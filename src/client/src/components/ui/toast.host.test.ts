import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Host } from "@/lib/host/host";

// A pilha dos avisos aparece na janela que tem o foco, entre a da aba e as do resultado dela (RN-ABAS-015): no `body` dessa página, no canto de cima da barra
// de status na janela da aba e a 12 px da borda na janela do resultado, que não tem barra de status.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return { ...createHookRuntime(), focused: { value: null as unknown } };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-dom", async (importOriginal) => {
  const { createElement: element } = await import("react");
  return { ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: ReactNode, target: unknown) => element("portal", { target }, children) };
});
vi.mock("@/lib/host/host", () => ({ hostFocus: { subscribe: () => () => {}, getSnapshot: () => rt.focused.value } }));
vi.mock("./host-context", async () => {
  const { createElement: element } = await import("react");
  return { HostProvider: ({ host, children }: { host: unknown; children: ReactNode }) => element("host-provider", { host }, children) };
});

import { elementsOf } from "@/lib/testing/react-tree";

import { ToastStack } from "./toast";

const host = (name: string | null): Host => ({ document: { body: { name: `${name ?? "aba"}-body` } }, view: {}, resultWindow: name }) as unknown as Host;

const show = () => elementsOf(rt.render(() => ToastStack({ queue: [], onDismiss: vi.fn() }) as ReactNode));

beforeEach(() => rt.unmount());

describe("a pilha dos avisos (RN-ABAS-015)", () => {
  it("na janela da aba, vai para o `body` dela, acima da barra de status", () => {
    const tab = host(null);
    rt.focused.value = tab;

    const found = show();

    expect(found.find((element) => element.type === "portal")?.props.target).toBe(tab.document.body);
    expect(found.find((element) => element.props["aria-live"] === "polite")?.props.className).toContain("bottom-20");
  });

  it("na janela do resultado, que tem o foco, vai para o `body` dela e fica 12 px acima da borda de baixo", () => {
    const result = host("prism-result-0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e");
    rt.focused.value = result;

    const found = show();

    expect(found.find((element) => element.type === "portal")?.props.target).toBe(result.document.body);
    const stack = found.find((element) => element.props["aria-live"] === "polite")!;
    expect(stack.props.className).toContain("bottom-3");
    expect(stack.props.className).not.toContain("bottom-20");
    expect(found.find((element) => "host" in element.props)?.props.host).toBe(result);
  });
});
