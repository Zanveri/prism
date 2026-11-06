import { useState, type ReactNode } from "react";

import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ApiResult } from "@/lib/api/prism-api";

import { credentialsMissingField, isNetworkSecretField, type NetworkSecretField } from "../_lib/credentials-missing";
import { NetworkSecretDialog } from "./network-secret-dialog";

type Asking = { connection: Connection; field: NetworkSecretField; answer: (connected: boolean) => void };

/**
 * RN-REDE-006 fora da área de trabalho (o modo Construir abre as próprias sessões): `withSecret` faz o pedido e, quando a API o recusa por faltar o segredo do
 * túnel ou do proxy (RN-REDE-003 e 007), pede o segredo no mesmo diálogo e repete o pedido uma vez, depois de a API conectar com ele. Cancelado, devolve a
 * recusa como veio. `dialog` é o diálogo, que quem usa põe na tela.
 */
export function useNetworkSecretPrompt(connections: readonly Connection[] | undefined): { withSecret: <T>(connectionId: string, request: () => Promise<ApiResult<T>>) => Promise<ApiResult<T>>; dialog: ReactNode } {
  const [asking, setAsking] = useState<Asking | null>(null);

  async function withSecret<T>(connectionId: string, request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    const first = await request();
    if (first.ok) return first;

    const field = credentialsMissingField(first.error);
    const connection = connections?.find((candidate) => candidate.id === connectionId);
    if (field === null || !isNetworkSecretField(field) || connection === undefined) return first;

    const connected = await new Promise<boolean>((answer) => setAsking({ connection, field, answer }));
    return connected ? request() : first;
  }

  const dialog =
    asking === null ? null : (
      <NetworkSecretDialog
        key={`${asking.connection.id}:${asking.field}`}
        connection={asking.connection}
        field={asking.field}
        onConnected={() => {
          setAsking(null);
          asking.answer(true);
        }}
        onMissing={(field) => setAsking({ ...asking, field })}
        onClose={() => {
          setAsking(null);
          asking.answer(false);
        }}
      />
    );

  return { withSecret, dialog };
}
