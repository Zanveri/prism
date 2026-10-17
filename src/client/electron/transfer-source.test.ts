import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { maxImportBytes, sourceReplySchema, sourceStatusSchema } from "./transfer-messages";
import { createTransferSource, copyFailureMessage, defaultCopy, SideError, sourceDialogFilters, spareBytes, unreadableReason, type TransferSourceDeps } from "./transfer-source";

const ids = ["0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7", "16fd2706-8baf-433b-82eb-8c7fada847da", "886313e1-3b8a-4372-9b90-0c9aee199e5d"];

type Harness = {
  root: string;
  dataDir: string;
  downloads: string;
  files: string;
  dialogs: { windowId: number; title: string; defaultPath: string }[];
  answer: (path: string | null) => void;
  logs: string[];
  source: ReturnType<typeof createTransferSource>;
  file: (name: string, content: string) => string;
};

let harness: Harness;

function setUp(overrides: Partial<TransferSourceDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "prism-source-"));
  const dataDir = join(root, "dados");
  const downloads = join(root, "Downloads");
  const files = join(root, "arquivos");
  mkdirSync(join(dataDir, "transfers"), { recursive: true });
  mkdirSync(downloads);
  mkdirSync(files);
  let next: string | null = null;
  let counter = 0;
  const h: Harness = {
    root,
    dataDir,
    downloads,
    files,
    dialogs: [],
    answer: (path) => (next = path),
    logs: [],
    source: null as never,
    file(name, content) {
      const path = join(files, name);
      writeFileSync(path, content);
      return path;
    },
  };
  h.source = createTransferSource({
    dataDir,
    downloadsDir: () => downloads,
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

async function choose(path: string | null, windowId = 1) {
  harness.answer(path);
  return harness.source.choose(windowId);
}

/** Espera a cópia sair de `copying` (a cópia de verdade, em fluxo, leva alguns giros do laço de eventos). */
async function settled(fileId: string, windowId = 1) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = harness.source.status(windowId, { fileId });
    if (status.status !== "copying") return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("A cópia não terminou.");
}

describe("escolher o arquivo (RN-IMPORT-018): o processo principal abre o diálogo de abrir, confere e copia", () => {
  it("o diálogo é do processo principal: o título, os filtros que ele escreve e a pasta de Downloads na primeira vez; depois, a da última importação", async () => {
    const path = harness.file("pedidos.csv", "id;nome\n1;Ana\n");
    const reply = await choose(path);
    expect(harness.dialogs[0]).toEqual({ windowId: 1, title: "Importar dados", defaultPath: harness.downloads });
    expect(sourceDialogFilters.map((filter) => filter.name)).toEqual([
      "Arquivos de dados (*.csv, *.tsv, *.tab, *.txt, *.json, *.xlsx, *.xlsm)",
      "CSV e TSV (*.csv, *.tsv, *.tab, *.txt)",
      "JSON (*.json)",
      "Excel (*.xlsx, *.xlsm)",
      "Todos os arquivos",
    ]);
    expect(sourceDialogFilters.at(-1)?.extensions).toEqual(["*"]);
    expect(reply.status).toBe("chosen");

    await choose(null);
    expect(harness.dialogs[1].defaultPath).toBe(harness.files);
  });

  it("desistir do diálogo responde `canceled`, sem nada na pasta", async () => {
    expect(await choose(null)).toEqual({ status: "canceled" });
    expect(await choose("")).toEqual({ status: "canceled" });
  });

  it("`chosen` leva só o identificador (a forma de um da API), o nome sem a pasta e o tamanho; a cópia vira `<fileId>.in`, no modo 0600, com o conteúdo do original", async () => {
    const content = "id;nome\n1;São Paulo\n";
    const reply = await choose(harness.file("pedidos.csv", content));
    expect(sourceReplySchema.parse(reply)).toEqual({ status: "chosen", fileId: ids[0], fileName: "pedidos.csv", size: Buffer.byteLength(content) });
    expect(JSON.stringify(reply)).not.toContain(harness.files);

    expect(await settled(ids[0])).toEqual({ status: "ready" });
    const copied = join(harness.dataDir, "transfers", `${ids[0]}.in`);
    expect(readFileSync(copied, "utf8")).toBe(content);
    expect(existsSync(`${copied}.part`)).toBe(false);
    if (process.platform !== "win32") expect(statSync(copied).mode & 0o777).toBe(0o600);
  });

  it("a cópia é o retrato do arquivo: mudar o original depois da cópia não muda o que a API lê", async () => {
    const path = harness.file("pedidos.csv", "antes");
    await choose(path);
    await settled(ids[0]);
    writeFileSync(path, "depois");
    expect(readFileSync(join(harness.dataDir, "transfers", `${ids[0]}.in`), "utf8")).toBe("antes");
  });

  it("uma pasta, ou o atalho que aponta para uma pasta, não é um arquivo comum: `notAFile`, e nada é copiado", async () => {
    const folder = join(harness.files, "uma-pasta");
    mkdirSync(folder);
    expect(await choose(folder)).toEqual({ status: "notAFile" });
    if (process.platform !== "win32") {
      const link = join(harness.files, "atalho");
      symlinkSync(folder, link);
      expect(await choose(link)).toEqual({ status: "notAFile" });
    }
  });

  it("o atalho para um arquivo comum é seguido, e o nome que volta é o do atalho escolhido", async () => {
    if (process.platform === "win32") return;
    const target = harness.file("real.csv", "a");
    const link = join(harness.files, "atalho.csv");
    symlinkSync(target, link);
    expect(await choose(link)).toMatchObject({ status: "chosen", fileName: "atalho.csv", size: 1 });
  });

  it("acima de 2 GiB: `tooLarge`, com o tamanho; até 2 GiB passa (o arquivo esparso não ocupa o disco)", async () => {
    const big = join(harness.files, "grande.csv");
    writeFileSync(big, "");
    truncateSync(big, maxImportBytes + 1);
    expect(await choose(big)).toEqual({ status: "tooLarge", size: maxImportBytes + 1 });

    const limit = setUp({ freeSpace: async () => Number.MAX_SAFE_INTEGER, copy: () => new Promise(() => {}) });
    const exact = join(limit.files, "limite.csv");
    writeFileSync(exact, "");
    truncateSync(exact, maxImportBytes);
    limit.answer(exact);
    expect(await limit.source.choose(1)).toMatchObject({ status: "chosen", size: maxImportBytes });
    rmSync(limit.root, { recursive: true, force: true });
  });

  it("o arquivo que sumiu entre o diálogo e a conferência: `unreadable`, com a frase do código do sistema, nunca o texto dele (que traz o caminho)", async () => {
    const reply = await choose(join(harness.files, "sumiu.csv"));
    expect(reply).toEqual({ status: "unreadable", message: "o arquivo não existe mais" });
  });

  it("as frases do motivo vêm do código: permissão, em uso, não existe, erro de disco e o resto com o código", () => {
    expect(unreadableReason("EACCES")).toBe("o sistema não dá permissão para ler o arquivo");
    expect(unreadableReason("EPERM")).toBe("o sistema não dá permissão para ler o arquivo");
    expect(unreadableReason("EBUSY")).toBe("o arquivo está em uso por outro programa");
    expect(unreadableReason("ENOENT")).toBe("o arquivo não existe mais");
    expect(unreadableReason("EIO")).toBe("o disco deu erro de leitura");
    expect(unreadableReason("EMFILE")).toBe("erro EMFILE");
    expect(copyFailureMessage("diskFull", "ENOSPC")).toBe("Não há espaço na pasta de dados do Prism para copiar o arquivo.");
    expect(copyFailureMessage("tooLarge", undefined)).toBe("O arquivo passou de 2 GB durante a cópia.");
    expect(copyFailureMessage("unreadable", "EIO")).toBe("Não foi possível ler o arquivo: o disco deu erro de leitura.");
    expect(copyFailureMessage("other", "EXDEV")).toBe("Não foi possível copiar o arquivo (EXDEV).");
  });

  it("a pasta de dados que não aceita gravação: `notWritable` (aqui, `transfers` é um arquivo, e a pasta não se cria)", async () => {
    rmSync(join(harness.dataDir, "transfers"), { recursive: true });
    writeFileSync(join(harness.dataDir, "transfers"), "");
    expect(await choose(harness.file("pedidos.csv", "a"))).toEqual({ status: "notWritable" });
  });

  it("a pasta `transfers` que alguém apagou com o app aberto é criada de novo, no modo 0700, antes da prova de gravação, e a prova não fica", async () => {
    rmSync(join(harness.dataDir, "transfers"), { recursive: true });
    const reply = await choose(harness.file("pedidos.csv", "a"));
    expect(reply.status).toBe("chosen");
    if (process.platform !== "win32") expect(statSync(join(harness.dataDir, "transfers")).mode & 0o777).toBe(0o700);
    await settled(ids[0]);
    expect(readFileSync(join(harness.dataDir, "transfers", `${ids[0]}.in`), "utf8")).toBe("a");
  });

  it("sem espaço livre para o arquivo e mais 64 MiB: `noSpace`, com o tamanho preciso; nada é registrado", async () => {
    const tight = setUp({ freeSpace: async () => spareBytes + 9 });
    tight.answer(join(tight.files, "x.csv"));
    writeFileSync(join(tight.files, "x.csv"), "0123456789");
    expect(await tight.source.choose(1)).toEqual({ status: "noSpace", needed: 10 + spareBytes });
    expect(tight.source.status(1, { fileId: ids[0] })).toEqual({ status: "missing" });
    rmSync(tight.root, { recursive: true, force: true });
  });

  it("o espaço que o sistema não diz não impede a cópia", async () => {
    const unknown = setUp({ freeSpace: async () => null });
    writeFileSync(join(unknown.files, "x.csv"), "abc");
    unknown.answer(join(unknown.files, "x.csv"));
    expect((await unknown.source.choose(1)).status).toBe("chosen");
    rmSync(unknown.root, { recursive: true, force: true });
  });
});

describe("a cópia em segundo plano e a consulta (`prism:transfer-source-status`)", () => {
  function controlled() {
    const gate: { progress: (copied: number) => void; finish: () => void; fail: (error: unknown) => void; signal: AbortSignal | null; target: string | null } = {
      progress: () => {},
      finish: () => {},
      fail: () => {},
      signal: null,
      target: null,
    };
    const h = setUp({
      copy: (_from, to, signal, progress) =>
        new Promise<void>((resolve, reject) => {
          writeFileSync(to, "parcial");
          gate.target = to;
          gate.signal = signal;
          gate.progress = progress;
          gate.finish = resolve;
          gate.fail = reject;
          signal.addEventListener("abort", () => reject(new Error("interrompida")));
        }),
    });
    return { h, gate };
  }

  it("enquanto copia: `copying`, com o copiado e o tamanho; no fim, `ready`; o log leva o identificador, o tamanho e a duração, nunca o nome nem o caminho", async () => {
    const { h, gate } = controlled();
    writeFileSync(join(h.files, "pedidos.csv"), "0123456789");
    h.answer(join(h.files, "pedidos.csv"));
    await h.source.choose(1);
    gate.progress(4);
    expect(sourceStatusSchema.parse(h.source.status(1, { fileId: ids[0] }))).toEqual({ status: "copying", copied: 4, size: 10 });
    gate.progress(10);
    gate.finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.source.status(1, { fileId: ids[0] })).toEqual({ status: "ready" });
    expect(existsSync(join(h.dataDir, "transfers", `${ids[0]}.in`))).toBe(true);
    expect(h.logs.join("\n")).toContain(ids[0]);
    expect(h.logs.join("\n")).not.toMatch(/pedidos|arquivos/);
    rmSync(h.root, { recursive: true, force: true });
  });

  it("o arquivo é da janela que o escolheu: a consulta de outra janela, ou com um identificador que não se conhece, responde `missing`", async () => {
    await choose(harness.file("pedidos.csv", "a"));
    expect(harness.source.status(2, { fileId: ids[0] })).toEqual({ status: "missing" });
    expect(harness.source.status(1, { fileId: ids[3] })).toEqual({ status: "missing" });
  });

  it("o pedido fora da forma (um caminho, o identificador em maiúsculas, um campo a mais) é recusado antes de virar nome de arquivo", () => {
    expect(() => harness.source.status(1, { fileId: "../../cofre" })).toThrow();
    expect(() => harness.source.status(1, { fileId: ids[0].toUpperCase() })).toThrow();
    expect(() => harness.source.status(1, { fileId: ids[0], path: "/etc" })).toThrow();
  });

  it("a cópia que falha na leitura: `failed` com `unreadable` e a frase; a cópia pela metade é apagada", async () => {
    const h = setUp({ copy: async (_from, to) => {
      writeFileSync(to, "meio");
      throw new SideError("read", "EIO");
    } });
    writeFileSync(join(h.files, "a.csv"), "x");
    h.answer(join(h.files, "a.csv"));
    await h.source.choose(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.source.status(1, { fileId: ids[0] })).toEqual({ status: "failed", reason: "unreadable", message: "Não foi possível ler o arquivo: o disco deu erro de leitura." });
    expect(existsSync(join(h.dataDir, "transfers", `${ids[0]}.in.part`))).toBe(false);
    rmSync(h.root, { recursive: true, force: true });
  });

  it("o disco cheio na gravação é `diskFull`; o arquivo que passou de 2 GiB no meio, `tooLarge`; o resto, `other` com o código", async () => {
    const cases: [unknown, string, string][] = [
      [new SideError("write", "ENOSPC"), "diskFull", "Não há espaço na pasta de dados do Prism para copiar o arquivo."],
      [new SideError("size", undefined), "tooLarge", "O arquivo passou de 2 GB durante a cópia."],
      [Object.assign(new Error("x"), { code: "EROFS" }), "other", "Não foi possível copiar o arquivo (EROFS)."],
    ];
    for (const [error, reason, message] of cases) {
      const h = setUp({ copy: async () => Promise.reject(error) });
      writeFileSync(join(h.files, "a.csv"), "x");
      h.answer(join(h.files, "a.csv"));
      await h.source.choose(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.source.status(1, { fileId: ids[0] })).toEqual({ status: "failed", reason, message });
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("a cópia de verdade leva um arquivo de 3 MiB inteiro, em vários pedaços", async () => {
    const content = Buffer.alloc(3 * 1024 * 1024 + 7, 0x61);
    const path = join(harness.files, "grande.csv");
    writeFileSync(path, content);
    await choose(path);
    expect(await settled(ids[0])).toEqual({ status: "ready" });
    expect(statSync(join(harness.dataDir, "transfers", `${ids[0]}.in`)).size).toBe(content.length);
  });

  it("a cópia de verdade para ao passar do teto (o arquivo que cresceu depois da conferência): `tooLarge`, sem a cópia pela metade", async () => {
    // O teto de 2 GiB não se testa com 2 GiB: a mesma cópia, com um teto de 1 MiB, recebe um arquivo de 3 MiB que a conferência do tamanho deixou passar.
    const h = setUp({ copy: (from, to, signal, progress) => defaultCopy(from, to, signal, progress, 1024 * 1024) });
    writeFileSync(join(h.files, "cresceu.csv"), Buffer.alloc(3 * 1024 * 1024, 0x61));
    h.answer(join(h.files, "cresceu.csv"));
    expect(await h.source.choose(1)).toMatchObject({ status: "chosen" });
    let status = h.source.status(1, { fileId: ids[0] });
    for (let attempt = 0; attempt < 200 && status.status === "copying"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      status = h.source.status(1, { fileId: ids[0] });
    }
    expect(status).toEqual({ status: "failed", reason: "tooLarge", message: "O arquivo passou de 2 GB durante a cópia." });
    expect(existsSync(join(h.dataDir, "transfers", `${ids[0]}.in.part`))).toBe(false);
    expect(existsSync(join(h.dataDir, "transfers", `${ids[0]}.in`))).toBe(false);
    rmSync(h.root, { recursive: true, force: true });
  });
});

describe("soltar o arquivo (`prism:transfer-source-release`), a janela que fecha e a saída", () => {
  it("soltar no meio da cópia interrompe a cópia, apaga o `.in.part` e esquece o arquivo", async () => {
    let signal: AbortSignal | null = null;
    const h = setUp({
      copy: (_from, to, abort) =>
        new Promise<void>((_resolve, reject) => {
          writeFileSync(to, "meio");
          signal = abort;
          abort.addEventListener("abort", () => reject(new Error("interrompida")));
        }),
    });
    writeFileSync(join(h.files, "a.csv"), "x");
    h.answer(join(h.files, "a.csv"));
    await h.source.choose(1);
    await h.source.release(1, { fileId: ids[0] });
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(existsSync(join(h.dataDir, "transfers", `${ids[0]}.in.part`))).toBe(false);
    expect(h.source.status(1, { fileId: ids[0] })).toEqual({ status: "missing" });
    rmSync(h.root, { recursive: true, force: true });
  });

  it("soltar depois da cópia apaga o `.in` que a API ainda não tomou; o que ela tomou (renomeado) não é achado e fica", async () => {
    await choose(harness.file("a.csv", "x"));
    await settled(ids[0]);
    await harness.source.release(1, { fileId: ids[0] });
    expect(existsSync(join(harness.dataDir, "transfers", `${ids[0]}.in`))).toBe(false);

    await choose(harness.file("b.csv", "y"));
    await settled(ids[1]);
    const taken = join(harness.dataDir, "transfers", `${ids[3]}.in`);
    // A API tomou o arquivo: renomeado para o identificador do trabalho.
    writeFileSync(taken, readFileSync(join(harness.dataDir, "transfers", `${ids[1]}.in`)));
    rmSync(join(harness.dataDir, "transfers", `${ids[1]}.in`));
    await harness.source.release(1, { fileId: ids[1] });
    expect(existsSync(taken)).toBe(true);
  });

  it("soltar o arquivo de outra janela não faz nada", async () => {
    await choose(harness.file("a.csv", "x"));
    await settled(ids[0]);
    await harness.source.release(2, { fileId: ids[0] });
    expect(existsSync(join(harness.dataDir, "transfers", `${ids[0]}.in`))).toBe(true);
    expect(harness.source.status(1, { fileId: ids[0] })).toEqual({ status: "ready" });
  });

  it("a janela que recarrega, cai ou fecha solta só os arquivos dela; a saída e o reinício do serviço soltam todos", async () => {
    await choose(harness.file("a.csv", "x"), 1);
    await choose(harness.file("b.csv", "y"), 2);
    await settled(ids[0], 1);
    await settled(ids[1], 2);
    await harness.source.releaseWindow(1);
    expect(harness.source.status(1, { fileId: ids[0] })).toEqual({ status: "missing" });
    expect(harness.source.status(2, { fileId: ids[1] })).toEqual({ status: "ready" });
    await harness.source.releaseAll();
    expect(harness.source.status(2, { fileId: ids[1] })).toEqual({ status: "missing" });
    expect(existsSync(join(harness.dataDir, "transfers", `${ids[1]}.in`))).toBe(false);
  });

  it("o diálogo de abrir que volta depois de a janela ser solta (ela recarregou com ele aberto) responde `canceled`, sem registrar nem copiar", async () => {
    const path = harness.file("a.csv", "x");
    let answer: (path: string | null) => void = () => {};
    const h = setUp({ showOpenDialog: () => new Promise((resolve) => (answer = resolve)) });
    const pending = h.source.choose(1);
    await h.source.releaseWindow(1);
    answer(path);
    expect(await pending).toEqual({ status: "canceled" });
    expect(h.source.status(1, { fileId: ids[0] })).toEqual({ status: "missing" });
    rmSync(h.root, { recursive: true, force: true });
  });
});
