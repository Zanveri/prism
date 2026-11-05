import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { describe, expect, it } from "vitest";

import { applicationMenuTemplate } from "../../../../electron/platform";

import { scriptShortcut, valuesShortcut, valuesShortcutLabel } from "./script-run";

// RN-VAR-026: o atalho do "Executar com valores…", e que nenhum outro atalho do Prism, do editor (CodeMirror) nem do menu do Electron usa as mesmas teclas.
const key = (over: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "X", code: "KeyX", ctrlKey: false, metaKey: false, altKey: true, shiftKey: true, ...over });

describe("o atalho do Executar com valores (RN-VAR-026)", () => {
  it("Shift+Alt+X no Windows e no Linux; Shift+Cmd+Option+X no macOS", () => {
    expect(valuesShortcut(key({}), "Win32")).toBe(true);
    expect(valuesShortcut(key({ key: "x" }), "Linux x86_64")).toBe(true);
    expect(valuesShortcut(key({ metaKey: true, key: "≈" }), "MacIntel")).toBe(true);
    expect(valuesShortcut(key({}), "MacIntel")).toBe(false);
    expect(valuesShortcutLabel("Win32")).toEqual({ label: "Shift+Alt+X", aria: "Shift+Alt+X" });
    expect(valuesShortcutLabel("MacIntel")).toEqual({ label: "Shift+Cmd+Option+X", aria: "Shift+Meta+Alt+X" });
  });

  it("não é o do script, e o do script não é ele; com Ctrl (o AltGr) não é nenhum", () => {
    expect(scriptShortcut(key({}), "Win32")).toBe(false);
    expect(valuesShortcut(key({ shiftKey: false }), "Win32")).toBe(false);
    expect(valuesShortcut(key({ ctrlKey: true }), "Win32")).toBe(false);
  });

  it("nenhum atalho dos mapas do editor nem do menu do Electron usa X com Shift e Alt", () => {
    // Os mapas que o editor monta (sql-editor.tsx): o padrão, o do histórico, o Tab e os do Prism à frente deles.
    const prism = ["Mod-Enter", "Mod-.", "Mod-Shift-f"];
    const keys = [...defaultKeymap, ...historyKeymap, indentWithTab].flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux]).filter((name): name is string => name !== undefined);
    const usesX = (name: string) => {
      const parts = name.split("-").map((part) => part.toLowerCase());
      return parts.at(-1) === "x" && parts.includes("alt") && parts.includes("shift");
    };
    expect([...keys, ...prism].filter(usesX)).toEqual([]);
    // O menu do macOS só tem papéis (sem `accelerator` próprio); no Windows e no Linux não há menu.
    expect(JSON.stringify(applicationMenuTemplate("darwin"))).not.toContain("accelerator");
    expect(applicationMenuTemplate("win32")).toBeNull();
  });
});
