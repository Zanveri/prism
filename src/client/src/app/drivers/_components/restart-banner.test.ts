import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { clickLabeled } from "@/lib/testing/react-tree";

import { RestartBanner } from "./restart-banner";

describe("a faixa de reinício pendente (item E)", () => {
  it("diz que o serviço precisa reiniciar, que a senha será pedida de novo e que as abas de SQL abertas serão fechadas", () => {
    const markup = renderToStaticMarkup(createElement(RestartBanner, { onRestart: () => {} }));

    expect(markup).toContain("O Prism precisa reiniciar o serviço para aplicar a mudança nos drivers.");
    expect(markup).toContain("pede a sua senha de novo");
    expect(markup).toContain("as abas de SQL abertas serão fechadas");
    expect(markup).toMatch(/<button[^>]*>Reiniciar agora<\/button>/);
  });

  it("'Reiniciar agora' chama o reinício", () => {
    const onRestart = vi.fn();

    clickLabeled(RestartBanner({ onRestart }), "Reiniciar agora");

    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
