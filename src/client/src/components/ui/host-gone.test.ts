import { afterEach, describe, expect, it, vi } from "vitest";

import { resultHostRegistry, type Host } from "@/lib/host/host";

// O que abriu na página de uma janela do resultado fecha quando a página sai (RN-ABAS-011): `useOnHostGone` assina a lista de janelas do resultado e avisa quando a
// página de quem chama deixa de estar nela. Sem DOM: as páginas são de mentira e os ganchos do React são os simulados.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { useOnHostGone } from "./host-context";

function fakeHost(resultWindow: string | null): Host {
  const view = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return { document: {}, view, resultWindow } as unknown as Host;
}

afterEach(() => {
  rt.unmount();
  for (const host of resultHostRegistry.list()) resultHostRegistry.remove(host);
});

const show = (host: Host, active: boolean, onGone: () => void) =>
  rt.render(() => {
    useOnHostGone(host, active, onGone);
    return null;
  });

describe("useOnHostGone (RN-ABAS-011)", () => {
  it("a página da janela do resultado que sai da lista avisa uma vez", () => {
    const host = fakeHost("prism-result-a");
    resultHostRegistry.add(host);
    const gone = vi.fn();
    show(host, true, gone);

    expect(gone).not.toHaveBeenCalled();
    resultHostRegistry.remove(host);

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("outra janela do resultado que sai não avisa quem está na que continua", () => {
    const stays = fakeHost("prism-result-a");
    const leaves = fakeHost("prism-result-b");
    resultHostRegistry.add(stays);
    resultHostRegistry.add(leaves);
    const gone = vi.fn();
    show(stays, true, gone);

    resultHostRegistry.remove(leaves);

    expect(gone).not.toHaveBeenCalled();
  });

  it("a janela da aba não sai, e o que está fechado não ouve", () => {
    const main = fakeHost(null);
    const result = fakeHost("prism-result-a");
    resultHostRegistry.add(result);
    const gone = vi.fn();
    show(main, true, gone);
    rt.unmount();
    show(result, false, gone);

    resultHostRegistry.remove(result);

    expect(gone).not.toHaveBeenCalled();
  });
});
