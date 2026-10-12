import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buttonLabeled } from "@/lib/testing/react-tree";

import { ApiGateError } from "./api-gate";

// O `ToastProvider` desenha num portal em `document.body`, que o renderizador de servidor não tem: "Verificar atualizações" só
// precisa de um `useToast` que não faça nada.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

describe("a tela de erro da API (seção 7 da especificação)", () => {
  const render = (message: string) => renderToStaticMarkup(createElement(ApiGateError, { message, onRestart: () => {} }));

  it("mostra o motivo como texto e oferece 'Reiniciar'", () => {
    const markup = render("A API saiu com código 1 antes de anunciar a porta.\n<b>stderr</b>");

    expect(markup).toContain("A API do Prism não está em execução");
    expect(markup).toContain("A API saiu com código 1 antes de anunciar a porta.");
    expect(markup).toContain("&lt;b&gt;stderr&lt;/b&gt;");
    expect(markup).toMatch(/<button[^>]*>Reiniciar<\/button>/);
  });

  it("'Reiniciar' chama o reinício", () => {
    const onRestart = vi.fn();
    const restart = buttonLabeled(ApiGateError({ message: "x", onRestart }), "Reiniciar");

    (restart?.props.onClick as () => void)();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("oferece 'Verificar atualizações': com a API fora do ar a versão nova pode ser o conserto, e o atualizador não depende dela (RN-ATUALIZA-002)", () => {
    expect(render("x")).toMatch(/<button[^>]*\bdata-check-updates\b[^>]*>Verificar atualizações<\/button>/);
  });
});
