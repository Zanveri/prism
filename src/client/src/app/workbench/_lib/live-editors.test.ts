import { describe, expect, it } from "vitest";

import { liveEditors } from "./live-editors";

describe("liveEditors: o texto do editor no instante em que a aba sai (RN-ABAS-002)", () => {
  it("lê o editor registrado na hora do pedido, e nada depois de ele sair", () => {
    let text = "select 1";
    const stop = liveEditors.register("a", () => ({ sql: text, anchor: 0, head: text.length }));

    text = "select 2";
    expect(liveEditors.snapshot("a")).toEqual({ sql: "select 2", anchor: 0, head: 8 });

    stop();
    expect(liveEditors.snapshot("a")).toBeNull();
  });

  it("o editor que sai não tira o que nasceu depois na mesma aba", () => {
    const first = liveEditors.register("b", () => ({ sql: "velho", anchor: 0, head: 0 }));
    const second = liveEditors.register("b", () => ({ sql: "novo", anchor: 0, head: 0 }));

    first();
    expect(liveEditors.snapshot("b")?.sql).toBe("novo");
    second();
  });
});
