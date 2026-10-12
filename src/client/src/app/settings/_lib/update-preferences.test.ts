import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatCheckedAt, refreshUpdatePreferences, saveCheckOnStartup, saveReceiveBeta, updatePreferencesQuery, type UpdatePreferences } from "./update-preferences";

describe("formatCheckedAt (a hora da última verificação de atualizações)", () => {
  it("escreve data e hora no formato do Brasil, na hora do computador", () => {
    const text = formatCheckedAt("2026-10-11T14:03:00.000Z", "UTC");

    expect(text).toContain("11/10/2026");
    expect(text).toContain("14:03");
  });

  it("a hora é a do fuso pedido: o mesmo instante, em São Paulo, é três horas antes", () => {
    expect(formatCheckedAt("2026-10-11T14:03:00.000Z", "America/Sao_Paulo")).toContain("11:03");
  });

  it("quem nunca verificou, ou trouxe uma data que não é data, não tem hora para mostrar", () => {
    expect(formatCheckedAt(null)).toBeNull();
    expect(formatCheckedAt("")).toBeNull();
    expect(formatCheckedAt("ontem de manhã")).toBeNull();
  });
});

describe("as preferências de atualização relidas na ponte (o processo principal as muda por conta própria)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const before: UpdatePreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null };

  /** Um cliente com a seção "aberta": uma consulta ativa, como a da tela, e a ponte devolvendo o que `current()` disser. */
  async function open(current: () => UpdatePreferences) {
    vi.stubGlobal("window", { prism: { updates: { getPreferences: async () => current() } } });
    const client = new QueryClient();
    const observer = new QueryObserver(client, updatePreferencesQuery);
    const stop = observer.subscribe(() => undefined);
    await client.fetchQuery(updatePreferencesQuery);
    return { client, stop };
  }

  it("depois de uma consulta, a hora nova aparece; depois de pular, a versão pulada aparece", async () => {
    let saved = before;
    const { client, stop } = await open(() => saved);
    expect(client.getQueryData(updatePreferencesQuery.queryKey)).toEqual(before);

    saved = { ...before, lastCheckedAt: "2026-10-11T15:00:00.000Z" };
    await refreshUpdatePreferences(client);
    expect(client.getQueryData(updatePreferencesQuery.queryKey)).toEqual(saved);

    saved = { ...saved, skippedVersion: "1.2.0", checkOnStartup: false };
    await refreshUpdatePreferences(client);
    expect(client.getQueryData(updatePreferencesQuery.queryKey)).toEqual(saved);

    stop();
  });

  it("sem a seção aberta não busca nada: só marca a leitura como velha (a próxima abertura relê)", async () => {
    const getPreferences = vi.fn(async () => before);
    vi.stubGlobal("window", { prism: { updates: { getPreferences } } });
    const client = new QueryClient();
    await client.fetchQuery(updatePreferencesQuery);
    getPreferences.mockClear();

    await refreshUpdatePreferences(client);

    expect(getPreferences).not.toHaveBeenCalled();
    expect(client.getQueryState(updatePreferencesQuery.queryKey)?.isInvalidated).toBe(true);
  });
});

describe("a resposta da ponte é conferida (a ponte é a fronteira de confiança)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const saved = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null };
  const read = async (reply: unknown) => {
    vi.stubGlobal("window", { prism: { updates: { getPreferences: async () => reply } } });
    return new QueryClient().fetchQuery(updatePreferencesQuery);
  };

  it("'Receber versões beta' (RN-ATUALIZA-010) chega como veio; ausente ou fora do formato vale desligado", async () => {
    expect((await read({ ...saved, receiveBeta: true })).receiveBeta).toBe(true);
    expect((await read({ ...saved, receiveBeta: false })).receiveBeta).toBe(false);
    for (const receiveBeta of [undefined, "true", 1, null, {}]) expect((await read({ ...saved, receiveBeta })).receiveBeta === true, JSON.stringify(receiveBeta)).toBe(false);
  });

  it("o resto fora do formato é resposta inválida, e a seção mostra a falha com 'Tentar de novo'", async () => {
    for (const reply of [null, "x", {}, { ...saved, checkOnStartup: "sim" }, { ...saved, skippedVersion: 2 }, { ...saved, lastCheckedAt: {} }]) await expect(read(reply), JSON.stringify(reply)).rejects.toThrow();
  });

  it("os campos que a tela não conhece não passam adiante", async () => {
    expect(await read({ ...saved, receiveBeta: true, caminho: "C:/segredo" })).toEqual({ ...saved, receiveBeta: true });
  });
});

describe("gravar as preferências pela ponte", () => {
  afterEach(() => vi.unstubAllGlobals());

  const saved: UpdatePreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: true };

  it("'Receber versões beta' manda só o booleano ao processo principal, e devolve o que ele gravou, conferido", async () => {
    const setReceiveBeta = vi.fn(async (value: boolean) => ({ ...saved, receiveBeta: value, extra: 1 }));
    vi.stubGlobal("window", { prism: { updates: { setReceiveBeta } } });

    await expect(saveReceiveBeta(true)).resolves.toEqual({ ...saved, receiveBeta: true });
    await expect(saveReceiveBeta(false)).resolves.toEqual({ ...saved, receiveBeta: false });
    expect(setReceiveBeta.mock.calls).toEqual([[true], [false]]);
  });

  it("'Verificar ao abrir' também passa pela conferência", async () => {
    const setCheckOnStartup = vi.fn(async (value: boolean) => ({ ...saved, checkOnStartup: value }));
    vi.stubGlobal("window", { prism: { updates: { setCheckOnStartup } } });

    await expect(saveCheckOnStartup(false)).resolves.toEqual({ ...saved, checkOnStartup: false });
    expect(setCheckOnStartup).toHaveBeenCalledWith(false);
  });

  it("a recusa do processo principal chega como falha", async () => {
    vi.stubGlobal("window", { prism: { updates: { setReceiveBeta: async () => Promise.reject(new Error("Pedido de atualização inválido.")) } } });

    await expect(saveReceiveBeta(true)).rejects.toThrow(/inválido/);
  });
});
