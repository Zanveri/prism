import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button, Dialog, LockIcon, TextField } from "@/components/ui";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import { rememberNetworkSecret } from "@/app/connections/_lib/connections.service";
import { connectionsCopy } from "@/app/connections/_lib/connections.copy";
import { allowRefusal } from "@/lib/api/prism-api";
import { apiFieldErrors } from "@/lib/utils/form";

import { credentialsMissingCode, credentialsMissingField, type NetworkSecretField } from "../_lib/credentials-missing";

const copy = connectionsCopy.networkSecret;
const formID = "network-secret-form";

/** O nome do segredo pedido: a frase secreta da chave, a senha do túnel por senha, ou a senha do proxy. */
export function networkSecretLabel(connection: Pick<Connection, "ssh">, field: NetworkSecretField): string {
  if (field === "proxyPassword") return copy.proxyPassword;
  return connection.ssh?.authMethod === "privateKey" ? copy.passphrase : copy.sshPassword;
}

export type NetworkSecretDialogProps = {
  connection: Connection;
  field: NetworkSecretField;
  /** Conectou com o segredo, e a API o guardou na memória: quem abriu fecha o diálogo e conecta de novo o que pediu. */
  onConnected: () => void;
  /** Ainda falta o outro segredo (o do proxy, depois do do túnel): quem abriu pede esse. */
  onMissing: (field: NetworkSecretField) => void;
  onClose: () => void;
};

/**
 * RN-REDE-006: o segredo que a conexão sem "Salvar credenciais" não grava, pedido ao conectar (pela árvore, por uma aba, pela barra do editor). A API conecta
 * com ele antes de guardá-lo: a recusa do servidor (a frase errada, a senha errada) fica no campo, com a mensagem dele, e o diálogo continua aberto. O segredo
 * não fica na tela depois da resposta (`gcTime: 0` e `reset`), e nunca vai ao cofre: a API o esquece ao desconectar a conexão ou ao fechar o cofre.
 */
export function NetworkSecretDialog({ connection, field, onConnected, onMissing, onClose }: NetworkSecretDialogProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  // Trocar a chave do campo o esvazia e devolve o foco a ele depois de uma recusa.
  const [attempt, setAttempt] = useState(0);
  const label = networkSecretLabel(connection, field);

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: async (value: string) => allowRefusal(await rememberNetworkSecret(connection.id, field, value), "DATABASE_CONNECTION_FAILED", credentialsMissingCode, "CONNECTION_INVALID"),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;

    const value = String(new FormData(event.currentTarget).get("secret") ?? "");
    if (value === "") return setError(copy.required(label));

    setError(undefined);
    mutation.mutate(value, {
      onSuccess: (result) => {
        mutation.reset();
        if (result.ok) return onConnected();

        const missing = credentialsMissingField(result.error);
        if (missing === "sshSecret" || missing === "proxyPassword") {
          if (missing !== field) return onMissing(missing);
        }
        setError(apiFieldErrors(result.error.errors)[field] ?? result.error.detail ?? result.error.title);
        setAttempt((current) => current + 1);
      },
      onError: () => {
        mutation.reset();
        onClose();
      },
    });
  }

  const pending = mutation.isPending;
  const server = field === "proxyPassword" ? connection.proxy : connection.ssh;

  return (
    <Dialog
      open
      size="sm"
      icon={<LockIcon />}
      title={copy.title(label)}
      description={copy.description}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? copy.connecting : copy.connect}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <p className="rounded-md border border-border bg-panel px-3 py-2.5 font-medium text-ink">
          {connection.name}
          {server === null || server === undefined ? null : <span className="block font-mono text-xs font-normal text-muted">{`${server.userName ? `${server.userName}@` : ""}${server.host}:${server.port}`}</span>}
        </p>
        <TextField key={attempt} id="network-secret" name="secret" type="password" label={label} autoComplete="off" autoFocus error={error} className="h-11" />
        <p className="text-xs text-muted">{label === copy.passphrase ? copy.forgottenPassphrase : copy.forgotten}</p>
      </form>
    </Dialog>
  );
}
