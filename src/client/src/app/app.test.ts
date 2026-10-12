import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiGate } from "@/app/_components/api-gate";
import { ToastProvider } from "@/components/ui";
import { UpdateDialog } from "@/components/update/update-dialog";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { App } from "./app";

// O roteador em hash lê `window` ao ser criado, e o vitest deste projeto não tem DOM: aqui só interessa onde cada coisa é montada.
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), createHashRouter: () => ({}) }));

describe("a casca do app", () => {
  const tree = App();
  const [provider] = elementsOf(tree);
  /** Os filhos diretos do provedor de avisos (um só ou vários), na ordem em que são montados. */
  const direct = ([provider.props.children].flat() as unknown[]).filter((child): child is Found => isValidElement(child));

  it("o diálogo de versão nova fica ACIMA do ApiGate: aparece também quando a API não sobe, que é quando a versão nova pode ser o conserto (RN-ATUALIZA-003)", () => {
    expect(provider.type).toBe(ToastProvider);
    expect(direct.map((element) => element.type)).toEqual([UpdateDialog, ApiGate]);
  });

  it("e é montado uma vez só: dentro do ApiGate não há outro", () => {
    const gate = direct.find((element) => element.type === ApiGate);

    expect(elementsOf(gate?.props.children as never).some((element) => element.type === UpdateDialog)).toBe(false);
    expect(elementsOf(tree).filter((element) => element.type === UpdateDialog)).toHaveLength(1);
  });
});
