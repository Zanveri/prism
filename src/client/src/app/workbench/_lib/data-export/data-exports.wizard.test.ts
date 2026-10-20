import { afterEach, describe, expect, it, vi } from "vitest";

import type { Host } from "@/lib/host/host";

// O assistente "Exportar dados" abre na janela de onde o pedido veio (RN-ABAS-015): a do resultado, se o pedido nasceu nela, e senão a que tem o foco. O estado
// do assistente é de módulo; aqui o gancho que o lê é o simulado, e a página com o foco, a de mentira.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() }));

const focus = vi.hoisted(() => ({ host: null as unknown }));
vi.mock("@/lib/host/host", () => ({ focusedHost: () => focus.host }));

import type { ExportSource } from "./export-source";
import { closeExportWizard, openExportWizard, useExportWizard } from "./data-exports";

const source = { connectionId: "c1", origin: { kind: "table", view: false, schema: "public", name: "pedidos" }, columns: null, unsavedEdits: 0 } as unknown as ExportSource;
const host = (name: string | null) => ({ document: {}, view: {}, resultWindow: name }) as unknown as Host;

afterEach(() => closeExportWizard());

describe("openExportWizard: a página onde o assistente abre (RN-ABAS-015)", () => {
  it("abre na página dada (a da janela do resultado, quando o pedido nasceu nela)", () => {
    const result = host("prism-result-0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e");

    openExportWizard(source, result);

    expect(useExportWizard()?.host).toBe(result);
    expect(useExportWizard()?.source).toBe(source);
  });

  it("sem página dada, abre na da janela que tem o foco", () => {
    const focused = host(null);
    focus.host = focused;

    openExportWizard(source);

    expect(useExportWizard()?.host).toBe(focused);
  });

  it("cada abertura é um assistente novo (a chave muda), na página de agora; fechar o tira", () => {
    focus.host = host(null);
    openExportWizard(source);
    const first = useExportWizard();

    openExportWizard(source, host("prism-result-1c0a3d2f-9b5e-4a7c-8d4f-2e3b4c5d6e7f"));
    expect(useExportWizard()?.key).not.toBe(first?.key);
    expect(useExportWizard()?.host.resultWindow).toBe("prism-result-1c0a3d2f-9b5e-4a7c-8d4f-2e3b4c5d6e7f");

    closeExportWizard();
    expect(useExportWizard()).toBeNull();
  });
});
