import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTransferDesk, type TransferDeskDeps } from "./transfer-desk";

const jobId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherJobId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

type Harness = {
  root: string;
  dataDir: string;
  downloads: string;
  dialogs: { windowId: number; defaultPath: string; filters: { name: string; extensions: string[] }[] }[];
  answer: (path: string | null) => void;
  clipboard: string[];
  revealed: string[];
  logs: string[];
  desk: ReturnType<typeof createTransferDesk>;
  ready: (id: string, content: string) => string;
};

let harness: Harness;

function setUp(overrides: Partial<TransferDeskDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "prism-transfer-"));
  const dataDir = join(root, "dados");
  const downloads = join(root, "Downloads");
  mkdirSync(join(dataDir, "transfers"), { recursive: true });
  mkdirSync(downloads);
  let next: string | null = null;
  let counter = 0;
  const h: Harness = {
    root,
    dataDir,
    downloads,
    dialogs: [],
    answer: (path) => (next = path),
    clipboard: [],
    revealed: [],
    logs: [],
    desk: null as never,
    ready(id, content) {
      const file = join(dataDir, "transfers", `${id}.ready`);
      writeFileSync(file, content);
      return file;
    },
  };
  h.desk = createTransferDesk({
    dataDir,
    downloadsDir: () => downloads,
    platform: "linux",
    async showSaveDialog(windowId, options) {
      h.dialogs.push({ windowId, ...options });
      return next;
    },
    writeClipboard: (text) => h.clipboard.push(text),
    reveal: (path) => h.revealed.push(path),
    log: (message) => h.logs.push(message),
    randomId: () => `id-${++counter}`,
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

async function choose(path: string | null, request: unknown = { suggestedName: "pedido_2026-10-16_143005", extension: "csv" }, windowId = 1) {
  harness.answer(path);
  return harness.desk.chooseDestination(windowId, request);
}

describe("escolher o destino (RN-EXPORT-019): o processo principal abre o diálogo de salvar e guarda o caminho", () => {
  it("o nome proposto é conferido de novo pelas regras de nome, e só ele vai ao diálogo, na pasta de Downloads, com o filtro que o processo principal escreve", async () => {
    await choose(null, { suggestedName: `a/b${String.fromCharCode(0x202e)}c`, extension: "md" });

    expect(harness.dialogs).toEqual([
      {
        windowId: 1,
        defaultPath: join(harness.downloads, "a_bc.md"),
        filters: [
          { name: "Markdown (*.md)", extensions: ["md"] },
          { name: "Todos os arquivos", extensions: ["*"] },
        ],
      },
    ]);
  });

  it("desistir do diálogo responde `canceled`, e nada fica reservado", async () => {
    expect(await choose(null)).toEqual({ status: "canceled" });
  });

  it("escolhido, a tela recebe um identificador e o nome do arquivo, nunca a pasta; o próximo diálogo abre na pasta da última exportação", async () => {
    const folder = join(harness.root, "relatorios");
    mkdirSync(folder);

    const reply = await choose(join(folder, "pedidos.csv"));
    expect(reply).toEqual({ status: "chosen", destinationId: "id-2", fileName: "pedidos.csv" });
    expect(JSON.stringify(reply)).not.toContain(harness.root);

    await choose(null);
    expect(harness.dialogs[1].defaultPath).toBe(join(folder, "pedido_2026-10-16_143005.csv"));
  });

  it("o nome escolhido sem extensão ganha a do formato", async () => {
    expect(await choose(join(harness.downloads, "pedidos"), { suggestedName: "x", extension: "json" })).toMatchObject({ status: "chosen", fileName: "pedidos.json" });
  });

  it("a janela que fecha, recarrega ou cai com o diálogo aberto não registra o destino que ele devolve: ninguém o soltaria", async () => {
    const answers = new Map<number, (path: string | null) => void>();
    rmSync(harness.root, { recursive: true, force: true });
    harness = setUp({ showSaveDialog: (windowId) => new Promise((resolve) => answers.set(windowId, resolve)) });
    const request = { suggestedName: "pedidos", extension: "csv" };

    const closed = harness.desk.chooseDestination(7, request);
    const reloaded = harness.desk.chooseDestination(9, request);
    const live = harness.desk.chooseDestination(8, request);
    await harness.desk.windowClosed(7);
    await harness.desk.releaseWindow(9);
    answers.get(7)?.(join(harness.downloads, "pedidos.csv"));
    answers.get(9)?.(join(harness.downloads, "outro.csv"));

    expect(await closed).toEqual({ status: "canceled" });
    expect(await reloaded).toEqual({ status: "canceled" });
    answers.get(8)?.(join(harness.downloads, "pedidos.csv"));
    expect(await live).toMatchObject({ status: "chosen", fileName: "pedidos.csv" });
  });

  it("a pasta que não existe, ou que não aceita gravação, é `notWritable`; a prova não deixa arquivo nenhum para trás", async () => {
    expect(await choose(join(harness.root, "sumiu", "pedidos.csv"))).toEqual({ status: "notWritable" });
    expect(await choose(join(harness.downloads, "pedidos.csv"))).toMatchObject({ status: "chosen" });
    expect(readdirSync(harness.downloads)).toEqual([]);
  });

  it("dentro da pasta de dados do Prism (os cofres, `transfers`), também por um atalho simbólico, é `notWritable`: a exportação nunca grava por cima de um cofre", async () => {
    expect(await choose(join(harness.dataDir, "usuario.vault"))).toEqual({ status: "notWritable" });
    expect(await choose(join(harness.dataDir, "transfers", `${jobId}.ready`))).toEqual({ status: "notWritable" });

    const link = join(harness.root, "atalho");
    symlinkSync(harness.dataDir, link);
    expect(await choose(join(link, "usuario.vault"))).toEqual({ status: "notWritable" });
  });

  it("o arquivo que outra exportação ainda não entregue vai gravar é `inUse`, comparado pelo caminho resolvido; sem diferenciar maiúsculas no Windows e no macOS", async () => {
    expect(await choose(join(harness.downloads, "pedidos.csv"))).toMatchObject({ status: "chosen" });
    expect(await choose(join(harness.downloads, "pedidos.csv"), undefined, 2)).toEqual({ status: "inUse" });
    expect(await choose(join(harness.downloads, "PEDIDOS.csv"))).toMatchObject({ status: "chosen" });

    rmSync(harness.root, { recursive: true, force: true });
    harness = setUp({ platform: "win32" });
    expect(await choose(join(harness.downloads, "pedidos.csv"))).toMatchObject({ status: "chosen" });
    expect(await choose(join(harness.downloads, "PEDIDOS.csv"))).toEqual({ status: "inUse" });
  });

  it("o pedido fora do formato é recusado sem abrir o diálogo: nome vazio ou acima de 200, extensão fora da lista, um caminho a mais", async () => {
    for (const request of [{ suggestedName: "", extension: "csv" }, { suggestedName: "x".repeat(201), extension: "csv" }, { suggestedName: "x", extension: "exe" }, { suggestedName: "x", extension: "csv", path: "/tmp" }, "x"]) {
      await expect(choose(join(harness.downloads, "a.csv"), request)).rejects.toThrow();
    }
    expect(harness.dialogs).toEqual([]);
  });
});

describe("entregar (RN-EXPORT-020): o arquivo pronto, achado só pelo identificador do trabalho, vai para o destino", () => {
  async function chosen(path = join(harness.downloads, "pedidos.csv"), windowId = 1): Promise<string> {
    const reply = await choose(path, undefined, windowId);
    if (reply.status !== "chosen") throw new Error(reply.status);
    return reply.destinationId;
  }

  it("na mesma unidade, renomeia: o arquivo chega inteiro, o pronto sai de `transfers`, e o log não leva caminho nem nome", async () => {
    const destinationId = await chosen();
    const ready = harness.ready(jobId, "id;nome\r\n1;Ana\r\n");

    const reply = await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false });

    expect(reply).toEqual({ status: "delivered", deliveryId: "id-3", fileName: "pedidos.csv" });
    expect(readFileSync(join(harness.downloads, "pedidos.csv"), "utf8")).toBe("id;nome\r\n1;Ana\r\n");
    expect(existsSync(ready)).toBe(false);
    expect(harness.revealed).toEqual([]);
    expect(harness.logs.join("\n")).not.toMatch(/pedidos|Downloads|dados/);
    expect(harness.logs.join("\n")).toContain(jobId);
  });

  it("com `reveal`, o gerenciador de arquivos abre no arquivo gravado; e o destino só vale uma vez", async () => {
    const destinationId = await chosen();
    harness.ready(jobId, "x");

    await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: true });
    expect(harness.revealed).toEqual([join(harness.downloads, "pedidos.csv")]);

    harness.ready(otherJobId, "y");
    expect(await harness.desk.deliver(1, { transferId: otherJobId, destinationId, reveal: false })).toEqual({ status: "canceled" });
  });

  it("o gerenciador de arquivos que não abre não vira falha da entrega: o arquivo já está no destino", async () => {
    rmSync(harness.root, { recursive: true, force: true });
    harness = setUp({
      reveal: () => {
        throw new Error("sem gerenciador de arquivos");
      },
    });
    const destinationId = await chosen();
    harness.ready(jobId, "x");

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: true })).toMatchObject({ status: "delivered", fileName: "pedidos.csv" });
    expect(readFileSync(join(harness.downloads, "pedidos.csv"), "utf8")).toBe("x");
  });

  it.skipIf(process.platform === "win32")("o arquivo entregue por renomeação ganha o modo de um arquivo novo da pasta, e não o 0600 do temporário da API", async () => {
    const destinationId = await chosen();
    chmodSync(harness.ready(jobId, "x"), 0o600);
    const fresh = join(harness.root, "novo.txt");
    writeFileSync(fresh, "");

    await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false });

    expect(statSync(join(harness.downloads, "pedidos.csv")).mode & 0o777).toBe(statSync(fresh).mode & 0o777);
  });

  it("o destino é da janela que o pediu: outra janela é recusada", async () => {
    const destinationId = await chosen();
    harness.ready(jobId, "x");

    await expect(harness.desk.deliver(2, { transferId: jobId, destinationId, reveal: false })).rejects.toThrow();
  });

  it("o identificador do trabalho tem de ter a forma de um `Guid` em minúsculas antes de virar nome de arquivo", async () => {
    const destinationId = await chosen();
    for (const transferId of ["../dados/usuario", jobId.toUpperCase(), `${jobId}.ready`, "", jobId.slice(1)]) {
      await expect(harness.desk.deliver(1, { transferId, destinationId, reveal: false })).rejects.toThrow();
    }
  });

  it("sem o arquivo pronto (o trabalho esquecido, abandonado, a API que reiniciou) é `missing`, e o destino é solto", async () => {
    const destinationId = await chosen();

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).toEqual({ status: "missing" });
    expect(await choose(join(harness.downloads, "pedidos.csv"))).toMatchObject({ status: "chosen" });
  });

  it("o arquivo que não existia ao escolher e apareceu até a entrega não é substituído: vai como `nome (2).ext`, o primeiro livre", async () => {
    const destinationId = await chosen();
    writeFileSync(join(harness.downloads, "pedidos.csv"), "de outra pessoa");
    writeFileSync(join(harness.downloads, "pedidos (2).csv"), "outro");
    harness.ready(jobId, "novo");

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).toMatchObject({ status: "delivered", fileName: "pedidos (3).csv" });
    expect(readFileSync(join(harness.downloads, "pedidos.csv"), "utf8")).toBe("de outra pessoa");
    expect(readFileSync(join(harness.downloads, "pedidos (3).csv"), "utf8")).toBe("novo");
  });

  it("o nome escolhido sem extensão: o `nome.ext` que já existia não é substituído, porque o diálogo do sistema perguntou só pelo nome sem ela", async () => {
    writeFileSync(join(harness.downloads, "pedido.csv"), "ARQUIVO IMPORTANTE");
    const destinationId = await chosen(join(harness.downloads, "pedido"));
    harness.ready(jobId, "novo");

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).toMatchObject({ status: "delivered", fileName: "pedido (2).csv" });
    expect(readFileSync(join(harness.downloads, "pedido.csv"), "utf8")).toBe("ARQUIVO IMPORTANTE");
    expect(readFileSync(join(harness.downloads, "pedido (2).csv"), "utf8")).toBe("novo");
  });

  it("o que já existia ao escolher a pessoa mandou substituir no diálogo do sistema: é substituído", async () => {
    writeFileSync(join(harness.downloads, "pedidos.csv"), "velho");
    const destinationId = await chosen();
    harness.ready(jobId, "novo");

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).toMatchObject({ status: "delivered", fileName: "pedidos.csv" });
    expect(readFileSync(join(harness.downloads, "pedidos.csv"), "utf8")).toBe("novo");
  });

  it("em outra unidade (`EXDEV`), copia em fluxo para um arquivo escondido ao lado e só no fim lhe dá o nome; o pronto sai de `transfers`", async () => {
    rmSync(harness.root, { recursive: true, force: true });
    harness = setUp({ move: async () => Promise.reject(Object.assign(new Error("cross-device"), { code: "EXDEV" })) });
    const destinationId = await chosen();
    const ready = harness.ready(jobId, "a".repeat(200_000));

    expect(await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).toMatchObject({ status: "delivered" });
    expect(readFileSync(join(harness.downloads, "pedidos.csv"), "utf8")).toHaveLength(200_000);
    expect(readdirSync(harness.downloads)).toEqual(["pedidos.csv"]);
    expect(existsSync(ready)).toBe(false);
  });

  it("cancelar durante a cópia entre unidades (`release`): a cópia para, a escondida é apagada, nada fica no destino, e a entrega responde `canceled`", async () => {
    let started = () => {};
    const copying = new Promise<void>((resolve) => (started = resolve));
    rmSync(harness.root, { recursive: true, force: true });
    harness = setUp({
      move: async () => Promise.reject(Object.assign(new Error("cross-device"), { code: "EXDEV" })),
      copy: (_from, to, signal) =>
        new Promise((_resolve, reject) => {
          writeFileSync(to, "pela metade");
          started();
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    });
    const destinationId = await chosen();
    const ready = harness.ready(jobId, "conteúdo");

    const delivery = harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: true });
    await copying;
    expect(readdirSync(harness.downloads)).toEqual([".pedidos.csv.0f8fad5b.part"]);

    await harness.desk.release(1, { destinationId });

    expect(await delivery).toEqual({ status: "canceled" });
    expect(readdirSync(harness.downloads)).toEqual([]);
    expect(existsSync(ready)).toBe(true);
    expect(harness.revealed).toEqual([]);
  });

  it("a entrega que falha não perde a exportação: o pronto fica em `transfers`, o destino continua reservado até a tela soltá-lo, e o motivo vem sem caminho", async () => {
    const folder = join(harness.root, "rede");
    mkdirSync(folder);
    const destinationId = await chosen(join(folder, "pedidos.csv"));
    rmSync(folder, { recursive: true });
    const ready = harness.ready(jobId, "x");

    const reply = await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false });

    expect(reply).toEqual({ status: "failed", reason: "folderMissing", message: "a pasta escolhida não existe mais" });
    expect(existsSync(ready)).toBe(true);
    // Reservado: escolher o mesmo arquivo de novo (a pasta voltou) é `inUse`, até o "Salvar como…" soltar o destino que falhou.
    mkdirSync(folder);
    expect(await choose(join(folder, "pedidos.csv"))).toEqual({ status: "inUse" });
    await harness.desk.release(1, { destinationId });
    expect(await choose(join(folder, "pedidos.csv"))).toMatchObject({ status: "chosen" });
  });

  it("o destino que falhou não se usa de novo: a nova entrega pede outro destino", async () => {
    const folder = join(harness.root, "rede");
    mkdirSync(folder);
    const destinationId = await chosen(join(folder, "pedidos.csv"));
    rmSync(folder, { recursive: true });
    harness.ready(jobId, "x");
    await harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false });

    await expect(harness.desk.deliver(1, { transferId: jobId, destinationId, reveal: false })).rejects.toThrow();
  });
});

describe("a área de transferência, o \"Mostrar na pasta\" e soltar os destinos", () => {
  it("`prism:transfer-copy`: o texto pronto vai para a área de transferência, até 10 MiB; acima disso `tooLarge`; sem o pronto, `missing`", async () => {
    harness.ready(jobId, "id;nome\r\n1;Ana\r\n");
    expect(await harness.desk.copy({ transferId: jobId })).toEqual({ status: "copied" });
    expect(harness.clipboard).toEqual(["id;nome\r\n1;Ana\r\n"]);

    harness.ready(otherJobId, "a".repeat(10 * 1024 * 1024 + 1));
    expect(await harness.desk.copy({ transferId: otherJobId })).toEqual({ status: "tooLarge" });
    expect(await harness.desk.copy({ transferId: "7c9e6679-7425-40de-944b-e07fc1f90ae8" })).toEqual({ status: "missing" });
    await expect(harness.desk.copy({ transferId: "../x" })).rejects.toThrow();
    expect(harness.clipboard).toHaveLength(1);
  });

  it("`prism:transfer-reveal` só mostra o arquivo que este processo gravou, e só na janela que pediu a entrega", async () => {
    const reply = await choose(join(harness.downloads, "pedidos.csv"));
    if (reply.status !== "chosen") throw new Error(reply.status);
    harness.ready(jobId, "x");
    const delivered = await harness.desk.deliver(1, { transferId: jobId, destinationId: reply.destinationId, reveal: false });
    if (delivered.status !== "delivered") throw new Error(delivered.status);

    harness.desk.reveal(1, { deliveryId: delivered.deliveryId });
    expect(harness.revealed).toEqual([join(harness.downloads, "pedidos.csv")]);
    expect(() => harness.desk.reveal(2, { deliveryId: delivered.deliveryId })).toThrow();
    harness.desk.reveal(1, { deliveryId: "não existe" });
    expect(harness.revealed).toHaveLength(1);

    // A janela que fechou leva as entregas dela.
    await harness.desk.windowClosed(1);
    harness.desk.reveal(1, { deliveryId: delivered.deliveryId });
    expect(harness.revealed).toHaveLength(1);
  });

  it("soltar um destino de outra janela é recusado; a janela que recarrega ou fecha, e a saída do app, soltam os destinos delas", async () => {
    const first = await choose(join(harness.downloads, "a.csv"), undefined, 1);
    const second = await choose(join(harness.downloads, "b.csv"), undefined, 2);
    if (first.status !== "chosen" || second.status !== "chosen") throw new Error("não escolhidos");

    await expect(harness.desk.release(2, { destinationId: first.destinationId })).rejects.toThrow();

    await harness.desk.releaseWindow(1);
    expect(await choose(join(harness.downloads, "a.csv"), undefined, 3)).toMatchObject({ status: "chosen" });
    expect(await choose(join(harness.downloads, "b.csv"), undefined, 3)).toEqual({ status: "inUse" });

    await harness.desk.releaseAll();
    expect(await choose(join(harness.downloads, "b.csv"), undefined, 3)).toMatchObject({ status: "chosen" });
    expect(basename(harness.desk.transfersDir)).toBe("transfers");
  });
});
