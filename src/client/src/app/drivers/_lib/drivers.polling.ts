import { hasInstalling } from "./drivers.model";
import type { Driver } from "./drivers.schema";

const intervalMs = 1000;
/** Depois de o `POST …/install` responder 202 a consulta fica ligada por este tempo, mesmo que a lista ainda não diga `installing`. */
const graceMs = 10_000;
/** Depois de tantos erros seguidos, com a API viva e respondendo erro, a consulta periódica para. */
const maxFailures = 3;

/**
 * O ritmo da consulta periódica da lista de drivers (item D). É estado de módulo, e não do `QueryClient`, porque o
 * `refetchInterval` do TanStack só recebe a consulta (que não expõe o cliente): há um cliente por vida da API, e o que
 * sobra de uma vida à outra (um prazo de 10 s, uma contagem de erros) se apaga ao abrir a tela (`resumePolling`) ou sozinho.
 */
let graceUntil = 0;
let failures = 0;

const listeners = new Set<() => void>();

/**
 * Avisa quem desenha a tela quando a consulta periódica para ou volta (`isPollingSuspended`). Sem isto a tela não saberia: o erro
 * seguinte da mesma consulta não muda nada do que o TanStack entrega ao componente (continua `isError`, com a mesma lista), e o
 * componente não é desenhado de novo.
 */
export function subscribePolling(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const notify = () => listeners.forEach((listener) => listener());

/**
 * O `meta` da consulta da lista, **o mesmo objeto sempre**: o aviso central lê `meta.silent` na hora do erro, e a consulta
 * periódica que falha várias vezes seguidas dá um aviso só (o primeiro erro); os seguintes ficam em silêncio.
 */
export const driversErrorMeta: { silent: boolean } = { silent: false };

/**
 * A lista é consultada de novo a cada segundo enquanto algum driver baixa, e só enquanto isso. Rede de segurança: depois de um
 * 202, por cerca de 10 s, mesmo que a lista ainda traga o driver como `available` (a especificação garante que ela já traz
 * `installing`, e a tela não confia só nisso). E para depois de 3 erros seguidos.
 */
export function pollInterval(drivers: readonly Driver[] | undefined, now = Date.now()): number | false {
  if (failures >= maxFailures) return false;
  return hasInstalling(drivers) || now < graceUntil ? intervalMs : false;
}

export function keepPollingAfterInstall(now = Date.now()): void {
  graceUntil = now + graceMs;
}

export function pollSucceeded(): void {
  const hadFailures = failures > 0;
  failures = 0;
  driversErrorMeta.silent = false;
  if (hadFailures) notify();
}

export function pollFailed(): void {
  failures += 1;
  driversErrorMeta.silent = failures > 1;
  notify();
}

/** A consulta periódica foi parada por erros seguidos: a tela diz isso e oferece atualizar a lista. */
export const isPollingSuspended = (): boolean => failures >= maxFailures;

/** O usuário abriu a tela ou pediu para atualizar a lista: a contagem de erros recomeça. */
export function resumePolling(): void {
  pollSucceeded();
}

/** Só para os testes: zera o prazo e a contagem. */
export function resetDriversPolling(): void {
  graceUntil = 0;
  pollSucceeded();
}
