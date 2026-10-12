import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiExitMessage, closeVaultAndStop, parseReadyLine, startApi, type ApiProcess } from "./api-process";

// O `spawn` é o de verdade; o espião só deixa o teste alcançar o processo filho que o
// `startApi` criou, para conferir que ele foi mesmo encerrado.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const idle = "setInterval(() => {}, 1000);";
const announce = `console.log("Building..."); console.log("PRISM_API_READY 51234"); ${idle}`;

let dataDir: string;
const started: ApiProcess[] = [];

/** Um processo filho falso: o próprio Node rodando o script dado. */
function fakeApi(script: string) {
  return { command: process.execPath, args: ["-e", script], dataDir, allowedOrigin: "http://localhost:5173" };
}

async function start(script: string) {
  const api = await startApi(fakeApi(script));
  started.push(api);
  return api;
}

/** O primeiro processo criado no teste. Os seguintes, se houver, são o `taskkill`. */
function firstChild(): ChildProcess {
  return vi.mocked(spawn).mock.results[0].value as ChildProcess;
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

beforeEach(() => {
  vi.mocked(spawn).mockClear();
  dataDir = mkdtempSync(join(tmpdir(), "prism-api-process-"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(started.splice(0).map((api) => api.stop()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe("parseReadyLine", () => {
  it("aceita PRISM_API_READY 51234", () => {
    expect(parseReadyLine("PRISM_API_READY 51234")).toBe(51234);
  });

  it("recusa PRISM_API_READY abc, linha vazia e linha com texto antes", () => {
    expect(parseReadyLine("PRISM_API_READY abc")).toBeNull();
    expect(parseReadyLine("")).toBeNull();
    expect(parseReadyLine("info: PRISM_API_READY 51234")).toBeNull();
  });
});

describe("startApi", () => {
  it("startApi resolve com a porta anunciada e um token de 32 bytes em base64url", async () => {
    const api = await start(announce);

    expect(api.baseUrl).toBe("http://127.0.0.1:51234");
    expect(api.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(api.token, "base64url")).toHaveLength(32);
  });

  it("startApi passa PRISM_API_TOKEN, PRISM_DATA_DIR, PRISM_ALLOWED_ORIGIN e PRISM_PARENT_PID ao filho", async () => {
    const dump = `
      const { PRISM_API_TOKEN, PRISM_DATA_DIR, PRISM_ALLOWED_ORIGIN, PRISM_PARENT_PID } = process.env;
      require("node:fs").writeFileSync(require("node:path").join(PRISM_DATA_DIR, "env.json"), JSON.stringify({ PRISM_API_TOKEN, PRISM_DATA_DIR, PRISM_ALLOWED_ORIGIN, PRISM_PARENT_PID }));
      ${announce}`;

    const api = await start(dump);

    expect(JSON.parse(readFileSync(join(dataDir, "env.json"), "utf8"))).toEqual({
      PRISM_API_TOKEN: api.token,
      PRISM_DATA_DIR: dataDir,
      PRISM_ALLOWED_ORIGIN: "http://localhost:5173",
      PRISM_PARENT_PID: String(process.pid),
    });
  });

  it("startApi rejeita quando o filho sai antes de anunciar, com o fim do stderr na mensagem", async () => {
    const crash = `process.stderr.write("Unhandled exception: PRISM_API_TOKEN ausente"); process.exitCode = 3;`;

    const failure = await startApi(fakeApi(crash)).then(() => null, (error: Error) => error);

    expect(failure?.message).toContain("código 3");
    expect(failure?.message).toContain("PRISM_API_TOKEN ausente");
  });

  it("startApi rejeita com o motivo quando o comando não existe", async () => {
    await expect(startApi({ ...fakeApi(idle), command: join(dataDir, "nao-existe.exe") })).rejects.toThrow(/Não foi possível iniciar a API/);
  });

  it("startApi rejeita por tempo quando o filho nunca anuncia, e mata o filho", async () => {
    await expect(startApi({ ...fakeApi(idle), readyTimeoutMs: 300 })).rejects.toThrow(/não anunciou a porta/);

    await vi.waitFor(() => expect(hasExited(firstChild())).toBe(true), { timeout: 5000 });
  });

  it("stop encerra o filho e onExit é chamado, dizendo que foi o app que mandou parar (D11)", async () => {
    const api = await start(announce);
    const onExit = vi.fn<(code: number | null, stoppedByApp: boolean) => void>();
    api.onExit(onExit);
    expect(hasExited(firstChild())).toBe(false);

    await api.stop();

    expect(hasExited(firstChild())).toBe(true);
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce());
    expect(onExit.mock.calls[0][1]).toBe(true);
  });

  it("a API que sai sozinha chega ao onExit com o código dela e sem a marca de parada do app (D11)", async () => {
    const api = await start(`console.log("PRISM_API_READY 51234"); setTimeout(() => process.exit(3), 100);`);
    const onExit = vi.fn<(code: number | null, stoppedByApp: boolean) => void>();
    api.onExit(onExit);

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(onExit).toHaveBeenCalledWith(3, false);
  });
});

describe("apiExitMessage (a linha do log quando a API acaba)", () => {
  it("parada pelo app: diz que foi o app, sem código (o `taskkill` do Windows sai com 1, e isso não é falha)", () => {
    expect(apiExitMessage(1, true)).toBe("API encerrada pelo app");
    expect(apiExitMessage(4294967295, true)).not.toMatch(/código|4294967295/);
  });

  it("saiu sozinha: diz o código", () => {
    expect(apiExitMessage(1, false)).toBe("API saiu com código 1");
    expect(apiExitMessage(0, false)).toBe("API saiu com código 0");
    expect(apiExitMessage(null, false)).toBe("API saiu com código null");
  });
});

describe("closeVaultAndStop (RN-COFRE-008)", () => {
  /** Uma API já em execução, de mentira: o que interessa é a ordem entre a chamada e o `stop()`. */
  function running(order: string[]) {
    const stop = vi.fn(async () => void order.push("stop"));
    return { api: { baseUrl: "http://127.0.0.1:51234", token: "token-de-teste", stop, onExit: () => {} } satisfies ApiProcess, stop };
  }

  function fetchAnswers(answer: () => Promise<Response>) {
    const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(answer);
    vi.stubGlobal("fetch", fake);
    return fake;
  }

  it("closeVaultAndStop chama DELETE api/public/sessions com o token e só depois para a API", async () => {
    const order: string[] = [];
    const fake = fetchAnswers(async () => {
      order.push("fetch");
      return new Response(null, { status: 204 });
    });
    const { api } = running(order);
    const log = vi.fn();

    await closeVaultAndStop(api, log);

    const [url, init] = fake.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:51234/api/public/sessions");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-de-teste");
    expect(order).toEqual(["fetch", "stop"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("204"));
  });

  it("closeVaultAndStop segue para o stop() mesmo quando a chamada falha", async () => {
    const refused = running([]);
    fetchAnswers(async () => {
      throw new TypeError("fetch failed");
    });
    const log = vi.fn();
    await closeVaultAndStop(refused.api, log);
    expect(refused.stop).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("fetch failed"));

    // A rota ainda não existe na API: o 404 também não segura a saída.
    const missing = running([]);
    fetchAnswers(async () => new Response(null, { status: 404 }));
    await closeVaultAndStop(missing.api, vi.fn());
    expect(missing.stop).toHaveBeenCalledOnce();
  });

  it("closeVaultAndStop segue depois de 2 s quando a chamada não responde", async () => {
    vi.useFakeTimers();
    const fake = fetchAnswers(() => new Promise<Response>(() => {}));
    const { api, stop } = running([]);
    const log = vi.fn();

    const closing = closeVaultAndStop(api, log);

    await vi.advanceTimersByTimeAsync(1999);
    expect(stop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(stop).toHaveBeenCalledOnce();
    // A chamada pendurada é cancelada, não fica viva atrás do app que está saindo.
    expect(fake.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("2 s"));
  });
});
