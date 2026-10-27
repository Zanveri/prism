/**
 * As pastas abertas do navegador, lembradas (RN-NAV-014): as pastas de conexões e as de scripts (RN-SCRIPT-008) voltam abertas ou fechadas como a pessoa as deixou,
 * ao abrir o app e ao entrar de novo, por usuário. Sem nada lembrado, todas começam fechadas: o que se guarda são as ABERTAS, e a pasta nova, a importada e a
 * criada noutra janela já nascem fechadas sem regra nenhuma.
 *
 * Fica numa chave própria do `localStorage` (`prism:navigator-folders:<usuário>`), e não na do navegador escondido (`prism:navigator:`, RN-NAV-008 e 012):
 * a forma é outra (conjuntos que mudam aos poucos, com poda e limite), e a 0.5.0 regrava a chave dela só com os dois campos que conhece, então um campo novo ali
 * se perderia na primeira gravação de quem voltasse a ela. O jeito de guardar é o mesmo das vizinhas: leitura tolerante, memória da sessão quando o
 * armazenamento falta ou recusa, e cada mudança gravada sobre o que está gravado AGORA. Só entram identificadores de pasta (GUID opacos): nada de nome, de
 * servidor nem de dado de conexão passa por aqui.
 *
 * Só as pastas, e não os nós abaixo das conexões (bancos, esquemas, grupos, tabelas): as chaves deles têm nome de banco, de esquema e de tabela, que são dado do
 * banco; e abrir a conexão é conectar (RN-SESSAO-001), então as conexões começam sempre fechadas (RN-ABAS-006).
 */

/** As duas árvores com pastas: a de conexões e a da seção Scripts. Cada uma tem a sua lista. */
export type FolderTree = "connections" | "scripts";

/** O que está gravado, em ordem de recência: o último de cada lista é o aberto mais recentemente. */
export type FolderMemory = { readonly connections: readonly string[]; readonly scripts: readonly string[] };

/** Quantas pastas abertas se lembra por árvore; passando disso, ficam as mais recentes. */
export const maxRememberedFolders = 1000;

const noIds: readonly string[] = Object.freeze([]);
const noMemory: FolderMemory = Object.freeze({ connections: noIds, scripts: noIds });
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O nome como a API o grava (RN-COFRE-010), como as chaves vizinhas: sem espaços nas pontas e em minúsculas. */
export function folderMemoryKey(userName: string): string {
  return `prism:navigator-folders:${userName.trim().toLowerCase()}`;
}

/** Os identificadores válidos de uma lista gravada: sem repetidos (vale a posição mais recente) e, passando do limite, os mais recentes. */
function idsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return noIds;

  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !guid.test(item)) continue;
    ids.delete(item);
    ids.add(item);
  }
  return Object.freeze([...ids].slice(-maxRememberedFolders));
}

/** O que está gravado pode ser qualquer coisa (editado à mão, cortado, de outra versão): nunca lança, e o que não se lê é ignorado, lista por lista. */
export function parseFolderMemory(raw: string | null): FolderMemory {
  if (raw === null) return noMemory;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return noMemory;

    const { connections, scripts } = value as { connections?: unknown; scripts?: unknown };
    return Object.freeze({ connections: idsOf(connections), scripts: idsOf(scripts) });
  } catch {
    return noMemory;
  }
}

/**
 * Uma mudança nas pastas abertas de uma árvore: abrir e fechar as dadas, fechar todas ("Recolher tudo", RN-NAV-002), ou deixar só as dadas (a poda: a pasta
 * excluída sai do que se lembra, RN-NAV-014).
 */
export type FolderChange = { readonly open: readonly string[] } | { readonly close: readonly string[] } | { readonly closeAll: true } | { readonly retain: readonly string[] };

/** Sem usuário (a sessão ainda não chegou), nada aberto e nada gravado; e o resultado de "Recolher tudo". */
export const noOpenFolders: ReadonlySet<string> = new Set();

/** O limite de pastas lembradas: passando dele, saem as mais antigas (o conjunto guarda a ordem em que as pastas entraram). */
const capped = (ids: Iterable<string>): ReadonlySet<string> => new Set([...ids].slice(-maxRememberedFolders));

/**
 * As pastas abertas depois da mudança. Pura. Devolve o MESMO conjunto quando nada muda (abrir a que já está aberta, fechar a que está fechada): é o que o
 * armazém compara para não gravar nem avisar, e o que o `useSyncExternalStore` compara para não redesenhar.
 */
export function applyFolderChange(current: ReadonlySet<string>, change: FolderChange): ReadonlySet<string> {
  if ("open" in change) {
    const added = change.open.filter((id) => !current.has(id));
    return added.length === 0 ? current : capped([...current, ...added]);
  }

  if ("close" in change) {
    const closing = new Set(change.close);
    return [...current].some((id) => closing.has(id)) ? new Set([...current].filter((id) => !closing.has(id))) : current;
  }

  if ("closeAll" in change) return current.size === 0 ? current : noOpenFolders;

  const kept = new Set(change.retain);
  return [...current].every((id) => kept.has(id)) ? current : new Set([...current].filter((id) => kept.has(id)));
}

export type FolderMemoryStorage = Pick<Storage, "getItem" | "setItem">;

/** As pastas abertas de cada árvore, como a janela as conhece. */
type Opened = { readonly connections: ReadonlySet<string>; readonly scripts: ReadonlySet<string> };

/**
 * O armazém das pastas abertas. `getStorage` é chamado a cada acesso e pode devolver `null` ou lançar: nos dois casos, e quando ler ou gravar falha, a escolha
 * vive na memória da sessão e a tela segue. Cada conjunto é o MESMO objeto até a próxima mudança daquela árvore (`useSyncExternalStore` compara por
 * referência), e mexer na lista de scripts não troca o conjunto das conexões.
 */
export function createFolderMemoryStore(getStorage: () => FolderMemoryStorage | null) {
  const cache = new Map<string, Opened>();
  const listeners = new Set<() => void>();

  function storage(): FolderMemoryStorage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function opened(userName: string): Opened {
    const key = folderMemoryKey(userName);
    let held = cache.get(key);

    if (held === undefined) {
      let raw: string | null = null;
      try {
        raw = storage()?.getItem(key) ?? null;
      } catch {
        // Leitura recusada: vale o padrão, tudo fechado.
      }
      const memory = parseFolderMemory(raw);
      held = Object.freeze({ connections: new Set(memory.connections), scripts: new Set(memory.scripts) });
      cache.set(key, held);
    }

    return held;
  }

  /** As pastas abertas desta árvore para este usuário. */
  function get(userName: string, tree: FolderTree): ReadonlySet<string> {
    return opened(userName)[tree];
  }

  /**
   * Muda as pastas abertas de uma árvore e devolve se a janela viu mudar; a mesma escolha de novo não grava nem avisa.
   *
   * Cada janela do app tem o seu armazém, que não ouve as outras (a janela aberta fica como está; a que abre depois começa como a última escolha). Por isso o
   * que vai para o armazenamento é a mudança sobre o que está gravado AGORA, e não sobre o que esta janela leu: com duas janelas, abrir uma pasta numa e outra
   * na outra guarda as duas, em vez de a última gravação desfazer a primeira com a lista velha que tinha. E por isso grava-se também quando a janela não vê
   * diferença e o gravado vê: "Recolher tudo" numa janela que mostra tudo fechado, com uma pasta que outra janela abriu depois, esvazia o gravado, que é o que
   * a pessoa pediu e o que volta na próxima entrada.
   */
  function change(userName: string, tree: FolderTree, folderChange: FolderChange): boolean {
    const current = opened(userName);
    const next = applyFolderChange(current[tree], folderChange);
    const seen = next !== current[tree];

    const key = folderMemoryKey(userName);
    if (seen) cache.set(key, Object.freeze({ ...current, [tree]: next }));
    try {
      const target = storage();
      if (target !== null) {
        const stored = parseFolderMemory(target.getItem(key));
        const before = new Set(stored[tree]);
        const after = applyFolderChange(before, folderChange);
        if (after !== before) target.setItem(key, JSON.stringify({ ...stored, [tree]: [...after] }));
      }
    } catch {
      // Cota cheia ou acesso bloqueado: a escolha vale até fechar o app.
    }

    if (!seen) return false;
    for (const listener of listeners) listener();
    return true;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  return { get, change, subscribe };
}

/** O armazém da janela: o gancho `useOpenFolders` fala com este. */
export const folderMemoryStore = createFolderMemoryStore(() => (typeof localStorage === "undefined" ? null : localStorage));
