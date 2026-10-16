import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";

// O botão da conexão e a lista aberta com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não
// tem DOM). O que se confere AQUI é o foco ao fechar a lista e ao escolher outra conexão: na hora, e antes da troca, porque a troca com alterações não
// salvas na grade abre a pergunta (RN-EDIT-007), e o diálogo dela guarda quem tem o foco ao abrir. O desenho do botão e da lista é de `connection-picker.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return { ...createHookRuntime(), connections: [] as Connection[] };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
// A lista vai num portal em `document.body`; aqui ela fica na árvore do botão, onde o teste a acha.
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: unknown) => children }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({ data: queryKey[0] === "connections" ? rt.connections : [] }),
}));
vi.mock("../_lib/use-connected-ids", () => ({ useConnectedIds: () => new Set<string>() }));

import { environmentLookup } from "@/app/connections/_lib/environment";
import { elementsOf } from "@/lib/testing/react-tree";

import { connectionChoices } from "../_lib/tab-connection";
import { ConnectionButtonView, ConnectionListPanel, ConnectionPicker, focusBack } from "./connection-picker";

function connection(id: string, name: string): Connection {
  return { id, folderID: null, name, engine: 3, host: "ifx.zanveri.local", port: 9089, database: "erp", userName: "informix", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: "", updatedAt: "" };
}

const erp = connection("c1", "ERP");
const mes = connection("c2", "MES");

/** O que pega o foco: o editor, o botão e o campo de busca. Ganhar o foco é virar o `document.activeElement` da página de mentira. */
class FakeElement {
  isConnected = true;
  constructor(readonly name: string) {}
  focus = vi.fn(() => {
    page.activeElement = this;
  });
  getBoundingClientRect() {
    return { left: 300, right: 480, top: 40, bottom: 72 };
  }
}

const page = { activeElement: null as FakeElement | null, addEventListener: vi.fn(), removeEventListener: vi.fn(), getElementById: () => null };
let editor: FakeElement;
let button: FakeElement;
let search: FakeElement;
const frame = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  rt.connections = [erp, mes];
  editor = new FakeElement("editor");
  button = new FakeElement("botão");
  search = new FakeElement("busca");
  page.activeElement = editor;
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", frame);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

/**
 * A lista aberta pelo Ctrl+9 com o foco no editor: o botão ganha o elemento dele (o `ref`), a lista abre, o efeito guarda quem tinha o foco, e o campo de
 * busca o pega. Devolve as propriedades que o botão dá à lista (o `onClose` é o `close` dele).
 */
function openFromEditor(props: ComponentProps<typeof ConnectionPicker>) {
  const closed = elementsOf(rt.render(() => ConnectionPicker({ ...props, open: false })));
  (closed.find((element) => element.type === ConnectionButtonView)!.props.buttonRef as { current: unknown }).current = button;

  rt.render(() => ConnectionPicker(props));
  const panel = elementsOf(rt.render(() => ConnectionPicker(props))).find((element) => element.type === ConnectionListPanel);
  search.focus();
  return panel!.props as unknown as ComponentProps<typeof ConnectionListPanel>;
}

describe("ConnectionPicker: o foco volta na hora a quem o tinha ao abrir a lista (RN-ARVORE-008)", () => {
  it("fechar pela lista devolve o foco ao editor do Ctrl+9 na hora, sem esperar o quadro seguinte, e fecha", () => {
    const props = { connectionId: "c1", busy: false, open: true, onOpenChange: vi.fn(), onChoose: vi.fn() };
    const panel = openFromEditor(props);

    panel.onClose(true);

    expect(page.activeElement).toBe(editor);
    expect(frame).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("o segundo Ctrl+9 vem de dentro da lista (a busca tem o foco, e o teclado dela não sobe à aba): ela fecha e devolve o foco ao editor", () => {
    const props = { connectionId: "c1", busy: false, open: true, onOpenChange: vi.fn(), onChoose: vi.fn() };
    openFromEditor(props);
    const dialog = elementsOf(rt.render(() => ConnectionPicker(props))).find((element) => element.props.role === "dialog");
    const keyDown = dialog!.props.onKeyDown as (event: unknown) => void;
    const press = (over: object = {}) => ({ key: "9", code: "Digit9", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });

    // Outras teclas ficam na lista e não fecham nada.
    const other = press({ key: "a", code: "KeyA", ctrlKey: false });
    keyDown(other);
    expect(other.stopPropagation).toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();

    const ctrl9 = press();
    keyDown(ctrl9);

    expect(ctrl9.stopPropagation).toHaveBeenCalled();
    expect(ctrl9.preventDefault).toHaveBeenCalled();
    expect(page.activeElement).toBe(editor);
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("o Cmd+9 do macOS também fecha a lista por dentro; com Shift, não", () => {
    const props = { connectionId: "c1", busy: false, open: true, onOpenChange: vi.fn(), onChoose: vi.fn() };
    openFromEditor(props);
    const dialog = elementsOf(rt.render(() => ConnectionPicker(props))).find((element) => element.props.role === "dialog");
    const keyDown = dialog!.props.onKeyDown as (event: unknown) => void;
    const press = (over: object) => ({ key: "9", code: "Digit9", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });

    keyDown(press({ shiftKey: true }));
    expect(props.onOpenChange).not.toHaveBeenCalled();

    keyDown(press({}));
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("\"Mostrar no navegador\" fecha sem devolver o foco: ele vai à linha da conexão na árvore", () => {
    const props = { connectionId: "c1", busy: false, open: true, onOpenChange: vi.fn(), onChoose: vi.fn() };
    const panel = openFromEditor(props);

    panel.onClose(false);

    expect(page.activeElement).toBe(search);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("escolher outra conexão devolve o foco ao editor ANTES da troca: a pergunta das alterações não salvas, aberta pela troca, guarda o editor, e não a busca (RN-EDIT-007)", () => {
    // O `onChoose` da aba passa pelo `guard`, que abre a pergunta; o diálogo dela lê o `document.activeElement` ao abrir, para devolvê-lo ao fechar.
    const openerOfQuestion: unknown[] = [];
    const props = { connectionId: "c1", busy: false, open: true, onOpenChange: vi.fn(), onChoose: vi.fn(() => void openerOfQuestion.push(page.activeElement)) };
    const panel = openFromEditor(props);
    rt.unmount();

    const list = rt.render(() => ConnectionListPanel(panel));
    (list.props.onChoose as (choice: unknown) => void)(connectionChoices([erp, mes], [], new Set()).find((choice) => choice.connection.id === "c2"));

    expect(props.onChoose).toHaveBeenCalledWith("c2");
    expect(openerOfQuestion).toEqual([editor]);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(frame).not.toHaveBeenCalled();
  });
});

describe("ConnectionListPanel: escolher fecha a lista antes de trocar (RN-ARVORE-008)", () => {
  const environments = environmentLookup([]);
  const mountList = (over: Partial<ComponentProps<typeof ConnectionListPanel>> = {}) => {
    const order: string[] = [];
    const props = { id: "lista", current: "c1", connections: [erp, mes], environments, busy: false, onClose: vi.fn(() => void order.push("fecha")), onChoose: vi.fn(() => void order.push("troca")), ...over };
    const show = () => rt.render(() => ConnectionListPanel(props)).props as unknown as { onKeyDown: (event: unknown) => void; onChoose: (choice: unknown) => void };
    return { props, order, show };
  };
  const key = (name: string) => ({ key: name, preventDefault: vi.fn() });

  it("pelo teclado: a seta marca a outra, e o Enter fecha (devolvendo o foco) e só então troca", () => {
    const { props, order, show } = mountList();

    show().onKeyDown(key("ArrowDown"));
    show().onKeyDown(key("Enter"));

    expect(order).toEqual(["fecha", "troca"]);
    expect(props.onClose).toHaveBeenCalledWith(true);
    expect(props.onChoose).toHaveBeenCalledWith("c2");
  });

  it("a conexão que já é a da aba só fecha; com comando em andamento, nada fecha nem troca", () => {
    const same = mountList();
    same.show().onKeyDown(key("Enter"));
    expect(same.order).toEqual(["fecha"]);
    rt.unmount();

    const busy = mountList({ busy: true });
    busy.show().onChoose(connectionChoices([erp, mes], [], new Set())[1]);
    expect(busy.order).toEqual([]);
  });
});

describe("focusBack: a quem volta o foco quando a lista fecha", () => {
  it("a quem o tinha ao abrir, se ainda está na página; senão, ao botão", () => {
    focusBack(editor as unknown as Element, button as unknown as HTMLElement);
    expect(page.activeElement).toBe(editor);

    editor.isConnected = false;
    focusBack(editor as unknown as Element, button as unknown as HTMLElement);
    expect(page.activeElement).toBe(button);

    focusBack(null, button as unknown as HTMLElement);
    expect(button.focus).toHaveBeenCalledTimes(2);
  });
});
