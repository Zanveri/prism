import { describe, expect, it } from "vitest";

import { activeSection, settingsSections } from "./sections";

describe("as seções da tela de Configurações", () => {
  it("as que funcionam vêm primeiro (a Conta, como no canvas), e as que dependem de uma API que ainda não existe, marcadas como em breve, no fim", () => {
    const soon = settingsSections.map((section) => section.soon);

    expect(soon).toEqual([...soon].sort((a, b) => Number(a) - Number(b)));
    expect(settingsSections.filter((section) => section.soon).map((section) => section.id)).toEqual(["transactions"]);
    expect(settingsSections[0].id).toBe("account");
  });

  it("cada seção tem uma âncora própria, no padrão do canvas (cfg-...)", () => {
    const anchors = settingsSections.map((section) => section.anchor);

    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors.every((anchor) => /^cfg-[a-z]+$/.test(anchor))).toBe(true);
    expect(settingsSections.find((section) => section.id === "appearance")?.anchor).toBe("cfg-aparencia");
  });
});

describe("a seção que a rolagem mostra (activeSection)", () => {
  const tops = [
    { id: "a", top: 0 },
    { id: "b", top: 500 },
    { id: "c", top: 900 },
    { id: "d", top: 1100 },
  ];
  const view = (scrollTop: number) => ({ scrollTop, height: 600, contentHeight: 1500 });

  it("no topo é a primeira", () => {
    expect(activeSection(tops, view(0))).toBe("a");
  });

  it("é a última cujo topo já passou da margem de cima", () => {
    expect(activeSection(tops, view(300))).toBe("a");
    expect(activeSection(tops, view(480))).toBe("b"); // a margem de 24 px: o topo de "b" está a 20 px de aparecer
    expect(activeSection(tops, view(700))).toBe("b");
    expect(activeSection(tops, view(880))).toBe("c");
  });

  it("no fim da rolagem é a última, mesmo que ela seja curta demais para chegar ao topo", () => {
    expect(activeSection(tops, view(900))).toBe("d");
  });

  it("sem rolagem possível (tudo cabe na tela) vale a primeira, e não a última", () => {
    expect(activeSection(tops, { scrollTop: 0, height: 2000, contentHeight: 1500 })).toBe("a");
  });

  it("sem seção nenhuma não há o que mostrar", () => {
    expect(activeSection([], view(0))).toBeNull();
  });
});
