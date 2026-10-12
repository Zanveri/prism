import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A divisa com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). O que se confere é o que cada evento do ponteiro e do
// teclado faz chegar a `onResize` e a `onFit`, e o que a divisa diz ao leitor de tela.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { maxWidth, minWidth } from "../_lib/grid-columns";
import { ColumnResizer } from "./column-resizer";

type Props = ComponentProps<typeof ColumnResizer>;
type Handlers = Record<string, (event: unknown) => void>;

const onResize = vi.fn();
const onFit = vi.fn();
const base: Props = { name: "name", width: 200, zoom: 1, last: false, onResize, onFit };

/** O elemento que a divisa desenha, com estas propriedades. */
function draw(over: Partial<Props> = {}) {
  const element = rt.render(() => ColumnResizer({ ...base, ...over }));
  return element.props as Record<string, unknown> & Handlers;
}

/** Um evento de ponteiro de mentira: o botão, a posição, e a captura anotada. */
function pointer(clientX: number, button = 0) {
  const captured: number[] = [];
  return { event: { button, clientX, pointerId: 7, preventDefault: vi.fn(), currentTarget: { setPointerCapture: (id: number) => captured.push(id) } }, captured };
}

function key(name: string, shiftKey = false) {
  return { key: name, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

beforeEach(() => {
  rt.unmount();
  vi.clearAllMocks();
});

describe("a divisa à direita do cabeçalho de cada coluna (RN-GRADE-009)", () => {
  it("é um separador vertical focável, com o nome da coluna, a largura de agora e os limites", () => {
    const props = draw();

    expect(props.role).toBe("separator");
    expect(props["aria-orientation"]).toBe("vertical");
    expect(props.tabIndex).toBe(0);
    expect(props["aria-label"]).toBe("Largura da coluna name");
    expect(props["aria-valuenow"]).toBe(200);
    expect(props["aria-valuemin"]).toBe(minWidth);
    expect(props["aria-valuemax"]).toBe(maxWidth);
    expect(props["aria-valuetext"]).toBe("200 px");
  });

  it("a área de pegar tem 8 px em qualquer zoom (pixels, e não a escala que o zoom muda), com o cursor de redimensionar; na última coluna fica dentro dela", () => {
    const classes = (props: Record<string, unknown>) => String(props.className).split(" ");

    expect(classes(draw())).toEqual(expect.arrayContaining(["w-[8px]", "-right-[4px]", "cursor-col-resize"]));
    expect(classes(draw({ last: true }))).toEqual(expect.arrayContaining(["w-[8px]", "right-0"]));
    // A última coluna não alarga a área rolável.
    expect(classes(draw({ last: true }))).not.toContain("-right-[4px]");
  });

  it("arrastar com o botão principal captura o ponteiro, e cada movimento pede a largura do ponto de partida mais o que o ponteiro andou", () => {
    const down = pointer(500);
    draw().onPointerDown(down.event);

    expect(down.captured).toEqual([7]);
    draw().onPointerMove(pointer(560).event);
    draw().onPointerMove(pointer(530).event);
    expect(onResize.mock.calls).toEqual([[260], [230]]);
  });

  it("no zoom, o ponteiro anda na escala da grade: em 200%, 60 px de ponteiro são 30 px de largura", () => {
    draw({ zoom: 2 }).onPointerDown(pointer(500).event);
    draw({ zoom: 2 }).onPointerMove(pointer(560).event);

    expect(onResize.mock.calls).toEqual([[230]]);
  });

  it.each(["onPointerUp", "onPointerCancel", "onLostPointerCapture"])("o arrasto termina em %s: o ponteiro que se move depois não muda nada", (end) => {
    draw().onPointerDown(pointer(500).event);
    draw()[end]({});
    draw().onPointerMove(pointer(700).event);

    expect(onResize).not.toHaveBeenCalled();
    expect(draw()["data-dragging"]).toBeUndefined();
  });

  it("enquanto arrasta, a divisa se marca (a linha de destaque fica acesa)", () => {
    draw().onPointerDown(pointer(500).event);
    expect(draw()["data-dragging"]).toBe("");
  });

  it("o botão do meio e o direito não arrastam, e mover o ponteiro sem arrasto não muda nada", () => {
    const right = pointer(500, 2);
    draw().onPointerDown(right.event);
    draw().onPointerMove(pointer(600).event);

    expect(right.captured).toEqual([]);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("o duplo clique ajusta a coluna ao conteúdo", () => {
    draw().onDoubleClick({});
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it("setas esquerda e direita mudam a largura em passos (Shift, maiores), dentro dos limites, sem rolar a grade", () => {
    const right = key("ArrowRight");
    draw().onKeyDown(right);
    draw().onKeyDown(key("ArrowLeft", true));
    draw({ width: minWidth }).onKeyDown(key("ArrowLeft"));

    expect(onResize.mock.calls).toEqual([[210], [150], [minWidth]]);
    expect(right.preventDefault).toHaveBeenCalled();
    // A tecla é da divisa: a grade (ou quem a envolve) não a trata de novo.
    expect(right.stopPropagation).toHaveBeenCalled();
  });

  it("Home leva à largura mínima, e Enter ajusta ao conteúdo, como o duplo clique", () => {
    draw().onKeyDown(key("Home"));
    draw().onKeyDown(key("Enter"));

    expect(onResize.mock.calls).toEqual([[minWidth]]);
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it("as outras teclas seguem o caminho delas: nada muda e o evento não é retido", () => {
    const tab = key("Tab");
    draw().onKeyDown(tab);

    expect(onResize).not.toHaveBeenCalled();
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(tab.stopPropagation).not.toHaveBeenCalled();
  });
});
