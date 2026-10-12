import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeHttp, type FakeStep } from "./http.fake";
import type { InstallFacts } from "./packages";
import type { UpdateState } from "./update-state";
import { createUpdater } from "./updater";

// As chamadas ao disco que o atualizador faz passam por aqui: cada uma é a de verdade, até um caso mandar que ela falhe.
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, mkdir: vi.fn(real.mkdir), open: vi.fn(real.open), rename: vi.fn(real.rename), rm: vi.fn(real.rm), copyFile: vi.fn(real.copyFile) };
});
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, rmSync: vi.fn(real.rmSync), writeFileSync: vi.fn(real.writeFileSync), renameSync: vi.fn(real.renameSync), mkdirSync: vi.fn(real.mkdirSync), createReadStream: vi.fn(real.createReadStream) };
});

const origin = { api: "https://api.github.com", site: "https://github.com", repository: "Zanveri/prism" };
const releasesUrl = `${origin.api}/repos/Zanveri/prism/releases?per_page=100`;
const registry = (file: string) => `${origin.site}/Zanveri/prism/releases/download/v0.3.0/${file}`;
const bytes = (text: string) => new TextEncoder().encode(text);

const installer = [bytes("MZ instalador "), bytes("de mentira")];
const good = createHash("sha256").update(Buffer.concat(installer)).digest("hex");
const exe = "Prism-0.3.0-win-x64.exe";
const deb = "Prism-0.3.0-linux-amd64.deb";

function world({ file = exe, notesSum = good } = {}) {
  const pack: FakeStep = { chunks: installer };
  return fakeHttp({
    [releasesUrl]: { chunks: [bytes(JSON.stringify([{ tag_name: "v0.3.0", body: `- Coisa nova.\n\n### Somas SHA-256\n\n\`\`\`\n${notesSum}  ${file}\n\`\`\`\n`, draft: false, prerelease: false, published_at: "2026-10-10T12:00:00Z" }]))] },
    [registry("SHA256SUMS")]: { chunks: [bytes(`${good}  ${file}\n`)] },
    [registry(file)]: pack,
  });
}

const windows: InstallFacts = { platform: "win32", arch: "x64", appImage: false, execPath: "C:\\Prism\\Prism.exe", debInstalled: false, hasRpm: false, nsisInstalled: true };
const debian: InstallFacts = { platform: "linux", arch: "x64", appImage: false, execPath: "/opt/Prism/prism", debInstalled: true, hasRpm: false, nsisInstalled: false };

/** Um erro como o que o sistema de arquivos dá: a mensagem e o campo `path` trazem o caminho inteiro. */
const diskError = (code: string, syscall: string, path: string) => Object.assign(new Error(`${code}: operation not permitted, ${syscall} '${path}'`), { code, syscall, path, errno: -4048 });

describe("as falhas de disco do atualizador", () => {
  let dir: string;
  let downloads: string;
  let states: UpdateState[];
  let logs: string[];
  const spawn = vi.fn();
  const quit = vi.fn();
  const reveal = vi.fn();

  function updater(net: ReturnType<typeof fakeHttp>, facts: InstallFacts = windows) {
    return createUpdater({ origin, currentVersion: "0.1.0", facts, dataDir: dir, downloadsDir: downloads, http: net.http, now: () => new Date("2026-10-10T12:00:00.000Z"), log: (message) => logs.push(message), spawn, stopApi: async () => {}, quit, reveal, onState: (state) => states.push(state), onProgress: () => {} });
  }

  /** Nenhuma causa que vai para a tela leva a pasta de dados nem a de downloads, com a barra que for e em qualquer caixa. */
  function expectNoFolder(state: UpdateState) {
    const flat = JSON.stringify(state).replaceAll("\\\\", "/").replaceAll("\\", "/").toLowerCase();
    for (const folder of [dir, downloads]) expect(flat).not.toContain(folder.replaceAll("\\", "/").toLowerCase());
    expect(state).toMatchObject({ status: "failed" });
    expect(state.status === "failed" && state.reason).not.toMatch(/updates|\.part|[A-Za-z]:[\\/]/);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "prism-disk-"));
    downloads = join(dir, "Pasta de Downloads");
    states = [];
    logs = [];
    spawn.mockReset().mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    quit.mockReset();
    reveal.mockReset();
  });
  afterEach(() => {
    vi.mocked(rmSync).mockClear();
    for (const mocked of [mkdir, open, rename, rm, copyFile]) vi.mocked(mocked).mockClear();
    rmSync(dir, { recursive: true, force: true });
  });

  const part = () => join(dir, "updates", "0.3.0", `${exe}.part`);

  it("criar a pasta da versão falha: a causa vai para a tela sem caminho, e o caminho fica no log", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(mkdir).mockRejectedValueOnce(diskError("EACCES", "mkdir", join(dir, "updates", "0.3.0")));

    const state = await subject.download("0.3.0");

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringContaining("EACCES") });
    expect(logs.join("\n")).toContain(join(dir, "updates", "0.3.0"));
  });

  it("abrir o arquivo temporário falha (o erro chega reembrulhado pelo download)", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(open).mockRejectedValueOnce(diskError("ENOENT", "open", part()));

    const state = await subject.download("0.3.0");

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringContaining("ENOENT") });
  });

  it("gravar falha no meio (disco cheio)", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(open).mockResolvedValueOnce({ write: async () => Promise.reject(diskError("ENOSPC", "write", part())), close: async () => {} } as never);

    const state = await subject.download("0.3.0");

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringContaining("ENOSPC") });
  });

  it("dar o nome final falha uma e duas vezes (antivírus lendo o arquivo novo): tenta de novo e fica pronto", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(rename).mockRejectedValueOnce(diskError("EPERM", "rename", part())).mockRejectedValueOnce(diskError("EBUSY", "rename", part()));

    await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("dar o nome final falha três vezes: desiste, sem caminho na causa", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(rename).mockRejectedValue(diskError("EPERM", "rename", part()));

    const state = await subject.download("0.3.0");
    vi.mocked(rename).mockReset();

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringContaining("EPERM") });
  });

  it("a soma não bate e apagar o arquivo falha: a causa continua sendo a soma, e ela vai para o log antes de apagar", async () => {
    const subject = updater(world({ notesSum: "f".repeat(64) }));
    await subject.check();
    // A primeira chamada é a limpeza da pasta antes de baixar; a que falha é a que apaga o arquivo recusado.
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (logs.some((line) => line.includes("não confere"))) throw diskError("EBUSY", "rm", String(path));
      await (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rm(path, options);
    });

    const state = await subject.download("0.3.0");
    vi.mocked(rm).mockReset();

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringMatching(/não confere com a soma SHA-256 das notas/) });
    expect(state.status === "failed" && state.reason).not.toMatch(/EBUSY|foi apagado/);
    expect(logs.findIndex((line) => line.includes("não confere"))).toBeGreaterThanOrEqual(0);
    expect(logs.findIndex((line) => line.includes("não confere"))).toBeLessThan(logs.findIndex((line) => line.includes("EBUSY")));
  });

  it("a soma não bate e o arquivo é apagado: a causa diz que foi", async () => {
    const subject = updater(world({ notesSum: "f".repeat(64) }));
    await subject.check();

    await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "failed", reason: expect.stringMatching(/não confere.*foi apagado/) });
  });

  it("limpar a pasta antes de baixar falha", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(rm).mockRejectedValueOnce(diskError("EBUSY", "rm", join(dir, "updates", "0.3.0")));

    expectNoFolder(await subject.download("0.3.0"));
  });

  it("um erro sem código, só com o caminho no texto, também não chega à tela", async () => {
    const subject = updater(world());
    await subject.check();
    vi.mocked(open).mockRejectedValueOnce(new Error(`algo deu errado em ${part().toUpperCase()}`));

    const state = await subject.download("0.3.0");

    expectNoFolder(state);
    expect(logs.join("\n")).toContain(part().toUpperCase());
  });

  it("entregar na pasta de downloads falha: o código vai para a tela, o caminho não", async () => {
    const subject = updater(world({ file: deb }), debian);
    await subject.check();
    await subject.download("0.3.0");
    vi.mocked(copyFile).mockRejectedValueOnce(diskError("EACCES", "copyfile", join(downloads, deb)));

    const state = await subject.install("0.3.0");

    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringContaining("EACCES") });
  });

  it("entregar falha com um erro sem código e com a pasta de downloads no texto", async () => {
    const subject = updater(world({ file: deb }), debian);
    await subject.check();
    await subject.download("0.3.0");
    vi.mocked(copyFile).mockRejectedValueOnce(new Error(`não deu para copiar para ${downloads.replaceAll("\\", "/")}/${deb}`));

    expectNoFolder(await subject.install("0.3.0"));
  });

  it("o arquivo mudou depois de conferido e apagá-lo falha: a falha aparece sem caminho, nada é rejeitado e o estado não fica preso", async () => {
    const subject = updater(world());
    await subject.check();
    await subject.download("0.3.0");
    writeFileSync(join(dir, "updates", "0.3.0", exe), "outro programa");
    vi.mocked(rm).mockRejectedValue(diskError("EBUSY", "unlink", join(dir, "updates", "0.3.0", exe)));

    const outcome = await subject.install("0.3.0").then(
      (state) => ({ state }),
      (error: unknown) => ({ error }),
    );
    vi.mocked(rm).mockReset();

    expect(outcome).not.toHaveProperty("error");
    const state = (outcome as { state: UpdateState }).state;
    expectNoFolder(state);
    expect(state).toMatchObject({ reason: expect.stringMatching(/mudou depois de conferido.*não conseguiu apagá-lo/) });
    expect(spawn).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/EBUSY/);
    // Não ficou preso em "pronta" sem arquivo conferido: dá para baixar de novo.
    await expect(subject.download("0.3.0")).resolves.toMatchObject({ status: "ready" });
  });

  describe("com o disco falhando em tudo, nenhuma função pública rejeita com caminho de pasta nem o manda à tela", () => {
    const flat = (text: string) => text.replaceAll("\\\\", "/").replaceAll("\\", "/").toLowerCase();
    const promised = [
      [mkdir, "mkdir"],
      [open, "open"],
      [rename, "rename"],
      [rm, "rm"],
      [copyFile, "copyfile"],
    ] as const;
    const synchronous = [
      [rmSync, "rm"],
      [writeFileSync, "open"],
      [renameSync, "rename"],
      [mkdirSync, "mkdir"],
      [createReadStream, "open"],
    ] as const;

    /** Daqui em diante toda chamada ao disco falha, com o caminho inteiro na mensagem e no campo `path`. */
    function breakDisk() {
      for (const [mocked, syscall] of promised) vi.mocked(mocked as typeof rm).mockImplementation(async (path) => Promise.reject(diskError("EPERM", syscall, String(path))));
      for (const [mocked, syscall] of synchronous) {
        vi.mocked(mocked as typeof rmSync).mockImplementation((path) => {
          throw diskError("EPERM", syscall, String(path));
        });
      }
    }
    function fixDisk() {
      for (const [mocked] of promised) vi.mocked(mocked as typeof rm).mockReset();
      for (const [mocked] of synchronous) vi.mocked(mocked as typeof rmSync).mockReset();
    }
    afterEach(fixDisk);

    /** Chama, e guarda o que voltou ou o que foi rejeitado (ou lançado), sem deixar escapar. */
    async function settle(call: () => unknown): Promise<{ value: unknown } | { error: unknown }> {
      try {
        return { value: await call() };
      } catch (error) {
        return { error };
      }
    }

    function expectNoFolderAnywhere(outcomes: Array<{ value: unknown } | { error: unknown }>) {
      const folders = [dir, downloads].map(flat);
      const seen = [...outcomes.map((outcome) => ("error" in outcome ? String((outcome.error as Error).message ?? outcome.error) : JSON.stringify(outcome.value ?? null))), ...states.map((state) => JSON.stringify(state))];
      for (const text of seen) for (const folder of folders) expect(flat(text)).not.toContain(folder);
    }

    it("quebrado desde o início: nascer, consultar, mudar preferência, baixar, pular, instalar, cancelar", async () => {
      breakDisk();
      const subject = updater(world());

      const outcomes = [
        await settle(() => subject.checkOnStartup()),
        await settle(() => subject.check()),
        await settle(() => subject.setCheckOnStartup(false)),
        await settle(() => subject.download("0.3.0")),
        await settle(() => subject.install("0.3.0")),
        await settle(() => subject.cancel()),
        await settle(() => subject.state()),
        await settle(() => subject.preferences()),
        await settle(() => subject.skipVersion("0.3.0")),
      ];

      expectNoFolderAnywhere(outcomes);
      // O download falhou por causa do disco, e disse isso sem caminho.
      expect(states.some((state) => state.status === "failed")).toBe(true);
      expect(logs.join("\n")).toContain(dir);
    });

    it.each([
      ["o instalador do Windows", exe, windows],
      ["o pacote que vai para a pasta de downloads", deb, debian],
    ] as const)("pronta, e então o disco quebra: instalar %s", async (_, file, facts) => {
      const subject = updater(world({ file }), facts);
      await subject.check();
      await subject.download("0.3.0");
      breakDisk();

      const outcomes = [await settle(() => subject.install("0.3.0")), await settle(() => subject.check()), await settle(() => subject.download("0.3.0"))];

      expectNoFolderAnywhere(outcomes);
      expect(outcomes[0]).toMatchObject({ value: { status: "failed" } });
      expect(spawn).not.toHaveBeenCalled();
    });

    it("pronta, o arquivo é trocado e o disco quebra: instalar", async () => {
      const subject = updater(world());
      await subject.check();
      await subject.download("0.3.0");
      writeFileSync(join(dir, "updates", "0.3.0", exe), "outro programa");
      // Ler ainda funciona (a troca é vista); todo o resto falha.
      breakDisk();
      vi.mocked(createReadStream).mockReset();

      const outcomes = [await settle(() => subject.install("0.3.0")), await settle(() => subject.install("0.3.0")), await settle(() => subject.download("0.3.0"))];

      expectNoFolderAnywhere(outcomes);
      expect(outcomes[0]).toMatchObject({ value: { status: "failed" } });
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it("o atualizador nunca impede o app de abrir: com um executável em uso em updates/, ele nasce, avisa no log e consulta", async () => {
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw diskError("EPERM", "unlink", join(dir, "updates", "0.2.0", "Prism-0.2.0-win-x64.exe"));
    });

    const subject = updater(world());

    expect(logs.join("\n")).toMatch(/não foi apagada.*EPERM/);
    await expect(subject.check()).resolves.toEqual({ outcome: "available" });
  });
});
