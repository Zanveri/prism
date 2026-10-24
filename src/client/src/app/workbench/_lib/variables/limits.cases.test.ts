import { beforeAll, describe, expect, test } from "vitest";

import { evaluateCase, loadCases } from "./cases-runner";

// Os casos de `limits.cases.json` (escritos à mão, nunca regerados do código).
describe("limits", () => {
  test.each(loadCases("limits"))("$name", (c) => {
    const outcome = evaluateCase(c);
    if (c.error !== undefined) expect(outcome).toEqual({ error: c.error });
    else {
      expect(outcome).toMatchObject({ value: c.value, type: c.type });
      if (typeof c.exact === "string") expect(outcome).toHaveProperty("exact", c.exact);
    }
  });
});

/*
 * Nada do que passou do limite é montado antes da conferência (RN-VAR-013 e 014, "Os limites" em "Testes e sondas"): a memória do teste não cresce além do limite.
 * A medida é o pico da memória residente do processo (`maxRSS`, que só sobe): cada script abaixo pediria um texto de 60 a 300 milhões de unidades (60 a 300 MB) se fosse
 * montado antes de conferir, e a recusa, com a frase do limite, tem de deixar o pico a menos de 32 MiB do que era. Os arquivos de teste rodam cada um num processo,
 * então o pico anterior é o da carga do próprio arquivo. O último teste é o controle: um buffer de 200 MiB tocado tem de aparecer na mesma medida, senão a medida não
 * vê nada e os testes de recusa não provam nada (por isso ele fica depois dos outros: o pico não desce).
 */
describe("limits: a memória não cresce além do limite", () => {
  const peakKiB = () => process.resourceUsage().maxRSS;
  const allowedGrowthKiB = 32 * 1024;
  const tooLong = "O texto passou de 1.000.000 de caracteres.";

  // Aquece o avaliador: a primeira carga do código e do cache de módulos não é o que se mede.
  beforeAll(() => {
    evaluateCase({ name: "aquecimento", engine: null, input: "const r = 'x'.padStart(10, 'x').length", seed: null });
  });

  const refused: { name: string; input: string; message: string; expand?: { token: string; text: string; times: number } }[] = [
    { name: "o padStart de 300 milhões", input: "const r = 'x'.padStart(300000000, 'x')", message: tooLong },
    { name: "o padEnd de 300 milhões", input: "const r = 'x'.padEnd(300000000, 'x')", message: tooLong },
    { name: "o random.string de 300 milhões", input: "const r = random.string(300000000)", message: "random.string: o tamanho vai de 0 a 10.000." },
    { name: "o replaceAll que daria 300 milhões", input: "const s = 'x'.padStart(1000000, 'x')\nconst r = s.replaceAll('x', 'y'.padStart(300, 'y'))", message: tooLong },
    // A lista de 60 textos de 1.000.000 (120 MiB em UTF-16) cabe nos 128 MiB da aba; o join dela daria 60 milhões de unidades.
    { name: "o join de 60 textos de 1.000.000 de caracteres", input: "const s = 'x'.padStart(1000000, 'x')\nconst l = [§s]\nconst r = l.join('')", message: tooLong, expand: { token: "§", text: "s, ", times: 59 } },
  ];

  test.each(refused)("$name é recusado com a frase do limite e sem montar o texto", ({ input, message, expand }) => {
    const before = peakKiB();
    const outcome = evaluateCase({ name: "memória", engine: null, input, seed: null, ...(expand === undefined ? {} : { expand }) });
    const growth = peakKiB() - before;

    expect(outcome).toMatchObject({ error: { message } });
    expect(growth, `o pico da memória subiu ${Math.round(growth / 1024)} MiB`).toBeLessThan(allowedGrowthKiB);
  });

  test("controle: um buffer de 200 MiB tocado aparece no pico da memória", () => {
    const before = peakKiB();
    const buffer = new Uint8Array(200 * 1024 * 1024).fill(1);
    const growth = peakKiB() - before;

    expect(buffer[buffer.length - 1]).toBe(1);
    expect(growth).toBeGreaterThan(100 * 1024);
  });
});
