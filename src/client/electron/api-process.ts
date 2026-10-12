import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

import { prismEndpoints } from "../src/lib/api/prism-endpoints";

/**
 * Inicia e encerra o processo da API (seção 3.1 da especificação). Não importa nada do Electron
 * de propósito: assim o vitest o exercita com um processo filho de verdade.
 */
export type ApiProcess = {
  baseUrl: string;
  token: string;
  stop(): Promise<void>;
  /** `stoppedByApp`: o app mandou a API parar (`stop`); sem isso, ela saiu sozinha ou foi morta de fora. */
  onExit(listener: (code: number | null, stoppedByApp: boolean) => void): void;
};

/** Review Focus 5: a janela mostra o erro em até 30 s, não fica na tela de abertura para sempre. */
const defaultReadyTimeoutMs = 30_000;

/** Quanto do fim do stderr vai para a mensagem de erro: é onde está a exceção da partida. */
const stderrTailLength = 2000;

/** Quanto o app espera a API fechar o cofre antes de pará-la mesmo assim. */
const closeVaultTimeoutMs = 2000;

/**
 * A linha do log quando a API acaba (D11 do Marco B). O app encerra a API à força ao fechar ou ao
 * reiniciar, e o `taskkill` do Windows faz o processo sair com código 1: dizer "saiu com código 1" ali
 * parece falha onde houve só a parada que o app pediu. Quando ela saiu sozinha, o código é o dado.
 */
export function apiExitMessage(code: number | null, stoppedByApp: boolean): string {
  return stoppedByApp ? "API encerrada pelo app" : `API saiu com código ${code}`;
}

/** `PRISM_API_READY <porta>`, sozinha na linha: o `dotnet run` escreve outras antes dela. */
export function parseReadyLine(line: string): number | null {
  const match = /^PRISM_API_READY (\d{1,5})$/.exec(line);
  if (match === null) return null;

  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

export function startApi(options: { command: string; args: string[]; dataDir: string; allowedOrigin: string; readyTimeoutMs?: number }): Promise<ApiProcess> {
  // O token de lançamento (RN-API-001): 32 bytes aleatórios, novos a cada partida.
  const token = randomBytes(32).toString("base64url");

  const child = spawn(options.command, options.args, {
    env: {
      ...process.env,
      PRISM_API_TOKEN: token,
      PRISM_DATA_DIR: options.dataDir,
      PRISM_ALLOWED_ORIGIN: options.allowedOrigin,
      // RN-API-004: a API encerra sozinha se este processo deixar de existir.
      PRISM_PARENT_PID: String(process.pid),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Sem isto, um programa de console iniciado por um app de janela abre um console no Windows.
    windowsHide: true,
  });

  let stderrTail = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-stderrTailLength);
  });
  const stderrEnded = new Promise<void>((resolve) => child.stderr.once("end", resolve));
  const withStderr = (message: string) => (stderrTail.trim() === "" ? message : `${message}\n${stderrTail.trim()}`);

  // `error` sem `exit` é o comando que nem chegou a iniciar; para quem espera, também acabou.
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });

  // Só conta o que o app de fato mandou: parar uma API que já tinha saído não a torna "encerrada pelo app".
  let stoppedByApp = false;
  const stop = async () => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      stoppedByApp = true;
      killTree(child);
    }
    await exited;
  };

  return new Promise<ApiProcess>((resolve, reject) => {
    const readyTimeoutMs = options.readyTimeoutMs ?? defaultReadyTimeoutMs;

    // A recusa não espera o filho morrer: se ele não morrer, a tela ainda assim precisa do erro.
    const timer = setTimeout(() => {
      void stop();
      reject(new Error(withStderr(`A API não anunciou a porta em ${readyTimeoutMs / 1000} s.`)));
    }, readyTimeoutMs);

    createInterface({ input: child.stdout }).on("line", (line) => {
      const port = parseReadyLine(line);
      if (port === null) return;

      clearTimeout(timer);
      resolve({ baseUrl: `http://127.0.0.1:${port}`, token, stop, onExit: (listener) => void exited.then((code) => listener(code, stoppedByApp)) });
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível iniciar a API (${options.command}): ${error.message}`));
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      // O `exit` chega antes de o stderr ser lido até o fim. Esperar o `close` não serve: ele só
      // vem quando todos os que herdaram o pipe o soltam, e os nós do MSBuild que o `dotnet run`
      // deixa vivos o seguram por minutos. Daí o prazo curto. Depois de pronta, a recusa não faz nada.
      void Promise.race([stderrEnded, delay(250)]).then(() => reject(new Error(withStderr(`A API saiu com código ${code} antes de anunciar a porta.`))));
    });
  });
}

/**
 * A saída do app (RN-COFRE-008): pede à API que feche o cofre — é o que encerra as sessões com
 * os bancos e zera a chave — e só então a para. O pedido é uma cortesia, não uma condição: a
 * resposta, a falha ou o silêncio vão para o log, e a parada acontece de qualquer jeito.
 */
export async function closeVaultAndStop(api: ApiProcess, log: (message: string) => void): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const outcome = await Promise.race([
    fetch(`${api.baseUrl}/${prismEndpoints.publicSessions}`, { method: "DELETE", headers: { Authorization: `Bearer ${api.token}` }, signal: controller.signal }).then(
      (response) => `a API respondeu ${response.status}`,
      (error: unknown) => `a chamada falhou (${error instanceof Error ? error.message : String(error)})`,
    ),
    // O prazo não depende de o `fetch` honrar o cancelamento: passou, a saída segue.
    new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(`sem resposta em ${closeVaultTimeoutMs / 1000} s`), closeVaultTimeoutMs);
    }),
  ]);
  clearTimeout(timer);
  controller.abort();

  log(`fechamento do cofre: ${outcome}`);
  await api.stop();
}

/**
 * No Windows, `child.kill()` encerra só o processo iniciado. Em desenvolvimento ele é o
 * `dotnet run`, e a API é filha dele: sem `/T` ela ficaria viva, com o cofre aberto, até o
 * Electron fechar.
 */
function killTree(child: ChildProcess) {
  if (process.platform !== "win32") {
    child.kill();
    return;
  }

  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("error", () => child.kill());
}
