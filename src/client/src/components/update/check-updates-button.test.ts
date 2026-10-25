import { afterEach, describe, expect, it, vi } from "vitest";

import { checkNotice, runUpdateCheck } from "./check-updates-button";

describe("o que 'Verificar atualizações' diz (RN-ATUALIZA-002): o resultado sempre aparece", () => {
  it("versão nova não é aviso: é o diálogo", () => {
    expect(checkNotice({ outcome: "available" }, "0.1.0")).toBeNull();
  });

  it("atualizado, com a versão instalada", () => {
    expect(checkNotice({ outcome: "upToDate" }, "0.1.0")).toEqual({ tone: "success", title: "O Prism está atualizado.", description: "A versão instalada, 0.1.0, é a mais recente." });
    expect(checkNotice({ outcome: "upToDate" }, "")).toEqual({ tone: "success", title: "O Prism está atualizado.", description: undefined });
  });

  it("atualizado, mas a versão mais nova saiu sem o pacote deste sistema: o aviso diz qual", () => {
    expect(checkNotice({ outcome: "upToDate", withoutPackage: "0.2.0" }, "0.1.0")).toEqual({
      tone: "success",
      title: "O Prism está atualizado.",
      description: "A versão instalada, 0.1.0, é a mais recente que tem pacote para este sistema. A versão 0.2.0 saiu sem ele; o Prism oferece a próxima que tiver.",
    });
    expect(checkNotice({ outcome: "upToDate", withoutPackage: "0.2.0" }, "")).toMatchObject({ description: undefined });
  });

  it("sem origem", () => {
    expect(checkNotice({ outcome: "noSource" }, "0.1.0")).toMatchObject({ tone: "warning", title: "Este Prism não procura atualizações." });
  });

  it("a falha, com a causa", () => {
    expect(checkNotice({ outcome: "failed", reason: "net::ERR_CONNECTION_REFUSED" }, "0.1.0")).toEqual({ tone: "error", title: "Não foi possível verificar as atualizações.", description: "net::ERR_CONNECTION_REFUSED" });
  });

  it("um download ou uma instalação em andamento", () => {
    expect(checkNotice({ outcome: "busy" }, "0.1.0")).toMatchObject({ tone: "warning", title: "Há uma atualização em andamento." });
  });

  it("aberto com um argumento que desliga a conferência do certificado: diz por quê, em português, e o que fazer", () => {
    const notice = checkNotice({ outcome: "blocked" }, "0.1.0");

    expect(notice).toMatchObject({ tone: "warning", title: "As atualizações estão desligadas nesta abertura." });
    expect(notice?.description).toMatch(/linha de comando/);
    expect(notice?.description).toMatch(/certificado/);
    expect(notice?.description).toMatch(/Abra o Prism sem/);
    // Sem nome de argumento em inglês: quem lê não precisa dele para saber o que fazer.
    expect(`${notice?.title} ${notice?.description}`).not.toMatch(/ignore|resolver|host-|--/);
  });
});

describe("terminada a consulta, quem pediu é avisado (as Configurações releem as preferências: a hora da última verificação mudou)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const toast = () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() });
  const bridge = (check: () => Promise<unknown>) => vi.stubGlobal("window", { prism: { version: "0.1.0", updates: { check } } });

  it("depois do aviso do resultado, e uma vez só", async () => {
    bridge(async () => ({ outcome: "upToDate" }));
    const messages = toast();
    const order: string[] = [];
    messages.success.mockImplementation(() => order.push("aviso"));

    await runUpdateCheck(messages, () => order.push("avisou"));

    expect(order).toEqual(["aviso", "avisou"]);
  });

  it("também quando a consulta falha, porque o processo principal grava a hora da tentativa mesmo assim", async () => {
    bridge(async () => {
      throw new Error("sem rede");
    });
    const messages = toast();
    const onChecked = vi.fn();

    await runUpdateCheck(messages, onChecked);

    expect(messages.error).toHaveBeenCalledWith("Não foi possível verificar as atualizações.", "sem rede");
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it("sem ninguém para avisar, só mostra o resultado", async () => {
    bridge(async () => ({ outcome: "noSource" }));
    const messages = toast();

    await expect(runUpdateCheck(messages)).resolves.toBeUndefined();
    expect(messages.warning).toHaveBeenCalledTimes(1);
  });
});
