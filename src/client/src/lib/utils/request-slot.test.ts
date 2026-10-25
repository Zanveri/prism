import { describe, expect, it } from "vitest";

import { createRequestSlot } from "./request-slot";

describe("createRequestSlot", () => {
  it("guarda o último pedido, com um número novo a cada um, e devolve o mesmo objeto enquanto nada muda", () => {
    const slot = createRequestSlot<string>();
    expect(slot.pending()).toBeNull();

    slot.request("a");
    const first = slot.pending();
    expect(first).toEqual({ value: "a", seq: 1 });
    expect(slot.pending()).toBe(first);

    slot.request("a");
    expect(slot.pending()).toEqual({ value: "a", seq: 2 });
  });

  it("`take` só leva o pedido que foi atendido: o pedido novo, feito no meio, fica", () => {
    const slot = createRequestSlot<number>();
    slot.request(1);
    const seq = slot.pending()?.seq ?? 0;
    slot.request(2);

    slot.take(seq);
    expect(slot.pending()?.value).toBe(2);
    slot.take(slot.pending()?.seq ?? 0);
    expect(slot.pending()).toBeNull();
  });

  it("avisa quem assina a cada mudança, e `clear` esquece o pedido", () => {
    const slot = createRequestSlot<number>();
    let calls = 0;
    const stop = slot.subscribe(() => calls++);

    slot.request(1);
    slot.clear();
    slot.clear();
    expect(calls).toBe(2);
    expect(slot.pending()).toBeNull();

    stop();
    slot.request(2);
    expect(calls).toBe(2);
  });
});
