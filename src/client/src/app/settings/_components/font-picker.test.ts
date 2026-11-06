import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

const queryState = vi.hoisted(() => ({
  data: [
    { family: "Cantarell", monospace: false },
    { family: "FiraCode Nerd Font", monospace: true },
    { family: "JetBrains Mono", monospace: true },
  ] as unknown,
  isFetching: false,
}));

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: unknown) => children }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => queryState,
}));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { FontPicker } from "./font-picker";

const inputElement = {
  select: vi.fn(),
  getBoundingClientRect: () => ({ left: 100, right: 360, width: 260, top: 80, bottom: 116 }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

function openPicker(props: ComponentProps<typeof FontPicker>) {
  const input = (found: Found[]) => found.find((element) => element.props.role === "combobox")!;
  const show = () => elementsOf(rt.render(() => FontPicker(props)));

  (input(show()).props.ref as { current: unknown }).current = inputElement;
  (input(show()).props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown", preventDefault: vi.fn() });
  show();
  return show().filter((element) => element.props.role === "option");
}

describe("FontPicker: prévia de cada fonte na lista (RN-CONFIG-008)", () => {
  it("cada opção da lista desenha o próprio nome na pilha daquela fonte (com a reserva do papel atrás), e a etiqueta 'do Prism' fica na fonte da interface", () => {
    const uiOptions = openPicker({
      id: "cfg-fonte-interface",
      label: "Fonte da interface",
      role: "ui",
      value: "IBM Plex Sans",
      onChange: vi.fn(),
      hintId: "cfg-fonte-interface-dica",
    });

    const spansOf = (option: Found) => elementsOf(option).filter((el) => el.type === "span");

    expect(spansOf(uiOptions[0]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["IBM Plex Sans", { fontFamily: "var(--font-app-sans)" }],
      ["do Prism", undefined],
    ]);
    expect(spansOf(uiOptions[1]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["Cantarell", { fontFamily: '"Cantarell", var(--font-app-sans)' }],
    ]);
    expect(spansOf(uiOptions[2]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["FiraCode Nerd Font", { fontFamily: '"FiraCode Nerd Font", var(--font-app-sans)' }],
    ]);

    rt.unmount();

    const editorOptions = openPicker({
      id: "cfg-fonte-editor",
      label: "Fonte do editor SQL",
      role: "editor",
      value: "IBM Plex Mono",
      onChange: vi.fn(),
      hintId: "cfg-fonte-editor-dica",
    });

    expect(spansOf(editorOptions[0]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["IBM Plex Mono", { fontFamily: "var(--font-mono)" }],
      ["do Prism", undefined],
    ]);
    expect(spansOf(editorOptions[1]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["FiraCode Nerd Font", { fontFamily: '"FiraCode Nerd Font", var(--font-mono)' }],
    ]);
    expect(spansOf(editorOptions[2]).map((span) => [span.props.children, span.props.style])).toEqual([
      ["JetBrains Mono", { fontFamily: '"JetBrains Mono", var(--font-mono)' }],
    ]);
  });
});
