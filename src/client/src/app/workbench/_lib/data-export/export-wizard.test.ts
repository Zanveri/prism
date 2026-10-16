import { describe, expect, it } from "vitest";

import type { ApiError } from "@/lib/api/prism-api";

import { parseExportChoices } from "./export-choices";
import type { ExportOrigin, SourceColumn } from "./export-source";
import {
  canVisit,
  chosenColumns,
  choicesToRemember,
  draftOf,
  droppedGenerated,
  extractionProblem,
  fieldPathOf,
  fieldsShown,
  fileNamesOf,
  formattingProblemsOf,
  nextStep,
  placeRefusals,
  previousStep,
  refusalsOf,
  stepOfField,
  stepProblem,
  usesClipboard,
  type WizardChoices,
  type WizardContext,
} from "./export-wizard";

const table: ExportOrigin = { kind: "table", view: false, schema: "estoque", name: "pedido" };
const result: ExportOrigin = { kind: "result", tabTitle: "consulta-1.sql", scriptNumber: null, sql: "select * from pedido", filter: null, table: null };
const columns: SourceColumn[] = [
  { name: "id", type: "integer", generated: "byDefault" },
  { name: "total", type: "numeric", generated: "always" },
  { name: "cliente", type: "text", generated: null },
];

const choices = (change: Partial<WizardChoices> = {}): WizardChoices => ({ ...parseExportChoices(null, { schema: "estoque", table: "pedido" }), checked: [true, true, true], ...change });
const context = (change: Partial<WizardContext> = {}): WizardContext => ({ origin: table, engine: 1, columns, ...change });

const apiError = (code: string, change: Partial<ApiError> = {}): ApiError => ({ status: 422, code, title: `Título de ${code}`, detail: null, errors: null, extensions: {}, ...change });

describe("as etapas do assistente (RN-EXPORT-003)", () => {
  it("cinco, nesta ordem; as anteriores levam de volta, as seguintes não", () => {
    expect(nextStep("format")).toBe("extraction");
    expect(previousStep("format")).toBeNull();
    expect(nextStep("confirmation")).toBeNull();
    expect(canVisit("format", "output")).toBe(true);
    expect(canVisit("confirmation", "output")).toBe(false);
    expect(canVisit("output", "output")).toBe(false);
  });

  it("a Extração não avança sem nenhuma coluna marcada, nem antes de as colunas chegarem", () => {
    expect(stepProblem("extraction", choices({ checked: [false, false, false] }), context())).toBe("Marque ao menos uma coluna.");
    expect(stepProblem("extraction", choices({ checked: null }), context({ columns: null }))).toBe("Lendo as colunas…");
    expect(stepProblem("extraction", choices(), context())).toBeNull();
  });

  it("o motivo da Extração aparece na lista: nenhuma marcada, ou a recusa da API no campo `columns`; lendo as colunas, nada (a etapa já o diz)", () => {
    expect(extractionProblem(choices({ checked: [false, false, false] }), context(), null)).toBe("Marque ao menos uma coluna.");
    expect(extractionProblem(choices(), context(), "Recusada pela API.")).toBe("Recusada pela API.");
    expect(extractionProblem(choices({ checked: null }), context({ columns: null }), null)).toBeNull();
    expect(extractionProblem(choices(), context(), null)).toBeNull();
  });

  it("nos Registros, o SQL sem \"Incluir as colunas que o banco calcula\" não avança antes de o catálogo dizer quais são: a calculada iria no INSERT sem aviso", () => {
    const records: ExportOrigin = { kind: "records", schema: "estoque", name: "pedido", sql: "SELECT * FROM estoque.pedido", filter: "" };
    const unknown = context({ origin: records, columns: columns.map((column) => ({ ...column, generated: null })), generatedUnknown: "Lendo as colunas…" });
    const sql = choices({ format: "sql" });

    expect(formattingProblemsOf(sql, unknown)["options.includeGenerated"]).toBe("Lendo as colunas…");
    expect(stepProblem("formatting", sql, unknown)).toBe("Lendo as colunas…");
    expect(stepProblem("formatting", sql, { ...unknown, generatedUnknown: 'permission denied for table "pedido"' })).toBe('permission denied for table "pedido"');
    // Incluídas, ou noutro formato, ou sabidas, nada segura a etapa.
    sql.options.sql.includeGenerated = true;
    expect(stepProblem("formatting", sql, unknown)).toBeNull();
    expect(stepProblem("formatting", choices({ format: "csv" }), unknown)).toBeNull();
    expect(stepProblem("formatting", choices({ format: "sql" }), context({ origin: records, generatedUnknown: null }))).toBeNull();
  });

  it("a Formatação não avança com um campo recusado; a Saída, com o nome recusado, menos na área de transferência", () => {
    const bad = choices();
    bad.options.csv.nullText = "a\nb";
    expect(stepProblem("formatting", bad, context())).toBe("O texto do nulo não pode ter caractere de controle.");
    expect(stepProblem("output", choices({ pattern: "" }), context())).toBe("Informe o nome do arquivo.");
    expect(stepProblem("output", choices({ pattern: "", clipboard: true }), context())).toBeNull();
    // O XLSX não vai para a área de transferência: o nome vale de novo.
    expect(stepProblem("output", choices({ pattern: "", clipboard: true, format: "xlsx" }), context())).toBe("Informe o nome do arquivo.");
    expect(usesClipboard({ format: "xlsx", clipboard: true })).toBe(false);
  });
});

describe("as colunas que vão no arquivo (RN-EXPORT-002 e 011)", () => {
  it("as marcadas, na ordem da origem, com a posição dela", () => {
    expect(chosenColumns(choices({ checked: [true, false, true] }), context())).toEqual([
      { position: 0, name: "id" },
      { position: 2, name: "cliente" },
    ]);
  });

  it("no SQL, sem \"Incluir as colunas que o banco calcula\", a que ele calcula sempre fica de fora, mesmo marcada; a identidade por padrão entra", () => {
    const sql = choices({ format: "sql" });
    expect(chosenColumns(sql, context()).map((column) => column.name)).toEqual(["id", "cliente"]);
    expect(droppedGenerated(sql, context())).toEqual(["total"]);

    sql.options.sql.includeGenerated = true;
    expect(chosenColumns(sql, context()).map((column) => column.name)).toEqual(["id", "total", "cliente"]);
    expect(droppedGenerated(sql, context())).toEqual([]);
  });

  it("no resultado de uma consulta a opção não existe, e vão as colunas marcadas", () => {
    expect(chosenColumns(choices({ format: "sql" }), context({ origin: result })).map((column) => column.name)).toEqual(["id", "total", "cliente"]);
  });
});

describe("o pedido e os nomes", () => {
  it("o rascunho leva a origem, as colunas e a saída; o BOM é o do formato escolhido", () => {
    const draft = draftOf(choices({ format: "json", bom: { ...choices().bom, json: true } }), { ...context(), connectionId: "c1", windowId: 3, entryName: null });
    expect(draft).toMatchObject({ connectionId: "c1", format: "json", bom: true, zip: false, clipboard: false, windowId: 3 });
    expect(draft.columns).toHaveLength(3);
  });

  it("os nomes que saem do padrão: com o .zip, o arquivo é o .zip e o de dentro tem a extensão do formato", () => {
    const now = new Date(2026, 9, 16, 14, 30, 5);
    expect(fileNamesOf(choices(), { tabela: "pedido", esquema: "estoque", conexao: "ERP" }, now)).toMatchObject({ extension: "csv", zip: false, fileName: "pedido_2026-10-16_143005.csv" });
    expect(fileNamesOf(choices({ zip: true }), { tabela: "pedido", esquema: "estoque", conexao: "ERP" }, now)).toMatchObject({ zip: true, fileName: "pedido_2026-10-16_143005.zip", entryName: "pedido_2026-10-16_143005.csv" });
  });

  it("as escolhas que se lembram não levam as colunas", () => {
    expect(Object.keys(choicesToRemember(choices()))).not.toContain("checked");
  });
});

describe("onde cada recusa do começo aparece (RN-EXPORT-015)", () => {
  it("a de campo, no campo, pelo caminho da API (o nome da propriedade do C# vira o da tela), e a etapa dele", () => {
    const refusals = refusalsOf(apiError("EXPORT_OPTIONS_INVALID", { errors: { "options.RowsPerStatement": ["Use de 1 a 1.000 linhas por comando."], "output.entryName": ["Nome inválido."] } }));
    expect(refusals).toEqual([
      { field: "options.rowsPerStatement", message: "Use de 1 a 1.000 linhas por comando." },
      { field: "output.entryName", message: "Nome inválido." },
    ]);
    expect(fieldPathOf("Options.RowsPerStatement")).toBe("options.rowsPerStatement");
    expect(stepOfField("options.rowsPerStatement")).toBe("formatting");
    expect(stepOfField("output.entryName")).toBe("output");
    expect(stepOfField("columns")).toBe("extraction");
    expect(stepOfField("source.sql")).toBe("confirmation");
    expect(stepOfField(null)).toBe("confirmation");
  });

  it("a de um campo que o assistente não desenha (o comando de mais de 1 MB, o formato, uma opção de escolha) vai ao alto da Confirmação, sem se perder", () => {
    const refusals = refusalsOf(apiError("EXPORT_OPTIONS_INVALID", { errors: { "source.sql": ["O comando pode ter até 1 MB."], "options.delimiter": ["O separador deve ser ;, a vírgula, a tabulação ou |."], "options.nullText": ["O texto do nulo pode ter até 100 caracteres."], columns: ["Marque de 1 a 32.767 colunas."] } }));
    expect(placeRefusals(refusals, "csv", 1)).toEqual([
      { field: null, message: "O comando pode ter até 1 MB." },
      { field: null, message: "O separador deve ser ;, a vírgula, a tabulação ou |." },
      { field: "options.nullText", message: "O texto do nulo pode ter até 100 caracteres." },
      { field: "columns", message: "Marque de 1 a 32.767 colunas." },
    ]);
    // A opção que outro formato desenha não tem campo neste: o nulo do CSV não aparece no JSON.
    expect(placeRefusals([{ field: "options.nullText", message: "x" }], "json", 1)).toEqual([{ field: null, message: "x" }]);
    // No Informix as linhas por comando ficam fixas em 1, sem a recusa no campo.
    expect(placeRefusals([{ field: "options.rowsPerStatement", message: "y" }], "sql", 3)).toEqual([{ field: null, message: "y" }]);
    expect(placeRefusals([{ field: "options.rowsPerStatement", message: "y" }], "sql", 1)).toEqual([{ field: "options.rowsPerStatement", message: "y" }]);
    expect([...fieldsShown("txt", 2)].sort()).toEqual(["columns", "options.maxWidth", "options.minWidth", "output.entryName"]);
  });

  it("as outras, no alto da Confirmação, com a frase da tela onde a especificação a escreve", () => {
    expect(refusalsOf(apiError("TRANSFER_LIMIT_REACHED", { status: 409 }))).toEqual([{ field: null, message: "Já há 3 transferências em andamento (exportações, importações ou cópias para outro banco). Espere uma terminar, ou cancele uma na barra de status." }]);
    expect(refusalsOf(apiError("CONNECTION_NOT_FOUND", { status: 404 }))).toEqual([{ field: null, message: "A conexão não existe mais." }]);
    expect(refusalsOf(apiError("EXPORT_SOURCE_NOT_READ", { detail: "um DELETE não é leitura" }))).toEqual([{ field: null, message: "um DELETE não é leitura" }]);
    expect(refusalsOf(apiError("DRIVER_NOT_INSTALLED", { detail: "Instale o driver do Db2.", extensions: { driverID: "db2" } }))).toEqual([{ field: null, message: "Instale o driver do Db2.", driverID: "db2" }]);
  });

  it("a conexão sem usuário ou sem senha vem como erro de campo e fica no alto, com a frase de cada campo, sem abrir o Editar conexão", () => {
    expect(refusalsOf(apiError("CONNECTION_CREDENTIALS_MISSING", { errors: { userName: ["x"], password: ["y"] } })).map((refusal) => refusal.message)).toEqual([
      "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e exporte de novo.",
      "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e exporte de novo.",
    ]);
    expect(refusalsOf(apiError("CONNECTION_CREDENTIALS_MISSING", { errors: { Password: ["y"] } }))).toEqual([{ field: null, message: "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e exporte de novo." }]);
  });
});
