import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import { withEditedSql } from "./saved-scripts";
import type { QueryTab } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

/**
 * A conexão da aba de consulta e a troca dela (seção 27 da especificação, RN-ARVORE-008), sem React: a lista do botão da conexão na barra do editor (as
 * conectadas primeiro, com o caminho de pastas e a busca), o atalho Ctrl+9, as setas da lista e a aba depois de trocar.
 */

/** Uma conexão na lista da troca: a conexão, o caminho das pastas acima dela ("Clientes / ERP"; vazio na raiz) e se está conectada (`isConnected`). */
export type ConnectionChoice = { connection: Connection; path: string; connected: boolean };

/** O separador do caminho de pastas, como a barra do editor e o cabeçalho da aba da tabela escrevem um lugar. */
const pathSeparator = " / ";

/**
 * Os nomes das pastas acima da conexão, da raiz até a pasta dela. A pasta que não existe mais acaba a subida (a árvore põe na raiz o que ficou sem pai), e as
 * pastas em ciclo (que a API recusa, RN-PASTA-003) não prendem a conta.
 */
export function folderPathOf(folderID: string | null, folders: readonly Pick<Folder, "id" | "parentID" | "name">[]): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  const names: string[] = [];

  for (let folder = folderID === null ? undefined : byId.get(folderID); folder !== undefined && !seen.has(folder.id); folder = folder.parentID === null ? undefined : byId.get(folder.parentID)) {
    seen.add(folder.id);
    names.unshift(folder.name);
  }
  return names.join(pathSeparator);
}

/** Sem acento e sem caixa, como a busca do `Select`: "producao" acha "Produção". */
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/**
 * RN-ARVORE-008: as conexões da lista do botão da conexão, e as da faixa da aba sem conexão (RN-SCRIPT-005). As conectadas vêm primeiro; dentro de cada
 * grupo, em ordem de nome (sem diferenciar maiúsculas nem acento, com os números pela grandeza) e, no empate, de caminho. A busca acha o pedaço no nome, no
 * caminho de pastas e no servidor (`host`), sem acento e sem caixa; em branco, todas.
 */
export function connectionChoices(connections: readonly Connection[], folders: readonly Pick<Folder, "id" | "parentID" | "name">[], connected: ReadonlySet<string>, query = ""): ConnectionChoice[] {
  const wanted = normalize(query.trim());
  return connections
    .map((connection) => ({ connection, path: folderPathOf(connection.folderID, folders), connected: connected.has(connection.id) }))
    .filter((choice) => wanted === "" || [choice.connection.name, choice.path, choice.connection.host].some((text) => normalize(text).includes(wanted)))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || collator.compare(a.connection.name, b.connection.name) || collator.compare(a.path, b.path));
}

/**
 * RN-ARVORE-008: Ctrl+9 abre a lista das conexões da aba, como no DBeaver (o Cmd do macOS vale o Ctrl, como no Ctrl+S). A tecla é a do 9 da fileira de
 * números (`Digit9`), também nos teclados em que ela escreve outra coisa sem o Shift.
 */
export function connectionShortcut(event: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === "9" || event.code === "Digit9");
}

/** O atalho como a plataforma o escreve, na dica do botão e para o leitor de tela: Cmd+9 no macOS, Ctrl+9 nas outras (`navigator.platform`). */
export function connectionShortcutLabel(platform: string): { label: string; aria: string } {
  return /mac|iphone|ipad/i.test(platform) ? { label: workbenchCopy.editor.connection.shortcutMac, aria: "Meta+9" } : { label: workbenchCopy.editor.connection.shortcut, aria: "Control+9" };
}

/** As setas da lista, sem dar a volta (como no `Select`); sem nada marcado, a seta para baixo marca a primeira e a para cima, a última. `null`: não é seta. */
export function choiceKeyTarget(key: string, active: number, count: number): number | null {
  if (count === 0 || (key !== "ArrowDown" && key !== "ArrowUp")) return null;
  if (active < 0) return key === "ArrowDown" ? 0 : count - 1;
  return key === "ArrowDown" ? Math.min(active + 1, count - 1) : Math.max(active - 1, 0);
}

/**
 * RN-ARVORE-008: a aba de consulta passa a outra conexão. A sessão de antes era da conexão anterior e não serve mais (quem chama a fecha, e o executor novo
 * abre a desta na próxima execução); a aba vai ao banco padrão da conexão nova; o texto fica, o do editor deste instante (`sql`); a aba de um script refaz o
 * ponto pelo texto e pela conexão (RN-SCRIPT-003; o genérico não conta a conexão, RN-SCRIPT-005). `null` quando não há o que trocar: a aba de uma tabela (ela
 * é a tabela daquela conexão) e a mesma conexão. A aba sem conexão recebe a escolhida pelo mesmo caminho.
 */
export function withConnection(tab: QueryTab, connectionId: string, sql: string = tab.sql): QueryTab | null {
  if (tab.table !== undefined || tab.connectionId === connectionId) return null;

  const rest = { ...tab };
  delete rest.database;
  return withEditedSql({ ...rest, connectionId, sessionId: null }, sql);
}
