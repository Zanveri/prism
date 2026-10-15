import type { Connection, Folder } from "./connections.schema";

/**
 * O ambiente que a tela mostra numa etiqueta (RN-CONN-015 e RN-PASTA-005): o nome, a cor e, quando é herdado, a pasta de onde vem (`folder` nulo é o
 * ambiente próprio). Só o nome faz um ambiente: sem nome a etiqueta não tem o que dizer (`EnvironmentPill`), então a cor sozinha não conta.
 */
export type ShownEnvironment = { name: string; color: string | null; folder: Folder | null };

type EnvironmentOwner = Pick<Connection, "folderID" | "environmentName" | "environmentColor">;

export type EnvironmentLookup = {
  /** O que a conexão mostra: o ambiente próprio sempre ganha; sem ele, o da pasta mais próxima acima dela que tenha um. */
  connection: (connection: EnvironmentOwner) => ShownEnvironment | null;
  /** A etiqueta da pasta na árvore: só o ambiente dela, sem o de cima. */
  folder: (folderID: string) => ShownEnvironment | null;
  /** O que uma conexão sem ambiente próprio herda nesta pasta (`null` é a raiz): o formulário diz "Herda … da pasta …". */
  inheritedIn: (folderID: string | null) => ShownEnvironment | null;
};

/**
 * Quem responde o ambiente de cada conexão e de cada pasta, a partir da lista de pastas (RN-PASTA-005). Pura: mover a conexão ou a pasta é
 * outra lista (a que a API devolve depois), e a resposta muda com ela. A pasta que sumiu e as pastas em ciclo (que a API recusa, RN-PASTA-003)
 * não passam nada adiante. As respostas são guardadas: a mesma conexão (o mesmo objeto) e a mesma pasta dão o mesmo objeto, para o que é
 * memorizado (`TableTabPanel`) não redesenhar à toa; quem monta de novo, quando a lista de pastas muda, é o `useMemo` de quem usa.
 */
export function environmentLookup(folders: readonly Folder[]): EnvironmentLookup {
  const byID = new Map(folders.map((folder) => [folder.id, folder]));
  const own = new Map<string, ShownEnvironment | null>();
  const inherited = new Map<string | null, ShownEnvironment | null>();
  const ofConnection = new WeakMap<EnvironmentOwner, ShownEnvironment | null>();

  function folderEnvironment(folderID: string): ShownEnvironment | null {
    if (!own.has(folderID)) {
      const folder = byID.get(folderID);
      own.set(folderID, folder?.environmentName ? { name: folder.environmentName, color: folder.environmentColor, folder: null } : null);
    }
    return own.get(folderID) ?? null;
  }

  function inheritedIn(folderID: string | null): ShownEnvironment | null {
    if (inherited.has(folderID)) return inherited.get(folderID) ?? null;

    const parentOf = (folder: Folder) => (folder.parentID === null ? undefined : byID.get(folder.parentID));
    const seen = new Set<string>();
    let found: ShownEnvironment | null = null;
    // Sobe pelas pastas até a primeira com ambiente. A pasta em ciclo sem ambiente no caminho fica sem herança, e não presa num laço.
    for (let current = folderID === null ? undefined : byID.get(folderID); current !== undefined && !seen.has(current.id); current = parentOf(current)) {
      seen.add(current.id);
      if (!current.environmentName) continue;

      // Quem herda da mesma pasta recebe o mesmo objeto, qualquer que seja a pasta de baixo por onde se chegou a ela.
      if (!inherited.has(current.id)) inherited.set(current.id, { name: current.environmentName, color: current.environmentColor, folder: current });
      found = inherited.get(current.id) ?? null;
      break;
    }

    inherited.set(folderID, found);
    return found;
  }

  function connection(owner: EnvironmentOwner): ShownEnvironment | null {
    if (ofConnection.has(owner)) return ofConnection.get(owner) ?? null;

    const shown = owner.environmentName ? { name: owner.environmentName, color: owner.environmentColor, folder: null } : inheritedIn(owner.folderID);
    ofConnection.set(owner, shown);
    return shown;
  }

  return { connection, folder: folderEnvironment, inheritedIn };
}
