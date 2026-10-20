import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Host } from "@/lib/host/host";

// O diálogo, o menu de contexto e a lista do `Select` abrem na PÁGINA de onde vieram (RN-ABAS-015 e 017): o `body` do documento dela, o foco e as medidas dela, e
// os ouvintes na janela dela. Sem `document` nem `window` globais (o vitest deste projeto não tem DOM): se o componente tocasse neles, o teste quebraria. Os
// ganchos do React são os simulados (`createHookRuntime`), e o portal vira um elemento que diz para onde iria.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return { ...createHookRuntime(), current: { value: null as unknown }, gone: { calls: [] as { host: unknown; active: boolean; onGone: () => void }[] } };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-dom", async (importOriginal) => {
  const { createElement: element } = await import("react");
  return { ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: ReactNode, target: unknown) => element("portal", { target }, children) };
});
vi.mock("./host-context", async () => {
  const { createElement: element } = await import("react");
  return { useHost: () => rt.current.value, useOnHostGone: (host: unknown, active: boolean, onGone: () => void) => void rt.gone.calls.push({ host, active, onGone }), HostProvider: ({ host, children }: { host: unknown; children: ReactNode }) => element("host-provider", { host }, children) };
});

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { ContextMenu, moveFocus } from "./context-menu";
import { Dialog } from "./dialog";
import { Select } from "./select";

/** Uma página de mentira: o documento (com o `body` e o elemento focado), a janela dele (as medidas e os ouvintes), e o nome da janela do resultado. */
function page(name: string | null) {
  const body = { name: `${name ?? "aba"}-body` };
  const active = { value: body as unknown };
  const document = { body, get activeElement() { return active.value; }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const view = { innerWidth: 900, innerHeight: 600, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const host = { document, view, resultWindow: name } as unknown as Host;
  return { host, document, view, body, active };
}

let main: ReturnType<typeof page>;
let result: ReturnType<typeof page>;

beforeEach(() => {
  rt.gone.calls.length = 0;
  main = page(null);
  result = page("prism-result-0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e");
  rt.current.value = main.host;
});

afterEach(() => rt.unmount());

const portalOf = (found: Found[]) => found.find((element) => element.type === "portal")?.props.target;

describe("Dialog: abre na página de onde veio e fica nela até fechar (RN-ABAS-015 e 017)", () => {
  const show = (open: boolean) => elementsOf(rt.render(() => Dialog({ open, title: "Exportar dados", onClose: vi.fn() }) as ReactNode));

  it("na janela do resultado, o portal vai para o `body` da página dela, e o conteúdo recebe a página como contexto", () => {
    rt.current.value = result.host;

    const found = show(true);

    expect(portalOf(found)).toBe(result.body);
    expect(found.find((element) => "host" in element.props)?.props.host).toBe(result.host);
  });

  it("na janela da aba, vai para o `body` dela", () => {
    expect(portalOf(show(true))).toBe(main.body);
  });

  it("a página é a de quando abriu: se a pessoa muda de janela com o diálogo aberto, ele não pula para a outra", () => {
    rt.current.value = result.host;
    show(false);
    show(true);

    rt.current.value = main.host;
    const found = show(true);

    expect(portalOf(found)).toBe(result.body);
  });

  it("o próximo diálogo abre na página de agora", () => {
    rt.current.value = result.host;
    show(true);
    show(false);

    rt.current.value = main.host;

    expect(portalOf(show(true))).toBe(main.body);
  });

  it("o foco que volta ao fechar é o da página em que abriu", () => {
    const opener = { focus: vi.fn(), nodeType: 1 };
    result.active.value = opener;
    rt.current.value = result.host;
    show(true);

    rt.unmount();
    // A limpeza do efeito devolve o foco a quem o tinha.
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

describe("a página da janela do resultado que sai fecha o que abriu nela (RN-ABAS-011)", () => {
  it("o diálogo se fecha como no Esc, e com a ação rodando fica", () => {
    rt.current.value = result.host;
    const onClose = vi.fn();
    elementsOf(rt.render(() => Dialog({ open: true, title: "Exportar dados", onClose }) as ReactNode));

    const { host, active, onGone } = rt.gone.calls.at(-1)!;
    expect(host).toBe(result.host);
    expect(active).toBe(true);
    onGone();
    expect(onClose).toHaveBeenCalledTimes(1);

    const busy = vi.fn();
    elementsOf(rt.render(() => Dialog({ open: true, title: "Exportar dados", pending: true, onClose: busy }) as ReactNode));
    rt.gone.calls.at(-1)!.onGone();
    expect(busy).not.toHaveBeenCalled();
  });

  it("o diálogo fechado não ouve", () => {
    elementsOf(rt.render(() => Dialog({ open: false, title: "Exportar dados", onClose: vi.fn() }) as ReactNode));

    expect(rt.gone.calls.at(-1)?.active).toBe(false);
  });
});

describe("ContextMenu: mede, ouve e abre na página do controle (RN-ABAS-017)", () => {
  const show = () => elementsOf(rt.render(() => ContextMenu({ label: "Menu", point: { x: 10, y: 20 }, groups: [[{ id: "a", label: "A" }]], onClose: vi.fn() }) as ReactNode));

  it("o portal vai para o `body` da página, e os ouvintes do ponteiro, da rolagem e do tamanho ficam no documento e na janela dela", () => {
    rt.current.value = result.host;

    const found = show();

    expect(portalOf(found)).toBe(result.body);
    expect(result.document.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    for (const type of ["scroll", "resize", "blur"]) expect(result.view.addEventListener).toHaveBeenCalledWith(type, expect.any(Function), ...(type === "scroll" ? [true] : []));
    expect(main.document.addEventListener).not.toHaveBeenCalled();
    expect(main.view.addEventListener).not.toHaveBeenCalled();
  });

  it("ao fechar, solta os ouvintes da mesma página", () => {
    rt.current.value = result.host;
    show();

    rt.unmount();

    expect(result.document.removeEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(result.view.removeEventListener).toHaveBeenCalledWith("blur", expect.any(Function));
  });

  it("as setas andam pelos itens a partir do elemento focado NA PÁGINA do menu", () => {
    const items = ["a", "b", "c"].map((id) => ({ id, focus: vi.fn(), nodeType: 1 }));
    const menu = { ownerDocument: { activeElement: items[1] }, querySelectorAll: () => items } as unknown as ParentNode;

    expect(moveFocus({ key: "ArrowDown", preventDefault: vi.fn() }, menu)).toBe(true);

    expect(items[2].focus).toHaveBeenCalledTimes(1);
    expect(items[0].focus).not.toHaveBeenCalled();
  });
});

describe("Select: a lista abre na página do controle (RN-ABAS-017)", () => {
  const options = [
    { value: "erp", label: "erp" },
    { value: "vendas", label: "vendas" },
  ];

  function open() {
    const trigger = (found: Found[]) => found.find((element) => element.props.role === "combobox")!;
    const render = () => elementsOf(rt.render(() => Select({ value: "erp", options, onChange: vi.fn(), "aria-label": "Banco" }) as ReactNode));
    (trigger(render()).props.ref as { current: unknown }).current = { getBoundingClientRect: () => ({ left: 10, right: 100, top: 40, bottom: 72 }), focus: vi.fn() };
    (trigger(render()).props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown", preventDefault: vi.fn() });
    // A primeira renderização depois de abrir mede a lista (o efeito); a seguinte a desenha no lugar.
    render();
    return render();
  }

  it("o portal vai para o `body` da página, e a rolagem, o tamanho e o clique fora são ouvidos nela", () => {
    rt.current.value = result.host;

    const found = open();

    expect(portalOf(found)).toBe(result.body);
    expect(result.view.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(result.view.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(result.document.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(main.view.addEventListener).not.toHaveBeenCalled();
  });

  it("abre para cima ou para baixo pela altura da janela da página (e não pela da janela da aba)", () => {
    rt.current.value = result.host;
    const found = open();

    const list = found.find((element) => element.props.role === "listbox")!;
    // O controle está a 72 px do alto numa janela de 600 px: há espaço embaixo, então a lista abre para baixo.
    expect((list.props.style as { top?: number }).top).toBeDefined();
    expect((list.props.style as { bottom?: number }).bottom).toBeUndefined();
  });
});
