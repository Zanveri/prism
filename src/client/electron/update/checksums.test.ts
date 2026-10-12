import { describe, expect, it } from "vitest";

import { parseSums, splitNotes, sumRefusal } from "./checksums";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "0123456789abcdef".repeat(4);
const exe = "Prism-0.2.0-win-x64.exe";

describe("parseSums: as linhas do sha256sum", () => {
  it("lê soma e nome, com dois espaços ou com o asterisco do modo binário", () => {
    const sums = parseSums(`${a}  ${exe}\n${b} *Prism-0.2.0-win-x64.zip\n${c}  Prism-0.2.0-linux-x64.tar.gz\n`);

    expect([...sums]).toEqual([[exe, a], ["Prism-0.2.0-win-x64.zip", b], ["Prism-0.2.0-linux-x64.tar.gz", c]]);
  });

  it("soma em maiúsculas vale, e sai em minúsculas", () => {
    expect(parseSums(`${c.toUpperCase()}  ${exe}`).get(exe)).toBe(c);
  });

  it("fim de linha do Windows não atrapalha", () => {
    expect(parseSums(`${a}  ${exe}\r\n${b}  outro.zip\r\n`).get(exe)).toBe(a);
  });

  it("nome com caminho é ignorado", () => {
    const sums = parseSums([`${a}  ../${exe}`, `${a}  a/b`, `${a}  a\\b`, `${a}  C:\\x.exe`, `${a}  /etc/passwd`, `${a}  ./${exe}`, `${a}  ..`, `${a}  .oculto`].join("\n"));

    expect(sums.size).toBe(0);
  });

  it("linha malformada é ignorada, e as boas ao lado dela valem", () => {
    const lines = ["", "   ", "texto qualquer", `${a.slice(1)}  curta.exe`, `${a}g  longa.exe`, `${"g".repeat(64)}  naohex.exe`, `${a}`, `${a}  `, `${a}\t${exe}`, `${a}  dois nomes.exe`, `${a}  nome.exe sobra`, `  ${a}  recuada.exe`, `${b}  ${exe}`];

    expect([...parseSums(lines.join("\n"))]).toEqual([[exe, b]]);
  });

  it("o mesmo nome com duas somas diferentes vale como ausente; repetido com a mesma soma, vale", () => {
    expect(parseSums(`${a}  ${exe}\n${b}  ${exe}\n${c}  outro.zip`).has(exe)).toBe(false);
    expect(parseSums(`${a}  ${exe}\n${b}  ${exe}\n${a}  ${exe}`).has(exe)).toBe(false);
    expect(parseSums(`${a}  ${exe}\n${a}  ${exe}`).get(exe)).toBe(a);
  });
});

describe("splitNotes: as notas da release, como o release-notes.sh as escreve", () => {
  const block = `### Somas SHA-256\n\n\`\`\`\n${a}  ${exe}\n${b}  Prism-0.2.0-win-x64.zip\n\`\`\`\n`;

  it("separa o texto das notas do bloco das somas", () => {
    const { notes, sums } = splitNotes(`### Adicionado\n\n- Coisa nova.\n\n${block}`);

    expect(notes).toBe("### Adicionado\n\n- Coisa nova.");
    expect([...sums]).toEqual([[exe, a], ["Prism-0.2.0-win-x64.zip", b]]);
  });

  it("com fim de linha do Windows também", () => {
    const { notes, sums } = splitNotes(`- Coisa nova.\n\n${block}`.replaceAll("\n", "\r\n"));

    expect(notes).toBe("- Coisa nova.");
    expect(sums.get(exe)).toBe(a);
  });

  it("sem o bloco não há soma, e o texto fica inteiro", () => {
    const { notes, sums } = splitNotes("### Adicionado\n\n- Coisa nova.\n");

    expect(notes).toBe("### Adicionado\n\n- Coisa nova.");
    expect(sums.size).toBe(0);
  });

  it("vale o ÚLTIMO título de somas: um bloco escrito no meio das notas não é o da pipeline", () => {
    const fake = `### Somas SHA-256\n\n\`\`\`\n${c}  ${exe}\n\`\`\`\n`;
    const { notes, sums } = splitNotes(`- Antes.\n\n${fake}\n- Depois.\n\n${block}`);

    expect(sums.get(exe)).toBe(a);
    expect(notes).toContain(c);
    expect(notes).toContain("- Depois.");
  });

  it("bloco fora do formato não é lido: sem cerca, sem fechar, com texto depois, ou com o título diferente", () => {
    const line = `${a}  ${exe}`;
    const broken = [
      `### Somas SHA-256\n\n${line}\n`,
      `### Somas SHA-256\n\n\`\`\`\n${line}\n`,
      `### Somas SHA-256\n\n\`\`\`\n${line}\n\`\`\`\n\nmais texto\n`,
      `### Somas SHA-256\ntexto\n\`\`\`\n${line}\n\`\`\`\n`,
      `## Somas SHA-256\n\n\`\`\`\n${line}\n\`\`\`\n`,
      `### Somas SHA-256 \u200b\n\n\`\`\`\n${line}\n\`\`\`\n`,
      `### somas sha-256\n\n\`\`\`\n${line}\n\`\`\`\n`,
      `    ### Somas SHA-256\n\n\`\`\`\n${line}\n\`\`\`\n`,
    ];

    for (const text of broken) expect(splitNotes(text).sums.size, JSON.stringify(text)).toBe(0);
  });

  it("o que não é texto vira notas vazias, sem soma", () => {
    for (const value of [null, undefined, 42, {}, []]) expect(splitNotes(value)).toEqual({ notes: "", sums: new Map() });
  });
});

describe("sumRefusal: as duas fontes têm de existir e bater (RN-ATUALIZA-005)", () => {
  const notes = new Map([[exe, a]]);
  const published = new Map([[exe, a]]);

  it("as duas existem e o arquivo confere: sem recusa", () => {
    expect(sumRefusal(exe, notes, published)).toBeNull();
    expect(sumRefusal(exe, notes, published, a)).toBeNull();
    expect(sumRefusal(exe, notes, published, a.toUpperCase())).toBeNull();
  });

  it("falta a soma nas notas: recusa, dizendo qual", () => {
    expect(sumRefusal(exe, new Map(), published, a)).toMatch(/notas/);
    expect(sumRefusal(exe, new Map([["outro.exe", a]]), published)).toMatch(/notas/);
  });

  it("falta a soma no SHA256SUMS: recusa, dizendo qual", () => {
    expect(sumRefusal(exe, notes, new Map(), a)).toMatch(/SHA256SUMS/);
  });

  it("o arquivo não bate com a das notas: recusa", () => {
    expect(sumRefusal(exe, new Map([[exe, b]]), published, a)).toMatch(/notas/);
  });

  it("o arquivo não bate com a do SHA256SUMS: recusa", () => {
    expect(sumRefusal(exe, notes, new Map([[exe, b]]), a)).toMatch(/SHA256SUMS/);
  });

  it("o arquivo não bate com nenhuma: recusa", () => {
    expect(sumRefusal(exe, notes, published, b)).not.toBeNull();
  });
});
