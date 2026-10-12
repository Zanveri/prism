import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { downloadFile, fetchText, sha256OfFile } from "./download";
import { fakeHttp, type FakeStep } from "./http.fake";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const bytes = (text: string) => new TextEncoder().encode(text);

const origin = { api: "https://api.github.com", site: "https://github.com", repository: "Zanveri/prism" };
const url = "https://api.github.com/repos/Zanveri/prism/releases?per_page=100";

describe("fetchText: a consulta (prazo, teto de tamanho, sem seguir redirecionamento)", () => {
  it("devolve o texto de um 200", async () => {
    const { http } = fakeHttp({ [url]: { chunks: [bytes('[{"tag_'), bytes('name":"v0.2.0"}]')] } });

    await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false })).resolves.toBe('[{"tag_name":"v0.2.0"}]');
  });

  it("resposta que não é 200 falha com o código", async () => {
    for (const status of [204, 301, 401, 404, 500]) {
      const { http } = fakeHttp({ [url]: { status } });

      await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false })).rejects.toThrow(new RegExp(String(status)));
    }
  });

  it("passou do teto, para de ler e falha", async () => {
    const { http } = fakeHttp({ [url]: { chunks: [new Uint8Array(600), new Uint8Array(600), new Uint8Array(600)] } });

    await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false })).rejects.toThrow(/grande/);
  });

  it("tamanho declarado acima do teto falha antes de ler", async () => {
    const { http } = fakeHttp({ [url]: { headers: { "content-length": "5000" }, chunks: [new Uint8Array(10)] } });

    await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false })).rejects.toThrow(/grande/);
  });

  it("sem resposta no prazo, falha", async () => {
    const { http } = fakeHttp({ [url]: { hang: true } });

    await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 50, redirects: false })).rejects.toThrow(/prazo/);
  });

  it("cancelado por quem chamou, para antes do prazo", async () => {
    const controller = new AbortController();
    const { http } = fakeHttp({ [url]: { hang: true } });
    const pending = fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 60_000, redirects: false, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/cancelado/i);
  });

  it("a consulta não segue redirecionamento, nem para https", async () => {
    const { http, requested } = fakeHttp({ [url]: { redirect: "https://outro.example.invalid/releases" }, "https://outro.example.invalid/releases": { chunks: [bytes("[]")] } });

    const failure = fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false });
    // A frase é a da consulta, que não segue nenhum: o "só para https" é do download.
    await expect(failure).rejects.toThrow("O servidor respondeu com um redirecionamento, e a consulta às versões não segue redirecionamento.");
    expect(requested).toEqual([url]);
  });

  it("falha de rede sai como falha, com a causa", async () => {
    const { http } = fakeHttp({});

    await expect(fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false })).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
  });

  it("os cabeçalhos pedidos chegam ao transporte (os da API do GitHub, na consulta); sem pedido, nenhum", async () => {
    const { http, requests } = fakeHttp({ [url]: { chunks: [bytes("[]")] } });
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

    await fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false, headers });
    await fetchText(http, url, { origin, maxBytes: 1000, timeoutMs: 1000, redirects: false });

    expect(requests.map((request) => request.headers)).toEqual([headers, {}]);
  });
});

describe("downloadFile: o pacote (RN-ATUALIZA-005)", () => {
  const file = "https://github.com/Zanveri/prism/releases/download/v0.2.0/Prism-0.2.0-win-x64.exe";
  // O GitHub responde o download de um arquivo de release com um redirecionamento para outro domínio, onde o arquivo está.
  const storage = "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r&sig=assinatura";
  const content = [bytes("MZ instalador "), bytes("de mentira "), bytes("fim")];
  const whole = Buffer.concat(content);
  let dir: string;
  let destination: string;
  const options = (overrides: Partial<Parameters<typeof downloadFile>[3]> = {}) => ({ origin, maxBytes: 1000, stallMs: 1000, signal: new AbortController().signal, onProgress: () => {}, ...overrides });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prism-download-"));
    destination = join(dir, "pacote.part");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("grava o arquivo, devolve a soma SHA-256 do que gravou e avisa o progresso", async () => {
    const { http } = fakeHttp({ [file]: { headers: { "content-length": String(whole.length) }, chunks: content } });
    const progress: Array<[number, number | null]> = [];

    const result = await downloadFile(http, file, destination, options({ onProgress: (received, total) => progress.push([received, total]) }));

    expect(result).toEqual({ sha256: sha256(whole), bytes: whole.length });
    expect(readFileSync(destination)).toEqual(whole);
    expect(progress.at(-1)).toEqual([whole.length, whole.length]);
    expect(progress.length).toBe(3);
  });

  it("sem tamanho declarado, baixa e o total do progresso é desconhecido", async () => {
    const { http } = fakeHttp({ [file]: { chunks: content } });
    const totals = new Set<number | null>();

    await downloadFile(http, file, destination, options({ onProgress: (_, total) => totals.add(total) }));

    expect([...totals]).toEqual([null]);
  });

  it("segue o redirecionamento para https (o GitHub manda o download para outro domínio)", async () => {
    const { http, requested } = fakeHttp({ [file]: { redirect: storage }, [storage]: { chunks: content } });

    await expect(downloadFile(http, file, destination, options())).resolves.toMatchObject({ bytes: whole.length });
    expect(requested).toEqual([file, storage]);
  });

  it("redirecionamento para http é recusado, e nada é pedido lá", async () => {
    const target = "http://release-assets.githubusercontent.com/objeto";
    const { http, requested } = fakeHttp({ [file]: { redirect: target }, [target]: { chunks: content } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/redirecionamento/i);
    expect(requested).toEqual([file]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("mais de cinco redirecionamentos seguidos: recusa", async () => {
    const hops = Array.from({ length: 7 }, (_, index) => `https://release-assets.githubusercontent.com/${index}`);
    const routes: Record<string, FakeStep> = { [file]: { redirect: hops[0] } };
    hops.forEach((hop, index) => (routes[hop] = index === hops.length - 1 ? { chunks: content } : { redirect: hops[index + 1] }));
    const { http, requested } = fakeHttp(routes);

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/redirecionamento/i);
    expect(requested.length).toBe(6);
  });

  it("resposta que não é 200 falha com o código, sem arquivo", async () => {
    const { http } = fakeHttp({ [file]: { status: 404, chunks: [bytes("não achei")] } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/404/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("tamanho declarado acima do teto: recusa antes de gravar", async () => {
    const { http } = fakeHttp({ [file]: { headers: { "content-length": "1001" }, chunks: content } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/grande/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("tamanho declarado que não é um número: recusa", async () => {
    for (const declared of ["abc", "-5", "1e3", "12 34", ""]) {
      const { http } = fakeHttp({ [file]: { headers: { "content-length": declared }, chunks: content } });

      await expect(downloadFile(http, file, destination, options()), declared).rejects.toThrow(/tamanho/i);
    }
  });

  it("sem tamanho declarado, passou do teto durante a leitura: para, recusa e apaga", async () => {
    const { http } = fakeHttp({ [file]: { chunks: [new Uint8Array(600), new Uint8Array(600), new Uint8Array(600)] } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/grande/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("veio mais do que o declarado: recusa e apaga", async () => {
    const { http } = fakeHttp({ [file]: { headers: { "content-length": "5" }, chunks: content } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/tamanho/i);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("veio menos do que o declarado: recusa e apaga", async () => {
    const { http } = fakeHttp({ [file]: { headers: { "content-length": String(whole.length + 10) }, chunks: content } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/tamanho/i);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a conexão cai no meio: falha e apaga o que tinha gravado", async () => {
    const { http } = fakeHttp({ [file]: { chunks: content, failAfter: 1 } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow(/ERR_CONNECTION_RESET/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("cancelado no meio: para, e o arquivo parcial some", async () => {
    const controller = new AbortController();
    const { http } = fakeHttp({ [file]: { chunks: content, hang: true } });

    const pending = downloadFile(http, file, destination, options({ signal: controller.signal, onProgress: (received) => received === whole.length && controller.abort() }));

    await expect(pending).rejects.toThrow(/cancelado/i);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("parou de chegar dado: desiste depois do prazo, e apaga", async () => {
    const { http } = fakeHttp({ [file]: { chunks: [content[0]], hang: true } });

    await expect(downloadFile(http, file, destination, options({ stallMs: 50 }))).rejects.toThrow(/prazo/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("não grava por cima de um arquivo que já existe no lugar do temporário", async () => {
    writeFileSync(destination, "já estava aqui");
    const { http } = fakeHttp({ [file]: { chunks: content } });

    await expect(downloadFile(http, file, destination, options())).rejects.toThrow();
    expect(readFileSync(destination, "utf8")).toBe("já estava aqui");
  });
});

describe("sha256OfFile", () => {
  it("a soma do arquivo como está no disco, em minúsculas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-sha-"));
    const file = join(dir, "x.bin");
    writeFileSync(file, "abc");

    await expect(sha256OfFile(file)).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(file)).toBe(false);
  });
});
