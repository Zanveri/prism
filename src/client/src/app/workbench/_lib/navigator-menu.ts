import { tableTargetOf, type NavNode } from "./navigator-model";
import { quoteIdentifier } from "./table-sql";
import { navigatorCopy } from "./navigator.copy";
import type { TableView } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.navigator.menu;
/** Os itens que vieram da tela de Conexões quando ela passou para o navegador (RN-NAV-003). */
const moved = navigatorCopy.menu;

/**
 * O que um item do menu faz. O modelo só descreve; quem executa é a tela (`navigator.tsx`), que tem a conexão, a aba e o cache. Por
 * isso o que cada tipo de linha oferece se testa sem DOM.
 */
export type MenuAction =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "newQuery" }
  | { type: "refresh" }
  | { type: "editConnection" }
  | { type: "moveConnection" }
  | { type: "deleteConnection" }
  | { type: "newConnection" }
  | { type: "openTable"; view: TableView }
  | { type: "generateSelect" }
  | { type: "copy"; text: string }
  | { type: "newFolder" }
  | { type: "renameFolder" }
  | { type: "moveFolder" }
  | { type: "deleteFolder" };

export type MenuItem = { id: string; label: string; action: MenuAction; shortcut?: string; disabled?: boolean };

/** O que o menu precisa saber além da linha: o estado da conexão (só conta na linha da conexão) e se ela está sendo desconectada. */
export type MenuState = { status: "connected" | "connecting" | "disconnected" | "failed"; busy: boolean };

const item = (id: string, label: string, action: MenuAction, extra: Partial<Pick<MenuItem, "shortcut" | "disabled">> = {}): MenuItem => ({ id, label, action, ...extra });

/**
 * O menu do botão direito no espaço vazio do navegador (RN-NAV-003, pedido do dono): "Nova conexão" e "Nova pasta", que criam na raiz, sempre
 * habilitadas (RN-NAV-002). É o mesmo `ContextMenu` das linhas, nas mesmas regras de teclado e de foco.
 */
export function backgroundMenu(): MenuItem[][] {
  return [[item("newConnection", moved.newConnection, { type: "newConnection" }), item("newFolder", moved.newFolder, { type: "newFolder" })]];
}

/**
 * Como o menu foi aberto, pelo foco com que ele nasce: `first` é o teclado (Shift+F10 e a tecla de menu: o foco vai ao primeiro item) e `menu` é
 * o ponteiro (o botão direito: o foco vai ao menu, sem item ativo).
 */
export type MenuOpening = "first" | "menu";

/**
 * O `contextmenu` do ponteiro que chega com um menu aberto pelo teclado é o que a tecla de menu gera ao ser solta (no keyup; o Shift+F10 não
 * gera nenhum), em cima do menu que ela mesma abriu: se o foco ainda não estivesse no menu, ele cairia na linha e abriria um segundo menu, na
 * posição errada. O clique direito de verdade não é pego por isto: o `pointerdown` fora do menu já o fechou quando o `contextmenu` chega.
 */
export function ignoresContextMenu(open: MenuOpening | null, requested: MenuOpening): boolean {
  return open === "first" && requested === "menu";
}

/**
 * O menu de contexto de uma linha do navegador (RN-MENU-001), em grupos (entre dois grupos vai um separador). A ação que não se aplica
 * no estado atual vem desabilitada e não some: "Atualizar" numa conexão sem sessão não tem o que atualizar. Atalho só onde a árvore
 * já trata a tecla: o Enter abre a aba da tabela, na vista em que ela estiver (uma aba por tabela), e "Abrir registros" faz o mesmo
 * quando a aba ainda não existe; com ela aberta noutra vista, o item é que leva aos registros.
 *
 * Além do que a especificação lista, o banco e os grupos (Tabelas, Colunas…) têm "Atualizar", que a linha já oferece ao passar o
 * mouse: um botão direito que não faz nada em metade da árvore parece defeito. As linhas Carregando… e de erro não têm menu.
 * "Copiar nome" copia o nome cru, como a árvore o mostra. "Copiar nome qualificado" copia o que o "Gerar SELECT" escreve depois do `FROM`:
 * `"esquema"."nome"`, pelo mesmo `quoteIdentifier` (`table-sql.ts`, aspas sempre, nos três bancos), para colar no editor sem acerto à mão.
 */
export function menuFor(node: NavNode, state: MenuState): MenuItem[][] {
  const copyName = item("copyName", copy.copyName, { type: "copy", text: node.label });
  const newQuery = item("newQuery", copy.newQuery, { type: "newQuery" });
  const refresh = (disabled = false) => item("refresh", copy.refresh, { type: "refresh" }, { disabled });

  switch (node.kind) {
    case "connection": {
      const connected = state.status === "connected";
      const connectOrDisconnect = connected
        ? item("disconnect", copy.disconnect, { type: "disconnect" }, { disabled: state.busy })
        : item("connect", copy.connect, { type: "connect" }, { disabled: state.status === "connecting" });

      // Mover e Excluir eram da tela de Conexões (RN-NAV-003): lá, mover era trocar a pasta no formulário, e excluir, o botão dele. Valem em qualquer
      // estado: excluir uma conexão conectada encerra as sessões dela (RN-CONN-014).
      return [
        [connectOrDisconnect, newQuery],
        [refresh(!connected), item("editConnection", copy.editConnection, { type: "editConnection" })],
        [item("moveConnection", moved.moveConnection, { type: "moveConnection" }), item("deleteConnection", moved.deleteConnection, { type: "deleteConnection" })],
        [copyName],
      ];
    }

    // A consulta nova de um banco roda na sessão dele (RN-ARVORE-006), como a de um esquema.
    case "database":
      return [[newQuery, refresh()], [copyName]];

    case "schema":
      return [[newQuery, refresh()], [copyName]];

    case "group":
      return [[refresh()]];

    case "table":
    case "view": {
      // Sem saber onde a tabela está (não deve acontecer: a chave dela diz) as ações aparecem desabilitadas, como em qualquer outro estado em que não se
      // aplicam, e não somem; o nome cru continua habilitado.
      const target = tableTargetOf(node);
      const disabled = target === null;
      const qualified = target === null ? "" : `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.name)}`;

      return [
        [
          item("openRecords", copy.openRecords, { type: "openTable", view: "data" }, { shortcut: "Enter", disabled }),
          item("openStructure", copy.openStructure, { type: "openTable", view: "structure" }, { disabled }),
          item("openDiagram", copy.openDiagram, { type: "openTable", view: "diagram" }, { disabled }),
        ],
        [item("generateSelect", copy.generateSelect, { type: "generateSelect" }, { disabled })],
        [copyName, item("copyQualifiedName", copy.copyQualifiedName, { type: "copy", text: qualified }, { disabled })],
      ];
    }

    // As ações que a tela de Conexões tinha para a pasta, e "Nova conexão" e "Nova pasta" dentro dela, como a barra de ações (RN-NAV-002 e 003).
    case "folder":
      return [
        [item("newConnection", moved.newConnection, { type: "newConnection" }), item("newFolder", moved.newFolder, { type: "newFolder" })],
        [item("renameFolder", copy.renameFolder, { type: "renameFolder" }), item("moveFolder", copy.moveFolder, { type: "moveFolder" }), item("deleteFolder", copy.deleteFolder, { type: "deleteFolder" })],
        [copyName],
      ];

    case "routine":
    case "column":
    case "index":
    case "foreignKey":
      return [[copyName]];

    case "loading":
    case "error":
      return [];
  }
}
