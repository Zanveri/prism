import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O `Select` com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM). O que se confere
// AQUI é o foco depois da escolha: ele volta ao controle na hora e antes do `onChange`, porque quem recebe a escolha pode abrir uma pergunta (a troca do
// banco da aba com alterações não salvas na grade, RN-ARVORE-007 com a RN-EDIT-007), e o diálogo dela guarda quem tem o foco ao abrir.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
// A lista vai num portal em `document.body`; aqui ela fica na árvore do controle, onde o teste a acha.
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: unknown) => children }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { panelWidthOf, Select } from "./select";

/** O controle: ganhar o foco é virar o `document.activeElement` da página de mentira. */
const control = {
  focus: vi.fn(() => {
    page.activeElement = control;
  }),
  getBoundingClientRect: () => ({ left: 300, right: 480, width: 180, top: 40, bottom: 72 }),
};
const body = { name: "body" };
const page = { activeElement: body as unknown, body, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const frame = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  page.activeElement = control;
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", frame);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

/** O `Select` com a lista aberta pela seta para baixo, como a pessoa a abre pelo teclado; o controle ganha o elemento dele (o `ref`). */
function openList(props: ComponentProps<typeof Select>) {
  const trigger = (found: Found[]) => found.find((element) => element.props.role === "combobox")!;
  const show = () => elementsOf(rt.render(() => Select(props)));

  (trigger(show()).props.ref as { current: unknown }).current = control;
  (trigger(show()).props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown", preventDefault: vi.fn() });
  show();
  return { show, trigger: () => trigger(show()), options: () => show().filter((element) => element.props.role === "option") };
}

describe("Select: o foco depois da escolha", () => {
  const options = [
    { value: "erp", label: "erp (padrão)" },
    { value: "vendas", label: "vendas" },
  ];

  it("o clique numa opção devolve o foco ao controle na hora, ANTES do onChange: a pergunta que a escolha abrir encontra o controle com o foco", () => {
    const focusedOnChange: unknown[] = [];
    const props = { value: "erp", options, "aria-label": "Banco", onChange: vi.fn(() => void focusedOnChange.push(page.activeElement)) };
    const list = openList(props);

    // O clique numa opção (que não pega foco) tira o foco do controle: ele cai no corpo da página.
    page.activeElement = body;
    (list.options()[1].props.onClick as () => void)();

    expect(props.onChange).toHaveBeenCalledWith("vendas");
    expect(focusedOnChange).toEqual([control]);
    expect(frame).not.toHaveBeenCalled();
    expect(list.trigger().props["aria-expanded"]).toBe(false);
  });

  it("pelo teclado, o Enter escolhe a opção marcada; o foco fica no controle, e nada adiado para o quadro seguinte o tira da pergunta que a escolha abrir", () => {
    const props = { value: "erp", options, "aria-label": "Banco", onChange: vi.fn() };
    const list = openList(props);

    (list.trigger().props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown", preventDefault: vi.fn() });
    (list.trigger().props.onKeyDown as (event: unknown) => void)({ key: "Enter", preventDefault: vi.fn() });

    expect(props.onChange).toHaveBeenCalledWith("vendas");
    expect(page.activeElement).toBe(control);
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("Select: a opção desabilitada", () => {
  it("fica na lista com `aria-disabled` e o motivo embaixo; escolhê-la (o clique, o Enter) não muda nada e deixa a lista aberta", () => {
    const onChange = vi.fn();
    const list = openList({
      value: "",
      onChange,
      options: [
        { value: "", label: "Não importar" },
        { value: "soma", label: "soma", disabled: true, hint: "O banco calcula esta coluna e não aceita valor." },
        { value: "total", label: "total", hint: "numeric(10,2)" },
      ],
    });
    const [, computed, total] = list.options();
    expect(computed.props["aria-disabled"]).toBe(true);
    expect(total.props["aria-disabled"]).toBeUndefined();
    (computed.props.onClick as () => void)();
    expect(onChange).not.toHaveBeenCalled();
    expect(list.options()).toHaveLength(3);
    (list.options()[2].props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledWith("total");
  });
});

describe("panelWidthOf: a largura da lista aberta", () => {
  it("sem `wideList`, a do controle", () => {
    expect(panelWidthOf({ left: 300, width: 180 }, 1280, false)).toEqual({ width: 180 });
  });

  it("com `wideList`, no mínimo o controle, no máximo o que resta da janela à direita dele (menos o espaço de 6 px), e a do maior texto no meio", () => {
    expect(panelWidthOf({ left: 300, width: 180 }, 1280, true)).toEqual({ width: "max-content", minWidth: 180, maxWidth: 974 });
    expect(panelWidthOf({ left: 8, width: 130 }, 1024, true)).toEqual({ width: "max-content", minWidth: 130, maxWidth: 1010 });
  });

  it("o controle junto da borda direita não deixa o máximo abaixo do mínimo: a lista nunca fica mais estreita que o controle", () => {
    expect(panelWidthOf({ left: 1200, width: 130 }, 1280, true)).toEqual({ width: "max-content", minWidth: 130, maxWidth: 130 });
  });
});

describe("Select com `wideList`: as opções não quebram", () => {
  const options = [
    { value: "", label: "Todos os ambientes" },
    { value: "erp", label: "erp (padrão)" },
  ];
  const listbox = (list: ReturnType<typeof openList>) => list.show().find((element) => element.props.role === "listbox")!;
  const classesOf = (element: { props: { className?: unknown } }) => String(element.props.className).split(" ");

  it("a lista mede no mínimo o controle e cresce até o maior texto, sem passar da janela; o texto da opção não quebra e termina em reticências quando a janela não deixa mais", () => {
    const list = openList({ value: "", options, onChange: vi.fn(), "aria-label": "Ambiente", wideList: true });

    expect(listbox(list).props.style).toMatchObject({ position: "fixed", left: 300, width: "max-content", minWidth: 180, maxWidth: 974 });
    for (const option of list.options()) {
      expect(classesOf(option)).toEqual(expect.arrayContaining(["whitespace-nowrap", "overflow-hidden", "text-ellipsis"]));
      expect(classesOf(option)).not.toContain("break-words");
    }
  });

  it("sem ela, a lista tem a largura do controle e o texto quebra, como sempre foi", () => {
    const list = openList({ value: "", options, onChange: vi.fn(), "aria-label": "Banco" });

    expect(listbox(list).props.style).toMatchObject({ position: "fixed", left: 300, width: 180 });
    expect(listbox(list).props.style).not.toHaveProperty("maxWidth");
    for (const option of list.options()) {
      expect(classesOf(option)).toContain("break-words");
      expect(classesOf(option)).not.toContain("whitespace-nowrap");
    }
  });
});
