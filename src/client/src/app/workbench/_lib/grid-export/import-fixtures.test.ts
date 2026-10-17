import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { csvFieldOf } from "../csv";

/**
 * RN-IMPORT-028: as fixtures de ouro da importação que a tela divide com a API, na pasta da RN-EXPORT-024 (`src/test-fixtures/export/`). A tela não lê
 * arquivo de importação nenhum (quem lê é a API, em C#); o lado dela é a proteção contra fórmula do "Exportar CSV" (`csvFieldOf`), de que a importação faz a
 * volta: cada caso de `import-unguard.json` diz o valor, o campo que a tela escreve e o que a API devolve ao tirar o apóstrofo. Aqui se confere o campo; o
 * `ImportFixturesTests` da API confere a volta. Mudar a proteção é mudar a fixture, e os dois lados falham até seguirem a regra nova. Sem o arquivo o
 * teste falha, e não fica de fora: a conferência não some calada.
 */
const fixtures = new URL("../../../../../../../src/test-fixtures/export/", import.meta.url);
const unguard = new URL("import-unguard.json", fixtures);

type FixtureText = string | { codePoints: number[] };
type UnguardCase = { name: string; value: FixtureText; field: FixtureText; back: FixtureText; lossy?: boolean };

/** Monta o texto da fixture ponto de código por ponto de código: o par solto vira um `char` só, como no C#. */
function text(written: FixtureText): string {
  if (typeof written === "string") return written;
  return written.codePoints.map((code) => (code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code))).join("");
}

describe("a volta da proteção contra fórmula (RN-IMPORT-004 e 028, import-unguard.json)", () => {
  const cases = () => (JSON.parse(readFileSync(unguard, "utf8")) as { cases: UnguardCase[] }).cases;

  it("o campo de cada caso é o que o Exportar CSV da tela escreve (`csvFieldOf`, com os padrões)", () => {
    const failures = cases().flatMap((test) => {
      const actual = csvFieldOf(text(test.value));
      return actual === text(test.field) ? [] : [`${test.name}: esperado ${JSON.stringify(text(test.field))}, veio ${JSON.stringify(actual)}`];
    });
    expect(cases().length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("proteger e tirar devolve o valor, menos nos casos marcados como perda (o apóstrofo de verdade antes de =, +, - ou @)", () => {
    const failures = cases().flatMap((test) => {
      const same = text(test.back) === text(test.value);
      return same === (test.lossy !== true) ? [] : [`${test.name}: a volta ${same ? "devolve" : "não devolve"} o valor, e a fixture diz o contrário`];
    });
    expect(failures).toEqual([]);
  });
});
