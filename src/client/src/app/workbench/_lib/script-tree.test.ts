import { describe, expect, it } from "vitest";

import {
  ancestorIds,
  buildScriptTree,
  folderContents,
  folderIdOf,
  folderKey,
  initialSaveFolder,
  scriptFolderNameProblem,
  scriptFolderOptions,
  scriptFolderPath,
  scriptFolderRefusal,
  scriptKey,
  scriptTreeLabels,
  scriptTreeMove,
  scriptTreeRowKey,
  visibleScriptRows,
  type ScriptTreeNode,
} from "./script-tree";
import type { ScriptFolder, ScriptSummary } from "./scripts.schema";

const folder = (id: string, name: string, parentID: string | null = null): ScriptFolder => ({ id, parentID, name, createdAt: "", updatedAt: "" });
const script = (id: string, name: string, folderID: string | null = null): ScriptSummary => ({ id, name, connectionID: null, database: null, folderID, icon: null, color: null, updatedAt: "" });

// Fechamento / (Mensal / (Abril, abril.sql), Anual, relatório.sql), Rascunhos (vazia), e na raiz álamo.sql e Zeta.sql.
const folders = [folder("f2", "Rascunhos"), folder("f3", "Mensal", "f1"), folder("f1", "Fechamento"), folder("f4", "Anual", "f1"), folder("f5", "Abril", "f3")];
const scripts = [script("s1", "Zeta"), script("s2", "relatório", "f1"), script("s3", "álamo"), script("s4", "abril", "f3")];

/** O desenho da árvore: cada linha como "  nome" com dois espaços por nível. */
const drawn = (nodes: readonly ScriptTreeNode[]): string[] => nodes.flatMap((node) => [`${"  ".repeat(node.depth)}${node.kind === "folder" ? `${node.folder.name}/` : node.script.name}`, ...(node.kind === "folder" ? drawn(node.children) : [])]);

describe("a árvore da seção Scripts (RN-SCRIPT-008)", () => {
  it("em cada nível, as subpastas primeiro e depois os scripts, cada grupo por nome, na ordem do português e sem diferenciar maiúsculas", () => {
    expect(drawn(buildScriptTree(folders, scripts))).toEqual(["Fechamento/", "  Anual/", "  Mensal/", "    Abril/", "    abril", "  relatório", "Rascunhos/", "álamo", "Zeta"]);
  });

  it("a pasta ou o script cuja pasta não está na lista vai para a raiz; as pastas em ciclo não aparecem", () => {
    const tree = buildScriptTree([folder("a", "A", "b"), folder("b", "B", "a"), folder("c", "Órfã", "sumiu")], [script("s1", "Solto", "sumiu")]);

    expect(drawn(tree)).toEqual(["Órfã/", "Solto"]);
  });

  it("cada pasta sabe o que tem direto dentro dela, como a API conta; a chave leva o tipo, e o nó, a pasta acima", () => {
    const [fechamento] = buildScriptTree(folders, scripts);

    expect(fechamento).toMatchObject({ key: folderKey("f1"), parentKey: null, contents: { folders: 2, scripts: 1 } });
    expect(fechamento.kind === "folder" && fechamento.children.map((child) => [child.key, child.parentKey])).toEqual([
      [folderKey("f4"), folderKey("f1")],
      [folderKey("f3"), folderKey("f1")],
      [scriptKey("s2"), folderKey("f1")],
    ]);
    expect(folderContents(folders, scripts, "f2")).toEqual({ folders: 0, scripts: 0 });
  });
});

describe("as linhas à vista e o teclado da árvore (RN-SCRIPT-008)", () => {
  const tree = buildScriptTree(folders, scripts);
  const names = (rows: ReturnType<typeof visibleScriptRows>) => rows.map(({ node, expanded }) => `${node.kind === "folder" ? node.folder.name : node.script.name}${expanded === null ? "" : expanded ? " [-]" : " [+]"}`);
  /** Todas as pastas com alguma coisa dentro abertas: a árvore inteira à vista. */
  const allOpen = new Set([folderKey("f1"), folderKey("f3")]);

  it("as pastas só abrem se estão entre as abertas (sem nada lembrado, só o primeiro nível); a aberta mostra o que tem dentro; a vazia não diz se está aberta", () => {
    expect(names(visibleScriptRows(tree, new Set()))).toEqual(["Fechamento [+]", "Rascunhos", "álamo", "Zeta"]);
    expect(names(visibleScriptRows(tree, new Set([folderKey("f1")])))).toEqual(["Fechamento [-]", "Anual", "Mensal [+]", "relatório", "Rascunhos", "álamo", "Zeta"]);
    expect(names(visibleScriptRows(tree, allOpen))).toEqual(["Fechamento [-]", "Anual", "Mensal [-]", "Abril", "abril", "relatório", "Rascunhos", "álamo", "Zeta"]);
  });

  it("a pasta aberta dentro de uma fechada continua escondida; o que não é pasta da árvore, no conjunto, não tem efeito", () => {
    expect(names(visibleScriptRows(tree, new Set([folderKey("f3")])))).toEqual(["Fechamento [+]", "Rascunhos", "álamo", "Zeta"]);
    expect(names(visibleScriptRows(tree, new Set([folderKey("sumiu"), scriptKey("s1")])))).toEqual(["Fechamento [+]", "Rascunhos", "álamo", "Zeta"]);
  });

  it("as setas para cima e para baixo andam sem dar a volta, e Home e End vão às pontas", () => {
    const rows = visibleScriptRows(tree, allOpen);

    expect(scriptTreeMove("ArrowDown", rows, 0)).toEqual({ focus: 1 });
    expect(scriptTreeMove("ArrowDown", rows, 8)).toEqual({ focus: 8 });
    expect(scriptTreeMove("ArrowUp", rows, 0)).toEqual({ focus: 0 });
    expect(scriptTreeMove("Home", rows, 5)).toEqual({ focus: 0 });
    expect(scriptTreeMove("End", rows, 0)).toEqual({ focus: 8 });
    expect(scriptTreeMove("a", rows, 0)).toBeNull();
    expect(scriptTreeMove("ArrowDown", [], 0)).toBeNull();
  });

  it("a seta para a direita abre a pasta fechada e, na aberta, vai à primeira linha dentro dela; na pasta vazia e no script, nada", () => {
    const open = visibleScriptRows(tree, allOpen);
    const closed = visibleScriptRows(tree, new Set());

    expect(scriptTreeMove("ArrowRight", closed, 0)).toEqual({ toggle: folderKey("f1") });
    expect(scriptTreeMove("ArrowRight", open, 0)).toEqual({ focus: 1 });
    expect(scriptTreeMove("ArrowRight", open, 6)).toBeNull();
    expect(scriptTreeMove("ArrowRight", open, 7)).toBeNull();
  });

  it("a seta para a esquerda fecha a pasta aberta e, na fechada ou num script, vai à pasta pai; na raiz, nada", () => {
    const rows = visibleScriptRows(tree, allOpen);

    expect(scriptTreeMove("ArrowLeft", rows, 2)).toEqual({ toggle: folderKey("f3") });
    expect(scriptTreeMove("ArrowLeft", rows, 4)).toEqual({ focus: 2 });
    expect(scriptTreeMove("ArrowLeft", rows, 1)).toEqual({ focus: 0 });
    expect(scriptTreeMove("ArrowLeft", rows, 6)).toBeNull();
    expect(scriptTreeMove("ArrowLeft", rows, 8)).toBeNull();
  });

  it("Enter, F2, Delete, Shift+F10 e a tecla de menu são da linha; o F10 sozinho e o resto, não", () => {
    const key = (name: string, shiftKey = false) => scriptTreeRowKey({ key: name, shiftKey });

    expect([key("Enter"), key("F2"), key("Delete"), key("F10", true), key("ContextMenu")]).toEqual(["enter", "rename", "delete", "menu", "menu"]);
    expect([key("F10"), key("a")]).toEqual([null, null]);
  });
});

describe("scriptTreeLabels (os nomes do type-ahead, RN-ARVORE-009)", () => {
  it("o nome da pasta ou do script de cada linha à vista, na ordem da árvore", () => {
    const tree = buildScriptTree(folders, scripts);

    expect(scriptTreeLabels(visibleScriptRows(tree, new Set([folderKey("f1"), folderKey("f3")])))).toEqual(["Fechamento", "Anual", "Mensal", "Abril", "abril", "relatório", "Rascunhos", "álamo", "Zeta"]);
    expect(scriptTreeLabels(visibleScriptRows(tree, new Set()))).toEqual(["Fechamento", "Rascunhos", "álamo", "Zeta"]);
  });
});

describe("o nome da pasta de scripts (RN-SCRIPT-007)", () => {
  it("de 1 a 60 caracteres depois de normalizado, sem caractere de controle no que foi digitado", () => {
    expect(scriptFolderNameProblem("   ", [], null)).toBe("empty");
    expect(scriptFolderNameProblem("a".repeat(61), [], null)).toBe("tooLong");
    expect(scriptFolderNameProblem(` ${"é".repeat(60)} `, [], null)).toBeNull();
    expect(scriptFolderNameProblem("Fecha\tmento", [], null)).toBe("control");
  });

  it("único entre as irmãs, sem diferenciar maiúsculas: o mesmo nome noutra pasta passa, e a pasta não colide com ela mesma", () => {
    expect(scriptFolderNameProblem("MENSAL", folders, "f1")).toBe("taken");
    expect(scriptFolderNameProblem("Mensal", folders, null)).toBeNull();
    expect(scriptFolderNameProblem("mensal", folders, "f1", "f3")).toBeNull();
  });

  it("a recusa da API no campo: o nome repetido, e o inválido com o problema que a tela acha nele", () => {
    expect(scriptFolderRefusal("SCRIPT_FOLDER_ALREADY_EXISTS", "a")).toBe("taken");
    expect(scriptFolderRefusal("SCRIPT_FOLDER_NAME_INVALID", "a\nb")).toBe("control");
    expect(scriptFolderRefusal("SCRIPT_FOLDER_NAME_INVALID", "a")).toBe("empty");
    expect(scriptFolderRefusal("SCRIPT_FOLDER_NOT_FOUND", "a")).toBeNull();
  });
});

describe("o caminho, as escolhas do campo Pasta e a pasta que o diálogo traz (RN-SCRIPT-009 e 010)", () => {
  it("o caminho vai da raiz até a pasta; na raiz e na pasta que não está na lista, nenhum", () => {
    expect(scriptFolderPath(folders, "f5")).toBe("Fechamento / Mensal / Abril");
    expect(scriptFolderPath(folders, null)).toBeNull();
    expect(scriptFolderPath(folders, "sumiu")).toBeNull();
    expect(scriptFolderPath([folder("a", "A", "b"), folder("b", "B", "a")], "a")).toBe("B / A");
  });

  it("as pastas com o caminho inteiro, na ordem da árvore; para mover uma pasta, sem ela nem as subpastas dela", () => {
    expect(scriptFolderOptions(folders).map((option) => [option.value, option.label])).toEqual([
      ["f1", "Fechamento"],
      ["f4", "Fechamento / Anual"],
      ["f3", "Fechamento / Mensal"],
      ["f5", "Fechamento / Mensal / Abril"],
      ["f2", "Rascunhos"],
    ]);
    expect(scriptFolderOptions(folders, "f3").map((option) => option.value)).toEqual(["f1", "f4", "f2"]);
  });

  it("as pastas acima de um nó, pelo identificador, para abri-las e lembrá-las (RN-NAV-014); na raiz, nenhuma; o ciclo não prende a subida", () => {
    expect(ancestorIds(folders, "f5")).toEqual(["f5", "f3", "f1"]);
    expect(ancestorIds(folders, null)).toEqual([]);
    expect(ancestorIds([folder("a", "A", "b"), folder("b", "B", "a")], "a")).toEqual(["a", "b"]);
  });

  it("a chave da pasta e o identificador dela, um do outro; a chave do script não é de pasta", () => {
    expect(folderIdOf(folderKey("f3"))).toBe("f3");
    expect(folderIdOf(scriptKey("s1"))).toBeNull();
    expect(folderIdOf(folderKey(""))).toBe("");
  });

  it("o Salvar como traz a pasta do script na lista; o script que outra janela excluiu, a que a aba lembra; o resto, Sem pasta", () => {
    expect(initialSaveFolder({ scriptId: "s4", remembered: "f2" }, scripts, folders)).toBe("f3");
    expect(initialSaveFolder({ scriptId: "s3", remembered: null }, scripts, folders)).toBe("");
    expect(initialSaveFolder({ scriptId: "excluido", remembered: "f2" }, scripts, folders)).toBe("f2");
    expect(initialSaveFolder({ scriptId: "excluido", remembered: null }, scripts, folders)).toBe("");
    expect(initialSaveFolder({ scriptId: "excluido", remembered: "sumiu" }, scripts, folders)).toBe("");
    expect(initialSaveFolder({ scriptId: null, remembered: null }, scripts, folders)).toBe("");
  });
});
