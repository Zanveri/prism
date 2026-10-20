import { describe, expect, it } from "vitest";

import type { InstallFacts } from "./packages";
import { clipNotes, maxNotesLength, maxNotesLines, mergeReleasePages, offerable, readReleasePage, type ReleaseInfo } from "./releases";

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

describe("offerable (RN-ATUALIZA-002 e 003): só o que tem o pacote desta instalação", () => {
  const windows: InstallFacts = { platform: "win32", arch: "x64", appImage: false, execPath: "C:\\Prism\\Prism.exe", debInstalled: false, hasRpm: false, nsisInstalled: true };
  const info = (version: string, files: string[]): ReleaseInfo => ({ version, prerelease: version.includes("-"), date: null, notes: "", sums: new Map(files.map((file) => [file, sum])) });
  const withWindows = (version: string) => info(version, [`Prism-${version}-win-x64.exe`]);
  const withoutWindows = (version: string) => info(version, [`Prism-${version}-linux-x64.tar.gz`]);
  const versions = (releases: ReleaseInfo[]) => releases.map((each) => each.version);

  it("todas têm o pacote: nada muda", () => {
    const result = offerable([withWindows("0.3.0"), withWindows("0.2.0")], windows);

    expect(versions(result.releases)).toEqual(["0.3.0", "0.2.0"]);
    expect(result.withoutPackage).toEqual([]);
  });

  it("as mais novas sem o pacote saem, e a oferta é a mais nova que o tem, com as mais antigas atrás dela", () => {
    const result = offerable([withoutWindows("0.5.0"), withoutWindows("0.4.0"), withWindows("0.3.0"), withoutWindows("0.2.0")], windows);

    expect(versions(result.releases)).toEqual(["0.3.0", "0.2.0"]);
    expect(result.withoutPackage).toEqual(["0.5.0", "0.4.0"]);
  });

  it("uma sem o pacote no meio fica, porque há uma mais nova com ele", () => {
    expect(versions(offerable([withWindows("0.5.0"), withoutWindows("0.4.0"), withWindows("0.3.0")], windows).releases)).toEqual(["0.5.0", "0.4.0", "0.3.0"]);
  });

  it("nenhuma tem o pacote: nada é oferecido, e todas as versões vão para o aviso", () => {
    const result = offerable([withoutWindows("0.4.0"), withoutWindows("0.3.0")], windows);

    expect(result.releases).toEqual([]);
    expect(result.withoutPackage).toEqual(["0.4.0", "0.3.0"]);
  });

  it("o nome do arquivo tem de ser o da versão: o pacote de outra versão nas somas não vale", () => {
    expect(versions(offerable([info("0.4.0", ["Prism-0.3.0-win-x64.exe"])], windows).releases)).toEqual([]);
  });

  it("o zip portátil do Windows não é o instalador: procura o próprio arquivo", () => {
    const portable: InstallFacts = { ...windows, nsisInstalled: false };
    const installerOnly = info("0.4.0", ["Prism-0.4.0-win-x64.exe"]);

    expect(offerable([installerOnly], portable).releases).toEqual([]);
    expect(versions(offerable([installerOnly], windows).releases)).toEqual(["0.4.0"]);
  });

  it("um sistema sem pacote nenhum (Linux arm64) não filtra: a tela diz que não há pacote", () => {
    const arm: InstallFacts = { platform: "linux", arch: "arm64", appImage: false, execPath: "/opt/Prism/prism", debInstalled: false, hasRpm: false, nsisInstalled: false };

    expect(versions(offerable([withoutWindows("0.4.0")], arm).releases)).toEqual(["0.4.0"]);
  });

  it("no macOS um beta sem o pacote é o esperado: não vai para o aviso, e a estável sem o pacote vai", () => {
    const mac: InstallFacts = { platform: "darwin", arch: "arm64", appImage: false, execPath: "/Applications/Prism.app", debInstalled: false, hasRpm: false, nsisInstalled: false };
    const beta = info("0.6.0-beta.2", ["Prism-0.6.0-beta.2-win-x64.exe"]);
    const stable = info("0.5.1", ["Prism-0.5.1-linux-x64.tar.gz"]);

    expect(offerable([beta], mac)).toEqual({ releases: [], withoutPackage: [] });
    expect(offerable([beta, stable], mac)).toEqual({ releases: [], withoutPackage: ["0.5.1"] });
    expect(offerable([beta, info("0.5.0", ["Prism-0.5.0-mac-arm64.dmg"])], mac).withoutPackage).toEqual([]);
    // No Windows o beta sem o pacote é uma falha de pacote, e conta.
    expect(offerable([info("0.6.0-beta.2", ["Prism-0.6.0-beta.2-linux-x64.tar.gz"])], windows).withoutPackage).toEqual(["0.6.0-beta.2"]);
  });

  it("lista vazia: nada oferecido e nada de fora", () => {
    expect(offerable([], windows)).toEqual({ releases: [], withoutPackage: [] });
  });
});
