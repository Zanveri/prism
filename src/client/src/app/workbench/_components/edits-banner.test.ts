import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditsBanner } from "./edits-banner";

const noop = () => {};
const render = (over: Partial<Parameters<typeof EditsBanner>[0]> = {}) =>
  renderToStaticMarkup(createElement(EditsBanner, { pending: 0, oneAtATime: false, saving: false, readOnly: null, notice: null, failure: null, fetching: false, onCancelFetch: noop, onViewSql: noop, onDiscard: noop, onSave: noop, ...over }));

/** O cadeado (o retângulo dele) e o triângulo de atenção, pelos traços de `icons.tsx`. */
const lock = '<rect x="3.5" y="7"';
const alert = 'd="M8 2.5l6 10.5H2z"';

describe("o recado da faixa da edição", () => {
  it("o motivo de só leitura e a conferência do catálogo vêm com o cadeado, como antes", () => {
    const markup = render({ notice: "Somente leitura: DISTINCT." });

    expect(markup).toContain(lock);
    expect(markup).not.toContain(alert);
    expect(markup).toMatch(/<p role="status"[^>]*text-muted/);
  });

  it("o aviso do \"Duplicar linha\" (RN-EDIT-016) vem com o triângulo de atenção, no tom do texto, sem o cadeado", () => {
    const markup = render({ notice: "Não copiada (fica com o padrão da tabela): id.", noticeTone: "warning" });

    expect(markup).toContain(alert);
    expect(markup).not.toContain(lock);
    expect(markup).toMatch(/<p role="status"[^>]*text-ink/);
    expect(markup).toContain("Não copiada (fica com o padrão da tabela): id.");
  });

  it("sem recado, o motivo de só leitura da barra fica com o cadeado, mesmo com o tom de atenção guardado", () => {
    expect(render({ readOnly: "Somente leitura: DISTINCT.", noticeTone: "warning" })).toContain(lock);
  });
});

describe("a nota das linhas importadas (RN-IMPORT-020)", () => {
  it("\"Linhas foram importadas nesta tabela depois da leitura.\" com \"Atualizar\", também sem alteração nenhuma; sem a nota, a faixa não aparece", () => {
    const markup = render({ onImportedRefresh: noop });

    expect(markup).toContain('<span role="status" class="text-ink">Linhas foram importadas nesta tabela depois da leitura.</span>');
    expect(markup).toMatch(/<button[^>]*>Atualizar<\/button>/);
    expect(render()).toBe("");
  });

  it("o \"Atualizar\" da nota espera o Salvar em andamento", () => {
    expect(render({ onImportedRefresh: noop, pending: 2, saving: true })).toMatch(/<button[^>]*disabled=""[^>]*>Atualizar<\/button>/);
  });
});
