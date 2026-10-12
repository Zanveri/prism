import { describe, expect, it } from "vitest";

import { buildIcns } from "./icns.mjs";

const fakePng = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7 + length) % 251);
const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

describe("buildIcns", () => {
  const images = [
    { type: "ic07", png: fakePng(30) },
    { type: "ic10", png: fakePng(50) },
  ];
  const icns = buildIcns(images);
  const view = new DataView(icns.buffer);

  it("começa por icns e o tamanho total, em big-endian", () => {
    expect(text(icns, 0)).toBe("icns");
    expect(view.getUint32(4)).toBe(icns.length);
    expect(icns.length).toBe(8 + (8 + 30) + (8 + 50));
  });

  it("cada entrada traz o tipo, o tamanho (com o cabeçalho de 8 bytes) e os bytes do PNG, na ordem dada", () => {
    expect(text(icns, 8)).toBe("ic07");
    expect(view.getUint32(12)).toBe(8 + 30);
    expect(Array.from(icns.subarray(16, 46))).toEqual(Array.from(images[0].png));

    expect(text(icns, 46)).toBe("ic10");
    expect(view.getUint32(50)).toBe(8 + 50);
    expect(Array.from(icns.subarray(54, 104))).toEqual(Array.from(images[1].png));
  });

  it("recusa a lista vazia e o tipo que não tem 4 letras", () => {
    expect(() => buildIcns([])).toThrow(/ao menos uma imagem/);
    expect(() => buildIcns([{ type: "ic1", png: fakePng(4) }])).toThrow(/Tipo inválido/);
  });
});
