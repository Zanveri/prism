import { dbeaverCopy } from "@/app/connections/_lib/dbeaver.copy";
import { transferCopy } from "@/app/connections/_lib/transfer.copy";

import { dataExportCopy } from "./data-export/data-export.copy";
import { dataImportCopy } from "./data-import/data-import.copy";
import { tableTargetOf, type NavNode } from "./navigator-model";
import { quoteIdentifier } from "./table-sql";
import { navigatorCopy } from "./navigator.copy";
import type { TableView } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.navigator.menu;
/** Os itens que vieram da tela de Conexões quando ela passou para o navegador (RN-NAV-003). */
const moved = navigatorCopy.menu;
/** Exportar e importar conexões (RN-TRANSF-001). */
const transfer = transferCopy.menu;
const dbeaver = dbeaverCopy.menu;

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
  | { type: "renameConnection" }
  | { type: "duplicateConnection" }
  | { type: "moveConnection" }
  | { type: "deleteConnection" }
  | { type: "newConnection" }
  | { type: "openTable"; view: TableView }
  | { type: "generateSelect" }
  /** RN-EXPORT-001: o assistente "Exportar dados", com a tabela (ou a visão) inteira como origem. */
  | { type: "exportData" }
  /** RN-IMPORT-001: o assistente "Importar dados", com a tabela de destino já escolhida (só na tabela). */
  | { type: "importData" }
  | { type: "copy"; text: string }
  | { type: "newFolder" }
  | { type: "renameFolder" }
  | { type: "editFolder" }
  | { type: "moveFolder" }
  | { type: "deleteFolder" }
  // RN-TRANSF-001: o "Exportar conexões" com a linha (a conexão, ou a pasta com tudo dentro) marcada, ou nada no espaço vazio; o "Importar conexões" com a
  // pasta da linha como o lugar, ou a raiz no espaço vazio.
  | { type: "exportConnections" }
  | { type: "importConnections" }
  // RN-DBEAVER-003: o "Importar do DBeaver" com a pasta da linha como o lugar, ou a raiz no espaço vazio.
  | { type: "importDbeaver" };

/**
 * `hint` diz por que a ação desabilitada não se aplica, embaixo do rótulo: "Não há pastas nem conexões para exportar.", ou o "Importar dados…" numa
 * conexão somente leitura.
 */
export type MenuItem = { id: string; label: string; action: MenuAction; shortcut?: string; disabled?: boolean; hint?: string };

/**
 * O que o menu precisa saber além da linha: o estado da conexão (só conta na linha da conexão), se ela está sendo desconectada e, na tabela, se a conexão
 * dela é somente leitura (pela opção dela ou de uma pasta acima): importar grava na tabela (RN-IMPORT-001).
 */
export type MenuState = {
  status: "connected" | "connecting" | "disconnected" | "failed";
  busy: boolean;
  readOnly?: boolean;
  /** Há processo principal para procurar o DBeaver? Fora do Electron o "Importar do DBeaver" fica desabilitado, com o motivo (RN-DBEAVER-003). Ausente vale sim. */
  dbeaverAvailable?: boolean;
};

/** O "Importar do DBeaver…" do menu, ou o "aqui" da pasta; desabilitado, com o motivo, fora do app. */
const dbeaverItem = (id: "importDbeaver" | "importDbeaverHere", label: string, available: boolean) => item(id, label, { type: "importDbeaver" }, available ? {} : { disabled: true, hint: dbeaverCopy.outside });

const item = (id: string, label: string, action: MenuAction, extra: Partial<Pick<MenuItem, "shortcut" | "disabled" | "hint">> = {}): MenuItem => ({ id, label, action, ...extra });

/** RN-NAV-009: a tecla do "Renomear", na pasta e na conexão. O menu a mostra, e a árvore a trata pelo `keyActionFor`. */
const renameShortcut = "F2";

/** A tecla, como o `KeyboardEvent` a entrega: só o que decide se ela é um atalho. */
export type KeyPress = { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };

/**
 * A ação do menu que uma tecla na linha faz (RN-NAV-009): o F2, sem modificador, é o "Renomear" da pasta e o da conexão, os mesmos itens que o
 * menu mostra com o atalho, e os dois mudam só o nome (o "Editar pasta…", RN-PASTA-006, não tem atalho). As outras linhas não se renomeiam, e as
 * outras teclas da árvore (setas, Enter, o menu) são tratadas por ela: `null`.
 */
export function keyActionFor(node: NavNode, press: KeyPress): MenuAction | null {
  if (press.key !== renameShortcut || press.shiftKey || press.ctrlKey || press.altKey || press.metaKey) return null;
  if (node.kind === "folder") return { type: "renameFolder" };
  if (node.kind === "connection") return { type: "renameConnection" };
  return null;
}

/**
 * O menu do botão direito no espaço vazio do navegador (RN-NAV-003, pedido do dono): "Nova conexão" e "Nova pasta", que criam na raiz, sempre
 * habilitadas (RN-NAV-002), e, num grupo depois delas, "Exportar conexões…" (nada marcado) e "Importar conexões…" (na raiz) (RN-TRANSF-001) e, depois deste, "Importar do DBeaver…" (RN-DBEAVER-003). Sem nenhuma
 * pasta e nenhuma conexão no cofre (`hasItems` falso) não há o que exportar: o item fica desabilitado, com o motivo. É o mesmo `ContextMenu` das linhas, nas
 * mesmas regras de teclado e de foco.
 */
export function backgroundMenu(hasItems = true, dbeaverAvailable = true): MenuItem[][] {
  return [
    [item("newConnection", moved.newConnection, { type: "newConnection" }), item("newFolder", moved.newFolder, { type: "newFolder" })],
    [
      item("exportConnections", transfer.exportConnections, { type: "exportConnections" }, hasItems ? {} : { disabled: true, hint: transfer.nothingToExport }),
      item("importConnections", transfer.importConnections, { type: "importConnections" }),
      dbeaverItem("importDbeaver", dbeaver.importDbeaver, dbeaverAvailable),
    ],
  ];
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
 * quando a aba ainda não existe; com ela aberta noutra vista, o item é que leva aos registros. O F2 renomeia a pasta e a conexão
 * (RN-NAV-009), pelo `keyActionFor`, que é quem a árvore consulta.
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
      // estado: excluir uma conexão conectada encerra as sessões dela (RN-CONN-014). Renomear (RN-NAV-009) e Duplicar (RN-CONN-016) também: renomear não
      // mexe na sessão, e a cópia nasce desconectada. Exportar (RN-TRANSF-001), num grupo próprio antes de "Copiar nome", também: não mexe em sessão, em
      // proteção nem no cofre.
      return [
        [connectOrDisconnect, newQuery],
        [refresh(!connected), item("editConnection", copy.editConnection, { type: "editConnection" })],
        [
          item("renameConnection", moved.renameConnection, { type: "renameConnection" }, { shortcut: renameShortcut }),
          item("duplicateConnection", moved.duplicateConnection, { type: "duplicateConnection" }),
          item("moveConnection", moved.moveConnection, { type: "moveConnection" }),
          item("deleteConnection", moved.deleteConnection, { type: "deleteConnection" }),
        ],
        [item("exportConnection", transfer.exportConnection, { type: "exportConnections" })],
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
        // RN-EXPORT-001: num grupo próprio, depois de "Gerar SELECT" e antes de "Copiar nome". RN-IMPORT-001: "Importar dados…" logo depois, só na tabela; na
        // conexão somente leitura, desabilitado com o motivo.
        node.kind === "table"
          ? [
              item("exportData", dataExportCopy.entry.menu, { type: "exportData" }, { disabled }),
              item("importData", dataImportCopy.entry.menu, { type: "importData" }, { disabled: disabled || state.readOnly === true, ...(!disabled && state.readOnly === true ? { hint: dataImportCopy.entry.readOnly } : {}) }),
            ]
          : [item("exportData", dataExportCopy.entry.menu, { type: "exportData" }, { disabled })],
        [copyName, item("copyQualifiedName", copy.copyQualifiedName, { type: "copy", text: qualified }, { disabled })],
      ];
    }

    // As ações que a tela de Conexões tinha para a pasta, e "Nova conexão" e "Nova pasta" dentro dela, como a barra de ações (RN-NAV-002 e 003). O
    // "Renomear" (F2, RN-NAV-009) muda só o nome, como o da conexão; o "Editar pasta…" (RN-PASTA-006) abre o diálogo inteiro: o nome, a cor e o ambiente.
    // Exportar as conexões dela (com tudo o que está dentro, a qualquer profundidade) e importar conexões nela, num grupo próprio antes de "Copiar nome"
    // (RN-TRANSF-001).
    case "folder":
      return [
        [item("newConnection", moved.newConnection, { type: "newConnection" }), item("newFolder", moved.newFolder, { type: "newFolder" })],
        [
          item("renameFolder", copy.renameFolder, { type: "renameFolder" }, { shortcut: renameShortcut }),
          item("editFolder", copy.editFolder, { type: "editFolder" }),
          item("moveFolder", copy.moveFolder, { type: "moveFolder" }),
          item("deleteFolder", copy.deleteFolder, { type: "deleteFolder" }),
        ],
        [
          item("exportConnections", transfer.exportConnections, { type: "exportConnections" }),
          item("importHere", transfer.importHere, { type: "importConnections" }),
          dbeaverItem("importDbeaverHere", dbeaver.importDbeaverHere, state.dbeaverAvailable !== false),
        ],
        [copyName],
      ];

    case "routine":
    case "sequence":
    case "column":
    case "index":
    case "foreignKey":
      return [[copyName]];

    case "loading":
    case "error":
      return [];
  }
}
