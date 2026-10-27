import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CellEditor } from "./cell-editor";

// O campo de edição da célula (RN-EDIT-001) com a dica de para quantas a edição vale (RN-EDIT-017), sem DOM: o que se confere é o que ele desenha.

const noop = () => {};
const render = (hint: string | null) => renderToStaticMarkup(createElement(CellEditor, { label: "preco, linha 1", draft: "10", hint, number: true, onDraft: noop, onCommit: noop, onCancel: noop }));

describe("a dica do campo de edição (RN-EDIT-017)", () => {
  it("com várias células, a dica fica logo abaixo do campo, no tom de atenção, e é a descrição dele", () => {
    const markup = render("Vale para as 37 células escolhidas da coluna preco.");
    const id = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toMatch(/data-editor-hint[^>]*class="[^"]*border-accent[^"]*top-full/);
    expect(markup).toContain("Vale para as 37 células escolhidas da coluna preco.");
  });

  it("com uma célula só, não há dica nem descrição", () => {
    const markup = render(null);
    expect(markup).not.toContain("aria-describedby");
    expect(markup).not.toContain("data-editor-hint");
  });
});

describe("a cor do ambiente no campo de edição (RN-AMB-002)", () => {
  const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
  const field = (markup: string) => /<textarea[^>]*>/.exec(markup)?.[0] ?? "";
  const border = "border-[color:var(--environment-color,var(--color-accent))]";

  it("a borda do campo lê a cor do ambiente (reserva: o acento), para o contorno da célula não trocar de cor ao editar", () => {
    for (const hint of [null, "Vale para as 37 células escolhidas da coluna preco."]) {
      const names = classesOf(field(render(hint)));

      expect(names).toContain("border");
      expect(names).toContain(border);
      expect(names).not.toContain("border-accent");
      expect(names).toContain("outline-none");
    }
  });

  it("a dica, o ícone de atenção e o botão de confirmar continuam no acento do tema: ali é atenção e ação, e não contorno", () => {
    const markup = render("Vale para as 37 células escolhidas da coluna preco.");
    const hint = /<p[^>]*data-editor-hint[^>]*>/.exec(markup)?.[0] ?? "";
    const confirm = /<button[^>]*aria-label="Confirmar edição \(Enter\)"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(confirm).not.toBe("");

    expect(classesOf(hint)).toContain("border-accent");
    expect(classesOf(hint)).not.toContain(border);
    expect(/<svg[^>]*text-accent[^>]*>/.test(markup)).toBe(true);
    expect(classesOf(confirm)).toContain("bg-accent");
    expect(classesOf(confirm).some((name) => name.includes("environment"))).toBe(false);
  });

  it("o campo não põe a variável: ela vem da área de resultado, por herança", () => {
    expect(render("dica")).not.toContain("--environment-color:");
    expect(render(null)).not.toContain("style=");
  });

  it("o campo de uma coluna numérica e o de texto levam a mesma borda", () => {
    const text = renderToStaticMarkup(createElement(CellEditor, { label: "obs, linha 1", draft: "a", number: false, onDraft: noop, onCommit: noop, onCancel: noop }));

    expect(classesOf(field(text))).toContain(border);
    expect(classesOf(field(text))).not.toContain("text-right");
    expect(classesOf(field(render(null)))).toContain("text-right");
  });
});
