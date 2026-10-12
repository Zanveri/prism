import { crc32 as nodeCrc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readZip } from "./test-zip-reader";
import { crc32, zipStored } from "./zip";

const text = (value: string) => new TextEncoder().encode(value);

describe("crc32", () => {
  it("o vetor de conferência do padrão: `123456789` dá 0xCBF43926; o vazio dá 0", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("é o mesmo do zlib do Node, em dados de todos os tamanhos e de todos os bytes", () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    const big = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31 + (index >> 8)) & 0xff);

    for (const bytes of [all, big, text("açaí 🙂"), new Uint8Array(1), Uint8Array.of(0xff, 0xff, 0xff, 0xff)]) expect(crc32(bytes)).toBe(nodeCrc32(bytes));
  });

  it("o resultado é sempre um inteiro sem sinal de 32 bits", () => {
    for (const bytes of [text("a"), text("b"), new Uint8Array(0), Uint8Array.of(0xff)]) {
      expect(Number.isInteger(crc32(bytes))).toBe(true);
      expect(crc32(bytes)).toBeGreaterThanOrEqual(0);
      expect(crc32(bytes)).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("zipStored: o ZIP sem compressão", () => {
  it("o que se escreve é o que um leitor de ZIP de fora lê de volta (nomes, dados, CRC, tamanhos, cabeçalhos local e central)", () => {
    const binary = Uint8Array.from({ length: 1000 }, (_, index) => (index * 7) & 0xff);
    const files = readZip(
      zipStored([
        { name: "a.txt", data: text("olá, mundo") },
        { name: "pasta/b.bin", data: binary },
        { name: "vazio.xml", data: new Uint8Array(0) },
        { name: "[Content_Types].xml", data: text("<x/>") },
      ]),
    );

    expect(files.map((file) => file.name)).toEqual(["a.txt", "pasta/b.bin", "vazio.xml", "[Content_Types].xml"]);
    expect(new TextDecoder().decode(files[0].data)).toBe("olá, mundo");
    expect([...files[1].data]).toEqual([...binary]);
    expect(files[2].data).toHaveLength(0);
    expect(files.every((file) => file.method === 0)).toBe(true);
  });

  it("sem entrada nenhuma é um arquivo válido, só com o fim do diretório central (22 bytes)", () => {
    const bytes = zipStored([]);

    expect(bytes).toHaveLength(22);
    expect(readZip(bytes)).toEqual([]);
  });

  it("o nome com acento e emoji é UTF-8, e o sinalizador do bit 11 o declara", () => {
    const [file] = readZip(zipStored([{ name: "planilha-ação-🙂.xml", data: text("x") }]));

    expect(file.name).toBe("planilha-ação-🙂.xml");
    expect(file.flags & 0x0800).toBe(0x0800);
  });

  it("a data e a hora são fixas (1980-01-01 00:00), e o mesmo conteúdo dá os mesmos bytes: o arquivo é reproduzível", () => {
    const entries = [{ name: "a", data: text("x") }];
    const [file] = readZip(zipStored(entries));

    expect(file.date).toBe(0x0021);
    expect(file.time).toBe(0);
    expect([...zipStored(entries)]).toEqual([...zipStored(entries)]);
  });

  it("não altera os dados que recebe, e a saída não os compartilha", () => {
    const data = text("abc");
    const bytes = zipStored([{ name: "a", data }]);

    data[0] = 0x7a;
    expect(new TextDecoder().decode(readZip(bytes)[0].data)).toBe("abc");
  });

  it("o teto: 65.535 entradas, e cada uma e o arquivo todo em 4 GiB menos 1 (o ZIP sem ZIP64); acima disso lança RangeError antes de copiar qualquer dado", () => {
    const entries = Array.from({ length: 65_536 }, (_, index) => ({ name: `f${index}`, data: new Uint8Array(0) }));

    expect(() => zipStored(entries)).toThrow(RangeError);
    expect(zipStored(entries.slice(0, 65_535)).length).toBeGreaterThan(65_535 * 76);
    expect(() => zipStored([{ name: "grande", data: { length: 0x1_0000_0000 } as Uint8Array }])).toThrow(RangeError);
    expect(() => zipStored([{ name: "a", data: { length: 0xffff_ffff } as Uint8Array }, { name: "b", data: { length: 1 } as Uint8Array }])).toThrow(RangeError);
  });

  it("nome maior que 65.535 bytes não cabe no cabeçalho: RangeError", () => {
    expect(() => zipStored([{ name: "x".repeat(70_000), data: new Uint8Array(0) }])).toThrow(RangeError);
  });
});
