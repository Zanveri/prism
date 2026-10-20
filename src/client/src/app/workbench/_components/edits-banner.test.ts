import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditsBanner, savingLabel } from "./edits-banner";

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

describe("a coluna inteira e o Salvar que conta e pergunta (RN-EDIT-017 a 021)", () => {
  it("a linha das colunas inteiras embaixo da contagem; no banco sem log, a frase de que ela é um comando só, gravado primeiro", () => {
    const markup = render({ pending: 2, wholeLine: "Em todas as linhas do resultado: preco = 10.00." });
    expect(markup).toContain("2 alterações não salvas");
    expect(markup).toContain("Em todas as linhas do resultado: preco = 10.00.");
    expect(render({ pending: 2, oneAtATime: true, wholeLine: "x" })).toContain("A da coluna inteira é um comando só, gravado primeiro, e não há como desfazê-lo.");
    expect(render({ pending: 2, oneAtATime: true })).not.toContain("A da coluna inteira");
  });

  it("o grupo de células sendo montado, com o \"Cancelar\": os botões das pendências esperam, com o motivo", () => {
    const markup = render({ pending: 1, building: "Aplicando o valor a 100.000 células…", onCancelBuild: noop });
    expect(markup).toContain("Aplicando o valor a 100.000 células…");
    expect(markup.match(/disabled=""/g)?.length).toBe(3);
    expect(markup).toContain('title="Aplicando o valor às células escolhidas."');
  });

  it("\"Contando as linhas do resultado…\" com o \"Cancelar\"; com a pergunta aberta, os botões esperam", () => {
    const counting = render({ pending: 1, counting: true, onCancelSave: noop });
    expect(counting).toContain("Contando as linhas do resultado…");
    expect(counting).toContain(">Cancelar<");
    expect(render({ pending: 1, asking: true }).match(/disabled=""/g)?.length).toBe(3);
  });

  it("o \"Salvando…\" com o \"Cancelar\", e o tempo depois de 2 segundos", () => {
    expect(render({ pending: 1, saving: true, onCancelSave: noop })).toContain(">Cancelar<");
    expect(savingLabel(null, 0)).toBe("Salvando…");
    expect(savingLabel(1_000, 2_999)).toBe("Salvando…");
    expect(savingLabel(1_000, 13_400)).toBe("Salvando… 12 s");
  });
});
