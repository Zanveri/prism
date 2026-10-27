import { describe, expect, it, vi } from "vitest";

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { workbenchCopy } from "../_lib/workbench.copy";
import { NavigatorSearchField } from "./navigator-search-field";

const copy = workbenchCopy.navigator.search;

function drawn(value = "", handlers: Partial<Parameters<typeof NavigatorSearchField>[0]> = {}) {
  const focus = vi.fn();
  const inputRef = { current: { focus } as unknown as HTMLInputElement };
  const props = { value, onChange: vi.fn(), onFocusList: vi.fn(), inputRef, ...handlers };
  const all = elementsOf(NavigatorSearchField(props));
  return { props, focus, root: all[0], input: all.find((element) => element.type === "input") as Found, clear: all.find((element) => element.type === "button") };
}

/** Uma tecla no campo: o evento falso que o `onKeyDown` do `input` recebe. */
function press(field: ReturnType<typeof drawn>, key: string) {
  const event = { key, preventDefault: vi.fn() };
  (field.input.props.onKeyDown as (event: unknown) => void)(event);
  return event;
}

describe("o campo de busca do navegador: a linha dele, na largura toda (RN-BUSCA-001, RN-NAV-010)", () => {
  const classes = () => String(drawn().root.props.className).split(" ");

  it("a raiz tem a largura toda e a altura fixa de 32 px, sem base flexível: na coluna das duas linhas da barra, a base o faria crescer na altura", () => {
    expect(classes()).toEqual(expect.arrayContaining(["w-full", "h-8", "flex-none"]));
  });

  it("e não tem base flexível, nem `flex-1`, nem largura mínima de antes (dividia a linha com o seletor de ambiente)", () => {
    for (const name of classes()) {
      expect(name).not.toMatch(/^flex-\[/);
      expect(name).not.toBe("flex-1");
      expect(name).not.toBe("flex-auto");
      expect(name).not.toMatch(/^min-w-/);
    }
  });

  it("o `input` é o do `type=\"search\"` com o nome acessível \"Filtrar objetos\", e é nele que vão a referência e o texto", () => {
    const { input, props } = drawn("clien");

    expect(input.props).toMatchObject({ type: "search", "aria-label": copy.label, placeholder: copy.label, value: "clien", autoComplete: "off" });
    expect(input.props.ref).toBe(props.inputRef);
    (input.props.onChange as (event: unknown) => void)({ target: { value: "cliente" } });
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith("cliente");
  });
});

describe("o teclado do campo de busca (RN-BUSCA-001)", () => {
  it("Esc com texto limpa o campo, e a tecla é do campo", () => {
    const field = drawn("abc");
    const event = press(field, "Escape");

    expect(field.props.onChange).toHaveBeenCalledExactlyOnceWith("");
    expect(field.props.onFocusList).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("Esc com o campo vazio leva o foco à lista", () => {
    const field = drawn("");
    const event = press(field, "Escape");

    expect(field.props.onFocusList).toHaveBeenCalledOnce();
    expect(field.props.onChange).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("a seta para baixo e o Enter levam o foco à lista, com ou sem texto, e a tecla é do campo", () => {
    for (const value of ["", "abc"]) {
      for (const key of ["ArrowDown", "Enter"]) {
        const field = drawn(value);
        const event = press(field, key);

        expect(field.props.onFocusList).toHaveBeenCalledOnce();
        expect(field.props.onChange).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
    }
  });

  it("outra tecla não faz nada e segue para o campo", () => {
    for (const key of ["a", "ArrowUp", "Tab", "Home", "F2"]) {
      const field = drawn("abc");
      const event = press(field, key);

      expect(field.props.onFocusList).not.toHaveBeenCalled();
      expect(field.props.onChange).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("o \"Limpar a busca\" do campo (RN-BUSCA-001)", () => {
  it("só existe com texto", () => {
    expect(drawn("").clear).toBeUndefined();
    expect(drawn("a").clear?.props).toMatchObject({ "aria-label": copy.clear, title: copy.clear, type: "button" });
  });

  it("o clique limpa o texto e devolve o foco ao campo", () => {
    const field = drawn("abc");
    (field.clear!.props.onClick as () => void)();

    expect(field.props.onChange).toHaveBeenCalledExactlyOnceWith("");
    expect(field.focus).toHaveBeenCalledOnce();
  });
});
