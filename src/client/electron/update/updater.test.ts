import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeHttp, type FakeStep } from "./http.fake";
import type { InstallFacts } from "./packages";
import type { UpdateProgress, UpdateState } from "./update-state";
import { createUpdater } from "./updater";

const origin = { api: "https://api.github.com", site: "https://github.com", repository: "Zanveri/prism" };
const releasesUrl = `${origin.api}/repos/Zanveri/prism/releases?per_page=100`;
const releasesPage = (page: number) => `${releasesUrl}&page=${page}`;
/** O endereço de download de um arquivo de release do GitHub: o site, o repositório, a tag e o nome. */
const asset = (version: string, file: string) => `${origin.site}/Zanveri/prism/releases/download/v${version}/${file}`;
/** Para onde o GitHub redireciona o download: outro domínio, por https. */
const storage = (file: string) => `https://release-assets.githubusercontent.com/github-production-release-asset/1/${file}?sp=r&sig=x`;
const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const installer = [bytes("MZ instalador "), bytes("de mentira")];
const good = sha256(Buffer.concat(installer));
const wrong = "f".repeat(64);
const exe = "Prism-0.3.0-win-x64.exe";
const deb = "Prism-0.3.0-linux-amd64.deb";

const notes = (version: string, file: string, sum: string | null) => `### Adicionado\n\n- Coisa da ${version}.\n` + (sum === null ? "" : `\n### Somas SHA-256\n\n\`\`\`\n${sum}  ${file}\n\`\`\`\n`);
const json = (value: unknown): FakeStep => ({ chunks: [bytes(JSON.stringify(value))] });
/** Uma release como a API do GitHub a devolve (os campos que o app lê; os outros não mudam nada). */
const gh = (tag: string, body: string | null, extra: Record<string, unknown> = {}) => ({ tag_name: tag, body, draft: false, prerelease: tag.includes("-"), published_at: "2026-10-10T12:00:00Z", ...extra });

/**
 * O mundo de um caso: as releases 0.3.0 e 0.2.0 (mais novas que a 0.1.0 instalada), um beta da 0.3.0, o SHA256SUMS e o pacote da
 * 0.3.0. O download dos dois arquivos é redirecionado para outro domínio, como o GitHub faz.
 */
function world({ file = exe, notesSum = good as string | null, publishedSum = good as string | null, extra = {} as Record<string, unknown>, pack = { headers: { "content-length": String(Buffer.concat(installer).length) }, chunks: installer } as FakeStep } = {}) {
  return fakeHttp({
    [releasesUrl]: json([
      gh("v0.3.0", notes("0.3.0", file, notesSum), { published_at: "2026-10-10T12:00:00Z", ...extra }),
      gh("v0.3.0-beta.1", "beta", { published_at: "2026-10-09T12:00:00Z" }),
      gh("v0.2.0", notes("0.2.0", file.replace("0.3.0", "0.2.0"), good), { published_at: "2026-10-05T12:00:00Z" }),
      gh("v0.1.0", "a instalada", { published_at: "2026-10-01T12:00:00Z" }),
    ]),
    [asset("0.3.0", "SHA256SUMS")]: { redirect: storage("SHA256SUMS") },
    [storage("SHA256SUMS")]: { chunks: [bytes(publishedSum === null ? `${good}  outro.zip\n` : `${publishedSum}  ${file}\n${good}  outro.zip\n`)] },
    [asset("0.3.0", file)]: { redirect: storage(file) },
    [storage(file)]: pack,
  });
}

const windows: InstallFacts = { platform: "win32", arch: "x64", appImage: false, execPath: "C:\\Prism\\Prism.exe", debInstalled: false, hasRpm: false, nsisInstalled: true };
const debian: InstallFacts = { platform: "linux", arch: "x64", appImage: false, execPath: "/opt/Prism/prism", debInstalled: true, hasRpm: false, nsisInstalled: false };

describe("o atualizador", () => {
  let dir: string;
  let now: Date;
  let states: UpdateState[];
  let progress: UpdateProgress[];
  let logs: string[];
  let child: EventEmitter & { unref(): void };
  const spawn = vi.fn();
  const stopApi = vi.fn<() => Promise<void>>();
  const quit = vi.fn();
  const reveal = vi.fn();

  function updater(net: ReturnType<typeof fakeHttp>, overrides: Partial<Parameters<typeof createUpdater>[0]> = {}) {
    return createUpdater({ origin, currentVersion: "0.1.0", facts: windows, dataDir: dir, downloadsDir: join(dir, "Downloads"), http: net.http, now: () => now, log: (message) => logs.push(message), spawn, stopApi, quit, reveal, onState: (state) => states.push(state), onProgress: (each) => progress.push(each), ...overrides });
  }
  const preferencesFile = () => JSON.parse(readFileSync(join(dir, "update-preferences.json"), "utf8")) as Record<string, unknown>;
  const updatesDir = () => join(dir, "updates", "0.3.0");
  const filesIn = (path: string) => (existsSync(path) ? readdirSync(path) : []);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prism-updater-"));
    now = new Date("2026-10-10T12:00:00.000Z");
    states = [];
    progress = [];
    logs = [];
    child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawn.mockReset().mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    stopApi.mockReset().mockResolvedValue(undefined);
    quit.mockReset();
    reveal.mockReset();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("a consulta ao abrir (RN-ATUALIZA-002)", () => {
    it("acha versão nova: o estado traz a instalada e as notas de TODAS as mais novas, da mais recente para a mais antiga", async () => {
      const net = world();
      const subject = updater(net);
      await subject.checkOnStartup();

      const state = subject.state();
      expect(state).toMatchObject({ status: "available", current: "0.1.0" });
      if (state.status !== "available") throw new Error("estado inesperado");
      expect(state.releases.map((each) => [each.version, each.date, each.notes])).toEqual([
        ["0.3.0", "2026-10-10", "### Adicionado\n\n- Coisa da 0.3.0."],
        ["0.2.0", "2026-10-05", "### Adicionado\n\n- Coisa da 0.2.0."],
      ]);
      expect(state.releases[0].sums).toEqual([{ file: exe, sha256: good }]);
      expect(states.at(-1)).toEqual(state);
      expect(net.requested).toEqual([releasesUrl]);
    });

    it("muitas versões mais novas: a tela recebe as 20 mais recentes e quantas ficaram de fora", async () => {
      const many = Array.from({ length: 60 }, (_, index) => gh(`v0.${index + 2}.0`, `notas da 0.${index + 2}.0`));
      const subject = updater(fakeHttp({ [releasesUrl]: json(many) }));
      await subject.checkOnStartup();

      const state = subject.state();
      if (state.status !== "available") throw new Error("estado inesperado");
      expect(state.releases).toHaveLength(20);
      expect(state.releases[0].version).toBe("0.61.0");
      expect(state.releases.at(-1)?.version).toBe("0.42.0");
      expect(state.omitted).toBe(40);
    });

    it("poucas versões: nenhuma fica de fora", async () => {
      const subject = updater(world());
      await subject.checkOnStartup();

      expect(subject.state()).toMatchObject({ status: "available", omitted: 0 });
    });

    it("notas com milhares de linhas: a tela recebe no máximo 400 por versão, com uma linha final dizendo que foram cortadas", async () => {
      const long = (version: string) => `${Array.from({ length: 4_000 }, (_, index) => `- item ${index + 1} da ${version}`).join("\n")}\n\n### Somas SHA-256\n\n\`\`\`\n${good}  Prism-${version}-win-x64.exe\n\`\`\`\n`;
      const many = Array.from({ length: 20 }, (_, index) => gh(`v0.${index + 2}.0`, long(`0.${index + 2}.0`)));
      const subject = updater(fakeHttp({ [releasesUrl]: json(many) }));
      await subject.check();

      const state = subject.state();
      if (state.status !== "available") throw new Error("estado inesperado");
      for (const release of state.releases) {
        const lines = release.notes.split("\n");
        expect(lines.length).toBeLessThanOrEqual(403);
        expect(lines.at(-1)).toBe("As notas desta versão foram cortadas aqui: são mais longas do que o Prism mostra.");
        expect(lines[399]).toBe(`- item 400 da ${release.version}`);
      }
      // 20 versões de 4 mil itens seriam 80 mil linhas na tela; vão 8 mil e poucas.
      expect(state.releases.reduce((total, release) => total + release.notes.split("\n").length, 0)).toBeLessThanOrEqual(20 * 403);
    });

    it("só as somas dos pacotes conhecidos vão para a tela; as outras linhas do bloco ficam no processo principal", async () => {
      const junk = Array.from({ length: 1000 }, (_, index) => `${good}  arquivo-${index}.bin`).join("\n");
      const description = `- Coisa nova.\n\n### Somas SHA-256\n\n\`\`\`\n${junk}\n${good}  ${exe}\n${wrong}  Prism-0.3.0-win-x64.zip\n${good}  SHA256SUMS\n${good}  Prism-0.2.0-win-x64.exe\n\`\`\`\n`;
      const net = fakeHttp({ [releasesUrl]: json([gh("v0.3.0", description)]), [asset("0.3.0", "SHA256SUMS")]: { chunks: [bytes(`${good}  ${exe}\n`)] }, [asset("0.3.0", exe)]: { chunks: installer } });
      const subject = updater(net);
      await subject.check();

      const state = subject.state();
      if (state.status !== "available") throw new Error("estado inesperado");
      expect(state.releases[0].sums).toEqual([
        { file: exe, sha256: good },
        { file: "Prism-0.3.0-win-x64.zip", sha256: wrong },
      ]);
      // A soma do pacote continua valendo para a conferência.
      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
    });

    it("anota a hora da consulta, e a segunda abertura no mesmo dia não consulta", async () => {
      const net = world();
      await updater(net).checkOnStartup();
      expect(preferencesFile().lastCheckedAt).toBe("2026-10-10T12:00:00.000Z");

      now = new Date("2026-10-11T11:59:00.000Z");
      const second = updater(net);
      await second.checkOnStartup();

      expect(net.requested).toEqual([releasesUrl]);
      expect(second.state()).toEqual({ status: "none" });

      now = new Date("2026-10-11T12:00:00.000Z");
      await updater(net).checkOnStartup();
      expect(net.requested).toEqual([releasesUrl, releasesUrl]);
    });

    it("com 'não verificar ao abrir', não consulta", async () => {
      const net = world();
      const subject = updater(net);
      expect(subject.setCheckOnStartup(false).checkOnStartup).toBe(false);

      await updater(net).checkOnStartup();

      expect(net.requested).toEqual([]);
    });

    it("sem origem, não consulta e não quebra", async () => {
      const net = world();
      const subject = updater(net, { origin: null });
      await subject.checkOnStartup();

      expect(net.requested).toEqual([]);
      expect(subject.state()).toEqual({ status: "none" });
    });

    it("servidor fora do ar: nada na tela, a causa no log, e a tentativa conta para as 24 horas", async () => {
      const net = fakeHttp({});
      const subject = updater(net);
      await subject.checkOnStartup();

      expect(subject.state()).toEqual({ status: "none" });
      expect(states).toEqual([]);
      expect(logs.join("\n")).toMatch(/ERR_CONNECTION_REFUSED/);
      expect(preferencesFile().lastCheckedAt).toBe("2026-10-10T12:00:00.000Z");
    });

    it("resposta que não é JSON, ou que não é uma lista: nada na tela, e vai para o log", async () => {
      for (const body of ["<html>manutenção</html>", '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/releases/releases#list-releases","status":"404"}']) {
        rmSync(join(dir, "update-preferences.json"), { force: true });
        const subject = updater(fakeHttp({ [releasesUrl]: { chunks: [bytes(body)] } }));
        await subject.checkOnStartup();

        expect(subject.state()).toEqual({ status: "none" });
      }
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it("a versão pulada não avisa ao abrir, até sair outra", async () => {
      const net = world();
      const first = updater(net);
      await first.checkOnStartup();
      expect(first.skipVersion("0.3.0").skippedVersion).toBe("0.3.0");
      expect(first.state()).toEqual({ status: "none" });

      now = new Date("2026-10-12T12:00:00.000Z");
      const second = updater(net);
      await second.checkOnStartup();
      expect(second.state()).toEqual({ status: "none" });

      now = new Date("2026-10-14T12:00:00.000Z");
      const newer = fakeHttp({ [releasesUrl]: json([gh("v0.4.0", "nova"), gh("v0.3.0", "pulada")]) });
      const third = updater(newer);
      await third.checkOnStartup();
      expect(third.state()).toMatchObject({ status: "available" });
    });

    it("nenhum endereço que venha no JSON da release é pedido", async () => {
      const net = world({
        extra: {
          url: "https://evil.example.invalid/api",
          html_url: "https://evil.example.invalid/html",
          assets_url: "https://evil.example.invalid/assets",
          upload_url: "https://evil.example.invalid/upload",
          tarball_url: "https://evil.example.invalid/tar",
          zipball_url: "https://evil.example.invalid/zip",
          assets: [{ name: exe, url: "https://evil.example.invalid/asset", browser_download_url: "https://evil.example.invalid/Prism-0.3.0-win-x64.exe" }],
        },
      });
      const subject = updater(net);
      await subject.checkOnStartup();
      await subject.download("0.3.0");

      expect(subject.state().status).toBe("ready");
      expect(net.requested).toEqual([releasesUrl, asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS"), asset("0.3.0", exe), storage(exe)]);
      expect(JSON.stringify(subject.state())).not.toContain("evil.example.invalid");
    });
  });

  describe("a consulta manual: o resultado sempre aparece", () => {
    it("versão nova", async () => {
      const subject = updater(world());

      await expect(subject.check()).resolves.toEqual({ outcome: "available" });
      expect(subject.state().status).toBe("available");
    });

    it("não depende das 24 horas, nem de 'não verificar ao abrir', nem da versão pulada", async () => {
      const net = world();
      const first = updater(net);
      await first.checkOnStartup();
      first.skipVersion("0.3.0");
      first.setCheckOnStartup(false);

      await expect(first.check()).resolves.toEqual({ outcome: "available" });
      expect(net.requested).toEqual([releasesUrl, releasesUrl]);
    });

    it("cada consulta que acha versão nova tem um número novo, para a tela abrir o diálogo de novo", async () => {
      const subject = updater(world());
      await subject.check();
      const first = subject.state();
      await subject.check();
      const second = subject.state();

      if (first.status !== "available" || second.status !== "available") throw new Error("estado inesperado");
      expect(second.checkId).toBeGreaterThan(first.checkId);
    });

    it("o Prism está atualizado", async () => {
      const subject = updater(world(), { currentVersion: "0.3.0" });

      await expect(subject.check()).resolves.toEqual({ outcome: "upToDate" });
      expect(subject.state()).toEqual({ status: "none" });
    });

    it("sem origem: diz isso, sem pedir nada à rede", async () => {
      const net = world();

      await expect(updater(net, { origin: null }).check()).resolves.toEqual({ outcome: "noSource" });
      expect(net.requested).toEqual([]);
    });

    it("aberto com um argumento que desliga a conferência do certificado: diz isso, e nada vai à rede, nem com origem", async () => {
      const net = world();
      const subject = updater(net, { blocked: true });

      await expect(subject.check()).resolves.toEqual({ outcome: "blocked" });
      await subject.checkOnStartup();
      expect(net.requested).toEqual([]);
      expect(subject.state()).toEqual({ status: "none" });
      expect(logs.join(" | ")).toMatch(/linha de comando/);
    });

    it("servidor fora do ar: a falha aparece, com a causa", async () => {
      const outcome = await updater(fakeHttp({})).check();

      expect(outcome).toMatchObject({ outcome: "failed" });
      expect(outcome.outcome === "failed" && outcome.reason).toMatch(/ERR_CONNECTION_REFUSED/);
    });

    it("servidor que responde 404 ou algo que não é a lista: a falha aparece", async () => {
      await expect(updater(fakeHttp({ [releasesUrl]: { status: 404 } })).check()).resolves.toMatchObject({ outcome: "failed", reason: expect.stringMatching(/404/) });
      await expect(updater(fakeHttp({ [releasesUrl]: { chunks: [bytes("<html>")] } })).check()).resolves.toMatchObject({ outcome: "failed" });
      await expect(updater(fakeHttp({ [releasesUrl]: json({ message: "x" }) })).check()).resolves.toMatchObject({ outcome: "failed" });
    });
  });

  describe("a consulta às releases do GitHub (RN-ATUALIZA-002 e 008)", () => {
    it("pede a lista à API com os cabeçalhos que ela pede, e o download vai ao site sem eles", async () => {
      const net = world();
      const subject = updater(net);
      await subject.check();
      await subject.download("0.3.0");

      expect(net.requests[0]).toEqual({ url: releasesUrl, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
      for (const request of net.requests.slice(1)) expect(request.headers, request.url).toEqual({});
    });

    it("a consulta não segue redirecionamento: a lista que manda para outro lugar é falha, e o outro lugar não recebe nada", async () => {
      const elsewhere = "https://evil.example.invalid/releases";
      const net = fakeHttp({ [releasesUrl]: { redirect: elsewhere }, [elsewhere]: json([gh("v9.0.0", notes("9.0.0", "Prism-9.0.0-win-x64.exe", good))]) });

      await expect(updater(net).check()).resolves.toMatchObject({ outcome: "failed", reason: expect.stringMatching(/redirecionamento/) });
      expect(net.requested).toEqual([releasesUrl]);
    });

    it("o download segue o redirecionamento para outro domínio, só por https: para http, recusa sem pedir nada lá", async () => {
      const net = world();
      net.routes[asset("0.3.0", exe)] = { redirect: "http://release-assets.githubusercontent.com/objeto" };
      const subject = updater(net);
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/redirecionamento/) });
      expect(net.requested).not.toContain("http://release-assets.githubusercontent.com/objeto");
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("um rascunho e uma release cuja marca de pré-lançamento não casa com a tag não aparecem na tela, e vão para o log", async () => {
      const net = fakeHttp({
        [releasesUrl]: json([gh("v0.9.0", notes("0.9.0", "Prism-0.9.0-win-x64.exe", good), { draft: true }), gh("v0.8.0", "estável marcada como pré-lançamento", { prerelease: true }), gh("v0.2.0", notes("0.2.0", "Prism-0.2.0-win-x64.exe", good))]),
      });
      const subject = updater(net);

      await expect(subject.check()).resolves.toEqual({ outcome: "available" });
      const state = subject.state();
      expect(state.status === "available" && state.releases.map((each) => each.version)).toEqual(["0.2.0"]);
      expect(logs.join("\n")).toMatch(/ignorada.*"v0\.9\.0".*"v0\.8\.0"|ignorada.*"v0\.8\.0"/s);
      expect(JSON.stringify(state)).not.toMatch(/0\.9\.0|0\.8\.0/);
    });

    describe("mais de cem releases: as páginas seguintes, montadas pelo app, até chegar à versão instalada", () => {
      const betas = (count: number, from = 1) => Array.from({ length: count }, (_, index) => gh(`v0.4.0-beta.${from + count - 1 - index}`, `beta ${from + count - 1 - index}`));

      it("a primeira página só tem betas mais novos: a segunda é pedida, e a estável que estava nela é oferecida", async () => {
        const net = fakeHttp({ [releasesUrl]: json(betas(100, 21)), [releasesPage(2)]: json([...betas(20), gh("v0.3.0", notes("0.3.0", exe, good)), gh("v0.1.0", "a instalada")]) });
        const subject = updater(net);

        await expect(subject.check()).resolves.toEqual({ outcome: "available" });
        expect(net.requested).toEqual([releasesUrl, releasesPage(2)]);
        const state = subject.state();
        expect(state.status === "available" && state.releases.map((each) => each.version)).toEqual(["0.3.0"]);
      });

      it("a página que já chegou à versão instalada é a última, mesmo cheia", async () => {
        const net = fakeHttp({ [releasesUrl]: json([gh("v0.3.0", notes("0.3.0", exe, good)), ...betas(98), gh("v0.1.0", "a instalada")]) });

        await updater(net).check();

        expect(net.requested).toEqual([releasesUrl]);
      });

      it("a página com menos de cem é a última", async () => {
        const net = fakeHttp({ [releasesUrl]: json(betas(99)) });

        await expect(updater(net).check()).resolves.toEqual({ outcome: "upToDate" });
        expect(net.requested).toEqual([releasesUrl]);
      });

      it("um servidor que manda páginas cheias sem fim: o app para no teto de páginas", async () => {
        const routes: Record<string, FakeStep> = { [releasesUrl]: json(betas(100)) };
        for (let page = 2; page <= 20; page += 1) routes[releasesPage(page)] = json(betas(100));
        const net = fakeHttp(routes);

        await updater(net).check();

        expect(net.requested).toEqual([releasesUrl, releasesPage(2), releasesPage(3), releasesPage(4), releasesPage(5)]);
      });

      it("a página seguinte falha: vale o que a primeira trouxe, e a falha vai para o log", async () => {
        const net = fakeHttp({ [releasesUrl]: json([gh("v0.5.0", notes("0.5.0", "Prism-0.5.0-win-x64.exe", good)), ...betas(99)]) });

        await expect(updater(net).check()).resolves.toEqual({ outcome: "available" });
        expect(net.requested).toEqual([releasesUrl, releasesPage(2)]);
        expect(logs.join("\n")).toMatch(/página 2.*ERR_CONNECTION_REFUSED/);
      });

      it("a primeira página falha: a consulta falha", async () => {
        await expect(updater(fakeHttp({})).check()).resolves.toMatchObject({ outcome: "failed" });
      });
    });
  });

  describe("o canal beta (RN-ATUALIZA-010)", () => {
    const betaExe = "Prism-0.4.0-beta.2-win-x64.exe";
    /** Um beta da 0.4.0 mais novo que a estável 0.3.0, com as somas nas notas e no SHA256SUMS da tag dele. */
    function betaWorld({ betaSum = good as string | null } = {}) {
      const net = world();
      net.routes[releasesUrl] = json([
        gh("v0.4.0-beta.2", notes("0.4.0-beta.2", betaExe, betaSum), { published_at: "2026-10-12T12:00:00Z" }),
        gh("v0.4.0-beta.1", "- O primeiro beta da 0.4.0.", { published_at: "2026-10-11T12:00:00Z" }),
        gh("v0.3.0", notes("0.3.0", exe, good), { published_at: "2026-10-10T12:00:00Z" }),
        gh("v0.3.0-beta.1", "beta", { published_at: "2026-10-09T12:00:00Z" }),
        gh("v0.2.0", notes("0.2.0", "Prism-0.2.0-win-x64.exe", good), { published_at: "2026-10-05T12:00:00Z" }),
      ]);
      net.routes[asset("0.4.0-beta.2", "SHA256SUMS")] = { redirect: storage("beta-SHA256SUMS") };
      net.routes[storage("beta-SHA256SUMS")] = { chunks: [bytes(`${good}  ${betaExe}\n`)] };
      net.routes[asset("0.4.0-beta.2", betaExe)] = { redirect: storage(betaExe) };
      net.routes[storage(betaExe)] = { chunks: installer };
      return net;
    }
    const offered = (subject: ReturnType<typeof updater>) => {
      const state = subject.state();
      return state.status === "none" ? [] : state.releases.map((each) => `${each.version}${each.prerelease ? " (beta)" : ""}`);
    };

    it("desligado por padrão: a consulta só considera as estáveis, mesmo com um beta mais novo publicado", async () => {
      const subject = updater(betaWorld());
      expect(subject.preferences().receiveBeta).toBe(false);

      await subject.check();

      expect(offered(subject)).toEqual(["0.3.0", "0.2.0"]);
    });

    it("ligado, a consulta considera também os betas, e as notas são as de todas as versões mais novas que a instalada nesse canal", async () => {
      const subject = updater(betaWorld());
      subject.setReceiveBeta(true);
      await subject.check();

      expect(offered(subject)).toEqual(["0.4.0-beta.2 (beta)", "0.4.0-beta.1 (beta)", "0.3.0", "0.3.0-beta.1 (beta)", "0.2.0"]);
      expect(subject.state()).toMatchObject({ status: "available", format: "nsis" });
    });

    it("ligar ou desligar só grava a preferência: não consulta, não baixa, não instala e não muda o que está na tela", async () => {
      const net = betaWorld();
      const subject = updater(net);
      await subject.check();
      const before = subject.state();
      net.requested.length = 0;
      states.length = 0;

      expect(subject.setReceiveBeta(true).receiveBeta).toBe(true);
      expect(preferencesFile().receiveBeta).toBe(true);
      expect(subject.setReceiveBeta(false).receiveBeta).toBe(false);
      expect(preferencesFile().receiveBeta).toBe(false);

      expect(net.requested).toEqual([]);
      expect(states).toEqual([]);
      expect(subject.state()).toBe(before);
      expect(spawn).not.toHaveBeenCalled();
      expect(stopApi).not.toHaveBeenCalled();
    });

    it("vale a partir da próxima consulta, nos dois sentidos", async () => {
      const subject = updater(betaWorld());
      subject.setReceiveBeta(true);
      await subject.check();
      expect(offered(subject)[0]).toBe("0.4.0-beta.2 (beta)");

      subject.setReceiveBeta(false);
      expect(offered(subject)[0]).toBe("0.4.0-beta.2 (beta)");
      await subject.check();
      expect(offered(subject)).toEqual(["0.3.0", "0.2.0"]);
    });

    it("a escolha vale para a instalação: uma abertura nova lê do arquivo, e a consulta ao abrir a segue", async () => {
      const net = betaWorld();
      updater(net).setReceiveBeta(true);

      const reopened = updater(net);
      await reopened.checkOnStartup();

      expect(reopened.preferences().receiveBeta).toBe(true);
      expect(offered(reopened)[0]).toBe("0.4.0-beta.2 (beta)");
    });

    it("só aceita verdadeiro ou falso", () => {
      const subject = updater(betaWorld());

      for (const value of ["true", 1, 0, null, undefined, {}, []]) expect(() => subject.setReceiveBeta(value), JSON.stringify(value)).toThrow(/inválido/);
      expect(subject.preferences().receiveBeta).toBe(false);
    });

    it("quem está num beta e desliga o canal recebe a próxima estável mais nova que ele, e nenhum beta", async () => {
      const subject = updater(betaWorld(), { currentVersion: "0.3.0-beta.1" });
      await subject.check();

      expect(offered(subject)).toEqual(["0.3.0"]);
    });

    it("quem está num beta com o canal ligado recebe os betas seguintes e a estável que veio depois dele", async () => {
      const subject = updater(betaWorld(), { currentVersion: "0.3.0-beta.1" });
      subject.setReceiveBeta(true);
      await subject.check();

      expect(offered(subject)).toEqual(["0.4.0-beta.2 (beta)", "0.4.0-beta.1 (beta)", "0.3.0"]);
    });

    it("baixar um beta: o SHA256SUMS e o pacote da tag do beta, com o nome que leva a versão inteira, conferidos com as duas somas", async () => {
      const net = betaWorld();
      const subject = updater(net);
      subject.setReceiveBeta(true);
      await subject.check();

      await expect(subject.download("0.4.0-beta.2")).resolves.toMatchObject({ status: "ready", format: "nsis" });
      expect(net.requested.slice(1)).toEqual([asset("0.4.0-beta.2", "SHA256SUMS"), storage("beta-SHA256SUMS"), asset("0.4.0-beta.2", betaExe), storage(betaExe)]);
      expect(filesIn(join(dir, "updates", "0.4.0-beta.2"))).toEqual([betaExe]);

      await expect(subject.install("0.4.0-beta.2")).resolves.toMatchObject({ status: "installing" });
      expect(spawn).toHaveBeenCalledWith(join(dir, "updates", "0.4.0-beta.2", betaExe), ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", shell: false });
    });

    it("o bloco de somas é exigido no beta também: sem ele nas notas, recusa antes de pedir qualquer coisa", async () => {
      const net = betaWorld({ betaSum: null });
      const subject = updater(net);
      subject.setReceiveBeta(true);
      await subject.check();
      net.requested.length = 0;

      await expect(subject.download("0.4.0-beta.2")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/notas da versão não trazem a soma SHA-256 de Prism-0\.4\.0-beta\.2-win-x64\.exe/) });
      expect(net.requested).toEqual([]);
    });

    it("'Pular esta versão' vale igual com um beta: a abertura seguinte não o oferece, e o beta seguinte, sim", async () => {
      const net = betaWorld();
      const first = updater(net);
      first.setReceiveBeta(true);
      await first.checkOnStartup();
      expect(first.skipVersion("0.4.0-beta.2").skippedVersion).toBe("0.4.0-beta.2");

      now = new Date("2026-10-12T12:00:00.000Z");
      const second = updater(net);
      await second.checkOnStartup();
      expect(second.state()).toEqual({ status: "none" });
      expect(logs.join("\n")).toMatch(/0\.4\.0-beta\.2 foi pulada/);

      now = new Date("2026-10-14T12:00:00.000Z");
      net.routes[releasesUrl] = json([gh("v0.4.0-beta.3", "o seguinte"), gh("v0.4.0-beta.2", "o pulado")]);
      const third = updater(net);
      await third.checkOnStartup();
      expect(offered(third)[0]).toBe("0.4.0-beta.3 (beta)");
    });
  });

  describe("baixar (RN-ATUALIZA-005)", () => {
    it("baixa o pacote da plataforma, confere com as duas somas e fica pronto; o nome temporário some", async () => {
      const net = world();
      const subject = updater(net);
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready", format: "nsis" });
      expect(filesIn(updatesDir())).toEqual([exe]);
      expect(net.requested.slice(1)).toEqual([asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS"), asset("0.3.0", exe), storage(exe)]);
      expect(states.some((state) => state.status === "downloading")).toBe(true);
    });

    it("o progresso não reenvia as notas: o estado 'baixando' vai à tela uma vez, e cada avanço vai num aviso pequeno, só com os números", async () => {
      const chunks = Array.from({ length: 12 }, (_, index) => bytes(`pedaço ${index} `));
      const body = Buffer.concat(chunks);
      const sum = sha256(body);
      const net = fakeHttp({
        [releasesUrl]: json([gh("v0.3.0", notes("0.3.0", exe, sum))]),
        [asset("0.3.0", "SHA256SUMS")]: { chunks: [bytes(`${sum}  ${exe}\n`)] },
        [asset("0.3.0", exe)]: { headers: { "content-length": String(body.length) }, chunks },
      });
      const subject = updater(net);
      await subject.check();
      const offered = subject.state();
      if (offered.status !== "available") throw new Error("estado inesperado");
      states.length = 0;

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });

      expect(states.map((state) => state.status)).toEqual(["downloading", "ready"]);
      expect(progress.length).toBeGreaterThanOrEqual(1);
      expect(progress.at(-1)).toEqual({ checkId: offered.checkId, receivedBytes: body.length, totalBytes: body.length });
      for (const each of progress) expect(Object.keys(each).sort()).toEqual(["checkId", "receivedBytes", "totalBytes"]);
    });

    it("quem pergunta o estado no meio do download recebe o avanço de agora, mesmo sem aviso de estado novo", async () => {
      const subject = updater(world({ pack: { chunks: installer, hang: true } }));
      await subject.check();

      const pending = subject.download("0.3.0");
      await vi.waitFor(() => expect(progress.some((each) => each.receivedBytes > 0)).toBe(true));
      const now = subject.state();
      subject.cancel();
      await pending;

      expect(now).toMatchObject({ status: "downloading", receivedBytes: progress.at(-1)?.receivedBytes });
    });

    it("o estado que vai para a tela não tem caminho de arquivo", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      for (const state of states) expect(JSON.stringify(state)).not.toContain(dir.replaceAll("\\", "\\\\"));
    });

    it("soma errada nas notas: recusa com a causa e apaga o arquivo", async () => {
      const subject = updater(world({ notesSum: wrong }));
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/notas/) });
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("soma errada no SHA256SUMS: recusa com a causa e apaga o arquivo", async () => {
      const subject = updater(world({ publishedSum: wrong }));
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/SHA256SUMS/) });
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("falta a soma nas notas: recusa antes de pedir qualquer coisa", async () => {
      const net = world({ notesSum: null });
      const subject = updater(net);
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/notas/) });
      expect(net.requested).toEqual([releasesUrl]);
    });

    it("falta a soma no SHA256SUMS: recusa sem baixar o pacote", async () => {
      const net = world({ publishedSum: null });
      const subject = updater(net);
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/SHA256SUMS/) });
      expect(net.requested).toEqual([releasesUrl, asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS")]);
    });

    it("SHA256SUMS fora do ar: recusa com a causa", async () => {
      const net = world();
      delete net.routes[storage("SHA256SUMS")];
      const subject = updater(net);
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/ERR_CONNECTION_REFUSED/) });
    });

    it("plataforma sem pacote: recusa sem pedir nada", async () => {
      const net = world();
      const subject = updater(net, { facts: { ...windows, arch: "arm64" } });
      await subject.check();

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed" });
      expect(net.requested).toEqual([releasesUrl]);
    });

    it("cancelado no meio: volta a 'há versão nova', sem arquivo", async () => {
      const subject = updater(world({ pack: { chunks: installer, hang: true } }));
      await subject.check();

      const pending = subject.download("0.3.0");
      await vi.waitFor(() => expect(progress.some((each) => each.receivedBytes > 0)).toBe(true));
      subject.cancel();

      await expect(pending).resolves.toMatchObject({ status: "available" });
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("cancelado enquanto ainda busca o SHA256SUMS: volta na hora, sem pedir o pacote", async () => {
      const net = world();
      net.routes[storage("SHA256SUMS")] = { hang: true };
      const subject = updater(net);
      await subject.check();

      const pending = subject.download("0.3.0");
      await vi.waitFor(() => expect(net.requested).toContain(storage("SHA256SUMS")));
      subject.cancel();

      await expect(pending).resolves.toMatchObject({ status: "available" });
      expect(net.requested).not.toContain(asset("0.3.0", exe));
    });

    it("a causa de uma falha de disco vai para a tela sem o caminho do arquivo", async () => {
      const subject = updater(world());
      await subject.check();
      // No lugar da pasta `updates` há um arquivo: a pasta da versão não pode ser criada.
      writeFileSync(join(dir, "updates"), "não é uma pasta");

      const state = await subject.download("0.3.0");

      expect(state).toMatchObject({ status: "failed", reason: expect.stringMatching(/pasta de dados do Prism \([A-Z]+\)/) });
      expect(JSON.stringify(state)).not.toContain(dir.replaceAll("\\", "\\\\"));
    });

    it("depois de uma falha dá para tentar de novo", async () => {
      const net = world({ pack: { chunks: installer, failAfter: 1 } });
      const subject = updater(net);
      await subject.check();
      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed" });

      net.routes[storage(exe)] = { chunks: installer };
      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
    });

    it("um download de cada vez", async () => {
      const subject = updater(world({ pack: { chunks: installer, hang: true } }));
      await subject.check();
      const pending = subject.download("0.3.0");

      await expect(subject.download("0.3.0")).rejects.toThrow();
      await expect(subject.check()).resolves.toEqual({ outcome: "busy" });
      subject.cancel();
      await pending;
    });

    it("o que sobrou de outra abertura em updates/ é apagado quando o atualizador nasce", () => {
      mkdirSync(join(dir, "updates", "0.2.0"), { recursive: true });
      writeFileSync(join(dir, "updates", "0.2.0", "Prism-0.2.0-win-x64.exe"), "plantado");

      updater(world());

      expect(existsSync(join(dir, "updates"))).toBe(false);
    });
  });

  describe("o que chega da tela é conferido (a versão tem de ser a que a última consulta achou)", () => {
    const unexpected: unknown[] = ["0.2.0", "0.9.9", "v0.3.0", "0.3.0 ", "../0.3.0", "", undefined, null, 3, {}, ["0.3.0"], { version: "0.3.0" }, { toString: () => "0.3.0" }];

    it("baixar: versão que não é a da última consulta, ou que não é texto, é recusada sem pedir nada", async () => {
      const net = world();
      const subject = updater(net);
      await subject.check();

      for (const version of unexpected) await expect(subject.download(version), JSON.stringify(version)).rejects.toThrow(/inválido/);
      expect(net.requested).toEqual([releasesUrl]);
      expect(subject.state().status).toBe("available");
    });

    it("baixar sem consulta nenhuma é recusado", async () => {
      await expect(updater(world()).download("0.3.0")).rejects.toThrow(/inválido/);
    });

    it("instalar: só a versão baixada e conferida, e só depois de pronta", async () => {
      const subject = updater(world());
      await subject.check();
      await expect(subject.install("0.3.0")).rejects.toThrow(/inválido/);

      await subject.download("0.3.0");
      for (const version of unexpected) await expect(subject.install(version), JSON.stringify(version)).rejects.toThrow(/inválido/);
      expect(spawn).not.toHaveBeenCalled();
    });

    it("pular: só a versão que a última consulta achou", async () => {
      const subject = updater(world());
      expect(() => subject.skipVersion("0.3.0")).toThrow(/inválido/);
      await subject.check();

      for (const version of unexpected) expect(() => subject.skipVersion(version), JSON.stringify(version)).toThrow(/inválido/);
      expect(subject.preferences().skippedVersion).toBeNull();
    });

    it("'verificar ao abrir' só aceita verdadeiro ou falso", () => {
      const subject = updater(world());

      for (const value of ["false", 0, 1, null, undefined, {}, []]) expect(() => subject.setCheckOnStartup(value), JSON.stringify(value)).toThrow(/inválido/);
      expect(subject.preferences().checkOnStartup).toBe(true);
    });
  });

  describe("instalar (RN-ATUALIZA-006)", () => {
    it("Windows: confere de novo, para a API, roda o instalador conferido com os argumentos dele e encerra o app, nessa ordem", async () => {
      const order: string[] = [];
      stopApi.mockImplementation(async () => void order.push("a API terminou"));
      spawn.mockImplementation(() => {
        order.push("instalador");
        queueMicrotask(() => child.emit("spawn"));
        return child;
      });
      quit.mockImplementation(() => void order.push("sair"));
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      await subject.install("0.3.0");

      expect(order).toEqual(["a API terminou", "instalador", "sair"]);
      expect(spawn).toHaveBeenCalledWith(join(updatesDir(), exe), ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", shell: false });
    });

    it("enquanto a API não terminou, o instalador não roda e o app não sai", async () => {
      let apiExited = () => {};
      stopApi.mockImplementation(() => new Promise<void>((resolve) => (apiExited = resolve)));
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      const pending = subject.install("0.3.0");
      await vi.waitFor(() => expect(stopApi).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(subject.state().status).toBe("installing");
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();

      apiExited();
      await pending;
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    });

    it("o arquivo é trocado enquanto a API para: a soma é refeita logo antes de rodar, e o instalador trocado nunca roda", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      // A parada da API leva tempo (fechar o cofre, esperar o processo): é a janela em que o arquivo pode ser trocado.
      stopApi.mockImplementation(async () => writeFileSync(join(updatesDir(), exe), "outro programa"));

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/mudou depois de conferido/) });
      expect(stopApi).toHaveBeenCalledTimes(1);
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("o arquivo some enquanto a API para: nada roda, e a falha aparece", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      stopApi.mockImplementation(async () => rmSync(join(updatesDir(), exe)));

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed" });
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    });

    it("a API não termina no prazo: nada roda, o app não sai e a falha aparece", async () => {
      stopApi.mockImplementation(() => new Promise<void>(() => {}));
      const subject = updater(world(), { apiStopTimeoutMs: 40 });
      await subject.check();
      await subject.download("0.3.0");

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/serviço do Prism não encerrou a tempo/) });
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    });

    it("parar a API falha: nada roda, e a falha aparece", async () => {
      stopApi.mockRejectedValue(new Error("taskkill falhou"));
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed" });
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    });

    it("depois de o instalador iniciar o estado é 'instalando', e um segundo pedido é recusado sem rodar nada", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "installing" });
      await expect(subject.install("0.3.0")).rejects.toThrow(/inválido/);
      await expect(subject.download("0.3.0")).rejects.toThrow(/inválido/);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    });

    it("dois pedidos de instalar ao mesmo tempo: o instalador roda uma vez só", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      const [first, second] = await Promise.allSettled([subject.install("0.3.0"), subject.install("0.3.0")]);

      expect([first.status, second.status]).toEqual(["fulfilled", "rejected"]);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
    });

    it("arquivo trocado depois de conferido: não roda, apaga e diz por quê", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      writeFileSync(join(updatesDir(), exe), "outro programa");

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/mudou/) });
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
      expect(filesIn(updatesDir())).toEqual([]);
    });

    it("arquivo apagado depois de conferido: não roda, e a falha aparece", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      rmSync(join(updatesDir(), exe));

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed" });
      expect(spawn).not.toHaveBeenCalled();
    });

    it("o instalador não inicia: a falha aparece e o app continua aberto", async () => {
      spawn.mockImplementation(() => {
        queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
        return child;
      });
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/EACCES/) });
      expect(quit).not.toHaveBeenCalled();
    });

    it("instalando: consultar responde 'ocupado' sem ir à rede, e pular é recusado, antes e depois de o instalador iniciar", async () => {
      let apiExited = () => {};
      stopApi.mockImplementation(() => new Promise<void>((resolve) => (apiExited = resolve)));
      const net = world();
      const subject = updater(net);
      await subject.check();
      await subject.download("0.3.0");
      const pending = subject.install("0.3.0");
      await vi.waitFor(() => expect(subject.state().status).toBe("installing"));
      net.requested.length = 0;

      await expect(subject.check()).resolves.toEqual({ outcome: "busy" });
      expect(() => subject.skipVersion("0.3.0")).toThrow(/inválido/);
      expect(subject.state().status).toBe("installing");

      apiExited();
      await pending;
      await expect(subject.check()).resolves.toEqual({ outcome: "busy" });
      expect(() => subject.skipVersion("0.3.0")).toThrow(/inválido/);
      expect(net.requested).toEqual([]);
      expect(subject.preferences().skippedVersion).toBeNull();
      expect(subject.state().status).toBe("installing");
    });

    describe("o instalador não inicia depois de a API ter parado", () => {
      const failingSpawn = () => {
        queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
        return child;
      };
      const workingSpawn = () => {
        queueMicrotask(() => child.emit("spawn"));
        return child;
      };

      it("a tela diz que o serviço do Prism foi parado para instalar e que 'Reiniciar' o traz de volta, e o pacote conferido fica", async () => {
        spawn.mockImplementation(failingSpawn);
        const subject = updater(world());
        await subject.check();
        await subject.download("0.3.0");

        const state = await subject.install("0.3.0");

        expect(state).toMatchObject({ status: "failed", reason: expect.stringMatching(/Não foi possível iniciar o instalador \(spawn EACCES\)\..*serviço do Prism foi parado para instalar.*Reiniciar/) });
        expect(stopApi).toHaveBeenCalledTimes(1);
        expect(filesIn(updatesDir())).toEqual([exe]);
      });

      it("'Tentar de novo' não baixa tudo outra vez: confere de novo, do disco, o arquivo que ficou, contra as duas somas", async () => {
        spawn.mockImplementation(failingSpawn);
        const net = world();
        const subject = updater(net);
        await subject.check();
        await subject.download("0.3.0");
        await subject.install("0.3.0");
        net.requested.length = 0;
        spawn.mockImplementation(workingSpawn);

        await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
        expect(net.requested).toEqual([asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS")]);

        await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "installing" });
        expect(spawn).toHaveBeenLastCalledWith(join(updatesDir(), exe), ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", shell: false });
        expect(quit).toHaveBeenCalledTimes(1);
      });

      it("se o arquivo que ficou não confere mais, ele não é aproveitado: baixa de novo", async () => {
        spawn.mockImplementation(failingSpawn);
        const net = world();
        const subject = updater(net);
        await subject.check();
        await subject.download("0.3.0");
        await subject.install("0.3.0");
        writeFileSync(join(updatesDir(), exe), "outro programa");
        net.requested.length = 0;

        await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
        expect(net.requested).toEqual([asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS"), asset("0.3.0", exe), storage(exe)]);
        expect(readFileSync(join(updatesDir(), exe))).toEqual(Buffer.concat(installer));
      });

      it("se o SHA256SUMS publicado mudou, o arquivo que ficou também não é aproveitado, e a recusa é a da soma", async () => {
        spawn.mockImplementation(failingSpawn);
        const net = world();
        const subject = updater(net);
        await subject.check();
        await subject.download("0.3.0");
        await subject.install("0.3.0");
        net.routes[storage("SHA256SUMS")] = { chunks: [bytes(`${wrong}  ${exe}\n`)] };

        await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/SHA256SUMS/) });
        expect(filesIn(updatesDir())).toEqual([]);
      });

      it("as outras falhas depois da parada dizem o mesmo: prazo estourado, parada que falha, arquivo trocado na parada", async () => {
        const reasonOf = async (arrange: (subject: ReturnType<typeof updater>) => void) => {
          const subject = updater(world(), { apiStopTimeoutMs: 40 });
          await subject.check();
          await subject.download("0.3.0");
          arrange(subject);
          const state = await subject.install("0.3.0");
          return state.status === "failed" ? state.reason : state.status;
        };

        expect(await reasonOf(() => stopApi.mockImplementation(() => new Promise<void>(() => {})))).toMatch(/não encerrou a tempo.*Reiniciar/);
        expect(await reasonOf(() => stopApi.mockRejectedValue(new Error("taskkill falhou")))).toMatch(/não encerrou.*Reiniciar.*feche o Prism e abra-o de novo/);
        expect(await reasonOf(() => stopApi.mockImplementation(async () => writeFileSync(join(updatesDir(), exe), "outro programa")))).toMatch(/mudou depois de conferido.*serviço do Prism foi parado para instalar.*Reiniciar/);
      });
    });

    describe("a parada da API que estoura o prazo (Ruling 89): 'Tentar de novo' só roda o instalador com a prova de que a API terminou", () => {
      /**
       * A parada como o processo principal a faz: a primeira solta a referência da API e espera o processo terminar (aqui, até o
       * teste mandar); as seguintes, sem API na referência, resolvem na hora — e isso não prova nada.
       */
      function hangingFirstStop() {
        let finish: () => void = () => {};
        let fail: (error: Error) => void = () => {};
        let calls = 0;
        stopApi.mockImplementation(() => {
          calls += 1;
          return calls === 1 ? new Promise<void>((resolve, reject) => ((finish = resolve), (fail = reject))) : Promise.resolve();
        });
        return { finish: () => finish(), fail: (error: Error) => fail(error) };
      }
      async function timedOut() {
        const subject = updater(world(), { apiStopTimeoutMs: 40 });
        await subject.check();
        await subject.download("0.3.0");
        await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/não encerrou a tempo/) });
        return subject;
      }
      /** "Tentar de novo": o diálogo pede o download (que confere de novo o pacote guardado) e, pronto, a instalação. */
      async function retry(subject: ReturnType<typeof updater>) {
        await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
        return subject.install("0.3.0");
      }

      it("enquanto a parada anterior não termina, a nova tentativa não roda o instalador, mesmo com a nova parada resolvendo na hora", async () => {
        hangingFirstStop();
        const subject = await timedOut();

        await expect(retry(subject)).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/não encerrou a tempo.*Reiniciar/) });
        expect(stopApi).toHaveBeenCalledTimes(2);
        expect(spawn).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
        expect(filesIn(updatesDir())).toEqual([exe]);
      });

      it("a parada anterior termina: a tentativa seguinte roda o instalador e o app sai", async () => {
        const stop = hangingFirstStop();
        const subject = await timedOut();
        stop.finish();

        await expect(retry(subject)).resolves.toMatchObject({ status: "installing" });
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(quit).toHaveBeenCalledTimes(1);
      });

      it("a parada anterior termina no meio da espera da nova tentativa: só então o instalador roda", async () => {
        const stop = hangingFirstStop();
        const subject = await timedOut();
        const order: string[] = [];
        spawn.mockImplementation(() => {
          order.push("instalador");
          queueMicrotask(() => child.emit("spawn"));
          return child;
        });
        setTimeout(() => {
          order.push("a API anterior terminou");
          stop.finish();
        }, 15);

        await expect(retry(subject)).resolves.toMatchObject({ status: "installing" });
        expect(order).toEqual(["a API anterior terminou", "instalador"]);
      });

      it("depois de 'Reiniciar' há uma API nova: a nova tentativa para a nova E espera a anterior", async () => {
        let finishOld: () => void = () => {};
        let finishNew: () => void = () => {};
        stopApi
          .mockImplementationOnce(() => new Promise<void>((resolve) => (finishOld = resolve)))
          .mockImplementationOnce(() => new Promise<void>((resolve) => (finishNew = resolve)));
        const subject = await timedOut();

        // Só a API nova termina (depois de a nova tentativa pedir a parada dela): falta a prova da anterior.
        const pending = retry(subject);
        await vi.waitFor(() => expect(stopApi).toHaveBeenCalledTimes(2));
        finishNew();
        await expect(pending).resolves.toMatchObject({ status: "failed" });
        expect(spawn).not.toHaveBeenCalled();

        // A anterior termina, e a nova já tinha terminado: a tentativa seguinte (que para o que estiver de pé, nada) roda.
        finishOld();
        stopApi.mockResolvedValue(undefined);
        await expect(retry(subject)).resolves.toMatchObject({ status: "installing" });
        expect(stopApi).toHaveBeenCalledTimes(3);
        expect(spawn).toHaveBeenCalledTimes(1);
      });

      it("a parada que falha não é prova: nenhuma tentativa seguinte roda o instalador nesta abertura, e a frase manda fechar e abrir o Prism", async () => {
        const stop = hangingFirstStop();
        const subject = await timedOut();
        stop.fail(new Error("taskkill falhou"));

        for (let attempt = 0; attempt < 2; attempt += 1) {
          await expect(retry(subject)).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/não encerrou.*Reiniciar.*feche o Prism e abra-o de novo/) });
        }
        expect(spawn).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
      });

      it("a parada que termina no prazo deixa a tentativa seguinte rodar como antes (o instalador que não iniciou)", async () => {
        spawn.mockImplementationOnce(() => {
          queueMicrotask(() => child.emit("error", new Error("spawn EACCES")));
          return child;
        });
        const subject = updater(world(), { apiStopTimeoutMs: 40 });
        await subject.check();
        await subject.download("0.3.0");
        await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/EACCES/) });

        await expect(retry(subject)).resolves.toMatchObject({ status: "installing" });
        expect(spawn).toHaveBeenCalledTimes(2);
      });
    });

    it("Linux: move o pacote conferido para a pasta de downloads, mostra-o e diz o formato; nada é executado", async () => {
      const subject = updater(world({ file: deb }), { facts: debian });
      await subject.check();
      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready", format: "deb" });

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "delivered", format: "deb", fileName: deb });
      expect(readFileSync(join(dir, "Downloads", deb))).toEqual(Buffer.concat(installer));
      expect(reveal).toHaveBeenCalledWith(join(dir, "Downloads", deb));
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
      // O app continua aberto: a API não é parada.
      expect(stopApi).not.toHaveBeenCalled();
    });

    it("Windows rodando do zip portátil: baixa o zip, confere e o deixa na pasta de downloads; o instalador nunca roda", async () => {
      const zip = "Prism-0.3.0-win-x64.zip";
      const net = world({ file: zip });
      const subject = updater(net, { facts: { ...windows, nsisInstalled: false } });
      await subject.check();
      expect(subject.state()).toMatchObject({ status: "available", format: "zip" });

      await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready", format: "zip" });
      expect(net.requested.slice(1)).toEqual([asset("0.3.0", "SHA256SUMS"), storage("SHA256SUMS"), asset("0.3.0", zip), storage(zip)]);

      await expect(subject.install("0.3.0")).resolves.toMatchObject({ status: "delivered", format: "zip", fileName: zip });
      expect(readFileSync(join(dir, "Downloads", zip))).toEqual(Buffer.concat(installer));
      expect(reveal).toHaveBeenCalledWith(join(dir, "Downloads", zip));
      expect(spawn).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    });
  });
});
