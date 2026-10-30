import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePage, type FakeElement } from "@/lib/testing/fake-page";

import type { QueryTab } from "../_lib/workbench-model";

// O foco ao abrir, fechar e trocar de aba (RN-ABAS-019) na área das abas (`WorkbenchTabs`), com os ganchos do React simulados e uma página de mentira
// (`createFakePage`): um lugar só decide QUANDO focar, num efeito depois de a aba aparecer, e cada aba diz COMO (`tabEntries`). A área de trabalho
// (`useWorkbench`), a faixa, os painéis e a ponte são de mentira, como em `workbench-tabs.result-place.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const runner = { values: { snapshot: () => ({ values: new Map(), counter: 0 }) }, getState: () => ({ status: "idle" }), autoRunSettled: () => Promise.resolve(), autoRefresh: { pause: vi.fn() }, sessionOf: () => null, transaction: { getState: () => ({ open: false }) } };
  const workbench = {
    tabs: [] as unknown[],
    activeTabId: null as string | null,
    resultActive: false,
    runnerOf: () => runner,
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    showEntry: vi.fn(),
    setResultPlace: vi.fn(),
  };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  /** A área de trabalho é a tela mostrada (a rota); a escondida por baixo de Configurações não decide o foco. */
  const screen = { on: true };

  return { ...createHookRuntime(), workbench, toast, screen };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: vi.fn(), tellWindows: () => {}, resultWindowsAvailable: () => false, onResultWindowClosed: () => () => {}, onResultWindowState: () => () => {} }));
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => rt.screen.on }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ ...noop, disconnectLog: { subscribe: () => () => {}, getSnapshot: () => new Set(), forget: () => {}, mark: () => {} }, ...rt.workbench }) }));
vi.mock("./result-host", () => ({ releaseFocusIn: vi.fn(), focusResultIn: vi.fn(), resultHostOf: vi.fn(() => null) }));
vi.mock("./use-script-saving", () => ({ useScriptSaving: () => ({ save: async () => true, dialog: null }) }));
vi.mock("./query-tab", () => ({ QueryTabPanel: () => null }));
vi.mock("./table-tab/table-tab", () => ({ TableTabPanel: () => null }));
vi.mock("./script-dialogs", () => ({ UnsavedScriptsDialog: () => null }));
vi.mock("./unsaved-edits-dialog", () => ({ UnsavedEditsDialog: () => null }));
vi.mock("./tab-strip", () => ({ TabStrip: () => null, panelElementId: (id: string) => `painel-${id}`, tabElementId: (id: string) => `aba-${id}` }));

import { vaultLock } from "@/lib/api/vault-lock";
import { elementsOf } from "@/lib/testing/react-tree";

import { resultTabElementId } from "../_lib/result-place";
import { resultFocus } from "../_lib/result-slots";
import { tabEntries, tabFocus } from "../_lib/tab-focus";
import { TabStrip } from "./tab-strip";
import { WorkbenchTabs } from "./workbench-tabs";

const noop = Object.fromEntries(["updateTab", "setTableView", "openTableTab", "reorderTab", "shiftTab", "releaseWindow", "markScriptEdited", "switchConnection", "switchDatabase", "holdForWindowClose", "releaseWindowClose"].map((name) => [name, vi.fn()]));

const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c1", sessionId: null, sql: "", ...over });

let page: ReturnType<typeof createFakePage>;
const entries: (() => void)[] = [];

/** A aba `id` registra a entrada dela, como o painel faz, e a prova espia o foco que ela recebe. */
function entryOf(id: string, focus = vi.fn(() => true)) {
  entries.push(tabEntries.register(id, focus));
  return focus;
}

/** O desenho de agora: a área das abas decide o foco no efeito que roda depois dele. */
function render() {
  return rt.render(() => WorkbenchTabs() as ReactElement);
}

/** Estado da área de trabalho: as abas dadas, com a ativa dada. */
function show(ids: string[], active: string | null) {
  rt.workbench.tabs = ids.map((id) => tab(id));
  rt.workbench.activeTabId = active;
}

beforeEach(() => {
  vi.clearAllMocks();
  page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
  rt.workbench.resultActive = false;
  rt.screen.on = true;
  tabFocus.forgetExcept(new Set());
  resultFocus.forgetExcept(new Set());
});

afterEach(() => {
  rt.unmount();
  for (const unregister of entries.splice(0)) unregister();
  tabFocus.forgetExcept(new Set());
  resultFocus.forgetExcept(new Set());
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("abrir uma aba por um gesto: o foco vai à entrada dela (RN-ABAS-019)", () => {
  let row: FakeElement;
  beforeEach(() => {
    row = page.element({ id: "linha-da-arvore" });
    page.focus(row);
  });

  it("com o foco ainda em quem pediu (o botão da linha do navegador), vai à entrada da aba que ficou ativa", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");

    tabFocus.request("a", row);
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o pedido é atendido uma vez só, e os desenhos seguintes (a lista de abas que muda a cada tecla) não puxam o foco de volta", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);

    render();
    rt.workbench.tabs = [tab("a", { sql: "select 1" })];
    render();
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("se o foco saiu de quem pediu para outro lugar vivo (o type-ahead andou na árvore, a pessoa clicou num campo), fica onde está, e o pedido é consumido", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    page.focus(page.element({ id: "outra-linha" }));

    render();
    expect(focus).not.toHaveBeenCalled();

    // O pedido já foi consumido: o foco perdido depois não o traz de volta.
    page.focus(null);
    render();
    expect(focus).not.toHaveBeenCalled();
  });

  it("com o foco perdido (o menu e o diálogo que abriram a aba fecharam), vai à entrada", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    row.remove();

    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o gesto que vem de um menu (o foco estava num item dele): o menu fecha e devolve o foco à linha da árvore, e a aba o recebe mesmo assim (RN-MENU-001)", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    const item = page.element({ id: "item-do-menu", inside: ['[role="menu"]'] });
    page.focus(item);
    tabFocus.request("a", item);
    item.remove();
    page.focus(row);

    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("a aba que já era a ativa (abrir a mesma tabela de novo): nada mais mudou além do pedido, e a versão dele refaz o efeito", () => {
    show(["a", "b"], "a");
    render();
    const focus = entryOf("a");

    tabFocus.request("a", row);
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o pedido de uma aba que ainda não é a ativa espera: a loja avisou antes de a lista de abas chegar (o script que vem da API), e a entrada é a da aba nova", () => {
    show(["a"], "a");
    render();
    const old = entryOf("a");
    const created = entryOf("b");

    tabFocus.request("b", row);
    render();
    expect(old).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();

    show(["a", "b"], "b");
    render();

    expect(old).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledOnce();
  });

  it.each([
    ["um diálogo, um menu ou uma lista aberta", () => page.setPopup(true)],
    ["o cofre bloqueado", () => vaultLock.lock()],
    ["outra tela à mostra (Configurações)", () => void (rt.screen.on = false)],
    ["o foco prometido por outra regra (o F6, a troca do lugar do resultado)", () => resultFocus.request("a", "result")],
  ])("com %s, o foco não é de ninguém aqui: nada, e o pedido é consumido", (_name, block) => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    block();

    render();

    expect(focus).not.toHaveBeenCalled();
    expect(tabFocus.take("a")).toBeNull();
  });

  it("a lista de sugestões do editor aberta (o Ctrl+clique no nome de uma tabela, logo depois de digitar) não bloqueia: ela é do editor que perde o foco, e a aba nova o recebe", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    // O painel do editor já está escondido, e a lista dele, que só fecha quando o editor perde o foco de vez, ainda está no `body`.
    page.setLists([true]);
    row.remove();

    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it.each([
    ["uma lista de outro lugar (a lista de conexões, um seletor)", [false]],
    ["uma lista de outro lugar junto com a de sugestões do editor", [true, false]],
  ])("%s, essa sim tomou o foco: nada, e o pedido é consumido", (_name, lists) => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    page.setLists(lists);

    render();

    expect(focus).not.toHaveBeenCalled();
    expect(tabFocus.take("a")).toBeNull();
  });

  it("em desenvolvimento o `StrictMode` recria o editor logo depois de o foco chegar (o foco cai no corpo da página): a entrada o leva de novo, no fim da mesma tarefa", async () => {
    show(["a"], "a");
    render();
    const editor = page.element({ id: "editor-a", inside: [content] });
    const focus = entryOf("a", vi.fn(() => (page.focus(editor), true)));
    tabFocus.request("a", row);

    render();
    expect(focus).toHaveBeenCalledOnce();

    // O `StrictMode` desmonta o campo que acabou de nascer e o monta de novo: o foco se perde, sem `blur`.
    page.focus(null);
    await Promise.resolve();

    expect(focus).toHaveBeenCalledTimes(2);
    expect(page.active()).toBe(editor);
  });

  it("no app empacotado o foco fica onde a entrada o pôs, e ela não é chamada de novo", async () => {
    show(["a"], "a");
    render();
    const editor = page.element({ id: "editor-a", inside: [content] });
    const focus = entryOf("a", vi.fn(() => (page.focus(editor), true)));
    tabFocus.request("a", row);

    render();
    await Promise.resolve();

    expect(focus).toHaveBeenCalledOnce();
    expect(page.active()).toBe(editor);
  });

  it("sem aba ativa (a janela sem abas) o pedido espera, sem erro", () => {
    show([], null);
    render();

    tabFocus.request("a", row);

    expect(() => render()).not.toThrow();
    expect(tabFocus.take("a")).not.toBeNull();
  });

  it("a aba que saiu leva o pedido dela: o provedor pediu e a aba fechou antes de aparecer", () => {
    show(["a"], "a");
    render();
    tabFocus.request("zumbi", row);

    show(["a", "b"], "a");
    render();

    expect(tabFocus.take("zumbi")).toBeNull();
  });
});

/** O `onKeyDown` do `section` das abas: onde o React trata a tecla que nasce dentro da área das abas. */
const sectionKeys = () => elementsOf(render()).find((element) => element.type === "section")!.props.onKeyDown as (event: unknown) => void;
const stripProps = () => elementsOf(render()).find((element) => element.type === TabStrip)!.props as Record<string, (...args: never[]) => unknown>;

const content = "[data-tab-content]";
const strip = "[data-tab-strip]";

describe("fechar: o foco vai à aba que ficou ativa, no mesmo lugar em que estava (RN-ABAS-019)", () => {
  let editorB: FakeElement;
  let tabA: FakeElement;
  let tabB: FakeElement;

  beforeEach(() => {
    show(["a", "b"], "b");
    render();
    editorB = page.element({ id: "editor-b", inside: [content] });
    tabA = page.element({ id: "aba-a", inside: [strip] });
    tabB = page.element({ id: "aba-b", inside: [strip] });
  });

  /** A aba `b` fecha: o painel e a entrada dela saem da página (o foco que estava neles vai para o corpo, sem `blur`), e a `a` fica ativa. */
  function closeB() {
    editorB.remove();
    tabB.remove();
    show(["a"], "a");
    render();
  }

  it("com o foco no conteúdo da aba que fechou (o editor, a grade), vai à entrada da aba que ficou ativa", () => {
    const entryA = entryOf("a");
    page.focus(editorB);

    closeB();

    expect(entryA).toHaveBeenCalledOnce();
    expect(tabA.focus).not.toHaveBeenCalled();
  });

  it("com o foco na faixa (a aba, o X pelo teclado), vai à aba ativa na faixa, sem rolar a página", () => {
    const entryA = entryOf("a");
    page.focus(tabB);

    closeB();

    expect(tabA.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(entryA).not.toHaveBeenCalled();
  });

  it("a região é a última em que o foco esteve: o diálogo, o menu e a lista no meio do caminho não a apagam", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    const menu = page.element({ id: "menu", inside: ['[role="menu"]', strip] });
    page.focus(menu);
    // O menu fecha e o foco que ele devolveria ao editor que saiu da página se perde com a aba.
    menu.remove();

    closeB();

    expect(entryA).toHaveBeenCalledOnce();
  });

  it("com a aba do resultado ativa, a aba na faixa é a do resultado", () => {
    const resultTab = page.element({ id: resultTabElementId("a"), inside: [strip] });
    page.focus(tabB);
    rt.workbench.resultActive = true;

    closeB();

    expect(resultTab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(tabA.focus).not.toHaveBeenCalled();
  });

  it("a aba ativa sem entrada registrada (o painel ainda por montar) fica com a aba da faixa: o foco não fica perdido", () => {
    page.focus(editorB);

    closeB();

    expect(tabA.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("a entrada que diz que o foco não chegou também cai na aba da faixa", () => {
    const entryA = entryOf("a", vi.fn(() => false));
    page.focus(editorB);

    closeB();

    expect(entryA).toHaveBeenCalledOnce();
    expect(tabA.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("o foco fora das abas (a linha do navegador, a busca) fica onde está", () => {
    const entryA = entryOf("a");
    const row = page.element({ id: "linha" });
    page.focus(row);

    closeB();

    expect(entryA).not.toHaveBeenCalled();
    expect(tabA.focus).not.toHaveBeenCalled();
    expect(page.active()).toBe(row);
  });

  it("o foco que a pessoa soltou clicando no vazio da janela não é puxado de volta quando a lista de abas muda por outro motivo (a sessão que abriu, o texto, o título)", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    page.focus(null);

    rt.workbench.tabs = [tab("a"), tab("b", { sessionId: "s-1", title: "outro-nome.sql" })];
    render();
    rt.workbench.tabs = [tab("a"), tab("b", { sessionId: "s-1", sql: "select 1" })];
    render();

    expect(entryA).not.toHaveBeenCalled();
    expect(tabB.focus).not.toHaveBeenCalled();
    expect(page.active()).toBe(page.body);
  });

  it("o foco que nunca esteve em aba nenhuma (acabou de abrir o app) não é inventado", () => {
    const entryA = entryOf("a");

    closeB();

    expect(entryA).not.toHaveBeenCalled();
    expect(tabA.focus).not.toHaveBeenCalled();
  });

  it("fechar uma aba de fundo com o foco no editor da ativa não muda nada: o foco não se perdeu", () => {
    show(["a", "b", "c"], "a");
    render();
    const editorA = page.element({ id: "editor-a", inside: [content] });
    const entryA = entryOf("a");
    page.focus(editorA);

    show(["a", "b"], "a");
    render();

    expect(entryA).not.toHaveBeenCalled();
    expect(page.active()).toBe(editorA);
  });

  it("a aba levada para outra janela e a de uma conexão excluída saem da lista como as fechadas: o foco vai à ativa", () => {
    const entryA = entryOf("a");
    page.focus(editorB);

    // O provedor tira a aba da lista (`detachTab`, `pruneWorkbench`) e a ativa passa à vizinha: o mesmo que fechar.
    closeB();

    expect(entryA).toHaveBeenCalledOnce();
  });

  it("a troca que esconde o painel em que o foco estava (seguir uma chave estrangeira): o foco perdido vai à entrada da aba que ficou ativa", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    // A aba `b` continua na lista, mas o painel dela ficou escondido (`hidden`), e a `a` é a ativa.
    editorB.visible = false;
    show(["a", "b"], "a");

    render();

    expect(entryA).toHaveBeenCalledOnce();
  });

  it("a última aba fecha: o foco vai à linha do navegador que o Tab alcança, e só se o navegador está à mostra", () => {
    show(["b"], "b");
    render();
    const row = page.element({ id: "linha-do-navegador" });
    page.answer('[role="tree"] [data-row-toggle][tabindex="0"]', row);
    page.focus(editorB);

    editorB.remove();
    show([], null);
    render();

    expect(row.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("a última aba fecha com o navegador escondido (Ctrl+B): não há onde pôr o foco, e nada é inventado", () => {
    show(["b"], "b");
    render();
    const row = page.element({ id: "linha-do-navegador" });
    row.visible = false;
    page.answer('[role="tree"] [data-row-toggle][tabindex="0"]', row);
    page.focus(editorB);

    editorB.remove();
    show([], null);
    render();

    expect(row.focus).not.toHaveBeenCalled();
  });

  it("a última aba fecha com o foco que estava fora das abas: fica onde estava", () => {
    show(["b"], "b");
    render();
    const row = page.element({ id: "linha-do-navegador" });
    page.answer('[role="tree"] [data-row-toggle][tabindex="0"]', row);
    const search = page.element({ id: "busca" });
    page.focus(search);

    show([], null);
    render();

    expect(row.focus).not.toHaveBeenCalled();
    expect(page.active()).toBe(search);
  });

  it("várias abas fecham de uma vez ('Fechar as outras'): o foco só se decide no fim da fila, depois da última", () => {
    show(["a", "b", "c"], "b");
    render();
    const entryA = entryOf("a");
    page.focus(editorB);

    // O menu da aba `a`: fecha a `b` agora e deixa a `c` na fila, e a `a` fica ativa.
    stripProps().onClose("others" as never, "a" as never);
    expect(rt.workbench.closeTab).toHaveBeenLastCalledWith("b");
    editorB.remove();
    show(["a", "c"], "a");
    render();

    // A fila fecha a `c`: ainda não é o fim, e o foco espera.
    expect(rt.workbench.closeTab).toHaveBeenLastCalledWith("c");
    expect(entryA).not.toHaveBeenCalled();

    show(["a"], "a");
    render();

    expect(entryA).toHaveBeenCalledOnce();
  });

  it("a pergunta de fechar (Descartar): o diálogo aberto não decide nada; depois dele a aba fecha, e o foco perdido vai à ativa. Cancelar devolve o foco a quem o tinha, sem mexer em nada", () => {
    const entryA = entryOf("a");
    page.focus(editorB);

    // O diálogo abre e leva o foco; ele não é uma região, e a região de quem o abriu fica guardada.
    const dialog = page.element({ id: "dialogo", inside: ['[aria-modal="true"]'] });
    page.setPopup(true);
    page.focus(dialog);
    render();
    expect(entryA).not.toHaveBeenCalled();

    // Cancelar: o diálogo devolve o foco ao editor, que continua na página.
    dialog.remove();
    page.setPopup(false);
    page.focus(editorB);
    render();
    expect(entryA).not.toHaveBeenCalled();

    // Descartar: o diálogo sai, a aba fecha, e o foco que o diálogo devolveria ao editor que saiu da página se perdeu.
    const again = page.element({ id: "dialogo-2", inside: ['[aria-modal="true"]'] });
    page.setPopup(true);
    page.focus(again);
    again.remove();
    page.setPopup(false);
    closeB();

    expect(entryA).toHaveBeenCalledOnce();
  });

  it("o foco prometido por outra regra (o F6, a troca do lugar do resultado) vale: o fechar não o desfaz", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    resultFocus.request("a", "result");

    closeB();

    expect(entryA).not.toHaveBeenCalled();
  });

  it("o Voltar e o Avançar já deixaram o foco na aba, na faixa (RN-ABAS-018): nada a fazer", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    // O gancho do histórico roda antes: ativa a `a` e leva o foco à aba dela na faixa.
    show(["a", "b"], "a");
    page.focus(tabA);

    render();

    expect(entryA).not.toHaveBeenCalled();
    expect(tabA.focus).toHaveBeenCalledOnce();
  });

  it("a volta das Configurações não é uma mudança de aba: o foco perdido por ela é do `WorkbenchSlot`, que o devolve ao elemento que o tinha", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    rt.screen.on = false;
    render();
    page.focus(null);

    rt.screen.on = true;
    render();

    expect(entryA).not.toHaveBeenCalled();
  });

  it("com outra tela à mostra (Configurações), uma aba que fecha não leva o foco a lugar nenhum", () => {
    const entryA = entryOf("a");
    page.focus(editorB);
    rt.screen.on = false;

    closeB();

    expect(entryA).not.toHaveBeenCalled();
  });

  it.each([
    ["o cofre bloqueado", () => vaultLock.lock()],
    ["um menu ou uma lista aberta", () => page.setPopup(true)],
  ])("com %s, o foco perdido não é de ninguém aqui: nada", (_name, block) => {
    const entryA = entryOf("a");
    page.focus(editorB);
    block();

    closeB();

    expect(entryA).not.toHaveBeenCalled();
    expect(tabA.focus).not.toHaveBeenCalled();
  });
});

describe("o Ctrl+W vale em toda a janela da área de trabalho (RN-ABAS-001 e 019)", () => {
  const ctrlW = { key: "w", ctrlKey: true };
  let editor: FakeElement;
  beforeEach(() => {
    show(["a", "b"], "b");
    render();
    editor = page.element({ id: "editor-b", inside: [content] });
  });

  it("com o foco perdido no corpo da página, fecha a aba ativa, e a tecla é tratada: nunca chega ao menu do Electron", () => {
    const event = page.key(ctrlW);

    expect(rt.workbench.closeTab).toHaveBeenCalledExactlyOnceWith("b");
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("o Cmd+W do macOS faz o mesmo", () => {
    page.key({ key: "W", metaKey: true });

    expect(rt.workbench.closeTab).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("com o foco no navegador (a linha da árvore, a busca), também fecha a aba ativa", () => {
    page.focus(page.element({ id: "busca" }));

    page.key(ctrlW);

    expect(rt.workbench.closeTab).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("a tecla que nasce dentro da área das abas é tratada pelo `section`, e a janela a vê já tratada: fecha uma aba só", () => {
    page.focus(editor);
    const event = page.keyEvent({ ...ctrlW, target: editor });

    sectionKeys()(event);
    page.press(event);

    expect(rt.workbench.closeTab).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("o segundo Ctrl+W fecha a próxima aba, com o foco caindo no corpo da página (a causa do pedido 6: ninguém devolvia o foco, e o `section` não via mais a tecla)", () => {
    page.focus(editor);
    const first = page.keyEvent({ ...ctrlW, target: editor });
    sectionKeys()(first);
    page.press(first);
    expect(rt.workbench.closeTab.mock.calls).toEqual([["b"]]);

    // A aba fecha: o painel sai da página e leva o foco ao corpo. Sem entrada registrada, ninguém o devolve.
    editor.remove();
    show(["a"], "a");
    render();
    expect(page.active()).toBe(page.body);

    page.key(ctrlW);

    expect(rt.workbench.closeTab.mock.calls).toEqual([["b"], ["a"]]);
  });

  it("com a entrada da aba que ficou ativa recebendo o foco, o segundo Ctrl+W nasce nela e fecha a próxima: três abas, três Ctrl+W", () => {
    show(["a", "b", "c"], "c");
    render();
    const editors = new Map(["a", "b", "c"].map((id) => [id, page.element({ id: `editor-${id}`, inside: [content] })]));
    for (const id of ["a", "b", "c"]) entryOf(id, vi.fn(() => (page.focus(editors.get(id)!), true)));
    page.focus(editors.get("c")!);

    const pressOnFocused = () => {
      const event = page.keyEvent({ ...ctrlW });
      sectionKeys()(event);
      page.press(event);
    };
    const closeActive = (remaining: string[], active: string | null, gone: string) => {
      editors.get(gone)!.remove();
      show(remaining, active);
      render();
    };

    pressOnFocused();
    closeActive(["a", "b"], "b", "c");
    pressOnFocused();
    closeActive(["a"], "a", "b");
    pressOnFocused();

    expect(rt.workbench.closeTab.mock.calls).toEqual([["c"], ["b"], ["a"]]);
  });

  it("com a aba do resultado ativa, volta o resultado ao painel, sem fechar nada", () => {
    show(["a"], "a");
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.resultActive = true;
    render();

    page.key(ctrlW);

    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "panel");
    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
  });

  it("sem aba nenhuma não faz nada, mas a tecla é tratada: nunca fecha a janela", () => {
    show([], null);
    render();

    const event = page.key(ctrlW);

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("com a lista de sugestões do editor aberta e o foco no editor, o Ctrl+W fecha a aba como sempre: o `section` trata a tecla antes, e a janela, que não age com listas abertas, não a trata de novo", () => {
    page.focus(editor);
    page.setLists([true]);
    const event = page.keyEvent({ ...ctrlW, target: editor });

    sectionKeys()(event);
    page.press(event);

    expect(rt.workbench.closeTab).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("a tecla segurada (repeat) é tratada, mas não fecha outra aba: uma por toque", () => {
    const event = page.key({ ...ctrlW, repeat: true });

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();

    // O `section` também: a tecla segurada com o foco no editor não passa de aba em aba.
    const held = page.keyEvent({ ...ctrlW, repeat: true, target: editor });
    sectionKeys()(held);
    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
  });

  it.each([
    ["um diálogo, um menu ou uma lista aberta", () => page.setPopup(true)],
    ["o cofre bloqueado", () => vaultLock.lock()],
  ])("com %s, não fecha nada e deixa a tecla como está", (_name, block) => {
    block();

    const event = page.key(ctrlW);

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("a tecla que alguém já tratou (o campo de edição de uma célula, o Ctrl+W da janela do resultado) não fecha", () => {
    const event = page.keyEvent(ctrlW);
    event.defaultPrevented = true;

    page.press(event);

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
  });

  it("com outra tela à mostra (Configurações), a janela não ouve a tecla", () => {
    rt.screen.on = false;
    rt.unmount();
    render();

    expect(page.listenerCount("window", "keydown")).toBe(0);
    page.key(ctrlW);

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
  });

  it.each([
    ["com Shift", { key: "w", ctrlKey: true, shiftKey: true }],
    ["com Alt", { key: "w", ctrlKey: true, altKey: true }],
    ["sem Ctrl nem Cmd", { key: "w" }],
    ["de outra letra", { key: "q", ctrlKey: true }],
  ])("a tecla %s não é o Ctrl+W", (_name, key) => {
    const event = page.key(key);

    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ao desmontar (sair do cofre) os ouvintes saem, e o do foco é de captura", () => {
    expect(page.listenerCount("window", "keydown")).toBe(1);
    expect(page.listenerCount("document", "focusin")).toBe(1);
    expect(page.capturing("focusin")).toBe(true);

    rt.unmount();

    expect(page.listenerCount("window", "keydown")).toBe(0);
    expect(page.listenerCount("document", "focusin")).toBe(0);
  });
});
