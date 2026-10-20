import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dbeaverLimits, dbeaverSourceReplySchema } from "./dbeaver-messages";
import { createDbeaverSource, dbeaverDialogTitle, dbeaverRoots, symlinkMessage, type DbeaverSourceDeps } from "./dbeaver-source";

/**
 * A procura e a cópia do DBeaver (RN-DBEAVER-004 a 006), em pastas temporárias de verdade, com uma pasta pessoal falsa. Os nomes e o conteúdo dos arquivos são
 * inventados: nada aqui vem de um DBeaver real.
 */

const ids = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "16fd2706-8baf-433b-82eb-8c7fada847da", "886313e1-3b8a-4372-9b90-0c9aee199e5d"];
const posix = process.platform !== "win32";

type Harness = {
  root: string;
  home: string;
  dataDir: string;
  transfers: string;
  dialogs: { windowId: number; title: string; defaultPath: string }[];
  answer: (path: string | null) => void;
  logs: string[];
  source: ReturnType<typeof createDbeaverSource>;
};

let harness: Harness;

function setUp(overrides: Partial<DbeaverSourceDeps> = {}): Harness {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prism-dbeaver-")));
  const home = join(root, "casa");
  const dataDir = join(root, "dados");
  mkdirSync(home);
  mkdirSync(join(dataDir, "transfers"), { recursive: true });
  let next: string | null = null;
  let counter = 0;
  const h: Harness = {
    root,
    home,
    dataDir,
    transfers: join(dataDir, "transfers"),
    dialogs: [],
    answer: (path) => (next = path),
    logs: [],
    source: null as never,
  };
  h.source = createDbeaverSource({
    dataDir,
    platform: "linux",
    env: {},
    home,
    async showOpenDialog(windowId, options) {
      h.dialogs.push({ windowId, title: options.title, defaultPath: options.defaultPath });
      return next;
    },
    log: (message) => h.logs.push(message),
    randomId: () => ids[counter++ % ids.length],
    now: () => 0,
    ...overrides,
  });
  return h;
}

beforeEach(() => {
  harness = setUp();
});

afterEach(() => {
  rmSync(harness.root, { recursive: true, force: true });
});

/** Um projeto do workspace: a `.dbeaver` com os arquivos dados (nome → conteúdo). */
function project(workspace: string, name: string, files: Record<string, string> = { "data-sources.json": "{}", "credentials-config.json": "cifra-inventada" }): string {
  const dir = join(workspace, name, ".dbeaver");
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
  return join(workspace, name);
}

const standard = () => join(harness.home, ".local", "share", "DBeaverData");
const workspaceOf = (dataFolder: string) => join(dataFolder, "workspace6");

async function find(windowId = 1) {
  return harness.source.source(windowId, { mode: "find" });
}

async function choose(path: string | null, windowId = 1) {
  harness.answer(path);
  return harness.source.source(windowId, { mode: "choose" });
}

const copyOf = (sourceId: string) => join(harness.transfers, `${sourceId}.dbeaver`);
const manifestOf = (sourceId: string) => JSON.parse(readFileSync(join(copyOf(sourceId), "manifest.json"), "utf8")) as { version: number; where: string; projects: { folder: string; name: string }[] };

describe("dbeaverRoots", () => {
  const home = "/home/<nome>";

  it("com DBEAVER_DATA, só $DBEAVER_DATA/DBeaverData, antes de qualquer sistema", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const roots = dbeaverRoots({ platform, env: { DBEAVER_DATA: "/dados/x", APPDATA: "C:\\a" }, home });
      expect(roots.map((root) => root.where)).toEqual(["env"]);
    }
    expect(dbeaverRoots({ platform: "linux", env: { DBEAVER_DATA: "/dados/x" }, home })[0].dir).toBe("/dados/x/DBeaverData");
    // Vazia vale como ausente.
    expect(dbeaverRoots({ platform: "darwin", env: { DBEAVER_DATA: "" }, home })[0].where).toBe("standard");
  });

  it("Windows: %APPDATA%\\DBeaverData, e a pasta do perfil quando não há APPDATA", () => {
    const roaming = String.raw`C:\Users\<nome>\AppData\Roaming`;
    const profile = String.raw`C:\Users\<nome>`;
    expect(dbeaverRoots({ platform: "win32", env: { APPDATA: roaming }, home: profile })).toEqual([{ where: "standard", dir: String.raw`${roaming}\DBeaverData` }]);
    expect(dbeaverRoots({ platform: "win32", env: {}, home: profile })).toEqual([{ where: "standard", dir: String.raw`${profile}\DBeaverData` }]);
  });

  it("macOS: ~/Library/DBeaverData", () => {
    expect(dbeaverRoots({ platform: "darwin", env: {}, home })).toEqual([{ where: "standard", dir: "/home/<nome>/Library/DBeaverData" }]);
  });

  it("Linux: o do Flatpak, o do Snap, o de sempre e o antigo, nesta ordem", () => {
    expect(dbeaverRoots({ platform: "linux", env: {}, home })).toEqual([
      { where: "flatpak", dir: "/home/<nome>/.var/app/io.dbeaver.DBeaverCommunity/data/DBeaverData" },
      { where: "snap", dir: "/home/<nome>/snap/dbeaver-ce/current/.local/share/DBeaverData" },
      { where: "standard", dir: "/home/<nome>/.local/share/DBeaverData" },
      { where: "standard", dir: "/home/<nome>/.local/share/.DBeaverData", legacy: true },
    ]);
  });
});

describe("a procura (find)", () => {
  it("acha o DBeaver de sempre, copia só os cinco arquivos esperados de cada projeto e responde sem caminho", async () => {
    const workspace = workspaceOf(standard());
    project(workspace, "General", {
      "data-sources.json": '{"connections":{}}',
      "data-sources-2.json": "{}",
      "credentials-config.json": "cifra-1",
      "credentials-config-2.json": "cifra-2",
      "project-settings.json": "{}",
      "notas.txt": "não se copia",
      "data-sources.json.bak": "não se copia",
      "credentials-config-.json": "o sufixo vazio não vale",
    });
    project(workspace, "Vendas", { "data-sources.json": "{}" });
    // Nada disto é projeto: a pasta oculta, a sem `.dbeaver`, a `.dbeaver` sem `data-sources`.
    mkdirSync(join(workspace, ".metadata"), { recursive: true });
    mkdirSync(join(workspace, "Scripts"));
    project(workspace, "Vazio", { "credentials-config.json": "x" });
    writeFileSync(join(workspace, "arquivo-solto.json"), "{}");

    const reply = await find();

    expect(reply).toEqual({ status: "found", sourceId: ids[0], where: "standard", projects: 2 });
    expect(dbeaverSourceReplySchema.safeParse(reply).success).toBe(true);
    const copy = copyOf(ids[0]);
    // O General vem primeiro, e os outros pela ordem dos nomes.
    expect(manifestOf(ids[0])).toEqual({ version: 1, where: "standard", projects: [{ folder: "1", name: "General" }, { folder: "2", name: "Vendas" }] });
    expect(readdirSync(join(copy, "1")).sort()).toEqual(["credentials-config-2.json", "credentials-config.json", "data-sources-2.json", "data-sources.json", "project-settings.json"]);
    expect(readFileSync(join(copy, "1", "data-sources.json"), "utf8")).toBe('{"connections":{}}');
    expect(readFileSync(join(copy, "1", "credentials-config.json"), "utf8")).toBe("cifra-1");
    expect(readdirSync(join(copy, "2"))).toEqual(["data-sources.json"]);
    expect(readdirSync(harness.transfers)).toEqual([`${ids[0]}.dbeaver`]);
    // Nem o caminho, nem o nome de projeto, nem o de arquivo vão ao log.
    expect(harness.logs).toHaveLength(1);
    expect(harness.logs[0]).toContain(ids[0]);
    for (const secret of [harness.home, harness.dataDir, "General", "Vendas", "data-sources"]) expect(harness.logs[0]).not.toContain(secret);
  });

  it.runIf(posix)("a pasta da cópia, a de cada projeto e o manifesto têm os modos 0700 e 0600", async () => {
    project(workspaceOf(standard()), "General");
    await find();

    const copy = copyOf(ids[0]);
    expect(statSync(copy).mode & 0o777).toBe(0o700);
    expect(statSync(join(copy, "1")).mode & 0o777).toBe(0o700);
    expect(statSync(join(copy, "1", "data-sources.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(copy, "manifest.json")).mode & 0o777).toBe(0o600);
  });

  it("sem o DBeaver em lugar nenhum, responde notFound e não copia nada", async () => {
    expect(await find()).toEqual({ status: "notFound" });
    // Um workspace sem projeto algum também não é o DBeaver.
    mkdirSync(workspaceOf(standard()), { recursive: true });
    expect(await find()).toEqual({ status: "notFound" });
    expect(readdirSync(harness.transfers)).toEqual([]);
  });

  it("com mais de uma pasta de dados com projetos, vale a do data-sources alterado por último", async () => {
    const flatpak = join(harness.home, ".var", "app", "io.dbeaver.DBeaverCommunity", "data", "DBeaverData");
    project(workspaceOf(flatpak), "General");
    project(workspaceOf(standard()), "General");
    utimesSync(join(workspaceOf(flatpak), "General", ".dbeaver", "data-sources.json"), new Date(2026, 0, 1), new Date(2026, 0, 1));
    utimesSync(join(workspaceOf(standard()), "General", ".dbeaver", "data-sources.json"), new Date(2026, 5, 1), new Date(2026, 5, 1));

    expect(await find()).toMatchObject({ status: "found", where: "standard" });
    utimesSync(join(workspaceOf(flatpak), "General", ".dbeaver", "data-sources.json"), new Date(2026, 9, 1), new Date(2026, 9, 1));
    expect(await find()).toMatchObject({ status: "found", where: "flatpak" });
  });

  it("a pasta antiga do Linux só vale quando a de sempre não existe", async () => {
    const legacy = join(harness.home, ".local", "share", ".DBeaverData");
    project(workspaceOf(legacy), "General");
    expect(await find()).toMatchObject({ status: "found", where: "standard" });
    expect(manifestOf(ids[0]).projects).toEqual([{ folder: "1", name: "General" }]);

    // A de sempre existe (ainda que vazia): a antiga é ignorada.
    mkdirSync(standard(), { recursive: true });
    expect(await find()).toEqual({ status: "notFound" });
  });

  it.runIf(posix)("o caminho do Snap passa pelo atalho `current`, que é resolvido antes de tudo", async () => {
    const snap = join(harness.home, "snap", "dbeaver-ce");
    const revision = join(snap, "412", ".local", "share", "DBeaverData");
    project(workspaceOf(revision), "General");
    symlinkSync("412", join(snap, "current"));

    const reply = await find();

    expect(reply).toMatchObject({ status: "found", where: "snap", projects: 1 });
  });

  it("com DBEAVER_DATA definida, só ela é procurada", async () => {
    const only = setUp();
    const own = join(only.root, "outro");
    const withEnv = createDbeaverSource({ dataDir: only.dataDir, platform: "linux", env: { DBEAVER_DATA: own }, home: only.home, showOpenDialog: async () => null, log: () => undefined, randomId: () => ids[0], now: () => 0 });
    // Só a da variável: o DBeaver de sempre, que também existe, não é procurado.
    project(workspaceOf(join(only.home, ".local", "share", "DBeaverData")), "General");
    expect(await withEnv.source(1, { mode: "find" })).toEqual({ status: "notFound" });

    project(workspaceOf(join(own, "DBeaverData")), "General");
    expect(await withEnv.source(1, { mode: "find" })).toMatchObject({ status: "found", where: "env", projects: 1 });
    rmSync(only.root, { recursive: true, force: true });
  });

  it.runIf(posix)("o projeto, a `.dbeaver` ou o arquivo que é atalho recusa a cópia inteira com a frase do atalho, sem copiar nada", async () => {
    const workspace = workspaceOf(standard());
    const outside = join(harness.root, "fora");
    mkdirSync(outside);
    writeFileSync(join(outside, "data-sources.json"), "{}");

    // O arquivo.
    project(workspace, "General");
    rmSync(join(workspace, "General", ".dbeaver", "credentials-config.json"));
    symlinkSync(join(outside, "data-sources.json"), join(workspace, "General", ".dbeaver", "credentials-config.json"));
    expect(await find()).toEqual({ status: "unreadable", message: symlinkMessage });
    rmSync(join(workspace, "General"), { recursive: true });

    // A `.dbeaver`.
    mkdirSync(join(workspace, "General"));
    symlinkSync(outside, join(workspace, "General", ".dbeaver"));
    expect(await find()).toEqual({ status: "unreadable", message: symlinkMessage });
    rmSync(join(workspace, "General"), { recursive: true });

    // O projeto.
    mkdirSync(join(outside, ".dbeaver"));
    writeFileSync(join(outside, ".dbeaver", "data-sources.json"), "{}");
    symlinkSync(outside, join(workspace, "General"));
    expect(await find()).toEqual({ status: "unreadable", message: symlinkMessage });

    expect(readdirSync(harness.transfers)).toEqual([]);
  });

  it("o workspace com mais de 1.000 entradas não é o do DBeaver", async () => {
    const workspace = workspaceOf(standard());
    project(workspace, "General");
    for (let index = 0; index <= dbeaverLimits.entries; index++) mkdirSync(join(workspace, `p${index}`));

    expect(await find()).toEqual({ status: "notFound" });
  });
});

describe("Escolher a pasta do DBeaver (choose)", () => {
  it("abre o diálogo com o título do processo principal, começando na pasta de dados do DBeaver quando ela existe, e senão na pessoal", async () => {
    expect(await choose(null)).toEqual({ status: "canceled" });
    expect(harness.dialogs).toEqual([{ windowId: 1, title: dbeaverDialogTitle, defaultPath: harness.home }]);

    mkdirSync(standard(), { recursive: true });
    await choose(null, 2);
    expect(harness.dialogs[1]).toEqual({ windowId: 2, title: dbeaverDialogTitle, defaultPath: standard() });
  });

  it("serve a pasta de dados, o workspace, o projeto e a própria `.dbeaver`", async () => {
    const data = join(harness.root, "escolhida", "DBeaverData");
    const workspace = workspaceOf(data);
    const general = project(workspace, "General");
    project(workspace, "Vendas");

    for (const [path, projects] of [
      [data, 2],
      [workspace, 2],
      [general, 1],
      [join(general, ".dbeaver"), 1],
    ] as const) {
      const reply = await choose(path);
      expect(reply).toMatchObject({ status: "found", where: "chosen", projects });
    }
    // A `.dbeaver` escolhida (a última) leva o nome da pasta acima dela.
    expect(manifestOf(ids[3]).projects).toEqual([{ folder: "1", name: "General" }]);
  });

  it("a pasta sem projeto algum é notDbeaver, e a que não existe, unreadable com a frase do sistema", async () => {
    mkdirSync(join(harness.root, "vazia"));
    expect(await choose(join(harness.root, "vazia"))).toEqual({ status: "notDbeaver" });
    expect(await choose(join(harness.root, "nao-existe"))).toEqual({ status: "unreadable", message: "Não foi possível ler os arquivos do DBeaver: o arquivo não existe mais." });
    expect(readdirSync(harness.transfers)).toEqual([]);
  });

  it.runIf(posix)("a pasta escolhida que é um atalho é resolvida, e o atalho dentro do workspace é recusado", async () => {
    const data = join(harness.root, "real", "DBeaverData");
    project(workspaceOf(data), "General");
    symlinkSync(data, join(harness.root, "atalho"));
    expect(await choose(join(harness.root, "atalho"))).toMatchObject({ status: "found", projects: 1 });

    const outside = join(harness.root, "fora");
    mkdirSync(join(outside, ".dbeaver"), { recursive: true });
    writeFileSync(join(outside, ".dbeaver", "data-sources.json"), "{}");
    symlinkSync(outside, join(workspaceOf(data), "Fora"));
    expect(await choose(data)).toEqual({ status: "unreadable", message: symlinkMessage });
  });

  it("o `choose` desistido não solta a cópia anterior da janela", async () => {
    project(workspaceOf(standard()), "General");
    const first = await find();
    expect(first.status).toBe("found");

    expect(await choose(null)).toEqual({ status: "canceled" });
    expect(existsSync(copyOf(ids[0]))).toBe(true);
  });
});

describe("os limites da cópia", () => {
  it("o arquivo de mais de 5 MiB, os 42 arquivos de um projeto e os 51 projetos recusam tudo com tooLarge, sem copiar nada", async () => {
    const workspace = workspaceOf(standard());
    const general = project(workspace, "General");
    truncateSync(join(general, ".dbeaver", "credentials-config.json"), dbeaverLimits.fileBytes + 1);
    expect(await find()).toEqual({ status: "tooLarge" });
    truncateSync(join(general, ".dbeaver", "credentials-config.json"), dbeaverLimits.fileBytes);
    expect(await find()).toMatchObject({ status: "found" });

    rmSync(workspace, { recursive: true });
    const many: Record<string, string> = {};
    for (let index = 0; index < dbeaverLimits.filesPerProject + 1; index++) many[index === 0 ? "data-sources.json" : `data-sources-${index}.json`] = "{}";
    project(workspace, "General", many);
    expect(await find()).toEqual({ status: "tooLarge" });

    rmSync(workspace, { recursive: true });
    for (let index = 0; index <= dbeaverLimits.projects; index++) project(workspace, `p${String(index).padStart(2, "0")}`, { "data-sources.json": "{}" });
    expect(await find()).toEqual({ status: "tooLarge" });
    expect(readdirSync(harness.transfers)).toEqual([]);
  });

  it("tudo junto passa de 32 MiB: tooLarge", async () => {
    const workspace = workspaceOf(standard());
    for (const name of ["a", "b", "c", "d", "e", "f", "g"]) {
      const dir = project(workspace, name);
      truncateSync(join(dir, ".dbeaver", "credentials-config.json"), dbeaverLimits.fileBytes);
    }
    expect(await find()).toEqual({ status: "tooLarge" });
  });

  it("a pasta `transfers` que não aceita gravação é notWritable, e a sem espaço, noSpace", async () => {
    project(workspaceOf(standard()), "General");
    rmSync(harness.transfers, { recursive: true });
    writeFileSync(harness.transfers, "um arquivo no lugar da pasta");
    expect(await find()).toEqual({ status: "notWritable" });
    rmSync(harness.transfers);
    mkdirSync(harness.transfers);

    const full = setUp({ freeSpace: async () => 1024 });
    project(workspaceOf(join(full.home, ".local", "share", "DBeaverData")), "General");
    expect(await full.source.source(1, { mode: "find" })).toEqual({ status: "noSpace" });
    rmSync(full.root, { recursive: true, force: true });
  });

  it("o arquivo trocado entre o lstat e a abertura (outro inode) recusa a cópia, e nada fica", async () => {
    const general = project(workspaceOf(standard()), "General");
    const target = join(general, ".dbeaver", "credentials-config.json");
    const swapped = setUp({
      home: harness.home,
      dataDir: harness.dataDir,
      beforeOpen(path) {
        if (path !== target) return;
        // O novo é criado antes de o antigo sair: o sistema não reaproveita o `inode` que ainda está em uso.
        writeFileSync(`${path}.novo`, "outro arquivo");
        renameSync(`${path}.novo`, path);
      },
    });

    const reply = await swapped.source.source(1, { mode: "find" });

    expect(reply).toMatchObject({ status: "unreadable" });
    expect(reply.status === "unreadable" ? reply.message : "").toContain("trocado");
    expect(readdirSync(harness.transfers)).toEqual([]);
    rmSync(swapped.root, { recursive: true, force: true });
  });

  it.runIf(posix)("o arquivo trocado por um atalho entre a verificação e a abertura é recusado (O_NOFOLLOW)", async () => {
    const general = project(workspaceOf(standard()), "General");
    const target = join(general, ".dbeaver", "credentials-config.json");
    const outside = join(harness.root, "fora.json");
    writeFileSync(outside, "{}");
    const swapped = setUp({
      home: harness.home,
      dataDir: harness.dataDir,
      beforeOpen(path) {
        if (path !== target) return;
        rmSync(path);
        symlinkSync(outside, path);
      },
    });

    expect(await swapped.source.source(1, { mode: "find" })).toEqual({ status: "unreadable", message: symlinkMessage });
    expect(readdirSync(harness.transfers)).toEqual([]);
    rmSync(swapped.root, { recursive: true, force: true });
  });
});

describe("uma cópia por janela e a limpeza", () => {
  beforeEach(() => {
    project(workspaceOf(standard()), "General");
  });

  it("um novo find da mesma janela solta a cópia anterior; a de outra janela fica", async () => {
    await find(1);
    await find(2);
    expect(existsSync(copyOf(ids[0]))).toBe(true);
    expect(existsSync(copyOf(ids[1]))).toBe(true);

    await find(1);
    expect(existsSync(copyOf(ids[0]))).toBe(false);
    expect(existsSync(copyOf(ids[2]))).toBe(true);
    expect(existsSync(copyOf(ids[1]))).toBe(true);
  });

  it("o release apaga a cópia da própria janela; o de outra janela e o de um id desconhecido não fazem nada", async () => {
    await find(1);

    await harness.source.release(2, { sourceId: ids[0] });
    await harness.source.release(1, { sourceId: ids[3] });
    expect(existsSync(copyOf(ids[0]))).toBe(true);

    await harness.source.release(1, { sourceId: ids[0] });
    expect(existsSync(copyOf(ids[0]))).toBe(false);
  });

  it("a janela que recarrega ou fecha solta a dela, e a saída solta todas", async () => {
    await find(1);
    await find(2);
    await harness.source.releaseWindow(1);
    expect(existsSync(copyOf(ids[0]))).toBe(false);
    expect(existsSync(copyOf(ids[1]))).toBe(true);

    await harness.source.releaseAll();
    expect(readdirSync(harness.transfers)).toEqual([]);
  });

  it("o pedido que termina depois de a janela ser solta não deixa a cópia (canceled)", async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const slow = setUp({
      home: harness.home,
      dataDir: harness.dataDir,
      async beforeOpen() {
        await waiting;
      },
    });

    const pending = slow.source.source(1, { mode: "find" });
    await slow.source.releaseWindow(1);
    release();

    expect(await pending).toEqual({ status: "canceled" });
    expect(readdirSync(harness.transfers)).toEqual([]);
    rmSync(slow.root, { recursive: true, force: true });
  });

  it("o pedido confere o conteúdo: modo desconhecido, chave a mais e id fora da forma são recusados", async () => {
    await expect(harness.source.source(1, { mode: "caminho" })).rejects.toThrow();
    await expect(harness.source.source(1, { mode: "find", path: "/etc" })).rejects.toThrow();
    await expect(harness.source.source(1, undefined)).rejects.toThrow();
    await expect(harness.source.release(1, { sourceId: "../../etc" })).rejects.toThrow();
    await expect(harness.source.release(1, { sourceId: ids[0], extra: 1 })).rejects.toThrow();
  });
});
