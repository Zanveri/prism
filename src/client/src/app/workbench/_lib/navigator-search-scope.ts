import type { QueryClient } from "@tanstack/react-query";

import { byName } from "@/app/connections/_lib/connection-tree";
import type { Connection } from "@/app/connections/_lib/connections.schema";

import { missingCredentials } from "./credentials-missing";
import type { DatabaseSession, ObjectNames } from "./database-sessions.schema";
import { databaseOfKey } from "./database-sessions.service";
import { inDatabase, navKey } from "./navigator-model";
import type { CachedNames } from "./navigator-search";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.navigator.search;

/** A conexão como a busca a lê: o nome (que a linha de estado diz), o banco que ela guarda e se tem usuário e senha gravados (abrir a sessão pede os dois). */
export type ScopeConnection = Pick<Connection, "id" | "name" | "database" | "userName" | "hasPassword">;

/** Uma sessão da árvore aberta, como o cache a guarda: de que conexão, de que banco (`database` ausente: o da conexão, RN-ARVORE-006) e o nome que o banco tem. */
export type TreeSession = { connectionId: string; database?: string; databaseName: string };

const noSessions: readonly TreeSession[] = [];
const sessionSnapshots = new WeakMap<QueryClient, { signature: string; value: readonly TreeSession[] }>();

/**
 * As sessões da árvore abertas (`["database-session", conexão, …]` com dado): é o que diz quais bancos de cada conexão a busca pode procurar sem abrir nada. Só lê.
 * Devolve a MESMA lista enquanto nenhuma sessão entrou, saiu ou trocou de nome (a assinatura), para o escopo da busca, que o `useMemo` guarda, não se refazer a cada
 * render. Lida na renderização, como `cachedTree`, e não por uma loja assinada: ver o comentário do escopo no navegador.
 */
export function cachedTreeSessions(queryClient: QueryClient): readonly TreeSession[] {
  const sessions = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["database-session"] })
    .flatMap((query): TreeSession[] => {
      const [, connectionId] = query.queryKey;
      const session = query.state.data as DatabaseSession | undefined;
      if (typeof connectionId !== "string" || session === undefined) return [];

      const database = databaseOfKey(query.queryKey);
      return [{ connectionId, ...inDatabase(database), databaseName: database ?? session.database }];
    });

  const signature = sessions.map((session) => `${session.connectionId}\u0000${session.database ?? ""}\u0000${session.databaseName}`).join("\u0001");
  const previous = sessionSnapshots.get(queryClient);
  if (previous?.signature === signature) return previous.value;

  const value = sessions.length === 0 ? noSessions : sessions;
  sessionSnapshots.set(queryClient, { signature, value });
  return value;
}

/** Um banco de que a busca pede o índice: a chave dele (a do nó do banco na árvore, única na tela), a conexão, o banco (ausente: o da conexão) e o nome "Conexão › banco". */
export type SearchDatabase = { key: string; connectionId: string; database?: string; name: string };

export type SearchScope = {
  /** Os bancos do escopo, na ordem das conexões à vista: o da conexão primeiro e depois os outros do servidor que já têm sessão da árvore, por nome. */
  databases: SearchDatabase[];
  /** As conexões de fora que o "Buscar nelas também" abre (têm usuário e senha gravados). */
  openable: ScopeConnection[];
  /** As de fora que ele pula, porque abri-las chamaria o "Editar conexão" (RN-TRANSF-016). */
  withoutCredentials: ScopeConnection[];
  /** As que não estavam conectadas e estão abrindo a sessão agora (o nó aberto, ou o próprio botão): não são de fora, entram no escopo quando a sessão abrir. */
  connecting: ScopeConnection[];
};

const searchDatabase = (connection: ScopeConnection, database: string | undefined, databaseName: string): SearchDatabase => ({
  key: navKey({ type: "database", connectionId: connection.id, ...inDatabase(database) }),
  connectionId: connection.id,
  ...inDatabase(database),
  name: copy.databaseName(connection.name, databaseName),
});

/**
 * O escopo da busca (RN-BUSCA-002): as conexões que a árvore mostra (`connections`, já depois do seletor de ambiente e de "Só as conectadas"), e, delas, só as
 * conectadas (`connected`, a definição única: a sessão da árvore aberta ou uma aba conectada). De cada uma, o banco da conexão (a conexão conectada só por uma aba
 * ainda não tem sessão da árvore, e a busca a abre sem abrir o nó) e cada outro banco do servidor que a pessoa já abriu (`sessions`). Nunca um banco que ninguém abriu.
 *
 * As que não estão conectadas ficam de fora: `openable` são as que "Buscar nelas também" abre e `withoutCredentials` as que ele pula. As que estão conectando agora
 * (`connecting`: o nó aberto, ou o próprio botão) não são de fora: entram no escopo quando a sessão abrir, e a linha de estado já as conta como buscadas. A conexão
 * conectada só por uma aba, sem sessão da árvore e sem usuário ou senha gravados (a pessoa os apagou depois de conectar), não tem como abrir a sessão sem chamar o
 * "Editar conexão": fica sem índice.
 */
export function searchScope({ connections, connected, connecting, sessions }: { connections: readonly ScopeConnection[]; connected: ReadonlySet<string>; connecting: ReadonlySet<string>; sessions: readonly TreeSession[] }): SearchScope {
  const ofConnection = new Map<string, TreeSession[]>();
  for (const session of sessions) ofConnection.set(session.connectionId, [...(ofConnection.get(session.connectionId) ?? []), session]);

  const scope: SearchScope = { databases: [], openable: [], withoutCredentials: [], connecting: [] };

  for (const connection of connections) {
    if (connected.has(connection.id)) {
      const own = ofConnection.get(connection.id) ?? [];
      const base = own.find((session) => session.database === undefined);
      if (base !== undefined || missingCredentials(connection) === null) scope.databases.push(searchDatabase(connection, undefined, base?.databaseName ?? connection.database));

      const others = own.flatMap((session) => (session.database === undefined ? [] : [{ name: session.database }])).sort(byName);
      for (const { name } of others) scope.databases.push(searchDatabase(connection, name, name));
    } else if (connecting.has(connection.id)) {
      scope.connecting.push(connection);
    } else {
      (missingCredentials(connection) === null ? scope.openable : scope.withoutCredentials).push(connection);
    }
  }

  return scope;
}

/** Os índices respondidos que são do escopo, na ordem dele: o das conexões que um filtro escondeu, ou que desconectaram, não entra na tela. */
export function indexesInScope(indexes: readonly CachedNames[], databases: readonly SearchDatabase[]): CachedNames[] {
  const byKey = new Map(indexes.map((index) => [navKey({ type: "database", connectionId: index.connectionId, ...inDatabase(index.database) }), index]));
  return databases.flatMap((database) => {
    const index = byKey.get(database.key);
    return index === undefined ? [] : [index];
  });
}

/** Um banco do escopo e o que a consulta do índice dele diz: a resposta (ainda não, se `undefined`) ou a falha, com a mensagem do banco e se foi a sessão que caiu. */
export type IndexReport = { database: SearchDatabase; names: ObjectNames | undefined; failure: { message: string; lost: boolean } | null };

/** Um banco ou uma conexão que a linha de estado cita: a chave dele (única na linha) e o nome que a pessoa lê. */
export type SearchTarget = { key: string; name: string };

/** O que "Tentar de novo" refaz: o índice de um banco (se a sessão caiu, abre outra, como a árvore faz) ou a abertura da sessão de uma conexão de fora. */
export type SearchRetry = { type: "index"; database: SearchDatabase; lost: boolean } | { type: "open"; connectionId: string };

export type SearchStatus = {
  /** Quantos bancos ainda esperam o índice, contando as conexões que estão abrindo a sessão agora: vão ser buscadas. */
  loading: number;
  cut: boolean;
  /** Os bancos cujo índice a API cortou em 50.000 nomes. */
  truncated: SearchTarget[];
  /** Os bancos cujo índice falhou e as conexões de fora cuja sessão não abriu, cada um com o que o "Tentar de novo" refaz. */
  failures: (SearchTarget & { message: string; retry: SearchRetry })[];
  /** Quantas conexões a busca deixou de fora por não estarem conectadas, e, dentre elas, quantas o botão pula. */
  leftOut: number;
  withoutCredentials: number;
};

/**
 * O que a linha de estado da busca diz (RN-BUSCA-002), a partir do que cada consulta respondeu. `reports`: um por banco do escopo. `openFailures`: as conexões de fora
 * cuja sessão da árvore falhou ao abrir, com a mensagem do banco (a de credencial faltando não entra: quem trata é o "Editar conexão"). `cut`: o corte de 200 por banco
 * deixou achados de fora (`IndexLevels.cuts`). A falha de um índice que já tem resposta (o "Atualizar" que falhou) também aparece: a busca segue com a resposta que tinha.
 */
export function searchStatusOf({ reports, openFailures, cut, scope }: { reports: readonly IndexReport[]; openFailures: readonly { connection: ScopeConnection; message: string }[]; cut: boolean; scope: Pick<SearchScope, "openable" | "withoutCredentials" | "connecting"> }): SearchStatus {
  const failures: SearchStatus["failures"] = [
    ...reports.flatMap(({ database, failure }) => (failure === null ? [] : [{ key: database.key, name: database.name, message: failure.message, retry: { type: "index", database, lost: failure.lost } as const }])),
    ...openFailures.map(({ connection, message }) => ({ key: `open:${connection.id}`, name: connection.name, message, retry: { type: "open", connectionId: connection.id } as const })),
  ];

  return {
    loading: reports.filter((report) => report.failure === null && report.names === undefined).length + scope.connecting.length,
    cut,
    truncated: reports.filter((report) => report.names?.truncated === true).map(({ database }) => ({ key: database.key, name: database.name })),
    failures,
    leftOut: scope.openable.length + scope.withoutCredentials.length,
    withoutCredentials: scope.withoutCredentials.length,
  };
}

/**
 * Se a linha "Nada encontrado para “x”." pode aparecer (RN-BUSCA-002): só quando a busca terminou em todo o escopo, sem índice a caminho e sem banco que falhou. Com um índice
 * a caminho, a linha de estado diz "Buscando…" sozinha; com uma falha, ela diz "Não foi possível buscar em …", e dizer "Nada encontrado" junto afirmaria o que a busca não
 * sabe: o banco que falhou pode ter o nome. Sem linha de estado (a busca não olha nada), não há o que esperar.
 */
export function nothingFoundShown(status: Pick<SearchStatus, "loading" | "failures"> | null): boolean {
  return status === null || (status.loading <= 0 && status.failures.length === 0);
}
