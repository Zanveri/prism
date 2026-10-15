import { describe, expect, it } from "vitest";

import { zoomShortcutModifier } from "./app-zoom";

describe("zoomShortcutModifier: a tecla dos atalhos do zoom (RN-ZOOM-001) como a plataforma a escreve, na dica", () => {
  it("Cmd no macOS, Ctrl nas outras", () => {
    expect(zoomShortcutModifier("MacIntel")).toBe("Cmd");
    expect(zoomShortcutModifier("Win32")).toBe("Ctrl");
    expect(zoomShortcutModifier("Linux x86_64")).toBe("Ctrl");
    expect(zoomShortcutModifier("")).toBe("Ctrl");
  });
});
