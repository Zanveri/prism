import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { unprotected, type Connection } from "@/app/connections/_lib/connections.schema";
import { stripTags } from "@/lib/testing/text";
import { NewModelDialog } from "./new-model-dialog";

function makeConnection(partial: Partial<Connection> & Pick<Connection, "id" | "name" | "engine" | "database">): Connection {
  return {
    folderID: null,
    host: "localhost",
    port: 5432,
    userName: "postgres",
    hasPassword: true,
    environmentName: null,
    environmentColor: null,
    confirmCommands: null,
    readOnly: false,
    verificationEnabled: true,
    verificationInterval: 30,
    verificationQuery: null,
    protections: unprotected,
    createdAt: "2026-10-29T12:00:00Z",
    updatedAt: "2026-10-29T12:00:00Z",
    ...partial,
  };
}

const sampleConnections: Connection[] = [
  makeConnection({
    id: "conn-pg",
    name: "MES Produção",
    engine: 1,
    database: "mes",
    environmentName: "Produção",
    environmentColor: "#FF8A7A",
  }),
  makeConnection({
    id: "conn-db2",
    name: "DB2 Corporativo",
    engine: 2,
    database: "CORP",
  }),
  makeConnection({
    id: "conn-mysql",
    name: "MySQL Legado",
    engine: 5,
    database: "legado",
  }),
  makeConnection({
    id: "conn-oracle",
    name: "Oracle Financeiro",
    engine: 8,
    database: "FIN",
  }),
];

const sampleSchemas = [
  {
    schema: "producao",
    tables: [
      "apontamento",
      "linha",
      "maquina",
      "operador",
      "ordem_producao",
      "produto",
    ],
  },
  {
    schema: "public",
    tables: ["configuracao", "usuario"],
  },
];

describe("NewModelDialog", () => {
  it("modo 'Do zero' mostra os três destinos (PostgreSQL, Db2 e Informix)", () => {
    const html = renderToStaticMarkup(
      createElement(NewModelDialog, {
        connections: sampleConnections,
        initialMode: "zero",
        initialName: "manutencao",
        initialDefaultSchema: "manutencao",
        onCancel: () => {},
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("Do zero");
    expect(text).toContain("Banco de destino");
    expect(text).toContain("PostgreSQL");
    expect(text).toContain("Db2");
    expect(text).toContain("Informix");
    expect(text).toContain("O Prism só lê o catálogo. Nada muda no banco.");
  });

  it("modo 'A partir de um banco' mostra conexão, banco, árvore e avisos, e esconde conexões de outros motores", () => {
    const html = renderToStaticMarkup(
      createElement(NewModelDialog, {
        connections: sampleConnections,
        initialMode: "database",
        initialName: "manutencao",
        initialConnectionId: "conn-pg",
        initialDatabase: "mes",
        databases: ["mes", "mes_historico"],
        schemas: sampleSchemas,
        initialChecked: new Set(["producao.maquina", "producao.operador", "producao.produto"]),
        initialDefaultSchema: "manutencao",
        onCancel: () => {},
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("Conexão");
    expect(text).toContain("MES Produção");
    expect(text).toContain("DB2 Corporativo");
    expect(text).not.toContain("MySQL Legado");
    expect(text).not.toContain("Oracle Financeiro");
    expect(text).toContain("Banco");
    expect(text).toContain("mes");
    expect(text).toContain("Esquemas e tabelas para ler");
    expect(text).toContain("3 de 8 marcadas");
    expect(text).toContain("producao");
    expect(text).toContain("maquina");
    expect(text).toContain(
      "As tabelas marcadas entram como existentes: recebem FKs das novas e também podem ser alteradas. Ao gerar o DDL, você escolhe se ele traz tudo ou só as diferenças.",
    );
    expect(text).toContain("O Prism só lê o catálogo. Nada muda no banco.");
  });

  it("'Criar o esquema no DDL' vem ligado quando o esquema digitado não está nos esquemas da base e desligado quando está", () => {
    const htmlNovoEsquema = renderToStaticMarkup(
      createElement(NewModelDialog, {
        connections: sampleConnections,
        initialMode: "database",
        initialConnectionId: "conn-pg",
        schemas: sampleSchemas,
        initialDefaultSchema: "manutencao",
        onCancel: () => {},
      }),
    );
    expect(htmlNovoEsquema).toMatch(
      /<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/><span>Criar o esquema no DDL<\/span>/,
    );

    const htmlEsquemaDaBase = renderToStaticMarkup(
      createElement(NewModelDialog, {
        connections: sampleConnections,
        initialMode: "database",
        initialConnectionId: "conn-pg",
        schemas: sampleSchemas,
        initialDefaultSchema: "producao",
        onCancel: () => {},
      }),
    );
    expect(htmlEsquemaDaBase).not.toMatch(
      /<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/><span>Criar o esquema no DDL<\/span>/,
    );
  });
});
