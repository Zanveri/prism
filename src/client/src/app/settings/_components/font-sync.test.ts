import { beforeEach, describe, expect, it, vi } from "vitest";

// O `FontSync` com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). O efeito de layout roda como o efeito comum.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks, useLayoutEffect: rt.hooks.useEffect }));

const state = vi.hoisted(() => ({ signedIn: true, ui: "IBM Plex Sans", editor: "IBM Plex Mono" }));
vi.mock("../_lib/use-preferences", () => ({
  usePreferences: () => ({ signedIn: state.signedIn, preferences: { ui: { fontFamily: state.ui }, editor: { fontFamily: state.editor } }, update: () => {} }),
}));

const fonts = vi.hoisted(() => ({ applyFonts: vi.fn(), clearFonts: vi.fn() }));
vi.mock("../_lib/fonts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/fonts")>()), ...fonts }));

import { FontSync } from "./font-sync";

beforeEach(() => {
  rt.unmount();
  vi.clearAllMocks();
  Object.assign(state, { signedIn: true, ui: "IBM Plex Sans", editor: "IBM Plex Mono" });
});

describe("as fontes do usuário na janela (RN-CONFIG-008)", () => {
  it("com o cofre aberto, aplica as duas escolhas", () => {
    state.ui = "Inter";
    rt.render(() => FontSync());

    expect(fonts.applyFonts).toHaveBeenCalledExactlyOnceWith({ ui: "Inter", editor: "IBM Plex Mono" });
  });

  it("a escolha que muda (nesta janela ou noutra, pelo `storage`) é aplicada na hora; a que não muda não reaplica", () => {
    rt.render(() => FontSync());
    rt.render(() => FontSync());
    expect(fonts.applyFonts).toHaveBeenCalledOnce();

    state.editor = "JetBrains Mono";
    rt.render(() => FontSync());

    expect(fonts.applyFonts).toHaveBeenLastCalledWith({ ui: "IBM Plex Sans", editor: "JetBrains Mono" });
  });

  it("sem usuário não aplica nada: as fontes são de quem entrou", () => {
    state.signedIn = false;
    rt.render(() => FontSync());

    expect(fonts.applyFonts).not.toHaveBeenCalled();
  });

  it("sair do cofre (o guard desmonta tudo) devolve a janela às fontes do app: o login não mostra as do usuário anterior", () => {
    state.ui = "Inter";
    rt.render(() => FontSync());

    rt.unmount();

    expect(fonts.clearFonts).toHaveBeenCalledOnce();
  });
});
