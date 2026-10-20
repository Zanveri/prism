import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Connection } from "@/app/connections/_lib/connections.schema";
import { unprotected } from "@/app/connections/_lib/connections.schema";

import { connectionOptions, CopyTargetStep, type CopyTargetStepProps } from "./copy-target-step";

const noop = () => {};
const connection = (id: string, change: Partial<Connection> = {}): Connection =>
  ({ id, folderID: null, name: id, engine: 1, host: "db.example.invalid", port: 5432, database: "loja", userName: "app", hasPassword: true, protections: unprotected, ...change }) as Connection;

const props = (change: Partial<CopyTargetStepProps> = {}): CopyTargetStepProps => ({
  connections: [
    { connection: connection("Produção", { engine: 2 }), path: "Estoque / Production PRD", readOnly: null, environment: { name: "Produção", color: "red", folder: null } },
    { connection: connection("DW"), path: "", readOnly: "Somente leitura pela pasta Relatórios.", environment: null },
  ],
  connectionId: "Produção",
  onConnection: noop,
  databases: { options: [{ value: "null", label: "LOJA (padrão)" }], value: "null", locked: true },
  onDatabase: noop,
  schemas: ["estoque", "dw"],
  schema: "estoque",
  onSchema: noop,
  tables: ["pedido", "pedido_hist", "item"],
  table: "pedido_hist",
  onTable: noop,
  search: "",
  onSearch: noop,
  waiting: null,
  failure: null,
  problem: null,
  ...change,
});

describe("a etapa \"Tabela de destino\" (RN-IMPORT-023)", () => {
  it("as conexões com o caminho das pastas; a somente leitura desabilitada, com o cadeado, \"somente leitura\" e o motivo", () => {
    const options = connectionOptions(props().connections);
    expect(options.map((option) => [option.value, option.disabled, option.hint])).toEqual([
      ["Produção", false, "Estoque / Production PRD"],
      ["DW", true, "Somente leitura pela pasta Relatórios."],
    ]);
    const content = renderToStaticMarkup(createElement("div", null, options[1].content));
    expect(content).toContain("somente leitura");
  });

  it("no Db2, o banco de dados preso ao da conexão, com o motivo à vista e ligado ao campo; as tabelas com a escolhida marcada", () => {
    const html = renderToStaticMarkup(createElement(CopyTargetStep, props()));
    expect(html).toContain("No Db2, a conexão usa um banco só.");
    expect(html).toMatch(/aria-describedby="[^"]*-database-locked"/);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/><span class="min-w-0 truncate font-mono text-ink"><bdi>pedido_hist<\/bdi>/);
  });

  it("a busca mostra só as tabelas que acha; nenhuma, a frase; o esquema sem tabelas, a outra frase", () => {
    expect(renderToStaticMarkup(createElement(CopyTargetStep, props({ search: "HIST" }))).match(/type="radio"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(CopyTargetStep, props({ search: "zzz" })))).toContain("Nenhuma tabela com esse nome.");
    expect(renderToStaticMarkup(createElement(CopyTargetStep, props({ tables: [] })))).toContain("Este esquema não tem tabelas.");
  });

  it("a espera com papel de estado; a falha com a mensagem do banco e \"Tentar de novo\"; a própria origem no lugar da tabela", () => {
    expect(renderToStaticMarkup(createElement(CopyTargetStep, props({ schemas: null, tables: null, waiting: "Conectando a DW…" })))).toContain('<p role="status" class="min-h-5 text-sm text-muted">Conectando a DW…</p>');
    const failed = renderToStaticMarkup(createElement(CopyTargetStep, props({ failure: { message: 'password authentication failed for user "app"', retry: noop } })));
    expect(failed).toContain("password authentication failed for user &quot;app&quot;");
    expect(failed).toContain("Tentar de novo");
    const credentials = renderToStaticMarkup(createElement(CopyTargetStep, props({ failure: { message: "A conexão de destino não tem senha gravada.", retry: null } })));
    expect(credentials).not.toContain("Tentar de novo");
    expect(renderToStaticMarkup(createElement(CopyTargetStep, props({ problem: "A tabela de destino é a própria origem. Escolha outra tabela." })))).toContain("A tabela de destino é a própria origem. Escolha outra tabela.");
  });
});
