import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button, Dialog, LockIcon, TextField, useToast } from "@/components/ui";
import { allowRefusal, type ApiResult } from "@/lib/api/prism-api";
import { apiFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { revealPasswordSchema } from "../_lib/connections.schema";
import { userPasswordRefusals } from "../_lib/user-password";

const copy = connectionsCopy.userPassword;
const formID = "user-password-form";

export type UserPasswordDialogProps<T> = {
  /** O que muda, numa frase: "Desmarcar “Somente leitura” de MES Produção" (RN-PROT-003). */
  change: string;
  /** Grava de novo o que a pessoa pediu, agora com a senha dela: o mesmo `PATCH`, com `userPassword`. */
  send: (userPassword: string) => Promise<ApiResult<T>>;
  /** As recusas do pedido que quem abriu mostra no próprio lugar (o 422 dos campos, o nome repetido): voltam a ele, como valor. */
  refusals?: readonly string[];
  /**
   * O pedido terminou sem ser pela senha: gravou (`ok`), ou foi recusado por um motivo que quem abriu mostra; `null` quando a falha já foi ao aviso
   * central (a API fora do ar, uma regra que só ela conhece). Quem abriu fecha o diálogo.
   */
  onDone: (result: ApiResult<T> | null) => void;
  onClose: () => void;
};

/**
 * "Confirme a sua senha" da mudança do somente leitura (RN-PROT-003), como o de revelar a senha (RN-CONN-002): diz o que muda, avisa que cinco senhas
 * erradas seguidas fecham o cofre e mostra o erro no campo. Abre ao salvar a mudança que pede a senha (marcar ou desmarcar "Somente leitura" numa conexão
 * ou pasta que já existe) e quando a API a pede sem a tela prever (422 `USER_PASSWORD_REQUIRED`: mover para fora de uma pasta somente leitura).
 *
 * A senha errada (`INVALID_PASSWORD`) e a que faltou (`USER_PASSWORD_REQUIRED`) ficam no campo, que volta vazio; o quinto erro seguido fecha o cofre (401
 * `VAULT_LOCKED`): a tela vai ao login e o aviso de atenção explica por quê, como no de revelar. Não há transação aberta a avisar: a tela ainda não tem o
 * Commit manual (RN-TX-001), e o Salvar da grade é uma transação própria. A senha não fica guardada depois da resposta: a mutação não é guardada
 * (`gcTime: 0`) e é esvaziada (`reset`) assim que a resposta chega.
 */
export function UserPasswordDialog<T>({ change, send, refusals = [], onDone, onClose }: UserPasswordDialogProps<T>) {
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});
  // Trocar a chave do campo o esvazia e devolve o foco a ele depois de uma senha recusada.
  const [attempt, setAttempt] = useState(0);

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async (userPassword: string) => allowRefusal(await send(userPassword), ...refusals, ...userPasswordRefusals),
    // Aqui e não em `mutate(…, { onSuccess })`: o `VaultGuard` já está levando a tela ao login, e o diálogo pode sair antes de a resposta chegar a quem o chamou.
    onSuccess: (result) => {
      if (!result.ok && result.error.code === "VAULT_LOCKED") toast.warning(connectionsCopy.toasts.vaultLockedAfterFiveAttempts);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;

    const parsed = parseForm(event.currentTarget, revealPasswordSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) return;

    mutation.mutate(parsed.data.password, {
      onSuccess: (result) => {
        mutation.reset();
        if (result.ok) return onDone(result);

        const { code } = result.error;
        if (code === "VAULT_LOCKED") return;
        if (code === "INVALID_PASSWORD" || code === "USER_PASSWORD_REQUIRED") {
          setErrors({ password: code === "INVALID_PASSWORD" ? copy.invalidPassword : (apiFieldErrors(result.error.errors).userPassword ?? copy.required) });
          setAttempt((current) => current + 1);
          return;
        }
        onDone(result);
      },
      onError: () => {
        mutation.reset();
        onDone(null);
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
      description={copy.description}
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
        <p className="rounded-md border border-border bg-panel px-3 py-2.5 font-medium text-ink">{change}</p>
        <TextField key={attempt} id="user-password" name="password" type="password" label={copy.password} autoComplete="current-password" autoFocus error={errors.password} className="h-11" />
        <p className="text-xs text-muted">{copy.attempts}</p>
      </form>
    </Dialog>
  );
}
