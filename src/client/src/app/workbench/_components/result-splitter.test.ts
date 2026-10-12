import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { maxResultPercent, minResultPercent } from "../_lib/result-layout";
import { workbenchCopy } from "../_lib/workbench.copy";
import { ResultSplitter } from "./result-splitter";

const render = (resultPercent: number) => renderToStaticMarkup(createElement(ResultSplitter, { area: { current: null }, controls: "resultado-1", resultPercent, dispatch: () => {} }));

describe("a divisória do editor e do resultado (RN-PAINEL-001)", () => {
  it("é um separador horizontal focável, com o valor, os limites e a área que controla", () => {
    const markup = render(60);

    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('aria-controls="resultado-1"');
    expect(markup).toContain(`aria-valuemin="${minResultPercent}"`);
    expect(markup).toContain(`aria-valuemax="${maxResultPercent}"`);
    expect(markup).toContain('aria-valuenow="60"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain(`aria-label="${workbenchCopy.result.resize}"`);
    expect(markup).toContain(`aria-valuetext="${workbenchCopy.result.resizeValue(60)}"`);
  });

  it("o valor lido é inteiro, mesmo depois de um arrasto que deixou casas decimais", () => {
    expect(render(41.37)).toContain('aria-valuenow="41"');
  });

  it("não deixa o arrasto selecionar o texto do editor e da grade que passam por baixo do ponteiro", () => {
    expect(render(60)).toMatch(/class="[^"]*\bselect-none\b/);
  });
});
