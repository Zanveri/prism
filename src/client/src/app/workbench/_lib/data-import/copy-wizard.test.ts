import { describe, expect, it } from "vitest";

import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";
import { unprotected } from "@/app/connections/_lib/connections.schema";
import type { ApiError } from "@/lib/api/prism-api";

import type { ExportOrigin } from "../data-export/export-source";
import {
  copyPairBlocker,
  copyPairNote,
  copyPreviewRefusalOf,
  copyPreviewRequest,
  copyRefusalsOf,
  copyStartRequest,
  copyTargetProblem,
  countForcedReason,
  filterTables,
  initialCopyTarget,
  isSourceTable,
  matchName,
  placesOf,
  readsTable,
  serverOf,
  sourceClassOf,
  sourceTableOf,
  stepOfCopyField,
  targetConnections,
  wantedNames,
  withConnection,
} from "./copy-wizard";
import type { TableColumn } from "./imports.schema";

const connection = (id: string, change: Partial<Connection> = {}): Connection =>
  ({ id, folderID: null, name: id, engine: 1, host: "db.example.invalid", port: 5432, database: "loja", userName: "app", hasPassword: true, protections: unprotected, ...change }) as Connection;
const folder = (id: string, name: string, parentID: string | null = null, change: Partial<Folder> = {}): Folder => ({ id, name, parentID, ...change }) as Folder;
const column = (change: Partial<TableColumn> = {}): TableColumn => ({ name: "c", type: "text", nullable: true, defaultValue: null, generated: null, class: "text", importable: true, reason: null, ...change });
const error = (code: string, change: Partial<ApiError> = {}): ApiError => ({ status: 422, code, title: `Título de ${code}`, detail: null, errors: null, extensions: {}, ...change });

const tableOrigin: ExportOrigin = { kind: "table", view: false, schema: "estoque", name: "pedido" };
const records: ExportOrigin = { kind: "records", schema: "estoque", name: "pedido", sql: 'SELECT * FROM "estoque"."pedido" WHERE qtd > 0', filter: "qtd > 0" };
const result: ExportOrigin = { kind: "result", tabTitle: "consulta-1.sql", scriptNumber: null, sql: "select * from pedido p join item i on i.pedido = p.id", filter: null, table: null };

describe("a tabela de destino: o que vem escolhido (RN-IMPORT-023)", () => {
  it("a conexão e o banco de dados da origem; outra conexão vai ao banco padrão dela; a mesma volta ao da origem", () => {
    const source = { connectionId: "c1", database: "outro" };
    expect(initialCopyTarget(source)).toEqual({ connectionId: "c1", database: "outro", schema: null, table: null });
    expect(withConnection(source, "c2")).toEqual({ connectionId: "c2", schema: null, table: null });
    expect(withConnection(source, "c1")).toEqual({ connectionId: "c1", database: "outro", schema: null, table: null });
  });

  it("o esquema e a tabela de mesmo nome: primeiro letra por letra, senão sem diferenciar maiúsculas; o resultado só com a tabela única", () => {
    expect(wantedNames(tableOrigin)).toEqual({ schema: "estoque", table: "pedido" });
    expect(wantedNames(result)).toBeNull();
    expect(wantedNames({ ...result, kind: "result", table: { schema: "s", name: "t" } } as ExportOrigin)).toEqual({ schema: "s", table: "t" });

    expect(matchName(["Pedido", "pedido"], "pedido")).toBe("pedido");
    expect(matchName(["PEDIDO", "outro"], "pedido")).toBe("PEDIDO");
    expect(matchName(["outro"], "pedido")).toBeNull();
    expect(matchName(["pedido"], undefined)).toBeNull();
  });

  it("as conexões na ordem do navegador (as pastas antes, em ordem de nome), com o caminho e o motivo do somente leitura", () => {
    const folders = [folder("f1", "Estoque"), folder("f2", "Production PRD", "f1"), folder("f3", "Arquivo")];
    const list = targetConnections(
      [connection("zeta"), connection("dw", { folderID: "f2", protections: { ...unprotected, readOnly: true } }), connection("alfa", { folderID: "f1" }), connection("velho", { folderID: "f3" })],
      folders,
    );
    expect(list.map((entry) => entry.connection.id)).toEqual(["velho", "dw", "alfa", "zeta"]);
    expect(list.find((entry) => entry.connection.id === "dw")?.path).toBe("Estoque / Production PRD");
    expect(list.find((entry) => entry.connection.id === "dw")?.readOnly).not.toBeNull();
    expect(list.find((entry) => entry.connection.id === "alfa")?.readOnly).toBeNull();
  });

  it("a tabela pesquisada: o pedaço no nome, sem maiúsculas nem acentos", () => {
    expect(filterTables(["pedido", "Pedido_Hist", "ação"], "PED")).toEqual(["pedido", "Pedido_Hist"]);
    expect(filterTables(["pedido", "ação"], "acao")).toEqual(["ação"]);
    expect(filterTables(["a", "b"], "  ")).toEqual(["a", "b"]);
  });
});

describe("a própria origem e a contagem obrigatória (RN-IMPORT-023)", () => {
  const c1 = connection("c1");
  const same = connection("c2", { host: "DB.EXAMPLE.INVALID" });
  const other = connection("c3", { host: "192.0.2.10" });

  it("a origem que se reconhece: a tabela pelo navegador e os Registros; a visão e o resultado, não", () => {
    expect(sourceTableOf(tableOrigin)).toEqual({ schema: "estoque", name: "pedido" });
    expect(sourceTableOf(records)).toEqual({ schema: "estoque", name: "pedido" });
    expect(sourceTableOf({ ...tableOrigin, view: true } as ExportOrigin)).toBeNull();
    expect(sourceTableOf(result)).toBeNull();
  });

  it("a mesma conexão e o mesmo banco, ou outra conexão no mesmo servidor (sem maiúsculas), porta e banco; o esquema e o nome letra por letra", () => {
    const source = { connection: c1, table: { schema: "estoque", name: "pedido" } };
    expect(isSourceTable(source, { connection: c1, schema: "estoque", table: "pedido" })).toBe(true);
    expect(isSourceTable(source, { connection: same, schema: "estoque", table: "pedido" })).toBe(true);
    expect(isSourceTable(source, { connection: same, schema: "estoque", table: "Pedido" })).toBe(false);
    expect(isSourceTable(source, { connection: other, schema: "estoque", table: "pedido" })).toBe(false);
    expect(isSourceTable(source, { connection: c1, database: "outro", schema: "estoque", table: "pedido" })).toBe(false);
    expect(isSourceTable({ ...source, table: null }, { connection: c1, schema: "estoque", table: "pedido" })).toBe(false);
  });

  it("no Db2 e no Informix com a origem e o destino no mesmo banco, a contagem fica ligada e travada; no PostgreSQL e em outro banco, não", () => {
    const place = serverOf(connection("x", { engine: 2, port: 50000, database: "LOJA" }), undefined);
    expect(countForcedReason(2, place, { ...place, host: place.host.toUpperCase() })).toBe("A origem e o destino estão no mesmo banco: a contagem é obrigatória.");
    expect(countForcedReason(3, place, place)).not.toBeNull();
    expect(countForcedReason(1, place, place)).toBeNull();
    expect(countForcedReason(2, place, { ...place, database: "DW" })).toBeNull();
    expect(countForcedReason(2, place, null)).toBeNull();
  });

  it("o que segura a etapa, na ordem: a conexão, o somente leitura, a falha, a espera, o esquema, a tabela e a própria origem", () => {
    const entry = { connection: c1, path: "", readOnly: null };
    const target = { connectionId: "c1", schema: "estoque", table: "pedido" };
    const base = { connection: entry, waiting: null, failure: null, target, isSource: false };
    expect(copyTargetProblem({ ...base, connection: null })).toBe("Escolha a conexão de destino.");
    expect(copyTargetProblem({ ...base, connection: { ...entry, readOnly: "Somente leitura" } })).toBe("A conexão é somente leitura, e a cópia grava na tabela. Escolha outra conexão.");
    expect(copyTargetProblem({ ...base, failure: "a senha não confere" })).toBe("a senha não confere");
    expect(copyTargetProblem({ ...base, waiting: "Conectando a DW…" })).toBe("Conectando a DW…");
    expect(copyTargetProblem({ ...base, target: { ...target, schema: null } })).toBe("Escolha o esquema da tabela de destino.");
    expect(copyTargetProblem({ ...base, target: { ...target, table: null } })).toBe("Escolha a tabela de destino.");
    expect(copyTargetProblem({ ...base, isSource: true })).toBe("A tabela de destino é a própria origem. Escolha outra tabela.");
    expect(copyTargetProblem(base)).toBeNull();
  });
});

describe("o mapeamento da cópia: as classes, os pares e as notas (RN-IMPORT-024)", () => {
  it("a classe da origem pelo tipo, com o kind do resultado quando o tipo não diz; o money do PostgreSQL é outra", () => {
    expect(sourceClassOf({ type: "character varying(80)" }, 1)).toBe("text");
    expect(sourceClassOf({ type: "numeric(12,4)" }, 1)).toBe("number");
    expect(sourceClassOf({ type: "timestamp with time zone" }, 1)).toBe("dateTime");
    expect(sourceClassOf({ type: "DATETIME YEAR TO FRACTION(5)" }, 3)).toBe("dateTime");
    expect(sourceClassOf({ type: "DATETIME HOUR TO SECOND" }, 3)).toBe("time");
    expect(sourceClassOf({ type: "date" }, 1)).toBe("date");
    expect(sourceClassOf({ type: "bytea" }, 1)).toBe("binary");
    expect(sourceClassOf({ type: "VARCHAR(10) FOR BIT DATA" }, 2)).toBe("binary");
    expect(sourceClassOf({ type: "boolean" }, 1)).toBe("boolean");
    expect(sourceClassOf({ type: "money" }, 1)).toBe("other");
    expect(sourceClassOf({ type: "MONEY(8,2)" }, 3)).toBe("number");
    expect(sourceClassOf({ type: "jsonb" }, 1)).toBe("other");
    expect(sourceClassOf({ type: "tipo_do_usuario", kind: "number" }, 1)).toBe("number");
  });

  it("o binário só vai para uma coluna binária, e a coluna binária só recebe binário", () => {
    expect(copyPairBlocker("binary", column({ class: "text" }))).toBe("Binário só vai para uma coluna binária.");
    expect(copyPairBlocker("text", column({ class: "binary" }))).toBe("Binário só vai para uma coluna binária.");
    expect(copyPairBlocker("binary", column({ class: "binary" }))).toBeNull();
    expect(copyPairBlocker("text", column({ class: "number" }))).toBeNull();
  });

  it("as casas que os tipos dizem", () => {
    expect(placesOf("numeric(12,4)", "number")).toBe(4);
    expect(placesOf("DECIMAL(10, 2)", "number")).toBe(2);
    expect(placesOf("numeric", "number")).toBeNull();
    expect(placesOf("double precision", "number")).toBeNull();
    expect(placesOf("timestamp without time zone", "dateTime")).toBe(6);
    expect(placesOf("timestamp(3)", "dateTime")).toBe(3);
    expect(placesOf("TIMESTAMP(12)", "dateTime")).toBe(12);
    expect(placesOf("DATETIME YEAR TO FRACTION(5)", "dateTime")).toBe(5);
    expect(placesOf("DATETIME YEAR TO FRACTION", "dateTime")).toBe(3);
    expect(placesOf("DATETIME YEAR TO SECOND", "dateTime")).toBe(0);
  });

  it("as notas, quando valem, uma frase depois da outra", () => {
    const pg = (type: string) => ({ type, class: sourceClassOf({ type }, 1), engine: 1 as const });
    expect(copyPairNote(pg("text"), { column: column({ type: "integer", class: "number" }), engine: 1 })).toBe("A origem é texto, e o destino é número: cada valor é convertido, e o que não converter para a cópia.");
    expect(copyPairNote(pg("timestamp"), { column: column({ type: "date", class: "date" }), engine: 1 })).toBe("A origem tem hora, e o destino é só data: o valor com hora que não é zero para a cópia.");
    expect(copyPairNote(pg("timestamp with time zone"), { column: column({ type: "TIMESTAMP(6)", class: "dateTime" }), engine: 2 })).toBe("A hora vai como o PostgreSQL a escreve no fuso da sessão, sem o fuso.");
    expect(copyPairNote(pg("timestamp with time zone"), { column: column({ type: "timestamp with time zone", class: "dateTime" }), engine: 1 })).toBeNull();
    expect(copyPairNote(pg("numeric(12,4)"), { column: column({ type: "DECIMAL(10,2)", class: "number" }), engine: 2 })).toBe("A origem tem até 4 casas, e o destino guarda 2: o valor com mais casas que não são zero para a cópia.");
    expect(copyPairNote(pg("numeric(12,4)"), { column: column({ type: "numeric(10,2)", class: "number" }), engine: 1 })).toBe("A origem tem até 4 casas, e o destino guarda 2: o PostgreSQL arredonda o valor.");
    expect(copyPairNote(pg("timestamp"), { column: column({ type: "DATETIME YEAR TO FRACTION(5)", class: "dateTime" }), engine: 3 })).toBe("A origem tem até 6 casas, e o destino guarda 5: o valor com mais casas que não são zero para a cópia.");
    expect(copyPairNote({ type: "TIMESTAMP(12)", class: "dateTime", engine: 2 }, { column: column({ type: "timestamp", class: "dateTime" }), engine: 1 })).toBe(
      "A origem tem até 12 casas, e o destino guarda 6: o PostgreSQL arredonda o valor. O driver entrega até 7 casas de fração: as outras se perdem.",
    );
    expect(copyPairNote(pg("money"), { column: column({ type: "DECIMAL(12,2)", class: "number" }), engine: 3 })).toBe(
      "O money sai no formato de moeda do servidor (R$ 1.234,56), que não é um número: copie de uma consulta com money::numeric.",
    );
    expect(copyPairNote(pg("integer"), { column: column({ type: "bigint", class: "number" }), engine: 1 })).toBeNull();
  });
});

describe("os pedidos da cópia (seção 36, \"Rotas e respostas\")", () => {
  const draft = { connectionId: "c1", database: "outro", origin: records, columns: [{ position: 0, name: "id" }, { position: 2, name: "total" }] };
  const target = { connectionID: "c2", schema: "dw", table: "pedido_hist" };

  it("a prévia: a origem como a da exportação, as colunas marcadas, o destino e o mapeamento pela posição na lista das colunas (sem ele, o sugerido)", () => {
    expect(copyPreviewRequest(draft, target, null)).toEqual({
      source: { kind: "query", connectionID: "c1", database: "outro", sql: records.kind === "records" ? records.sql : "", name: "pedido" },
      columns: [{ position: 0, name: "id" }, { position: 2, name: "total" }],
      target,
    });
    expect(copyPreviewRequest(draft, target, [null, null]).mapping).toBeUndefined();
    expect(copyPreviewRequest(draft, target, ["id", null]).mapping).toEqual([{ source: 0, target: "id" }]);
  });

  it("o começo: a contagem, o mapeamento, a carga sem a conferência e o número da janela", () => {
    const body = copyStartRequest({ ...draft, origin: tableOrigin }, target, [null, "valor"], { empty: true, commit: { commit: "single", commitEvery: "10000" } }, true, 3);
    expect(body).toEqual({
      source: { kind: "table", connectionID: "c1", database: "outro", schema: "estoque", table: "pedido" },
      columns: draft.columns,
      count: true,
      target,
      mapping: [{ source: 1, target: "valor" }],
      load: { empty: true, commitEvery: null },
      windowID: 3,
    });
    expect(copyStartRequest(draft, target, ["id"], { empty: false, commit: { commit: "every", commitEvery: "500" } }, false, 1).load).toEqual({ empty: false, commitEvery: 500 });
  });
});

describe("as recusas da cópia (RN-IMPORT-024 e 025)", () => {
  it("a conexão sem usuário ou sem senha diz qual é, a de origem ou a de destino", () => {
    expect(copyRefusalsOf(error("CONNECTION_CREDENTIALS_MISSING", { errors: { "Source.UserName": ["x"] } })).map((refusal) => refusal.message)).toEqual([
      "A conexão de origem não tem usuário gravado. Preencha-o em Editar conexão e copie de novo.",
    ]);
    expect(copyRefusalsOf(error("CONNECTION_CREDENTIALS_MISSING", { errors: { "Target.Password": ["x"] } })).map((refusal) => refusal.message)).toEqual([
      "A conexão de destino não tem senha gravada. Preencha-a em Editar conexão e copie de novo.",
    ]);
  });

  it("a de campo no campo que o assistente desenha (as colunas, o N da carga); a de outro campo, no alto; o resto com a frase da tela ou da API", () => {
    expect(copyRefusalsOf(error("IMPORT_OPTIONS_INVALID", { errors: { "Load.CommitEvery": ["Use de 1 a 1.000.000 linhas."], WindowID: ["inválido"] } }))).toEqual([
      { field: "load.commitEvery", message: "Use de 1 a 1.000.000 linhas." },
      { field: null, message: "inválido" },
    ]);
    expect(copyRefusalsOf(error("TRANSFER_LIMIT_REACHED"))[0].message).toContain("Já há 3 transferências em andamento");
    expect(copyRefusalsOf(error("CONNECTION_READ_ONLY"))[0].message).toBe("A conexão de destino é somente leitura, e a cópia grava na tabela. Nada foi enviado ao banco.");
    expect(copyRefusalsOf(error("IMPORT_TARGET_BUSY", { detail: "Já há uma cópia para dw.pedido_hist em andamento." }))[0]).toEqual({ field: null, message: "Já há uma cópia para dw.pedido_hist em andamento." });
    expect(copyRefusalsOf(error("DRIVER_NOT_INSTALLED", { detail: "Falta o driver.", extensions: { driverID: "db2" } }))[0]).toEqual({ field: null, message: "Falta o driver.", driverID: "db2" });
    expect(stepOfCopyField("columns")).toBe("extraction");
    expect(stepOfCopyField("load.commitEvery")).toBe("load");
    expect(stepOfCopyField(null)).toBe("confirmation");
  });

  it("a prévia da cópia: o banco fora do ar com \"Tentar de novo\"; o somente leitura e as credenciais com as frases da cópia", () => {
    const place = { schema: "dw", table: "pedido_hist" };
    expect(copyPreviewRefusalOf(error("DATABASE_CONNECTION_FAILED", { detail: "o servidor não responde", extensions: { sqlState: "08001" } }), place)).toEqual({ message: "o servidor não responde (SQLSTATE 08001)", retry: true });
    expect(copyPreviewRefusalOf(error("IMPORT_TABLE_NOT_FOUND"), place).message).toBe("A tabela dw.pedido_hist não existe mais.");
    expect(copyPreviewRefusalOf(error("CONNECTION_READ_ONLY"), place).message).toBe("A conexão de destino é somente leitura, e a cópia grava na tabela. Nada foi enviado ao banco.");
    expect(copyPreviewRefusalOf(error("CONNECTION_CREDENTIALS_MISSING", { errors: { "Target.UserName": ["x"] } }), place).message).toBe(
      "A conexão de destino não tem usuário gravado. Preencha-o em Editar conexão e copie de novo.",
    );
  });
});

describe("o comando da origem que lê a tabela de destino (RN-IMPORT-023 e 025)", () => {
  it("a palavra inteira, sem maiúsculas, também entre aspas; o pedaço de outro nome não conta", () => {
    expect(readsTable(result.kind === "result" ? result.sql : "", "pedido")).toBe(true);
    expect(readsTable('SELECT * FROM "estoque"."PEDIDO"', "pedido")).toBe(true);
    expect(readsTable("select * from pedido_hist", "pedido")).toBe(false);
    expect(readsTable("select * from item", "pedido")).toBe(false);
    expect(readsTable("select 1", "")).toBe(false);
    expect(readsTable("select * from ped.ido", "ped.ido")).toBe(true);
  });
});
