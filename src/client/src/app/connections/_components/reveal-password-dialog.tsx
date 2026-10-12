import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button, Dialog, FormMessage, LockIcon, TextField, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { parseForm, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { revealPasswordSchema, type Connection } from "../_lib/connections.schema";
import { revealConnectionPassword } from "../_lib/connections.service";

const copy = connectionsCopy.reveal;
const formID = "reveal-password-form";

/**
 * "Confirme a sua senha": para ver a senha de uma conexão gravada o usuário digita a própria
 * (RN-CONN-002). Certo, a senha vai ao formulário que abriu o diálogo (`onRevealed`) e daqui não
 * sobra nada. Errada, a recusa fica no diálogo (`INVALID_PASSWORD`) e o campo volta vazio. O quinto
 * erro seguido fecha o cofre (RN-CONN-003): a tela vai ao login e o aviso de atenção explica por quê.
 *
 * Tanto a senha digitada quanto a revelada passariam pelo cache de mutações (`variables` e `data`):
 * a mutação não é guardada (`gcTime: 0`) e é esvaziada (`reset`) assim que a resposta chega.
 */
export function RevealPasswordDialog({ connection, onRevealed, onClose }: { connection: Connection; onRevealed: (password: string) => void; onClose: () => void }) {
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refused, setRefused] = useState(false);
  // Trocar a chave do campo o esvazia e devolve o foco a ele depois de uma senha recusada.
  const [attempt, setAttempt] = useState(0);

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async (password: string) => allowRefusal(await revealConnectionPassword(connection.id, password), "INVALID_PASSWORD", "VAULT_LOCKED"),
    // Aqui e não em `mutate(…, { onSuccess })`: o `VaultGuard` já está levando a tela ao login, e o
    // diálogo pode sair antes de a resposta ser entregue ao que o chamou.
    onSuccess: (result) => {
      if (!result.ok && result.error.code === "VAULT_LOCKED") toast.warning(connectionsCopy.toasts.vaultLockedAfterFiveAttempts);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setRefused(false);

    const parsed = parseForm(event.currentTarget, revealPasswordSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) return;

    mutation.mutate(parsed.data.password, {
      onSuccess: (result) => {
        mutation.reset();
        if (result.ok) onRevealed(result.data.password);
        else if (result.error.code === "INVALID_PASSWORD") {
          setRefused(true);
          setAttempt((current) => current + 1);
        }
      },
    });
  }

  const pending = mutation.isPending;

  return (
    <Dialog
      open
      size="sm"
      icon={<LockIcon />}
      title={copy.title}
      description={
        <>
          {copy.description.before}
          <b className="font-mono text-sm font-medium text-ink">{connection.userName}</b>
          {copy.description.between}
          <b className="font-semibold text-ink">{connection.name}</b>
          {copy.description.after}
        </>
      }
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? copy.submitting : copy.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField key={attempt} id="reveal-password" name="password" type="password" label={copy.password} autoComplete="current-password" autoFocus error={errors.password} className="h-11" />
        {refused ? <FormMessage tone="error">{copy.invalidPassword}</FormMessage> : null}
      </form>
    </Dialog>
  );
}
