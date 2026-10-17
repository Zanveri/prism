import { describe, expect, it, vi } from "vitest";

import type { Column } from "../database-sessions.schema";
import type { QueryColumn } from "../query.schema";
import type { SqlTarget } from "../record-edits.schema";
import { defaultSqlOptions, type SqlRow } from "./generate-sql";
import { runSqlFlow, sqlDialogView, sqlTextLimit, utf8Bytes, type SqlDialogPhase, type SqlDialogRequest, type SqlFlowDeps } from "./generate-sql-flow";

const columns: QueryColumn[] = [
  { name: "id", type: "integer", kind: "number" },
  { name: "cliente", type: "text", kind: "text" },
];

const target: SqlTarget = {
  tables: [{ schema: "estoque", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "cliente", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const row = (number: number, values: (string | null)[], extra: Partial<SqlRow> = {}): SqlRow => ({ number, values, read: values, changed: [], cut: [], generated: [], ...extra });

const request = (extra: Partial<SqlDialogRequest> = {}): SqlDialogRequest => ({ item: "update", engine: 1, resultColumns: columns, rows: [row(1, ["1", "Ana"]), row(2, ["2", "Bia"])], newRows: 0, records: null, readOnlyConnection: false, ...extra });

const catalogColumns: Column[] = [
  { name: "id", type: "integer", isNullable: false, isPrimaryKey: true, position: 1, generated: null },
  { name: "cliente", type: "text", isNullable: true, isPrimaryKey: false, position: 2, generated: null },
];

function deps(extra: Partial<SqlFlowDeps> = {}): SqlFlowDeps {
  return {
    target: vi.fn(async () => ({ kind: "target" as const, target })),
    fullValues: vi.fn(async () => ({ kind: "values" as const, valueOf: (): string | undefined => undefined })),
    catalog: vi.fn(async () => ({ kind: "catalog" as const, columns: catalogColumns, foreignKeys: [], indexes: [] })),
    stillCurrent: () => true,
    ...extra,
  };
}

async function phasesOf(dialog: SqlDialogRequest, flow: SqlFlowDeps, signal = new AbortController().signal): Promise<SqlDialogPhase[]> {
  const shown: SqlDialogPhase[] = [];
  await runSqlFlow(dialog, flow, signal, (phase) => shown.push(phase));
  return shown;
}

describe("o caminho do diálogo Gerar SQL (RN-GRADE-018)", () => {
  it("confere a tabela e a chave, e mostra o texto das linhas de quando ele abriu", async () => {
    const shown = await phasesOf(request(), deps());

    expect(shown.map((phase) => phase.kind)).toEqual(["checking", "rows"]);
    const view = sqlDialogView(request(), shown[1], defaultSqlOptions);
    expect(view.body).toEqual({ kind: "text", text: 'UPDATE "estoque"."pedido"\nSET "cliente" = \'Ana\'\nWHERE "id" = 1;\n\nUPDATE "estoque"."pedido"\nSET "cliente" = \'Bia\'\nWHERE "id" = 2;' });
    expect(view.subtitle).toBe("UPDATE · estoque.pedido · 2 linhas");
    expect(view.canOutput).toBe(true);
  });

  it("busca antes os valores completos das células cortadas que o item usa, e só delas", async () => {
    const fullValues = vi.fn<SqlFlowDeps["fullValues"]>(async () => ({ kind: "values", valueOf: (found: SqlRow, column: number) => (found.number === 1 && column === 1 ? "Ana Maria" : undefined) }));
    const dialog = request({ item: "insert", rows: [row(1, ["1", "Ana…"], { cut: [1] })] });

    const shown = await phasesOf(dialog, deps({ fullValues }));

    expect(shown.map((phase) => phase.kind)).toEqual(["checking", "fetching", "rows"]);
    expect(fullValues.mock.calls[0][0].map(({ column }) => column)).toEqual([1]);
    expect(sqlDialogView(dialog, shown[2], { ...defaultSqlOptions, compact: true }).body).toEqual({ kind: "text", text: `INSERT INTO "estoque"."pedido" ("id", "cliente") VALUES (1, 'Ana Maria');` });
  });

  it("a busca cancelada fecha sem gerar nada; o resultado que mudou não gera nada e diz por quê", async () => {
    const cut = request({ rows: [row(1, ["1", "Ana…"], { cut: [1] })] });

    expect((await phasesOf(cut, deps({ fullValues: async () => ({ kind: "cancelled" }) }))).map((phase) => phase.kind)).toEqual(["checking", "fetching"]);
    expect((await phasesOf(cut, deps({ fullValues: async () => ({ kind: "changed" }) }))).at(-1)).toEqual({ kind: "changed" });
    expect((await phasesOf(request(), deps({ target: async () => ({ kind: "changed" }) }))).at(-1)).toEqual({ kind: "changed" });
    expect((await phasesOf(request(), deps({ stillCurrent: () => false }))).at(-1)).toEqual({ kind: "changed" });
    expect(sqlDialogView(request(), { kind: "changed" }, defaultSqlOptions).body).toEqual({ kind: "refused", text: "O resultado mudou desde a escolha das linhas. Escolha as linhas de novo e gere outra vez." });
  });

  it("fechado no meio (o Esc, o X), não mostra mais nada", async () => {
    const controller = new AbortController();
    const flow = deps({
      target: async () => {
        controller.abort();
        return { kind: "target", target };
      },
    });

    expect((await phasesOf(request(), flow, controller.signal)).map((phase) => phase.kind)).toEqual(["checking"]);
  });

  it("a falha do edit-target diz a frase da tela e a mensagem que veio, com Tentar de novo", async () => {
    const shown = await phasesOf(request(), deps({ target: async () => ({ kind: "failed", message: "a sessão caiu" }) }));

    expect(sqlDialogView(request(), shown.at(-1) as SqlDialogPhase, defaultSqlOptions).body).toEqual({ kind: "failed", title: "Não foi possível saber a tabela e a chave deste resultado.", message: "a sessão caiu" });
  });

  it("o item que não vale diz o motivo no lugar do SQL, e o plano fica com a fase, para a tela desabilitar o item dali em diante", async () => {
    const shown = await phasesOf(request({ item: "delete" }), deps({ target: async () => ({ kind: "notEditable", reason: "DISTINCT" }) }));
    const last = shown.at(-1) as SqlDialogPhase;

    expect(last.kind).toBe("refused");
    expect(last.kind === "refused" ? last.plan?.table : undefined).toBeNull();
    expect(sqlDialogView(request({ item: "delete" }), last, defaultSqlOptions)).toMatchObject({ body: { kind: "refused", text: "Só num resultado de uma tabela: DISTINCT." }, canOutput: false });
  });

  it("o INSERT da tabela não conhecida pede a tabela de destino, sem os Nomes completos nem o Excluir as geradas", async () => {
    const dialog = request({ item: "insert" });
    const shown = await phasesOf(dialog, deps({ target: async () => ({ kind: "notEditable", reason: "DISTINCT" }) }));
    const last = shown.at(-1) as SqlDialogPhase;

    const empty = sqlDialogView(dialog, last, defaultSqlOptions);
    expect(empty).toMatchObject({ subtitle: "INSERT · 2 linhas", targetFields: true, shown: { qualified: false, compact: true, excludeGenerated: false }, body: { kind: "refused", text: "Informe a tabela de destino." }, canOutput: false });
    const filled = sqlDialogView(dialog, last, { ...defaultSqlOptions, compact: true, target: { schema: "", name: "copia" } });
    expect(filled.body).toEqual({ kind: "text", text: `INSERT INTO "copia" ("id", "cliente") VALUES (1, 'Ana');\nINSERT INTO "copia" ("id", "cliente") VALUES (2, 'Bia');` });
  });

  it("o CREATE é o DDL aproximado da Estrutura, pelo catálogo, sem opções e sem as linhas; nos Registros vai direto ao catálogo", async () => {
    const catalog = vi.fn<SqlFlowDeps["catalog"]>(async () => ({ kind: "catalog", columns: catalogColumns, foreignKeys: [], indexes: [] }));
    const flowTarget = vi.fn<SqlFlowDeps["target"]>(async () => ({ kind: "target", target }));
    const dialog = request({ item: "create", rows: [], records: { schema: "estoque", name: "pedido", kind: "table" } });

    const shown = await phasesOf(dialog, deps({ catalog, target: flowTarget }));

    expect(shown.map((phase) => phase.kind)).toEqual(["catalog", "ddl"]);
    expect(flowTarget).not.toHaveBeenCalled();
    expect(catalog).toHaveBeenCalledWith({ schema: "estoque", name: "pedido" }, expect.anything());
    const view = sqlDialogView(dialog, shown[1], defaultSqlOptions);
    expect(view.subtitle).toBe("CREATE · estoque.pedido");
    expect(view.shown).toEqual({ qualified: false, compact: false, excludeGenerated: false });
    expect(view.body.kind === "text" ? view.body.text : "").toContain('CREATE TABLE "estoque"."pedido" (');
  });

  it("o CREATE que falha ao ler o catálogo diz a frase dele, com Tentar de novo", async () => {
    const shown = await phasesOf(request({ item: "create" }), deps({ catalog: async () => ({ kind: "failed", message: "permissão negada" }) }));

    expect(shown.map((phase) => phase.kind)).toEqual(["checking", "catalog", "failed"]);
    expect(sqlDialogView(request({ item: "create" }), shown[2], defaultSqlOptions).body).toEqual({ kind: "failed", title: "Não foi possível ler o catálogo da tabela.", message: "permissão negada" });
  });

  it("os avisos: as linhas de fora, as novas não salvas, as com alteração pendente e a conexão somente leitura", async () => {
    const dialog = request({ item: "update", rows: [row(1, ["1", "Bia"], { read: ["1", "Ana"], changed: [1] }), row(2, ["2", "x\u0000"])], newRows: 1, readOnlyConnection: true });
    const shown = await phasesOf(dialog, deps());

    expect(sqlDialogView(dialog, shown.at(-1) as SqlDialogPhase, defaultSqlOptions).warnings).toEqual([
      "1 das 2 linhas ficou de fora: o comentário no fim do SQL diz qual e por quê.",
      "As linhas novas ainda não salvas ficaram de fora: o Ver SQL mostra o INSERT delas.",
      "1 linha tem alterações não salvas: o SQL usa os valores da grade, e a condição, a chave lida do banco.",
      "A conexão é somente leitura: o SQL que grava será recusado nela.",
    ]);
    const select = request({ item: "selectEquals", readOnlyConnection: true });
    expect(sqlDialogView(select, (await phasesOf(select, deps())).at(-1) as SqlDialogPhase, defaultSqlOptions).warnings).toEqual([]);
  });

  it("o texto passa de 1 MB: nada é gerado, e o lugar do SQL diz o limite e o caminho da exportação", async () => {
    const big = "x".repeat(600_000);
    const dialog = request({ item: "insert", rows: [row(1, ["1", big]), row(2, ["2", big])] });
    const shown = await phasesOf(dialog, deps());

    expect(utf8Bytes("ação")).toBe(6);
    expect(sqlTextLimit).toBe(1_048_576);
    expect(sqlDialogView(dialog, shown.at(-1) as SqlDialogPhase, defaultSqlOptions)).toMatchObject({
      body: { kind: "refused", text: "O SQL passaria de 1 MB, o limite do texto de uma aba de consulta. Escolha menos linhas, ou exporte em SQL (Exportar dados…)." },
      canOutput: false,
    });
  });

  it("o que o lugar do SQL diz enquanto espera: a conferência, a busca dos valores (com Cancelar) e o catálogo", () => {
    expect(sqlDialogView(request(), { kind: "checking" }, defaultSqlOptions).body).toEqual({ kind: "status", text: "Conferindo a tabela e a chave deste resultado…", cancel: false });
    expect(sqlDialogView(request(), { kind: "fetching" }, defaultSqlOptions).body).toEqual({ kind: "status", text: "Buscando os valores completos…", cancel: true });
    expect(sqlDialogView(request({ item: "create" }), { kind: "catalog" }, defaultSqlOptions).body).toEqual({ kind: "status", text: "Lendo o catálogo…", cancel: false });
  });

  it("o cabeçalho com uma linha só, e sem a tabela antes de o alvo responder", () => {
    expect(sqlDialogView(request({ item: "delete", rows: [row(1, ["1", "a"])] }), { kind: "checking" }, defaultSqlOptions).subtitle).toBe("DELETE pela chave única · 1 linha");
    expect(sqlDialogView(request({ item: "selectIn", records: { schema: "loja", name: "pedido", kind: "table" } }), { kind: "checking" }, defaultSqlOptions).subtitle).toBe("SELECT .. WHERE .. IN · loja.pedido · 2 linhas");
  });
});
