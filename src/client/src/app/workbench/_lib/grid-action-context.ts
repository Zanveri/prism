import type { QueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { treeKey } from "./database-sessions.service";
import { inDatabase, type NavNode } from "./navigator-model";
import { objectKindOf, type ObjectKind } from "./object-kind";
import { recordsCopy } from "./records.copy";

/**
 * O que o "Copiar avançado" e o "Gerar SQL" da grade (seção 37) leem do que a tela já tem em cache, na hora da escolha, sem disparar consulta: o usuário do
 * cofre (as escolhas lembradas são dele), o somente leitura da conexão (RN-PROT-002) e, nos Registros, se a tabela da aba é tabela ou visão (o que a árvore
 * já carregou, como a Estrutura lê). Sem o dado em cache, o que vale quando não se sabe.
 */

type Cache = Pick<QueryClient, "getQueryData">;

/** O usuário do cofre aberto, como o guarda e a barra superior o leram; nulo antes de a sessão chegar. */
export const cachedUserName = (cache: Cache): string | null => cache.getQueryData(sessionQuery.queryKey)?.userName ?? null;

/** RN-PROT-002: a conexão é somente leitura agora, pelas proteções que valem (`protections` da API, com as da pasta); sem a lista, não se sabe e vale não. */
export const cachedReadOnly = (cache: Cache, connectionId: string | null): boolean =>
  connectionId !== null && (cache.getQueryData(connectionsQuery.queryKey)?.find((connection) => connection.id === connectionId)?.protections.readOnly ?? false);

/** O motivo que a API escreve na página de toda leitura da conexão somente leitura (RN-PROT-002, o `ReadOnlySql.ResultReason` dela). */
export const connectionReadOnlyReason = recordsCopy.edit.reasons.connectionReadOnly;

/**
 * RN-PROT-002 e RN-EDIT-002: o motivo de só leitura que vale agora, da página ou da recusa de antes. O da conexão somente leitura vale só enquanto ela é
 * somente leitura: desmarcada depois da leitura (RN-PROT-003), a editabilidade volta a ser a que não se sabe, e a tela pergunta à API (`edit-target`), como
 * numa página sem motivo. A página só diz o motivo em texto, e o desta proteção é um valor fixo da rota (seção 32). Os outros motivos (a união, o
 * `DISTINCT`) valem sempre, e o contrário (a conexão marcada depois da leitura) fica como era: a página não traz motivo, e a API recusa.
 */
export const readOnlyReasonNow = (reason: string | null, readOnlyNow: boolean): string | null => (reason === connectionReadOnlyReason && !readOnlyNow ? null : reason);

/** Tabela ou visão, pelos grupos "Tabelas" e "Visões" do esquema que a árvore já carregou (`objectKindOf`); `unknown` sem eles. */
export function cachedObjectKind(cache: Cache, place: { connectionId: string; database?: string; schema: string; name: string }): ObjectKind {
  const group = (objects: "tables" | "views") => cache.getQueryData<NavNode[]>(treeKey({ type: "objects", connectionId: place.connectionId, ...inDatabase(place.database), schema: place.schema, objects }));
  return objectKindOf(place.name, { tables: group("tables"), views: group("views") });
}
