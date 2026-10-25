import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTabHistory, focusKindOf, type HistoryScreen } from "./tab-history-controller";

const state = { screen: "workbench" as HistoryScreen, open: new Set(["a", "b", "c"]), blocked: false, mac: false };
const activate = vi.fn<(tabId: string) => void>();
const leaveSettings = vi.fn<() => void>();

const make = () => createTabHistory({ screen: () => state.screen, openTabs: () => state.open, activate, leaveSettings, blocked: () => state.blocked, mac: state.mac });

/** Um alvo de evento de mentira: responde ao `closest` pelos seletores que o código usa. */
const target = (kind: "sql" | "text" | "other") => ({
  closest: (selector: string) => (selector === "[data-sql-editor]" ? (kind === "sql" ? {} : null) : kind === "text" ? {} : null),
});

const key = (name: string, extra: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; defaultPrevented: boolean; kind: "sql" | "text" | "other" }> = {}) => {
  const { kind = "other", ...rest } = extra;
  return { key: name, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, ...rest, target: target(kind) as unknown as EventTarget, preventDefault: vi.fn(), stopPropagation: vi.fn() };
};
const mouse = (button: number) => ({ button, preventDefault: vi.fn() });

/** Três abas ativadas em ordem: o histórico é a, b, c, com c de agora. */
function started() {
  const history = make();
  for (const tabId of ["a", "b", "c"]) history.observe(state.open, tabId);
  return history;
}

beforeEach(() => {
  Object.assign(state, { screen: "workbench", open: new Set(["a", "b", "c"]), blocked: false, mac: false });
  vi.clearAllMocks();
});

describe("o botão do mouse (RN-ABAS-018)", () => {
  it("o 'voltar' ativa a aba anterior, e o 'avançar' a seguinte, e o evento é seguro", () => {
    const history = started();

    const back = mouse(3);
    history.onMouseUp(back);
    expect(activate).toHaveBeenLastCalledWith("b");
    expect(back.preventDefault).toHaveBeenCalledOnce();

    history.observe(state.open, "b");
    history.onMouseUp(mouse(4));
    expect(activate).toHaveBeenLastCalledWith("c");
  });

  it("os outros botões não fazem nada", () => {
    const history = started();
    for (const button of [0, 1, 2, 5]) {
      const event = mouse(button);
      history.onMouseUp(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(activate).not.toHaveBeenCalled();
  });

  it("sem entrada para onde ir, nada acontece (e o clique continua seguro)", () => {
    const history = make();
    history.observe(state.open, "a");
    const event = mouse(3);
    history.onMouseUp(event);
    history.onMouseUp(mouse(4));

    expect(activate).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("nas Configurações o 'voltar' volta à área de trabalho, e o 'avançar' não faz nada", () => {
    const history = started();
    state.screen = "settings";

    history.onMouseUp(mouse(4));
    expect(leaveSettings).not.toHaveBeenCalled();

    history.onMouseUp(mouse(3));
    expect(leaveSettings).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it("no login, no desbloqueio e nas outras telas não faz nada, mas o clique é seguro", () => {
    const history = started();
    state.screen = "other";
    const event = mouse(3);
    history.onMouseUp(event);

    expect(activate).not.toHaveBeenCalled();
    expect(leaveSettings).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("o menu ou a lista que o próprio clique fechou (no pointerdown) ainda seguram o botão: vale o que havia ao apertar", () => {
    const history = started();
    state.blocked = true;
    history.onPointerDown({ button: 3 });
    // Ao soltar, o menu já saiu do DOM.
    state.blocked = false;
    const event = mouse(3);
    history.onMouseUp(event);

    expect(activate).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();

    // O aperto seguinte, sem nada aberto, age; o que se viu no aperto não passa de um clique para o outro.
    history.onPointerDown({ button: 3 });
    history.onMouseUp(mouse(3));
    expect(activate).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("o botão apertado sem nada aberto, e solto com um diálogo que abriu no meio, continua sem agir", () => {
    const history = started();
    history.onPointerDown({ button: 3 });
    state.blocked = true;
    history.onMouseUp(mouse(3));

    expect(activate).not.toHaveBeenCalled();
  });

  it("outros botões apertados não guardam nada", () => {
    const history = started();
    state.blocked = true;
    history.onPointerDown({ button: 0 });
    state.blocked = false;
    history.onMouseUp(mouse(3));

    expect(activate).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("com um diálogo aberto ou o cofre bloqueado, nada acontece", () => {
    const history = started();
    state.blocked = true;
    const event = mouse(3);
    history.onMouseUp(event);

    expect(activate).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("as teclas (RN-ABAS-018)", () => {
  it("Alt+← volta e Alt+→ avança, e a tecla é tratada", () => {
    const history = started();
    const back = key("ArrowLeft", { altKey: true });
    history.onKeyDown(back);

    expect(activate).toHaveBeenLastCalledWith("b");
    expect(back.preventDefault).toHaveBeenCalledOnce();
    // Não chega a quem estiver com o foco (a faixa de abas, a grade, o editor).
    expect(back.stopPropagation).toHaveBeenCalledOnce();

    history.observe(state.open, "b");
    history.onKeyDown(key("ArrowRight", { altKey: true }));
    expect(activate).toHaveBeenLastCalledWith("c");
  });

  it("num campo de texto a tecla segue para o campo", () => {
    const history = started();
    const event = key("ArrowLeft", { altKey: true, kind: "text" });
    history.onKeyDown(event);

    expect(activate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("a tecla que alguém já tratou fica com quem tratou", () => {
    const history = started();
    history.onKeyDown(key("ArrowLeft", { altKey: true, defaultPrevented: true }));

    expect(activate).not.toHaveBeenCalled();
  });

  it("com um diálogo aberto a tecla não é tratada", () => {
    const history = started();
    state.blocked = true;
    const event = key("ArrowLeft", { altKey: true });
    history.onKeyDown(event);

    expect(activate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("nas Configurações, Alt+← volta à área de trabalho", () => {
    const history = started();
    state.screen = "settings";
    history.onKeyDown(key("ArrowLeft", { altKey: true }));

    expect(leaveSettings).toHaveBeenCalledOnce();
  });

  it("no macOS valem Cmd+[ e Cmd+], menos no editor de SQL; Alt+← não vale", () => {
    state.mac = true;
    const history = started();

    history.onKeyDown(key("ArrowLeft", { altKey: true }));
    history.onKeyDown(key("[", { metaKey: true, kind: "sql" }));
    expect(activate).not.toHaveBeenCalled();

    history.onKeyDown(key("[", { metaKey: true }));
    expect(activate).toHaveBeenLastCalledWith("b");
  });
});

describe("o histórico", () => {
  it("quem foi para outra janela ou fechou é pulado", () => {
    const history = started();
    state.open = new Set(["a", "c"]);
    history.onMouseUp(mouse(3));

    expect(activate).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("zera ao reset: a aba ativa de agora volta a ser a primeira entrada", () => {
    const history = started();
    history.reset();
    history.observe(state.open, "c");
    history.onMouseUp(mouse(3));

    expect(activate).not.toHaveBeenCalled();
  });

  it("o foco: a aba que o Voltar ativou o recebe uma vez, e a que não foi pedida não", () => {
    const history = started();
    history.onMouseUp(mouse(3));

    expect(history.takeFocus("c")).toBe(false);
    history.onMouseUp(mouse(3));
    expect(history.takeFocus("a")).toBe(true);
    expect(history.takeFocus("a")).toBe(false);
  });

  it("a aba ativada por outro caminho depois de voltar descarta o que está à frente", () => {
    const history = started();
    history.onMouseUp(mouse(3));
    history.observe(state.open, "b");
    history.observe(state.open, "a");
    history.onMouseUp(mouse(4));

    // O "c" que estava à frente foi descartado: o 'avançar' não tem para onde ir.
    expect(activate).toHaveBeenCalledExactlyOnceWith("b");
  });
});

describe("focusKindOf: onde está o foco", () => {
  it.each([
    ["o editor de SQL", target("sql"), "editor"],
    ["um campo de texto", target("text"), "text"],
    ["qualquer outro lugar", target("other"), "other"],
    ["nada", null, "other"],
    ["o que não é um elemento (a janela)", {}, "other"],
  ])("%s", (_name, element, expected) => {
    expect(focusKindOf(element as unknown as EventTarget | null)).toBe(expected);
  });
});
