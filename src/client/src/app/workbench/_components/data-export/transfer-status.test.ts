import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportTracker } from "../../_lib/data-export/data-exports";
import type { NewExport, TrackedExport } from "../../_lib/data-export/transfer-tracker";
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
