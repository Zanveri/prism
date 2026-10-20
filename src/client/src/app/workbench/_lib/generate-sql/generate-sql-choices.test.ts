import { describe, expect, it } from "vitest";

import { generateSqlChoicesKey, parseSqlOptions, readSqlOptions, writeSqlOptions } from "./generate-sql-choices";

/** Um armazenamento em memória, como o `localStorage` de uma instalação. */
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

describe("as opções lembradas do Gerar SQL (RN-GRADE-018)", () => {
  it("começam nos padrões: nomes completos ligado, compacto desligado, excluir as geradas ligado", () => {
    expect(parseSqlOptions(null)).toEqual({ qualified: true, compact: false, excludeGenerated: true });
  });

  it("são por usuário, numa chave própria, sem diferenciar maiúsculas nem os espaços das pontas", () => {
    const storage = memory();
    writeSqlOptions(" Marina.Costa ", { qualified: false, compact: true, excludeGenerated: false }, () => storage);

    expect([...storage.items.keys()]).toEqual([generateSqlChoicesKey("marina.costa")]);
    expect(readSqlOptions("marina.costa", () => storage)).toEqual({ qualified: false, compact: true, excludeGenerated: false });
    expect(readSqlOptions("outra.pessoa", () => storage)).toEqual({ qualified: true, compact: false, excludeGenerated: true });
  });

  it("o que não vale volta ao padrão, campo a campo, sem erro; sem usuário ou sem armazenamento, os padrões, e gravar não lança", () => {
    expect(parseSqlOptions('{"qualified": "sim", "compact": true}')).toEqual({ qualified: true, compact: true, excludeGenerated: true });
    expect(parseSqlOptions("não é JSON")).toEqual({ qualified: true, compact: false, excludeGenerated: true });
    expect(parseSqlOptions("[1, 2]")).toEqual({ qualified: true, compact: false, excludeGenerated: true });
    expect(readSqlOptions(null, () => memory())).toEqual({ qualified: true, compact: false, excludeGenerated: true });
    expect(
      readSqlOptions("marina", () => {
        throw new Error("sem acesso");
      }),
    ).toEqual({ qualified: true, compact: false, excludeGenerated: true });
    expect(() =>
      writeSqlOptions("marina", { qualified: true, compact: false, excludeGenerated: true }, () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error("cheio");
        },
      })),
    ).not.toThrow();
  });
});
