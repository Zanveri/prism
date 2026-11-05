import { describe, expect, it } from "vitest";

import { answersByName, chipsOf, entriesOf, executionTitle, reusableExecution } from "./execution-tab";
import { scriptMenu } from "./saved-scripts";
import { toSavedWorkspace } from "./saved-workspace";
import { closeConfirmation } from "./tab-strip";
import { readTransfer, serializeTab } from "./tab-transfer";
import { fullFieldsOf } from "./variable-fields";
import { readScript } from "./variables/script";
import { withoutSessions } from "./workbench-lock";
import type { ExecutionTarget, QueryTab } from "./workbench-model";

// RN-VAR-029: a aba de execução do "Executar com valores…", sem a tela.
const scriptId = "0199c3a0-0000-7000-8000-00000000000a";
const execution = (over: Partial<ExecutionTarget> = {}): ExecutionTarget => ({ scriptId, name: "Pedidos do período", generic: false, values: null, ranAt: null, pending: null, ...over });
const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: "Pedidos do período", connectionId: "c-1", sessionId: null, sql: "let n = 10\nlet x: number\nlet s: string\nselect @n, @x, @s;", ...over });

describe("a aba de execução (RN-VAR-029)", () => {
  it("o título numera a segunda do mesmo script; o Executar do navegador reusa a mais recente na mesma conexão e no mesmo banco", () => {
    const tabs = [tab("a", { execution: execution() }), tab("b"), tab("c", { database: "mes", execution: execution() })];
    expect(executionTitle([], scriptId, "Pedidos do período")).toBe("Pedidos do período");
    expect(executionTitle(tabs, scriptId, "Pedidos do período")).toBe("Pedidos do período (3)");
    expect(reusableExecution([...tabs, tab("d", { execution: execution() })], scriptId, { connectionId: "c-1" })?.id).toBe("d");
    expect(reusableExecution(tabs, scriptId, { connectionId: "c-1", database: "mes" })?.id).toBe("c");
    expect(reusableExecution(tabs, scriptId, { connectionId: "c-2" })).toBeUndefined();
  });

  it("os valores da aba voltam aos campos pelo nome; o que falta sem padrão, ou não serve mais, abre o diálogo", () => {
    const { fields } = fullFieldsOf(readScript(tab("a").sql, 1, { blankLines: true }), 1, undefined, new Set());
    const values = { x: { type: "number" as const, value: "7" }, s: { type: "text" as const, value: " a " } };
    const answers = answersByName(fields, values);
    // O n tem o padrão do script (= 10) e não vai.
    expect(answers === null ? null : entriesOf(fields, answers)).toEqual(values);
    expect(answersByName(fields, { s: values.s })).toBeNull();
    expect(answersByName(fields, { ...values, x: { type: "text", value: "abc" } })).toBeNull();
  });

  it("as fichas do cabeçalho: o valor como texto, cortado em 40 caracteres, e a marca do sql", () => {
    const chips = chipsOf({ ids: { type: "list", items: [{ type: "number", value: "1" }, { type: "number", value: "2" }] }, tabela: { type: "sql", value: "pedido" }, fim: { type: "null", value: null }, nome: { type: "text", value: "x".repeat(50) } });
    expect(chips.map((chip) => [chip.text, chip.sql])).toEqual([
      ["ids = [1, 2]", false],
      ["tabela = pedido", true],
      ["fim = NULL", false],
      [`nome = ${"x".repeat(32)}…`, false],
    ]);
    expect(chips[3].full).toBe(`nome = ${"x".repeat(50)}`);
  });

  it("o bloqueio descarta os valores e a hora; ela não volta na próxima entrada; fechar não pergunta pelo texto, que é o do script gravado", () => {
    const ran = tab("a", { sessionId: "s-1", execution: execution({ values: { x: { type: "number", value: "7" } }, ranAt: 1 }) });
    expect(withoutSessions([ran])[0]).toMatchObject({ sessionId: null, execution: { values: null, ranAt: null } });
    expect(toSavedWorkspace([ran, tab("b")], "a", () => null).tabs).toHaveLength(1);
    expect(closeConfirmation("all", [ran], "a")).toBeNull();
  });

  it("vai para outra janela com o script, os valores e a hora, sem o pedido pendente", () => {
    const moving = tab("6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10", { execution: execution({ values: { x: { type: "number", value: "7" } }, ranAt: 1730000000000, pending: { values: null, fresh: true } }) });
    const adopted = readTransfer(serializeTab({ tab: moving, sessionId: null, editor: null, state: { status: "idle" }, memory: {} }));
    expect(adopted?.tab.execution).toEqual({ ...moving.execution, pending: null });
  });

  it("o menu do script tem \"Executar com valores…\" logo depois de \"Abrir\", só no que declara variáveis no topo", () => {
    expect(scriptMenu({ generic: false, bindable: false, declaresVariables: true })[0].map((item) => item.action)).toEqual(["open", "runWithValues"]);
    expect(scriptMenu({ generic: false, bindable: false })[0].map((item) => item.action)).toEqual(["open"]);
  });
});
