import { describe, expect, it } from "vitest";

import {
  checkStates,
  checkTree,
  collapsedFor,
  foldersInFile,
  leavesOf,
  markAll,
  markedLeaves,
  noneCollapsed,
  pathOf,
  searchVisible,
  shownNodes,
  toggle,
  toggleCollapsed,
  unmarkAll,
  validMarks,
  type CheckItem,
} from "./check-tree";

// O exemplo do dono (seção 34): uma pasta por sistema, uma subpasta por ambiente, e em cada uma as conexões do mesmo papel ("DATA FIX", que o time divide, e
// "NOMINAL", de cada um). Mais uma pasta vazia e uma conexão na raiz.
const folder = (key: string, parentKey: string | null, name: string, selectable = true): CheckItem => ({ key, kind: "folder", parentKey, name, selectable });
const connection = (key: string, parentKey: string | null, name: string, selectable = true): CheckItem => ({ key, kind: "connection", parentKey, name, selectable });

const items: CheckItem[] = [
  connection("c-raiz", null, "Avulsa"),
  folder("estoque", null, "Estoque"),
  folder("prd", "estoque", "Production PRD"),
  folder("dev", "estoque", "Desenvolvimento DEV"),
  connection("prd-fix", "prd", "DATA FIX"),
  connection("prd-nominal", "prd", "NOMINAL"),
  connection("dev-fix", "dev", "DATA FIX"),
  connection("dev-nominal", "dev", "NOMINAL"),
  folder("vazia", null, "Arquivo morto"),
];
const tree = checkTree(items);
const keys = (nodes: readonly { key: string }[]) => nodes.map((node) => node.key);

describe("checkTree: a árvore de marcar (RN-TRANSF-002)", () => {
  it("na ordem do navegador: dentro de cada pasta, as subpastas primeiro e depois as conexões, cada grupo pelo nome", () => {
    expect(keys(tree.nodes)).toEqual(["vazia", "estoque", "dev", "dev-fix", "dev-nominal", "prd", "prd-fix", "prd-nominal", "c-raiz"]);
    expect(tree.nodes.map((node) => node.depth)).toEqual([0, 0, 1, 2, 2, 1, 2, 2, 0]);
  });

  it("as folhas são as conexões e as pastas vazias, que têm a caixa delas próprias", () => {
    expect(tree.nodes.filter((node) => node.leaf).map((node) => node.key)).toEqual(["vazia", "dev-fix", "dev-nominal", "prd-fix", "prd-nominal", "c-raiz"]);
    expect(keys(leavesOf(tree, "estoque"))).toEqual(["dev-fix", "dev-nominal", "prd-fix", "prd-nominal"]);
    expect(keys(leavesOf(tree, "vazia"))).toEqual(["vazia"]);
  });

  it("o item cujo pai não está na lista vai para a raiz, e as pastas em ciclo não aparecem", () => {
    const odd = checkTree([folder("a", "b", "A"), folder("b", "a", "B"), connection("x", "sumiu", "X"), folder("self", "self", "Ela mesma")]);
    expect(keys(odd.nodes)).toEqual(["self", "x"]);
  });

  it("o que está dentro de uma pasta que não pode ser marcada também não pode (RN-TRANSF-014: a pasta leva junto o que está dentro dela)", () => {
    const invalid = checkTree([folder("p", null, "P", false), connection("c", "p", "C"), folder("q", "p", "Q")]);
    expect(invalid.nodes.map((node) => [node.key, node.selectable])).toEqual([
      ["p", false],
      ["q", false],
      ["c", false],
    ]);
    expect(leavesOf(invalid, "p")).toEqual([]);
  });

  it("a pasta que pode ser marcada e só tem dentro o que não pode é folha, com a caixa dela própria, como a vazia (RN-TRANSF-011 e 014)", () => {
    const onlyInvalid = checkTree([folder("p", null, "P"), connection("bad", "p", "Bad", false), folder("q", "p", "Q", false)]);
    const p = onlyInvalid.byKey.get("p")!;

    expect([p.leaf, p.selectable, p.end - p.index]).toEqual([true, true, 3]);
    expect(keys(leavesOf(onlyInvalid, "p"))).toEqual(["p"]);
    expect([...toggle(onlyInvalid, "p", new Set())]).toEqual(["p"]);
    expect([...markAll(onlyInvalid, new Set())]).toEqual(["p"]);
    expect(checkStates(onlyInvalid, new Set(["p"])).get("p")).toBe("checked");
    expect(keys(foldersInFile(onlyInvalid, new Set(["p"])))).toEqual(["p"]);
    expect(keys(markedLeaves(onlyInvalid, new Set(["p", "bad"])))).toEqual(["p"]);
  });
});

describe("checkStates: marcada, desmarcada ou mista", () => {
  it("a pasta mostra o estado de tudo o que está dentro dela, a qualquer profundidade", () => {
    const states = checkStates(tree, new Set(["prd-fix", "prd-nominal"]));

    expect(states.get("prd")).toBe("checked");
    expect(states.get("dev")).toBe("unchecked");
    expect(states.get("estoque")).toBe("mixed");
    expect(states.get("prd-fix")).toBe("checked");
    expect(states.get("vazia")).toBe("unchecked");
  });

  it("a conexão marcada deixa a pasta dela mista, e não há como deixá-la de fora (RN-TRANSF-002)", () => {
    const states = checkStates(tree, new Set(["dev-fix"]));
    expect([states.get("dev"), states.get("estoque")]).toEqual(["mixed", "mixed"]);
    expect(keys(foldersInFile(tree, new Set(["dev-fix"])))).toEqual(["estoque", "dev"]);
  });

  it("o que não pode ser marcado não conta: a pasta com tudo o que pode marcado fica marcada", () => {
    const partly = checkTree([folder("p", null, "P"), connection("ok", "p", "Ok"), connection("bad", "p", "Bad", false)]);
    expect(checkStates(partly, new Set(["ok"])).get("p")).toBe("checked");
    expect(checkStates(partly, new Set()).get("p")).toBe("unchecked");
  });
});

describe("toggle, markAll e unmarkAll", () => {
  it("o clique na pasta marca tudo o que está dentro, ou desmarca tudo quando tudo já estava marcado", () => {
    const marked = toggle(tree, "estoque", new Set(["prd-fix"]));
    expect([...marked].sort()).toEqual(["dev-fix", "dev-nominal", "prd-fix", "prd-nominal"]);
    expect([...toggle(tree, "estoque", marked)]).toEqual([]);
  });

  it("o clique na folha marca e desmarca só ela, e a pasta vazia tem a dela", () => {
    expect([...toggle(tree, "vazia", new Set())]).toEqual(["vazia"]);
    expect([...toggle(tree, "prd-fix", new Set(["prd-fix", "dev-fix"]))]).toEqual(["dev-fix"]);
  });

  it("com a busca, a caixa da pasta age só no que está à vista: marca o que se vê, ou desmarca o que se vê quando tudo o que se vê já estava marcado", () => {
    const visible = searchVisible(tree, "data fix");
    const marked = toggle(tree, "estoque", new Set(["dev-nominal"]), visible);
    expect([...marked].sort()).toEqual(["dev-fix", "dev-nominal", "prd-fix"]);
    // A pasta continua mista: há algo escondido e desmarcado dentro dela.
    expect(checkStates(tree, marked).get("estoque")).toBe("mixed");
    expect([...toggle(tree, "estoque", marked, visible)]).toEqual(["dev-nominal"]);
  });

  it("“Marcar todas” e “Desmarcar todas” agem em tudo, ou só no que a busca mostra", () => {
    expect(markAll(tree, new Set()).size).toBe(6);
    expect([...markAll(tree, new Set(), searchVisible(tree, "nominal"))].sort()).toEqual(["dev-nominal", "prd-nominal"]);
    expect([...unmarkAll(tree, new Set(["dev-fix", "dev-nominal", "c-raiz"]), searchVisible(tree, "nominal"))].sort()).toEqual(["c-raiz", "dev-fix"]);
    expect(unmarkAll(tree, new Set(["dev-fix"])).size).toBe(0);
  });

  it("o que não pode ser marcado não se marca por nenhum caminho", () => {
    const partly = checkTree([folder("p", null, "P"), connection("ok", "p", "Ok"), connection("bad", "p", "Bad", false)]);
    expect([...toggle(partly, "p", new Set())]).toEqual(["ok"]);
    expect([...toggle(partly, "bad", new Set())]).toEqual([]);
    expect([...markAll(partly, new Set())]).toEqual(["ok"]);
  });
});

describe("searchVisible: a busca da árvore, pelas regras da RN-BUSCA-001", () => {
  it("sem diferenciar maiúsculas nem acentos; a conexão que casa aparece com as pastas do caminho", () => {
    expect([...(searchVisible(tree, "DATA fix") ?? [])].sort()).toEqual(["dev", "dev-fix", "estoque", "prd", "prd-fix"]);
    expect([...(searchVisible(tree, "desenvolvimento") ?? [])].sort()).toEqual(["dev", "dev-fix", "dev-nominal", "estoque"]);
    expect(searchVisible(checkTree([connection("c", null, "Produção")]), "producao")).toEqual(new Set(["c"]));
  });

  it("a pasta que casa aparece com tudo o que está dentro dela; sem texto, tudo à vista", () => {
    expect([...(searchVisible(tree, "estoque") ?? [])].sort()).toEqual(["dev", "dev-fix", "dev-nominal", "estoque", "prd", "prd-fix", "prd-nominal"]);
    expect(searchVisible(tree, "   ")).toBeNull();
  });
});

describe("shownNodes, foldersInFile, markedLeaves e validMarks", () => {
  it("as linhas desenhadas: as que a busca mostra, menos as de dentro de uma pasta fechada", () => {
    expect(keys(shownNodes(tree, null, new Set(["estoque"])))).toEqual(["vazia", "estoque", "c-raiz"]);
    expect(keys(shownNodes(tree, searchVisible(tree, "nominal"), new Set(["dev"])))).toEqual(["estoque", "dev", "prd", "prd-nominal"]);
  });

  it("com a busca, a pasta fechada antes dela abre para mostrar o que casou dentro dela, e limpar a busca a devolve fechada (RN-BUSCA-001)", () => {
    const shown = (collapsed: typeof noneCollapsed, query: string) => keys(shownNodes(tree, searchVisible(tree, query), collapsedFor(collapsed, query)));
    const closed = toggleCollapsed(noneCollapsed, "", "estoque");

    expect(shown(closed, "")).toEqual(["vazia", "estoque", "c-raiz"]);
    expect(shown(closed, "data fix")).toEqual(["estoque", "dev", "dev-fix", "prd", "prd-fix"]);
    expect(shown(closed, "  DATA FIX ")).toEqual(["estoque", "dev", "dev-fix", "prd", "prd-fix"]);
    expect(shown(closed, "")).toEqual(["vazia", "estoque", "c-raiz"]);
  });

  it("a pasta fechada durante a busca fica fechada só nela: outro texto abre tudo de novo, e sem busca valem as fechadas antes", () => {
    const closed = toggleCollapsed(noneCollapsed, "", "estoque");
    const inSearch = toggleCollapsed(closed, "data fix", "dev");

    expect(keys(shownNodes(tree, searchVisible(tree, "data fix"), collapsedFor(inSearch, "data fix")))).toEqual(["estoque", "dev", "prd", "prd-fix"]);
    expect([...collapsedFor(inSearch, "nominal")]).toEqual([]);
    expect([...collapsedFor(inSearch, "")]).toEqual(["estoque"]);
    expect([...collapsedFor(toggleCollapsed(inSearch, "data fix", "dev"), "data fix")]).toEqual([]);
  });

  it("o caminho de pastas acima de um item, para o leitor de tela distinguir as linhas de mesmo nome; na raiz, nenhum", () => {
    expect(pathOf(tree, "prd-nominal")).toBe("Estoque / Production PRD");
    expect(pathOf(tree, "dev-nominal")).toBe("Estoque / Desenvolvimento DEV");
    expect(pathOf(tree, "estoque")).toBeNull();
    expect(pathOf(tree, "c-raiz")).toBeNull();
    expect(pathOf(checkTree([folder("self", "self", "Ela mesma"), connection("x", "sumiu", "X")]), "self")).toBeNull();
    expect(pathOf(tree, "sumiu")).toBeNull();
  });

  it("as pastas do arquivo são as do caminho de cada folha marcada e a pasta vazia marcada, cada uma uma vez, na ordem da árvore", () => {
    expect(keys(foldersInFile(tree, new Set(["prd-fix", "dev-fix", "vazia", "c-raiz"])))).toEqual(["vazia", "estoque", "dev", "prd"]);
    expect(foldersInFile(tree, new Set(["c-raiz"]))).toEqual([]);
    expect(keys(markedLeaves(tree, new Set(["c-raiz", "vazia", "prd-fix"])))).toEqual(["vazia", "prd-fix", "c-raiz"]);
  });

  it("o item que outra janela excluiu sai com a marca, e a marca numa pasta que ganhou conteúdo não vale mais", () => {
    expect([...validMarks(tree, new Set(["prd-fix", "sumiu", "estoque"]))]).toEqual(["prd-fix"]);
  });

  it("4.000 linhas respondem sem travar: a árvore, os estados e o clique na pasta de cima", () => {
    const many: CheckItem[] = [];
    for (let index = 0; index < 2000; index++) many.push(folder(`f${index}`, index === 0 ? null : `f${Math.floor((index - 1) / 4)}`, `Pasta ${index}`));
    for (let index = 0; index < 2000; index++) many.push(connection(`c${index}`, `f${index}`, `Conexão ${index}`));

    const started = performance.now();
    const big = checkTree(many);
    const marked = toggle(big, "f0", new Set());
    checkStates(big, marked);
    foldersInFile(big, marked);
    expect(marked.size).toBe(2000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
