import { describe, expect, it } from "vitest";

import { clipNotes, maxNotesLength, maxNotesLines, mergeReleasePages, readReleasePage } from "./releases";

const sum = "a".repeat(64);
const notesOf = (version: string) => `### Adicionado\n\n- Coisa da ${version}.\n\n### Somas SHA-256\n\n\`\`\`\n${sum}  Prism-${version}-win-x64.exe\n\`\`\`\n`;
/** Uma release como a API do GitHub a devolve: estável publicada, com as notas no `body`. Os outros campos da API vêm junto e não são lidos. */
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  url: `https://api.github.com/repos/Zanveri/prism/releases/${tag}`,
  html_url: `https://github.com/Zanveri/prism/releases/tag/${tag}`,
  id: 1,
  tag_name: tag,
  name: `Prism ${tag}`,
  body: notesOf(tag.slice(1)),
  draft: false,
  prerelease: false,
  created_at: "2026-10-10T11:00:00Z",
  published_at: "2026-10-10T12:00:00Z",
  assets: [],
  ...extra,
});
const versionsOf = (payload: unknown, installed = "0.1.0") => readReleasePage(payload, installed)?.releases.map((each) => each.version);

describe("readReleasePage (RN-ATUALIZA-002 e 003): uma página da lista de releases do GitHub", () => {
  it("só as estáveis mais novas que a instalada, da mais recente para a mais antiga, pela versão e não pela ordem da resposta", () => {
    const payload = [release("v0.2.0"), release("v0.10.0"), release("v0.1.0"), release("v0.0.9"), release("v0.9.0")];

    expect(versionsOf(payload)).toEqual(["0.10.0", "0.9.0", "0.2.0"]);
  });

  it("cada uma traz a data de publicação, as notas sem o bloco das somas, e as somas à parte", () => {
    const [found] = readReleasePage([release("v0.2.0")], "0.1.0")!.releases;

    expect(found).toEqual({ version: "0.2.0", prerelease: false, date: "2026-10-10", notes: "### Adicionado\n\n- Coisa da 0.2.0.", sums: new Map([["Prism-0.2.0-win-x64.exe", sum]]) });
  });

  it("nada mais novo: lista vazia", () => {
    expect(versionsOf([release("v0.1.0"), release("v0.0.1")])).toEqual([]);
    expect(versionsOf([])).toEqual([]);
  });

  it("rascunho nunca conta, nem estável, nem com a marca de pré-lançamento", () => {
    expect(versionsOf([release("v0.3.0", { draft: true }), release("v0.4.0-beta.1", { draft: true, prerelease: true }), release("v0.2.0")])).toEqual(["0.2.0"]);
  });

  it("estável só com a tag vX.Y.Z E sem a marca de pré-lançamento; a tag que não casa com a marca é ignorada e vai para a lista do log", () => {
    const page = readReleasePage([release("v0.3.0", { prerelease: true }), release("v0.2.0")], "0.1.0")!;

    expect(page.releases.map((each) => each.version)).toEqual(["0.2.0"]);
    expect(page.ignored.join("\n")).toContain('"v0.3.0"');
  });

  it("tag malformada é ignorada", () => {
    const payload = ["v1", "v1.2", "vNext", "v1.2.3; rm -rf", "v1.2.3 ", "v1.2.3\n", "../v1.2.3", "V1.2.3", "1.2.3", "v1.2.3-beta", "v1.2.3-alpha.1"].map((tag) => release(tag));

    expect(versionsOf(payload)).toEqual([]);
  });

  it("o que fica de fora vai para a lista do log, com a tag entre aspas (uma quebra de linha não abre outra linha no log) e com teto de tamanho", () => {
    const page = readReleasePage([release(`v9.9.9\n[prism] atualização: versão falsa${"x".repeat(500)}`), release("v1.2.3-beta", { prerelease: true })], "0.1.0")!;

    expect(page.ignored).toHaveLength(2);
    for (const line of page.ignored) {
      expect(line).not.toContain("\n");
      expect(line.length).toBeLessThanOrEqual(200);
    }
    expect(page.ignored[0]).toContain("\\n");
  });

  it("resposta que não é uma lista é inválida", () => {
    for (const payload of [null, undefined, {}, "[]", 42, { releases: [] }, { message: "Not Found", documentation_url: "https://docs.github.com/rest" }]) expect(readReleasePage(payload, "0.1.0")).toBeNull();
  });

  it("item fora do formato (sem tag de texto, sem as marcas de rascunho e de pré-lançamento em verdadeiro ou falso) é pulado e vai para o log", () => {
    const payload = [null, 42, "v9.9.9", [], { tag_name: 9, draft: false, prerelease: false }, { tag_name: { toString: () => "v9.9.9" }, draft: false, prerelease: false }, {}, release("v8.0.0", { draft: "false" }), release("v8.1.0", { prerelease: 0 }), release("v8.2.0", { prerelease: undefined }), release("v0.2.0")];
    const page = readReleasePage(payload, "0.1.0")!;

    expect(page.releases.map((each) => each.version)).toEqual(["0.2.0"]);
    expect(page.ignored).toHaveLength(payload.length - 1);
    expect(page.items).toBe(payload.length);
  });

  it("corpo ausente, nulo ou que não é texto: notas vazias e nenhuma soma (a atualização vai ser recusada por falta de soma)", () => {
    for (const body of [undefined, null, 42, { html: "<b>x</b>" }, ["x"]]) {
      expect(readReleasePage([release("v0.2.0", { body })], "0.1.0")!.releases).toEqual([{ version: "0.2.0", prerelease: false, date: "2026-10-10", notes: "", sums: new Map() }]);
    }
  });

  it("corpo sem o bloco de somas: as notas inteiras, e nenhuma soma", () => {
    const [found] = readReleasePage([release("v0.2.0", { body: "### Adicionado\n\n- Coisa nova." })], "0.1.0")!.releases;

    expect(found.notes).toBe("### Adicionado\n\n- Coisa nova.");
    expect(found.sums.size).toBe(0);
  });

  it("data ilegível vira ausente", () => {
    for (const published_at of [undefined, null, 42, "", "ontem", "2026-13-45T00:00:00Z", "<script>", "2026-10-10"]) expect(readReleasePage([release("v0.2.0", { published_at })], "0.1.0")!.releases[0].date, String(published_at)).toBeNull();
  });

  it("nenhum endereço do JSON passa adiante: o resultado só tem versão, se é beta, data, notas e somas", () => {
    const hostile = release("v0.2.0", {
      url: "https://evil.example.invalid/api",
      html_url: "https://evil.example.invalid/html",
      assets_url: "https://evil.example.invalid/assets",
      upload_url: "https://evil.example.invalid/upload",
      tarball_url: "https://evil.example.invalid/tar",
      zipball_url: "https://evil.example.invalid/zip",
      assets: [{ name: "Prism-0.2.0-win-x64.exe", url: "https://evil.example.invalid/asset", browser_download_url: "https://evil.example.invalid/Prism-0.2.0-win-x64.exe" }],
      author: { login: "x", html_url: "https://evil.example.invalid/u" },
    });
    const [found] = readReleasePage([hostile], "0.1.0")!.releases;

    expect(Object.keys(found).sort()).toEqual(["date", "notes", "prerelease", "sums", "version"]);
    expect(JSON.stringify([found.version, found.date, found.notes, [...found.sums]])).not.toContain("evil.example.invalid");
  });

  it("a mesma versão duas vezes: vale a primeira", () => {
    const found = readReleasePage([release("v0.2.0", { body: "primeira" }), release("v0.2.0", { body: "segunda" })], "0.1.0")!.releases;

    expect(found.map((each) => each.notes)).toEqual(["primeira"]);
  });

  describe("os dois canais (RN-ATUALIZA-010)", () => {
    const beta = (tag: string, extra: Record<string, unknown> = {}) => release(tag, { prerelease: true, body: `notas da ${tag}`, ...extra });
    const mixed = [beta("v0.4.0-beta.2"), beta("v0.4.0-beta.10"), beta("v0.4.0-beta.9"), release("v0.3.0"), beta("v0.3.0-beta.3"), release("v0.2.0"), beta("v0.2.0-beta.1")];
    const offer = (payload: unknown, installed: string, channel: "stable" | "beta") => readReleasePage(payload, installed, channel)?.releases.map((each) => `${each.version}${each.prerelease ? " (beta)" : ""}`);

    it("sem o canal beta (o padrão), só as estáveis: os betas, mesmo mais novos, ficam de fora, sem ir para o log", () => {
      const page = readReleasePage(mixed, "0.1.0")!;

      expect(page.releases.map((each) => each.version)).toEqual(["0.3.0", "0.2.0"]);
      expect(page.ignored).toEqual([]);
      expect(offer(mixed, "0.1.0", "stable")).toEqual(["0.3.0", "0.2.0"]);
    });

    it("com o canal beta, as estáveis e os betas mais novos que a instalada, na ordem do SemVer: o beta.10 depois do beta.9, e a estável depois dos betas dela", () => {
      expect(offer(mixed, "0.1.0", "beta")).toEqual(["0.4.0-beta.10 (beta)", "0.4.0-beta.9 (beta)", "0.4.0-beta.2 (beta)", "0.3.0", "0.3.0-beta.3 (beta)", "0.2.0", "0.2.0-beta.1 (beta)"]);
    });

    it("beta é a tag vX.Y.Z-beta.N (ou -rc.N) E a marca de pré-lançamento: o beta sem a marca é ignorado nos dois canais, e vai para o log", () => {
      const payload = [release("v0.4.0-beta.1"), beta("v0.4.0-rc.1"), release("v0.3.0")];

      expect(offer(payload, "0.1.0", "beta")).toEqual(["0.4.0-rc.1 (beta)", "0.3.0"]);
      expect(readReleasePage(payload, "0.1.0", "beta")!.ignored.join("\n")).toContain('"v0.4.0-beta.1"');
      expect(readReleasePage(payload, "0.1.0", "stable")!.ignored.join("\n")).toContain('"v0.4.0-beta.1"');
    });

    it("quem está num beta e desliga o canal recebe a próxima estável mais nova que ele (a 0.3.0 depois da 0.3.0-beta.3), e nenhum beta", () => {
      expect(offer(mixed, "0.3.0-beta.3", "stable")).toEqual(["0.3.0"]);
      expect(offer([beta("v0.3.0-beta.4"), beta("v0.3.0-beta.3")], "0.3.0-beta.3", "stable")).toEqual([]);
    });

    it("quem está num beta com o canal ligado recebe os betas seguintes e a estável, e não os betas de antes", () => {
      expect(offer(mixed, "0.4.0-beta.2", "beta")).toEqual(["0.4.0-beta.10 (beta)", "0.4.0-beta.9 (beta)"]);
      expect(offer(mixed, "0.3.0-beta.3", "beta")).toEqual(["0.4.0-beta.10 (beta)", "0.4.0-beta.9 (beta)", "0.4.0-beta.2 (beta)", "0.3.0"]);
    });

    it("o beta sem o bloco de somas entra na oferta (com as notas, e sem somas): a recusa é na hora de baixar, como na estável", () => {
      const [found] = readReleasePage([beta("v0.4.0-beta.1", { body: "- Coisa nova, sem somas." })], "0.1.0", "beta")!.releases;

      expect(found).toEqual({ version: "0.4.0-beta.1", prerelease: true, date: "2026-10-10", notes: "- Coisa nova, sem somas.", sums: new Map() });
    });

    it("um beta chega à versão instalada também: a página com ele é a última", () => {
      expect(readReleasePage([beta("v0.4.0-beta.2"), beta("v0.4.0-beta.1")], "0.4.0-beta.1", "stable")!.reachedInstalled).toBe(true);
    });
  });

  describe("o que decide se vale pedir a página seguinte", () => {
    it("quantos itens a página trouxe, contando os que ficaram de fora", () => {
      expect(readReleasePage([release("v0.2.0"), { lixo: true }, release("v0.3.0", { draft: true })], "0.1.0")!.items).toBe(3);
    });

    it("a página chegou à versão instalada (ou abaixo dela): as páginas seguintes, mais antigas, não têm nada mais novo", () => {
      expect(readReleasePage([release("v0.3.0"), release("v0.1.0")], "0.1.0")!.reachedInstalled).toBe(true);
      expect(readReleasePage([release("v0.3.0"), release("v0.0.5")], "0.1.0")!.reachedInstalled).toBe(true);
      expect(readReleasePage([release("v0.3.0"), release("v0.2.0")], "0.1.0")!.reachedInstalled).toBe(false);
      expect(readReleasePage([], "0.1.0")!.reachedInstalled).toBe(false);
    });

    it("conta também a release que não entra na oferta (marca que não casa, rascunho): ela diz até onde a lista já chegou", () => {
      expect(readReleasePage([release("v0.1.0", { prerelease: true })], "0.1.0")!.reachedInstalled).toBe(true);
      expect(readReleasePage([release("v0.0.9", { draft: true })], "0.1.0")!.reachedInstalled).toBe(true);
      expect(readReleasePage([release("vNext")], "0.1.0")!.reachedInstalled).toBe(false);
    });
  });

  it("mergeReleasePages junta as páginas, na ordem da versão, e a versão repetida vale a da primeira página", () => {
    const first = readReleasePage([release("v0.4.0"), release("v0.3.0", { body: "da primeira" })], "0.1.0")!;
    const second = readReleasePage([release("v0.3.0", { body: "da segunda" }), release("v0.5.0"), release("v0.2.0")], "0.1.0")!;

    expect(mergeReleasePages([first, second]).map((each) => [each.version, each.notes.slice(0, 11)])).toEqual([
      ["0.5.0", "### Adicion"],
      ["0.4.0", "### Adicion"],
      ["0.3.0", "da primeira"],
      ["0.2.0", "### Adicion"],
    ]);
  });

  describe("clipNotes: o que vai para a tela tem um teto de linhas por versão", () => {
    const cut = "As notas desta versão foram cortadas aqui: são mais longas do que o Prism mostra.";

    it("até o teto, as notas ficam como são", () => {
      const notes = Array.from({ length: maxNotesLines }, (_, index) => `- item ${index + 1}`).join("\n");

      expect(clipNotes(notes)).toBe(notes);
      expect(clipNotes("")).toBe("");
    });

    it("acima do teto ficam as primeiras linhas, e uma linha final diz que foram cortadas", () => {
      const lines = Array.from({ length: 25_000 }, (_, index) => `- item ${index + 1}`);
      const clipped = clipNotes(lines.join("\n")).split("\n");

      expect(clipped.slice(0, maxNotesLines)).toEqual(lines.slice(0, maxNotesLines));
      expect(clipped.at(-1)).toBe(cut);
      expect(clipped.length).toBeLessThanOrEqual(maxNotesLines + 3);
    });

    it("cortadas no meio de um bloco de código, a cerca é fechada antes da linha final: ela não vira código", () => {
      const lines = ["```", ...Array.from({ length: 1000 }, (_, index) => `linha ${index}`), "```"];
      const clipped = clipNotes(lines.join("\n")).split("\n");

      expect(clipped.slice(-3)).toEqual(["```", "", cut]);
      expect(clipped.filter((line) => line.trim().startsWith("```")).length % 2).toBe(0);
    });

    it("fim de linha do Windows conta como linha", () => {
      expect(clipNotes(Array.from({ length: 1000 }, () => "- item").join("\r\n")).split("\n").length).toBeLessThanOrEqual(maxNotesLines + 3);
    });
  });

  it("notas enormes são cortadas (as somas são lidas antes do corte)", () => {
    const huge = `${"x".repeat(maxNotesLength * 3)}\n\n### Somas SHA-256\n\n\`\`\`\n${sum}  Prism-0.2.0-win-x64.exe\n\`\`\`\n`;
    const [found] = readReleasePage([release("v0.2.0", { body: huge })], "0.1.0")!.releases;

    expect(found.notes.length).toBeLessThanOrEqual(maxNotesLength + 1);
    expect(found.sums.get("Prism-0.2.0-win-x64.exe")).toBe(sum);
  });
});
