import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rm } from "node:fs/promises";

import { redirectAllowed, type UpdateOrigin } from "./origin";

/**
 * O pedido de rede do atualizador, sem depender do Electron: quem fala com a rede de verdade é `net-transport.ts`, e os
 * testes usam um de mentira. Tudo o que decide (para onde um redirecionamento pode ir, quanto pode chegar, quanto tempo
 * esperar, a soma do que foi gravado) está aqui.
 */
export type HttpResponse = { status: number; header(name: string): string | null; body: AsyncIterable<Uint8Array> };

/**
 * Um `GET`. `allowRedirect` é perguntado a cada redirecionamento, antes de qualquer pedido ao endereço novo: recusado, o
 * pedido falha. Cancelado por `signal`, o pedido e a leitura do corpo param. `headers`: os cabeçalhos a mais deste pedido (os da
 * API do GitHub, na consulta); o agente e os demais fixos são do transporte.
 */
export type HttpGet = (url: string, options: { signal: AbortSignal; allowRedirect(target: string): boolean; headers?: Readonly<Record<string, string>> }) => Promise<HttpResponse>;

/** O GitHub redireciona o download uma vez, para o domínio onde o arquivo está; cinco saltos já é um servidor que não sabe para onde ir. */
const maxRedirects = 5;

/** Decide cada redirecionamento (RN-ATUALIZA-008) e lembra se recusou algum, para a falha dizer o motivo. */
function redirectGuard(origin: UpdateOrigin, follow: boolean) {
  const guard = {
    hops: 0,
    refused: false,
    allow(target: string) {
      guard.hops += 1;
      const allowed = follow && guard.hops <= maxRedirects && redirectAllowed(target, origin);
      if (!allowed) guard.refused = true;
      return allowed;
    },
  };
  return guard;
}

/** Uma promessa que só rejeita, quando `signal` é cancelado. Já vem com um `catch`, para não sobrar rejeição sem dono. */
function rejectedOnAbort(signal: AbortSignal): Promise<never> {
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  aborted.catch(() => undefined);
  return aborted;
}

/** O trabalho ou o cancelamento, o que vier primeiro. O trabalho que perde a corrida pode falhar depois: essa falha já tem dono. */
function orAborted<T>(work: Promise<T>, aborted: Promise<never>): Promise<T> {
  work.catch(() => undefined);
  return Promise.race([work, aborted]);
}

/** O corpo, pedaço a pedaço, até acabar ou até o cancelamento: a parada não depende de o transporte encerrar o corpo dele. */
async function* untilAborted(body: AsyncIterable<Uint8Array>, aborted: Promise<never>): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await orAborted(iterator.next(), aborted);
      if (next.done === true) return;
      yield next.value;
    }
  } finally {
    // Sem esperar: um corpo parado não devolveria nunca.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

/** O `Content-Length`, se veio. Um valor que não é um número inteiro é recusado: não há o que conferir com ele. */
function declaredSize(response: HttpResponse): number | null {
  const header = response.header("content-length");
  if (header === null) return null;
  if (!/^\d{1,15}$/.test(header)) throw new Error("O servidor declarou um tamanho inválido para a resposta.");

  return Number(header);
}

const tooLarge = (maxBytes: number) => new Error(`A resposta é grande demais: passa do teto de ${Math.round(maxBytes / 1024).toLocaleString("pt-BR")} kB que o Prism aceita.`);
/** A frase da recusa diz a regra de quem recusou: a consulta não segue redirecionamento nenhum; o download, só por https e até cinco. */
const refusedRedirect = (cause: unknown, follow: boolean) =>
  new Error(follow ? "O servidor respondeu com um redirecionamento que o Prism não segue (só para https, e no máximo cinco seguidos)." : "O servidor respondeu com um redirecionamento, e a consulta às versões não segue redirecionamento.", { cause });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Um texto pequeno da origem: uma página da lista de releases (sem seguir redirecionamento nenhum) ou o `SHA256SUMS` (que o
 * GitHub redireciona como qualquer arquivo de release). Prazo total, teto de tamanho contado durante a leitura, e só resposta 200.
 * `signal` cancela o pedido antes do prazo; `headers` vão ao transporte como vieram.
 */
export async function fetchText(http: HttpGet, url: string, { origin, maxBytes, timeoutMs, redirects, signal, headers }: { origin: UpdateOrigin; maxBytes: number; timeoutMs: number; redirects: boolean; signal?: AbortSignal; headers?: Readonly<Record<string, string>> }): Promise<string> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted === true) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const aborted = rejectedOnAbort(controller.signal);
  const guard = redirectGuard(origin, redirects);
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await orAborted(http(url, { signal: controller.signal, allowRedirect: guard.allow, ...(headers === undefined ? {} : { headers }) }), aborted);
    if (response.status !== 200) throw new Error(`O servidor respondeu ${response.status}.`);

    const declared = declaredSize(response);
    if (declared !== null && declared > maxBytes) throw tooLarge(maxBytes);

    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of untilAborted(response.body, aborted)) {
      received += chunk.length;
      if (received > maxBytes) throw tooLarge(maxBytes);
      chunks.push(chunk);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
  } catch (error) {
    if (signal?.aborted === true) throw new Error("Download cancelado.", { cause: error });
    if (expired) throw new Error(`O servidor não respondeu no prazo de ${timeoutMs / 1000} s.`, { cause: error });
    if (guard.refused) throw refusedRedirect(error, redirects);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.abort();
  }
}

/**
 * Baixa um pacote para `destination` (o nome temporário, que não pode existir) e devolve a soma SHA-256 do que gravou
 * (RN-ATUALIZA-005). Redirecionamento só para https; só resposta 200; recusa o que passa do teto, pelo tamanho declarado
 * e pela contagem, e o que não bate com o tamanho declarado; desiste se parar de chegar dado por `stallMs`. Em qualquer
 * falha, e no cancelamento, o que tinha sido gravado é apagado.
 */
export async function downloadFile(
  http: HttpGet,
  url: string,
  destination: string,
  { origin, maxBytes, stallMs, signal, onProgress }: { origin: UpdateOrigin; maxBytes: number; stallMs: number; signal: AbortSignal; onProgress(receivedBytes: number, totalBytes: number | null): void },
): Promise<{ sha256: string; bytes: number }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const aborted = rejectedOnAbort(controller.signal);
  const guard = redirectGuard(origin, true);

  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };

  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    arm();
    const response = await orAborted(http(url, { signal: controller.signal, allowRedirect: guard.allow }), aborted);
    if (response.status !== 200) throw new Error(`O servidor respondeu ${response.status} ao pedido do pacote.`);

    const declared = declaredSize(response);
    if (declared !== null && declared > maxBytes) throw tooLarge(maxBytes);

    // `wx`: o temporário é sempre novo. Se já existe um arquivo com esse nome, não é deste download, e não é tocado.
    file = await open(destination, "wx");
    const hash = createHash("sha256");
    let received = 0;
    for await (const chunk of untilAborted(response.body, aborted)) {
      arm();
      received += chunk.length;
      if (received > maxBytes) throw tooLarge(maxBytes);
      if (declared !== null && received > declared) throw new Error("O servidor mandou mais do que o tamanho declarado do pacote.");

      hash.update(chunk);
      await file.write(chunk);
      onProgress(received, declared);
    }
    if (declared !== null && received !== declared) throw new Error("O download terminou antes do tamanho declarado do pacote.");

    await file.close();
    return { sha256: hash.digest("hex"), bytes: received };
  } catch (error) {
    if (file !== undefined) {
      await file.close().catch(() => undefined);
      await rm(destination, { force: true });
    }

    if (signal.aborted) throw new Error("Download cancelado.", { cause: error });
    if (stalled) throw new Error(`O servidor parou de responder: nenhum dado chegou no prazo de ${stallMs / 1000} s.`, { cause: error });
    if (guard.refused) throw refusedRedirect(error, true);
    throw new Error(messageOf(error), { cause: error });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}

/** A soma SHA-256 de um arquivo como ele está no disco agora, em minúsculas: é o que se confere logo antes de usá-lo. */
export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);

  return hash.digest("hex");
}
