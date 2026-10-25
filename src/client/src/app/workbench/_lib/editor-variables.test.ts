import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { createEditorVariablesStore, editorEntries } from "./editor-variables";
import { createQueryRunner, type DocRange, type QueryRunner } from "./use-query-runner";
import { panelRows } from "./variables-panel";
import { analysisEffect, connectVariables, hoverAt, tailText, variablesDecorations, variablesEditor } from "./variables-extension";
import { inlineEvaluator } from "./variables/evaluator-inline";
import { hasStatement } from "./sql-statements";
import { readScript } from "./variables/script";
import { declaredValues } from "./variables/tab-values";

// O fluxo inteiro das variáveis (seção 41), de ponta a ponta e sem tela: declarar, Alt+X, os valores no painel, a dica do ponteiro e o valor no fim da linha do
// editor (o armazém da aba chega a ele pela ponte de `editor-variables.ts`, a mesma que a aba monta), e o F5 e a atualização automática com os mesmos parâmetros.
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";
const queries = `POST ${sessions}/s1/queries`;
const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

function fakeApi() {
  const bodies: { sql: string; params?: { type: string; value: string | null }[] }[] = [];
  const answers: { route: string; answer: Response }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const route = `${init.method ?? "GET"} ${url.replace(base, "")}`;
    if (route === queries) bodies.push(JSON.parse(init.body as string));
    const index = answers.findIndex((candidate) => candidate.route === route);
    if (index < 0) throw new Error(`Sem resposta combinada para ${route}`);
    return answers.splice(index, 1)[0].answer;
  });
  const page = () => Response.json({ columns: [{ name: "id", type: "int8", kind: "number" }], rows: [["1"]], hasMore: false, elapsedMs: 4, truncatedCells: [], rowsAffected: null, resultID: "r1" });
  return {
    bodies,
    session: () => answers.push({ route: `POST ${sessions}`, answer: Response.json({ id: "s1", database: "mes" }, { status: 201 }) }),
    answer: () => void answers.push({ route: queries, answer: page() }),
  };
}

function setup() {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: vi.fn(), evaluator: inlineEvaluator(), title: () => "consulta-1.sql" });
  return { api, runner };
}

const range = (text: string): DocRange => ({ doc: { text, blankLines: true }, engine: 1, from: 0, to: text.length });

/**
 * O editor da aba, sem DOM: o estado do CodeMirror com a extensão das variáveis, ligado ao armazém como a aba o liga (o `useEditorVariables` entrega
 * `declaredValues` do texto de agora ao armazém, e o `connectVariables` do editor o assina). `sync` refaz a entrega, como a renderização que vem depois de
 * um comando ou de uma pausa na digitação.
 */
function mountEditor(runner: QueryRunner, text: string) {
  let state = EditorState.create({ doc: text, extensions: [variablesEditor({ engine: () => 1, blankLines: () => true })] });
  const reread = () => (state = state.update({ effects: analysisEffect(state, 1, true) }).state);
  reread();
  const shown = () => declaredValues(runner.values.snapshot(), readScript(state.doc.toString(), 1, { blankLines: true }));
  const store = createEditorVariablesStore(shown());
  connectVariables({ dispatch: (spec: TransactionSpec) => void (state = state.update(spec).state) } as unknown as Pick<EditorView, "dispatch">, store, () => true);
  return {
    sync: () => store.update(shown()),
    /** A pessoa troca o texto todo (o que a pausa da digitação lê em seguida). */
    type(next: string) {
      state = state.update({ changes: { from: 0, to: state.doc.length, insert: next } }).state;
      reread();
    },
    at: (needle: string) => state.doc.toString().indexOf(needle),
    tails: () => tailsOf(state),
    hover: (position: number) => hoverAt(state, position)?.lines.map((line) => line.text) ?? null,
    tail: (name: string) => tailText(store.snapshot().get(name)),
  };
}

function tailsOf(state: EditorState) {
  const found: string[] = [];
  for (const cursor = variablesDecorations(state).tails.iter(); cursor.value !== null; cursor.next()) found.push((cursor.value.spec as { widget?: { text: string } }).widget?.text ?? "");
  return found;
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a ponte do armazém da aba para o editor (RN-VAR-025)", () => {
  it("a dica leva o valor inteiro (até 200) e o fim da linha o curto, com o '· N itens' da lista; a origem e a hora vão na dica", async () => {
    const { runner } = setup();
    const text = "let ids = [1, 2, 3]\nlet n = 7\n";
    await runner.runScriptDoc(range(text));

    const entries = editorEntries(declaredValues(runner.values.snapshot(), readScript(text, 1, { blankLines: true })));
    expect(entries.get("ids")).toMatchObject({ type: "number[]", value: "[1, 2, 3]", short: "[1, 2, 3] · 3 itens", stale: false });
    expect(entries.get("n")?.from).toMatch(/^literal · \d\d:\d\d:\d\d$/);
    expect(tailText(entries.get("ids"))).toBe("= [1, 2, 3] · 3 itens");
  });

  it("só avisa o editor quando algo muda: reler o mesmo texto não dispara nada", async () => {
    const { runner } = setup();
    const text = "let n = 7\n";
    await runner.runScriptDoc(range(text));
    const model = readScript(text, 1, { blankLines: true });
    const store = createEditorVariablesStore(declaredValues(runner.values.snapshot(), model));
    const listener = vi.fn();
    store.subscribe(listener);

    store.update(declaredValues(runner.values.snapshot(), readScript(text, 1, { blankLines: true })));
    expect(listener).not.toHaveBeenCalled();

    store.update(declaredValues(runner.values.snapshot(), readScript("let n = 8\n", 1, { blankLines: true })));
    expect(listener).toHaveBeenCalledOnce();
    expect(store.snapshot().get("n")?.stale).toBe(true);
  });
});

describe("o texto só de declarações", () => {
  it("conta como texto com comando: o botão Executar fica habilitado e o Ctrl+Enter chega ao executor", () => {
    expect(hasStatement("let x = 5\nconst y = x * 2", 1)).toBe(true);
  });
});

describe("declarar, Alt+X, painel, editor, F5 e atualização automática", () => {
  const text = "let dias = 30\nconst nome = 'Ana'\n\nselect id from pedido where dias = @dias and nome = @nome;";

  it("o valor aparece no painel, na dica do ponteiro e no fim da linha; mudar a declaração o deixa desatualizado nos três", async () => {
    const { api, runner } = setup();
    api.session();
    api.answer();
    const editor = mountEditor(runner, text);
    expect(editor.tail("dias")).toBeNull();
    expect(editor.hover(editor.at("@dias") + 2)).toEqual(["dias · ainda sem valor. Alt+X, ou Ctrl+Enter na declaração, calcula."]);

    await runner.runScriptDoc(range(text));
    editor.sync();

    // O painel Variáveis.
    const rows = panelRows(readScript(text, 1, { blankLines: true }), runner.values.snapshot()).filter((row) => row.kind === "variable");
    expect(rows.map((row) => [row.name, row.type, row.value, row.origin, row.stale])).toEqual([
      ["dias", "number", "30", "literal", false],
      ["nome", "string", "'Ana'", "literal", false],
    ]);
    // O fim da linha e a dica do editor.
    expect(editor.tails()).toEqual(["= 30", "= 'Ana'"]);
    expect(editor.hover(editor.at("@dias") + 2)?.[0]).toMatch(/^dias: number = 30 · literal · \d\d:\d\d:\d\d$/);
    expect(editor.hover(editor.at("nome") + 1)?.[0]).toMatch(/^nome: string = 'Ana' · literal · /);
    // O comando saiu com os valores como parâmetros.
    expect(api.bodies).toEqual([{ sql: expect.stringContaining("dias = $1 and nome = $2"), params: [{ type: "number", value: "30" }, { type: "text", value: "Ana" }] }]);

    // A pessoa muda a declaração: o valor de antes fica desatualizado no painel e no editor.
    const changed = text.replace("let dias = 30", "let dias = 45");
    editor.type(changed);
    editor.sync();
    const stale = panelRows(readScript(changed, 1, { blankLines: true }), runner.values.snapshot()).find((row) => row.name === "dias");
    expect(stale?.stale).toBe(true);
    expect(editor.hover(editor.at("@dias") + 2)?.[0]).toMatch(/^dias: number = 30 · literal · \d\d:\d\d:\d\d · desatualizado$/);
    expect(editor.tail("dias")).toBeNull();
    expect(editor.tail("nome")).toBe("= 'Ana'");
  });

  it("Ctrl+Enter numa declaração mostra o valor no editor sem tocar na API", async () => {
    const { api, runner } = setup();
    const editor = mountEditor(runner, text);
    await runner.runItem({ doc: { text, blankLines: true }, engine: 1, from: 2, to: 2 });
    editor.sync();

    expect(api.bodies).toEqual([]);
    expect(editor.tail("dias")).toBe("= 30");
    expect(editor.tail("nome")).toBeNull();
  });

  it("o F5 executa de novo o texto enviado, com os mesmos parâmetros, e os valores não mudam", async () => {
    const { api, runner } = setup();
    api.session();
    api.answer();
    api.answer();
    const editor = mountEditor(runner, "let x = random.int(1, 1000000)\n\nselect @x from t;");
    await runner.runScriptDoc(range("let x = random.int(1, 1000000)\n\nselect @x from t;"));
    editor.sync();
    const shown = editor.tail("x");

    await runner.rerun();
    editor.sync();

    expect(api.bodies).toHaveLength(2);
    expect(api.bodies[1]).toEqual(api.bodies[0]);
    expect(editor.tail("x")).toBe(shown);
  });

  it("a atualização automática repete o comando com os mesmos parâmetros, a cada intervalo, e não reavalia nada", async () => {
    vi.useFakeTimers();
    const { api, runner } = setup();
    api.session();
    api.answer();
    const sql = "let x = random.int(1, 1000000)\n\nselect @x from t;";
    const editor = mountEditor(runner, sql);
    await runner.runScriptDoc(range(sql));
    editor.sync();
    const shown = editor.tail("x");
    const counter = runner.values.snapshot().counter;

    runner.autoRefresh.pause("hidden", false);
    runner.autoRefresh.start(5_000);
    api.answer();
    await vi.advanceTimersByTimeAsync(5_000);
    api.answer();
    await vi.advanceTimersByTimeAsync(5_000);
    editor.sync();

    expect(api.bodies).toHaveLength(3);
    expect(api.bodies[1]).toEqual(api.bodies[0]);
    expect(api.bodies[2]).toEqual(api.bodies[0]);
    expect(runner.values.snapshot().counter).toBe(counter);
    expect(editor.tail("x")).toBe(shown);
    runner.autoRefresh.stop();
  });
});
