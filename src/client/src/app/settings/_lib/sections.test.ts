import { describe, expect, it } from "vitest";

import { settingsSections } from "./sections";

describe("as seções da tela de Configurações", () => {
  it("todas as seções funcionam, e a Conta vem primeiro, como no canvas", () => {
    const soon = settingsSections.map((section) => section.soon);

    expect(soon).toEqual([...soon].sort((a, b) => Number(a) - Number(b)));
    expect(settingsSections.filter((section) => section.soon).map((section) => section.id)).toEqual([]);
    expect(settingsSections[0].id).toBe("account");
  });

  it("Importar vem logo depois de Conta (RN-CONFIG-011), e funciona", () => {
    expect(settingsSections.slice(0, 2).map((section) => [section.id, section.label, section.anchor, section.soon])).toEqual([
      ["account", "Conta", "cfg-conta", false],
      ["import", "Importar", "cfg-importar", false],
    ]);
  });

  it("cada seção tem uma âncora própria, no padrão do canvas (cfg-...), e um endereço próprio (o `id`)", () => {
    const anchors = settingsSections.map((section) => section.anchor);

    expect(new Set(anchors).size).toBe(anchors.length);
    expect(new Set(settingsSections.map((section) => section.id)).size).toBe(settingsSections.length);
    expect(anchors.every((anchor) => /^cfg-[a-z]+$/.test(anchor))).toBe(true);
    expect(settingsSections.find((section) => section.id === "appearance")?.anchor).toBe("cfg-aparencia");
  });
});
