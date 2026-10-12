import { describe, expect, it } from "vitest";

import { isCloseSettingsKey, isOpenSettingsShortcut } from "./shortcut";

const keys = (overrides: Partial<Parameters<typeof isOpenSettingsShortcut>[0]>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...overrides });

describe("o atalho que abre as Configurações (Ctrl+,)", () => {
  it("Ctrl+vírgula abre, e Cmd+vírgula também (macOS)", () => {
    expect(isOpenSettingsShortcut(keys({ key: ",", ctrlKey: true }))).toBe(true);
    expect(isOpenSettingsShortcut(keys({ key: ",", metaKey: true }))).toBe(true);
  });

  it("a vírgula sozinha é só uma vírgula: quem digita no editor não vai parar nas Configurações", () => {
    expect(isOpenSettingsShortcut(keys({ key: "," }))).toBe(false);
    expect(isOpenSettingsShortcut(keys({ key: ",", shiftKey: true }))).toBe(false);
  });

  it("outra tecla com Ctrl, ou com Alt junto, não abre", () => {
    expect(isOpenSettingsShortcut(keys({ key: ".", ctrlKey: true }))).toBe(false);
    expect(isOpenSettingsShortcut(keys({ key: ",", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isOpenSettingsShortcut(keys({ key: ",", ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("quem já tratou a tecla (um menu, um diálogo) fica com ela", () => {
    expect(isOpenSettingsShortcut(keys({ key: ",", ctrlKey: true, defaultPrevented: true }))).toBe(false);
  });
});

describe("a tecla que fecha as Configurações (Esc)", () => {
  it("Esc fecha", () => {
    expect(isCloseSettingsKey(keys({ key: "Escape" }))).toBe(true);
  });

  it("não fecha se algo já tratou o Esc: a lista aberta de um campo o usa para se fechar", () => {
    expect(isCloseSettingsKey(keys({ key: "Escape", defaultPrevented: true }))).toBe(false);
  });

  it("outras teclas, e Esc com modificador, não fecham", () => {
    expect(isCloseSettingsKey(keys({ key: "Enter" }))).toBe(false);
    expect(isCloseSettingsKey(keys({ key: "Escape", ctrlKey: true }))).toBe(false);
    expect(isCloseSettingsKey(keys({ key: "Escape", shiftKey: true }))).toBe(false);
  });
});
