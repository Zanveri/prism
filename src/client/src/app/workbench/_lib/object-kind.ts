import type { NavNode } from "./navigator-model";

/** O que o Prism sabe de um objeto da aba de tabela: tabela, visão, ou `unknown` (a árvore daquela conexão ainda não o mostrou). */
export type ObjectKind = "table" | "view" | "unknown";

/**
 * A aba de uma tabela abre a tabela ou a visão (RN-TABELA-001) e não carrega qual das duas é. Quem sabe é a árvore da conexão: o grupo "Tabelas" e
 * o grupo "Visões" do esquema, que ela guarda em cache quando a pessoa os abre. Só se lê o cache (nunca se dispara consulta): achado no grupo das
 * visões, é visão; achado no das tabelas, tabela; do contrário, `unknown`, que não se toma por tabela (os grupos podem não ter chegado). O nome é
 * comparado como o catálogo o diz, com a caixa e os espaços dele, e só entram os nós do tipo do grupo.
 */
export function objectKindOf(name: string, groups: { tables: readonly NavNode[] | undefined; views: readonly NavNode[] | undefined }): ObjectKind {
  if (groups.views?.some((node) => node.kind === "view" && node.label === name)) return "view";
  if (groups.tables?.some((node) => node.kind === "table" && node.label === name)) return "table";
  return "unknown";
}
