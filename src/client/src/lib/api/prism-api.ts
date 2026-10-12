import type { z } from "zod";

import { apiErrorSchema } from "./api-error.schema";
import { getBridge } from "./bridge";
import { vaultLock } from "./vault-lock";

/**
 * O único caminho da tela até a API: `fetch` em 127.0.0.1 com o token de lançamento (seção 3.1
 * da especificação). Resposta e erro são traduzidos aqui, uma vez, e `apiRequest` nunca lança.
 */
export type ApiError = {
  /** `0` quando a API sequer respondeu. */
  status: number;
  /** O `type` do erro da API, ou `NETWORK_ERROR` e `RESPONSE_INVALID`, que só a tela emite. */
  code: string;
  title: string;
  detail: string | null;
  /** Mensagens por campo, com a chave na caixa que o formulário usa (`name`, não `Name`). */
  errors: Record<string, string[]> | null;
  /** Os campos extras do corpo de erro, como vieram (`sqlState` e `position` no `SQL_EXECUTION_FAILED`). Quem os usa valida. */
  extensions: Record<string, unknown>;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** O erro de `apiRequest` em forma de exceção, para as `queryFn` e `mutationFn`. */
export class ApiRequestError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.title);
    this.name = "ApiRequestError";
    this.error = error;
  }
}

/** Devolve `data` ou lança `ApiRequestError`. */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ApiRequestError(result.error);
  return result.data;
}

/**
 * Deixa passar, como valor, a recusa que o formulário mostra no próprio lugar (por código), e
 * lança as demais para o aviso central (RN-AVISO-004). `meta: { silent: true }` não faz isto: ele
 * cala a chamada inteira, e a API fora do ar ou o `VAULT_UNAVAILABLE` também precisam de aviso.
 */
export function allowRefusal<T>(result: ApiResult<T>, ...codes: string[]): ApiResult<T> {
  if (!result.ok && !codes.includes(result.error.code)) throw new ApiRequestError(result.error);
  return result;
}

const vaultLockedListeners = new Set<() => void>();

/** Avisa quando a API responde 401 `VAULT_LOCKED` (RN-API-005): o cofre fechou e a tela volta ao login. */
export function onVaultLocked(listener: () => void): () => void {
  vaultLockedListeners.add(listener);
  return () => void vaultLockedListeners.delete(listener);
}

function failure(status: number, code: string, title: string): { ok: false; error: ApiError } {
  return { ok: false, error: { status, code, title, detail: null, errors: null, extensions: {} } };
}

const responseInvalid = (status: number) => failure(status, "RESPONSE_INVALID", "A API respondeu em um formato inesperado.");

/**
 * O prazo das chamadas que a PESSOA faz e espera ("Sair", "Desbloquear"): a API local responde em décimos de segundo, e a derivação da senha do
 * cofre (RN-COFRE-006) leva cerca de meio segundo aqui, e algumas vezes isso em máquinas lentas. 15 s dão folga para isso e ainda devolvem a tela
 * a quem a olha, quando a API parou de responder. Quem passa o próprio sinal (o fechamento do cofre no bloqueio, que repete) tem o prazo dele.
 */
export const userActionDeadlineMs = 15_000;

export type ApiRequestOptions<T> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  /** Sai mesmo com o Prism bloqueado por inatividade (RN-SEG-001): só entrar e sair, as saídas da tela de bloqueio. */
  whileLocked?: boolean;
};

export async function apiRequest<T = void>(path: string, options: ApiRequestOptions<T> = {}): Promise<ApiResult<T>> {
  const { method = "GET", body, schema, signal, whileLocked = false } = options;

  // Bloqueado, o cofre está fechado: o pedido espera o desbloqueio em vez de bater na API e receber 401 (ver `vault-lock.ts`).
  if (!whileLocked && vaultLock.isLocked() && !(await vaultLock.whenUnlocked(signal))) return failure(0, "NETWORK_ERROR", "Sem resposta da API.");

  let response: Response;
  let payload: unknown;
  try {
    // O endereço e o token são pedidos à ponte a cada chamada: reiniciar a API troca os dois.
    const { baseUrl, token } = await getBridge().getApiConfig();
    response = await fetch(`${baseUrl}/${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    payload = await readJson(response);
  } catch {
    // Pedido cancelado pelo `signal` também cai aqui; quem cancelou não lê o resultado.
    return failure(0, "NETWORK_ERROR", "Sem resposta da API.");
  }

  if (!response.ok) {
    const problem = apiErrorSchema.safeParse(payload);
    if (!problem.success) return responseInvalid(response.status);

    const { type, title, detail, errors } = problem.data;
    // Com o Prism bloqueado o cofre fechou de propósito (um pedido que já estava a caminho): voltar ao login apagaria as abas.
    if (response.status === 401 && type === "VAULT_LOCKED" && !vaultLock.isLocked()) for (const listener of vaultLockedListeners) listener();

    return { ok: false, error: { status: response.status, code: type, title, detail: detail ?? null, errors: errors ? toFieldErrors(errors) : null, extensions: extensionsOf(problem.data) } };
  }

  // Sem schema não há o que devolver: um 2xx nunca chega à tela sem passar pelo Zod.
  if (schema === undefined) return { ok: true, data: undefined as T };

  const parsed = schema.safeParse(payload);
  return parsed.success ? { ok: true, data: parsed.data } : responseInvalid(response.status);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Os campos do problem+json que o `ApiError` já carrega com nome próprio; o que sobra do corpo é extensão. */
const knownMembers = new Set(["type", "title", "status", "detail", "instance", "errors"]);

function extensionsOf(problem: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(problem).filter(([member]) => !knownMembers.has(member)));
}

/** `{ "Name": [...] }` vira `{ name: [...] }`: a API escreve o nome da propriedade em C#. */
function toFieldErrors(errors: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(errors).map(([property, messages]) => [property.charAt(0).toLowerCase() + property.slice(1), messages]));
}
