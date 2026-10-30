import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as Icons from "./icons";

const css = readFileSync(resolve(__dirname, "../../styles/globals.css"), "utf8");

describe("ícones animados em hover (icons.tsx + globals.css)", () => {
  const entries = Object.entries(Icons).filter(([name, value]) => name.endsWith("Icon") && typeof value === "function");

  it("todos os 68 ícones exportados renderizam <svg aria-hidden='true' data-icon='...'>", () => {
    expect(entries.length).toBeGreaterThanOrEqual(68);

    for (const [name, Component] of entries) {
      const markup = renderToStaticMarkup(createElement(Component));
      expect(markup, `${name} deve ter aria-hidden="true"`).toMatch(/^<svg[^>]*\baria-hidden="true"/);
      expect(markup, `${name} deve ter data-icon`).toMatch(/^<svg[^>]*\bdata-icon="[a-z-]+"/);
    }
  });

  it("cada família data-icon usada pelos ícones tem regra de animação em globals.css sob prefers-reduced-motion: no-preference", () => {
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(':not(:disabled):not([aria-disabled="true"])');

    const families = new Set(
      entries.map(([, Component]) => {
        const markup = renderToStaticMarkup(createElement(Component));
        return /\bdata-icon="([a-z-]+)"/.exec(markup)?.[1] ?? "";
      }),
    );

    for (const family of families) {
      expect(css, `globals.css deve estilizar [data-icon="${family}"]`).toContain(`[data-icon="${family}"]`);
    }
  });

  it("preserva os caminhos SVG exigidos pelos testes de grade, menu e alertas e separa partes móveis com icon-part-*", () => {
    expect(renderToStaticMarkup(createElement(Icons.ArrowUpIcon))).toContain('d="M8 13V3M4 7l4-4 4 4"');
    expect(renderToStaticMarkup(createElement(Icons.ArrowDownIcon))).toContain('d="M8 3v10M4 9l4 4 4-4"');
    expect(renderToStaticMarkup(createElement(Icons.CheckIcon))).toContain('d="M3.5 8.5l3 3 6-7"');
    expect(renderToStaticMarkup(createElement(Icons.AlertIcon))).toContain('d="M8 2.5l6 10.5H2z"');
    expect(renderToStaticMarkup(createElement(Icons.TrashIcon))).toContain('class="icon-part-lid"');
    expect(renderToStaticMarkup(createElement(Icons.LockIcon))).toContain('class="icon-part-shackle"');
    expect(renderToStaticMarkup(createElement(Icons.ClockIcon))).toContain('class="icon-part-hand"');
  });
});
