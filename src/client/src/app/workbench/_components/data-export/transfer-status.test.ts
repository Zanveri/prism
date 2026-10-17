import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportTracker } from "../../_lib/data-export/data-exports";
import type { NewExport, TrackedExport } from "../../_lib/data-export/transfer-tracker";
import { loadTracker } from "../../_lib/data-import/data-imports";
import type { NewLoad, TrackedLoad } from "../../_lib/data-import/load-tracker";
import { failureLines, LoadEntry } from "../data-import/load-status";
import { closeListOnEscape, TransferEntry, TransferStatus } from "./transfer-status";

const added = (change: Partial<NewExport> = {}): NewExport => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "pedido",
  subject: { subject: "Tabela pedido", feminine: true },
  connectionId: "c1",
  format: "csv",
  clipboard: false,
  reveal: false,
  destinationId: "d1",
  fileName: "pedido.csv",
  suggested: { suggestedName: "pedido", extension: "csv" },
  ...change,
});
const entry = (change: Partial<TrackedExport> = {}): TrackedExport => ({ ...added(), seq: 1, stage: "running", phase: "reading", rows: 5678, total: 12345, bytes: 3_565_158, failure: null, busy: false, ...change });

describe("a entrada da exportação na barra de status (RN-EXPORT-021)", () => {
  it("o texto com o nome isolado (`<bdi>`), o inteiro na dica, a barra de progresso com a porcentagem e o texto para o leitor de tela, e \"Cancelar\" com o nome", () => {
    const html = renderToStaticMarkup(createElement(TransferEntry, { entry: entry() }));
    expect(html).toContain("Exportando <bdi>pedido</bdi>… 45%");
    expect(html).toContain('title="5.678 de 12.345 linhas · 3,4 MB"');
    expect(html).toMatch(/role="progressbar" aria-label="Progresso da exportação de pedido" aria-valuemin="0" aria-valuemax="100" aria-valuenow="45" aria-valuetext="5.678 de 12.345 linhas · 3,4 MB"/);
    expect(html).toContain('aria-label="Cancelar a exportação de pedido"');
  });

  it("sem o total, a barra não tem medida; cancelando, \"Cancelar\" fica desabilitado sem sair do Tab", () => {
    const html = renderToStaticMarkup(createElement(TransferEntry, { entry: entry({ total: null, stage: "cancelling" }) }));
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain("Cancelando…");
    expect(html).toContain('aria-disabled="true"');
  });

  it("a entrega que falhou: o motivo, \"Salvar como…\" e \"Descartar\", sem barra", () => {
    const html = renderToStaticMarkup(createElement(TransferEntry, { entry: entry({ stage: "deliveryFailed", failure: "o arquivo está aberto em outro programa" }) }));
    expect(html).toContain("<bdi>pedido.csv</bdi> não foi gravado: o arquivo está aberto em outro programa.");
    expect(html).toContain("Salvar como…");
    expect(html).toContain("Descartar");
    expect(html).not.toContain("progressbar");
  });
});

describe("a barra mostra uma e conta as outras", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    exportTracker.reset();
    loadTracker.reset();
    vi.useRealTimers();
  });

  it("sem exportação, nada; com duas, a mais antiga e \"+1 exportação\"", () => {
    expect(renderToStaticMarkup(createElement(TransferStatus))).toBe("");

    exportTracker.start(added());
    exportTracker.start(added({ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", name: "item" }));
    const html = renderToStaticMarkup(createElement(TransferStatus));
    expect(html).toContain("<bdi>pedido</bdi>");
    expect(html).not.toContain("<bdi>item</bdi>");
    expect(html).toContain("+1 exportação");
    expect(html).toContain('aria-expanded="false"');
  });

  it("as importações e as cópias entram na mesma conta: \"+2 importações\" quando as outras são todas importações, e \"+2 transferências\" misturadas", () => {
    exportTracker.start(added());
    loadTracker.start(newLoad({ id: "i1" }));
    loadTracker.start(newLoad({ id: "i2" }));
    let html = renderToStaticMarkup(createElement(TransferStatus));
    expect(html).toContain("<bdi>pedido</bdi>");
    expect(html).toContain("+2 importações");

    loadTracker.start(newLoad({ id: "c3", kind: "copy", sourceName: "pedido", table: { connectionId: "c2", schema: "dw", name: "pedido_hist" } }));
    html = renderToStaticMarkup(createElement(TransferStatus));
    expect(html).toContain("+3 transferências");
  });

  it("Esc com a lista aberta a fecha e devolve o foco ao botão, também com o foco ainda no botão que a abriu; sem a lista, o Esc segue", () => {
    const calls: string[] = [];
    const event = (key: string) => ({ key, stopPropagation: () => calls.push(`stop ${key}`) });
    const opener = { focus: () => calls.push("focus") };

    closeListOnEscape(event("Escape"), true, () => calls.push("close"), opener);
    expect(calls).toEqual(["stop Escape", "close", "focus"]);

    calls.length = 0;
    closeListOnEscape(event("Escape"), false, () => calls.push("close"), opener);
    closeListOnEscape(event("Enter"), true, () => calls.push("close"), opener);
    expect(calls).toEqual([]);
  });
});

const newLoad = (change: Partial<NewLoad> = {}): NewLoad => ({
  id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  kind: "import",
  sourceName: "pedidos.csv",
  format: "csv",
  sheet: null,
  table: { connectionId: "c1", schema: "estoque", name: "pedido" },
  oneAtATime: false,
  empty: false,
  single: false,
  ...change,
});
const load = (change: Partial<TrackedLoad> = {}): TrackedLoad => ({ ...newLoad(), seq: 1, stage: "running", phase: "loading", rows: 12_345, committed: 10_000, total: null, bytes: 45, size: 100, failure: null, ...change });
const noop = () => {};

describe("a entrada da importação e da cópia na barra de status (RN-IMPORT-019 e 027)", () => {
  it("a seta para cima, o arquivo e a tabela isolados, a porcentagem dos bytes, a dica e \"Cancelar\" com o nome do arquivo", () => {
    const html = renderToStaticMarkup(createElement(LoadEntry, { entry: load(), onCancel: noop, onShowError: noop }));
    expect(html).toContain("Importando <bdi>pedidos.csv</bdi> para <bdi>pedido</bdi>… 45%");
    expect(html).toContain('title="12.345 linhas gravadas, 10.000 confirmadas · 45 bytes de 100 bytes lidos"');
    expect(html).toMatch(/role="progressbar" aria-label="Progresso da importação de pedidos.csv" aria-valuemin="0" aria-valuemax="100" aria-valuenow="45"/);
    expect(html).toContain('aria-label="Cancelar a importação de pedidos.csv"');
  });

  it("a cópia: os dois nomes iguais isolados cada um no seu lugar, e \"Cancelar a cópia de pedido\"", () => {
    const html = renderToStaticMarkup(createElement(LoadEntry, { entry: load({ kind: "copy", sourceName: "pedido", format: null, total: 200, rows: 90, bytes: 0, size: null }), onCancel: noop, onShowError: noop }));
    expect(html).toContain("Copiando <bdi>pedido</bdi> para <bdi>pedido</bdi>… 45%");
    expect(html).toContain('aria-label="Cancelar a cópia de pedido"');
  });

  it("a que parou: o texto, \"Ver o erro\" e \"Descartar\", sem barra; a que não se sabe: sem barra, com \"Cancelar\"", () => {
    const failed = renderToStaticMarkup(createElement(LoadEntry, { entry: load({ stage: "failed" }), onCancel: noop, onShowError: noop }));
    expect(failed).toContain("A importação para <bdi>pedido</bdi> parou.");
    expect(failed).toContain("Ver o erro");
    expect(failed).toContain("Descartar");
    expect(failed).not.toContain("progressbar");

    const lost = renderToStaticMarkup(createElement(LoadEntry, { entry: load({ stage: "lost" }), onCancel: noop, onShowError: noop }));
    expect(lost).toContain("Não foi possível saber como está a importação.");
    expect(lost).not.toContain("progressbar");
    expect(lost).toContain("Cancelar");
  });

  it("o diálogo da falha: o arquivo, a tabela, a linha do arquivo, a coluna, o SQLSTATE e o que ficou", () => {
    const failure = { line: 1234, column: "qtd", message: "«12a» não é um número inteiro.", sqlState: null, side: "target" as const, stayed: "Nenhuma linha foi gravada, e a tabela está como antes." };
    expect(failureLines(load({ stage: "failed", failure }))).toEqual([
      { label: "Arquivo", value: "pedidos.csv" },
      { label: "Tabela", value: "estoque.pedido" },
      { label: "Linha", value: "Linha 1.234 do arquivo" },
      { label: "Coluna", value: "qtd" },
      { label: "O que ficou", value: "Nenhuma linha foi gravada, e a tabela está como antes." },
    ]);
    expect(failureLines(load({ kind: "copy", sourceName: "pedido", stage: "failed", failure: { ...failure, column: null, sqlState: "23505" } }))).toEqual([
      { label: "Origem", value: "pedido" },
      { label: "Tabela", value: "estoque.pedido" },
      { label: "Linha", value: "Linha 1.234 da origem" },
      { label: "SQLSTATE", value: "23505" },
      { label: "O que ficou", value: "Nenhuma linha foi gravada, e a tabela está como antes." },
    ]);
  });
});
