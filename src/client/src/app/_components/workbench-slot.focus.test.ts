import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePage } from "@/lib/testing/fake-page";
import { pathsConfig } from "@/config/paths.config";

// O foco que a área de trabalho devolve ao reaparecer (a volta das Configurações), com os ganchos do React simulados e uma página de mentira. Só devolve o foco
// antigo quando o foco está perdido (RN-ABAS-019): o invólucro é pai da área das abas e o efeito dele roda depois do dela, então devolver sempre desfaria o foco
// que ela acabou de levar a uma aba aberta na mesma volta da tela. O que a página mostra (hidden, inert) está em `workbench-slot.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), route: { pathname: "/" } };
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: rt.route.pathname }) }));

import { WorkbenchSlot } from "./workbench-slot";

let page: ReturnType<typeof createFakePage>;

/** O invólucro na rota dada; devolve o que ele guarda do foco (`onFocusCapture`, que o React chamaria). */
function render(pathname: string) {
  rt.route.pathname = pathname;
  const slot = rt.render(() => WorkbenchSlot({ children: null }) as ReactElement<{ onFocusCapture: (event: { target: unknown }) => void }>);
  return { focused: (target: unknown) => slot.props.onFocusCapture({ target }) };
}

beforeEach(() => {
  page = createFakePage();
  vi.stubGlobal("document", page.document);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("WorkbenchSlot: o foco ao reaparecer (RN-ABAS-019)", () => {
  /** A pessoa estava no editor, foi às Configurações (o navegador tira o foco do que ficou escondido) e volta. */
  function leaveAndReturn(between: () => void = () => {}) {
    const editor = page.element({ id: "editor" });
    const slot = render(pathsConfig.workbench);
    page.focus(editor);
    slot.focused(editor);

    render(pathsConfig.settings);
    page.focus(null);
    between();
    render(pathsConfig.workbench);
    return editor;
  }

  it("o foco perdido volta ao elemento que o tinha, como antes", () => {
    const editor = leaveAndReturn();

    expect(editor.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(page.active()).toBe(editor);
  });

  it("o foco que já está em outro lugar vivo (o que a aba aberta na mesma volta acabou de levar) não é desfeito", () => {
    const entry = page.element({ id: "entrada-da-aba" });
    const editor = leaveAndReturn(() => page.focus(entry));

    expect(page.active()).toBe(entry);
    // Uma só chamada: a do teste, quando a pessoa estava no editor.
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it("o elemento que saiu da página (as linhas de uma lista virtual) não é focado", () => {
    const editor = page.element({ id: "editor" });
    const slot = render(pathsConfig.workbench);
    slot.focused(editor);
    editor.remove();

    render(pathsConfig.settings);
    render(pathsConfig.workbench);

    expect(editor.focus).not.toHaveBeenCalled();
  });

  it("só a volta da tela devolve o foco: ficar na área de trabalho, não", () => {
    const editor = page.element({ id: "editor" });
    const slot = render(pathsConfig.workbench);
    slot.focused(editor);
    page.focus(null);

    render(pathsConfig.workbench);

    expect(editor.focus).not.toHaveBeenCalled();
  });
});
