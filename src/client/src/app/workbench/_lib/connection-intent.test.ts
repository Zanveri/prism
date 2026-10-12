import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vaultLock } from "@/lib/api/vault-lock";

import { createConnectionReveal, createDisconnectLog } from "./connection-intent";
import { databaseSessionKey, reopenDatabaseSession } from "./database-sessions.service";
import { structureKey } from "./table-structure.service";
import { dropDataAtLock } from "./workbench-lock";

/** A API trocada: só a abertura de sessão (POST) responde, o que basta para `reopenDatabaseSession`. */
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
  api.request.mockReset();
  api.request.mockResolvedValue({ ok: true, data: { id: "s-novo", database: "mes" } });
});

afterEach(() => vaultLock.reset());

const openSession = (connectionId: string) => queryClient.setQueryData(databaseSessionKey(connectionId), { id: `sessao-${connectionId}`, database: "mes" });
const disconnect = (connectionId: string) => queryClient.removeQueries({ queryKey: databaseSessionKey(connectionId) });

/** Assina como o React faz (`useSyncExternalStore`) e devolve quantas vezes o log avisou. */
function watch(log = createDisconnectLog(queryClient)) {
  const listener = vi.fn();
  const unsubscribe = log.subscribe(listener);
  return { log, listener, unsubscribe };
}

describe("createDisconnectLog: quem a pessoa desconectou (RN-SESSAO-004)", () => {
  it("o 'Desconectar' remove a sessão da árvore do cache, e a conexão passa a constar como desconectada", () => {
    openSession("c1");
    const { log, listener } = watch();

    disconnect("c1");

    expect([...log.getSnapshot()]).toEqual(["c1"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("cada conexão é uma só: desconectar uma não marca a outra", () => {
    openSession("c1");
    openSession("c2");
    const { log } = watch();

    disconnect("c2");

    expect([...log.getSnapshot()]).toEqual(["c2"]);
  });

  it("a sessão da árvore voltando a ter dado (a pessoa expandiu a conexão, ou clicou em Conectar) tira a conexão da lista", () => {
    openSession("c1");
    const { log, listener } = watch();
    disconnect("c1");

    openSession("c1");

    expect(log.getSnapshot().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uma sessão de aba (o 'Atualizar' dos registros) também a tira: quem avisa é `forget`", () => {
    openSession("c1");
    const { log } = watch();
    disconnect("c1");

    log.forget("c1");

    expect(log.getSnapshot().size).toBe(0);
  });

  it("o bloqueio por inatividade não é um 'Desconectar': ele remove a sessão com o cofre já bloqueado, e desbloquear restaura tudo", () => {
    openSession("c1");
    queryClient.setQueryData(structureKey("c1", "producao", "apontamento", "columns"), []);
    const { log, listener } = watch();

    // A ordem do `VaultLock`: arma o bloqueio, e só então o provedor descarta o que dependia do cofre aberto.
    vaultLock.lock();
    dropDataAtLock(queryClient);
    vaultLock.unlock();

    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toBeUndefined();
    expect(log.getSnapshot().size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reabrir a sessão que caiu (o 'Atualizar' que a descobre) reinicia a consulta e não a remove: continua conectada", async () => {
    openSession("c1");
    const { log, listener } = watch();

    await reopenDatabaseSession(queryClient, "c1");

    expect(log.getSnapshot().size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("os níveis da árvore e a estrutura das tabelas saem do cache sem que isso diga nada: só a sessão da árvore conta", () => {
    openSession("c1");
    queryClient.setQueryData(["tree", "c1", "schemas"], []);
    queryClient.setQueryData(structureKey("c1", "producao", "apontamento", "columns"), []);
    const { log } = watch();

    queryClient.removeQueries({ queryKey: ["tree", "c1"] });
    queryClient.removeQueries({ queryKey: ["table-structure", "c1"] });

    expect(log.getSnapshot().size).toBe(0);
  });

  it("só observa o cache enquanto alguém assina; sem assinante, o que acontece nele não conta", () => {
    openSession("c1");
    openSession("c2");
    const log = createDisconnectLog(queryClient);

    disconnect("c1");
    expect(log.getSnapshot().size).toBe(0);

    const { unsubscribe } = watch(log);
    unsubscribe();
    disconnect("c2");

    expect(log.getSnapshot().size).toBe(0);
  });

  it("o retrato só muda de objeto quando muda de conteúdo (é o que o React compara)", () => {
    openSession("c1");
    const { log } = watch();
    const before = log.getSnapshot();

    log.forget("c1");
    expect(log.getSnapshot()).toBe(before);

    disconnect("c1");
    const after = log.getSnapshot();
    expect(after).not.toBe(before);

    openSession("c1");
    disconnect("c1");
    expect(log.getSnapshot()).not.toBe(after);
    expect([...log.getSnapshot()]).toEqual(["c1"]);
  });
});

describe("createConnectionReveal: a conexão que acabou de ser salva, para a árvore mostrar e escolher (RN-NAV-004)", () => {
  it("o formulário pede, e o navegador vê o pedido e é avisado", () => {
    const reveal = createConnectionReveal();
    const listener = vi.fn();
    reveal.subscribe(listener);

    reveal.request("c1");

    expect(reveal.pending()?.connectionId).toBe("c1");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("o retrato é o mesmo objeto enquanto nada muda (é o que o React compara)", () => {
    const reveal = createConnectionReveal();
    reveal.request("c1");

    expect(reveal.pending()).toBe(reveal.pending());
  });

  it("quem mostrou leva o pedido embora: não volta a mostrar na próxima vez que a árvore se desenhar", () => {
    const reveal = createConnectionReveal();
    reveal.request("c1");

    reveal.take(reveal.pending()?.seq ?? -1);

    expect(reveal.pending()).toBeNull();
  });

  it("salvar a mesma conexão de novo é outro pedido (outro número): a árvore mostra de novo", () => {
    const reveal = createConnectionReveal();
    reveal.request("c1");
    const first = reveal.pending();
    reveal.take(first?.seq ?? -1);
    reveal.request("c1");

    expect(reveal.pending()?.connectionId).toBe("c1");
    expect(reveal.pending()?.seq).not.toBe(first?.seq);
  });

  it("levar um pedido que já foi trocado por outro não apaga o novo", () => {
    const reveal = createConnectionReveal();
    reveal.request("c1");
    const old = reveal.pending()?.seq ?? -1;
    reveal.request("c2");

    reveal.take(old);

    expect(reveal.pending()?.connectionId).toBe("c2");
  });

  it("parar de olhar não avisa mais; esquecer apaga o pedido (sair do cofre: nada passa ao usuário seguinte)", () => {
    const reveal = createConnectionReveal();
    const listener = vi.fn();
    const stop = reveal.subscribe(listener);
    stop();

    reveal.request("c1");
    expect(listener).not.toHaveBeenCalled();

    reveal.clear();
    expect(reveal.pending()).toBeNull();
  });
});
