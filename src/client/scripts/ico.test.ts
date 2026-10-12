import { describe, expect, it } from "vitest";

import { buildIco } from "./ico.mjs";

/** Um "PNG" de mentira: o `.ico` só carrega os bytes, e o teste os reconhece pelo conteúdo. */
function fakePng(size: number) {
  return Uint8Array.from({ length: 20 + size }, (_, index) => (index + size) % 251);
}

const images = [16, 32, 256].map((size) => ({ size, png: fakePng(size) }));
const directorySize = 6 + 16 * images.length;

function read(ico: Uint8Array) {
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  const entry = (index: number) => {
    const at = 6 + 16 * index;
    return {
      width: view.getUint8(at),
      height: view.getUint8(at + 1),
      colors: view.getUint8(at + 2),
      reserved: view.getUint8(at + 3),
      planes: view.getUint16(at + 4, true),
      bitCount: view.getUint16(at + 6, true),
      bytes: view.getUint32(at + 8, true),
      offset: view.getUint32(at + 12, true),
    };
  };
  return { view, entry };
}

describe("buildIco", () => {
  it("cabeçalho: reservado 0, tipo 1, contagem igual ao número de imagens", () => {
    const { view } = read(buildIco(images));

    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(images.length);
  });

  it("cada entrada traz largura e altura em um byte, com 256 gravado como 0", () => {
    const { entry } = read(buildIco(images));

    expect([entry(0).width, entry(0).height]).toEqual([16, 16]);
    expect([entry(1).width, entry(1).height]).toEqual([32, 32]);
    expect([entry(2).width, entry(2).height]).toEqual([0, 0]);
  });

  it("cada entrada declara 32 bits por pixel e o tamanho em bytes do PNG", () => {
    const { entry } = read(buildIco(images));

    images.forEach((image, index) => {
      expect(entry(index)).toMatchObject({ colors: 0, reserved: 0, planes: 1, bitCount: 32, bytes: image.png.length });
    });
  });

  it("os deslocamentos são contíguos e o primeiro vem logo depois do diretório", () => {
    const { entry } = read(buildIco(images));

    expect(entry(0).offset).toBe(directorySize);
    expect(entry(1).offset).toBe(entry(0).offset + entry(0).bytes);
    expect(entry(2).offset).toBe(entry(1).offset + entry(1).bytes);
  });

  it("os bytes de cada PNG saem inteiros na posição declarada", () => {
    const ico = buildIco(images);
    const { entry } = read(ico);

    images.forEach((image, index) => {
      const { offset, bytes } = entry(index);
      expect(Array.from(ico.subarray(offset, offset + bytes))).toEqual(Array.from(image.png));
    });
    expect(ico.length).toBe(directorySize + images.reduce((total, image) => total + image.png.length, 0));
  });

  it("lista vazia lança erro", () => {
    expect(() => buildIco([])).toThrow();
  });

  it("tamanho fora de 1 a 256 lança erro: o formato guarda a medida em um byte", () => {
    expect(() => buildIco([{ size: 512, png: fakePng(1) }])).toThrow();
    expect(() => buildIco([{ size: 0, png: fakePng(1) }])).toThrow();
  });
});
