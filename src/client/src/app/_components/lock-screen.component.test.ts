import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pathsConfig } from "@/config/paths.config";
import { ApiRequestError, userActionDeadlineMs } from "@/lib/api/prism-api";

import { LockDialog, LockScreen, LockScreenView, type LockScreenViewProps } from "./lock-screen";

// A `LockScreen` com os ganchos simulados (o vitest deste projeto não tem DOM): o que interessa é como ela liga o usuário do cofre, as mutações,
// o diálogo modal e o ouvinte de teclado. As partes puras (tratadores, `unlockVault`, `blockOutsideKeys`) têm os testes delas.
type Effect = () => void | (() => void);

const mocks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  layoutEffects: [] as Effect[],
  effects: [] as Effect[],
  mutationOptions: [] as Record<string, unknown>[],
  navigate: vi.fn(),
  clear: vi.fn(),
  session: { data: { userName: "marina" } as { userName: string } | undefined },
  signInOrRefuse: vi.fn(),
  signOut: vi.fn(),
  parseForm: vi.fn(),
  leave: { isPending: false, isError: false, error: undefined as unknown, mutate: vi.fn() },
  unlock: { isPending: false, isError: false, error: undefined as unknown, data: undefined as unknown, mutate: vi.fn(), reset: vi.fn() },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useId: () => "id",
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    mocks.refs.push(ref);
    return ref;
  },
  useState: (initial: unknown) => [initial, vi.fn()],
  useLayoutEffect: (effect: Effect) => void mocks.layoutEffects.push(effect),
  useEffect: (effect: Effect) => void mocks.effects.push(effect),
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => mocks.session,
  useQueryClient: () => ({ clear: mocks.clear }),
  // Em cada renderização a tela chama `useMutation` duas vezes, nesta ordem: o "Sair" e o desbloqueio.
  useMutation: (options: Record<string, unknown>) => {
    mocks.mutationOptions.push(options);
    return mocks.mutationOptions.length % 2 === 1 ? mocks.leave : mocks.unlock;
  },
}));
vi.mock("@/app/sign-in/_lib/sign-in.service", () => ({
  sessionQuery: { queryKey: ["session"] },
  signInOrRefuse: (...args: unknown[]) => mocks.signInOrRefuse(...args),
  signOut: (...args: unknown[]) => mocks.signOut(...args),
}));
vi.mock("@/lib/utils/form", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/utils/form")>()), parseForm: (...args: unknown[]) => mocks.parseForm(...args) }));

beforeEach(() => {
  mocks.refs.length = 0;
  mocks.layoutEffects.length = 0;
  mocks.effects.length = 0;
  mocks.mutationOptions.length = 0;
  for (const mock of [mocks.navigate, mocks.clear, mocks.signInOrRefuse, mocks.signOut, mocks.parseForm, mocks.leave.mutate, mocks.unlock.mutate, mocks.unlock.reset]) mock.mockReset();
  mocks.session = { data: { userName: "marina" } };
  mocks.leave.isPending = mocks.leave.isError = false;
  mocks.unlock.isPending = mocks.unlock.isError = false;
  mocks.leave.error = mocks.unlock.error = mocks.unlock.data = undefined;
});
afterEach(() => vi.unstubAllGlobals());

function render(closeState: "closing" | "retrying" | "closed" | "gaveUp" = "closed", onUnlocked = vi.fn()) {
  const element = LockScreen({ closeState, onUnlocked }) as ReactElement<{ children: ReactElement<LockScreenViewProps> }>;
  const [dialogRef, formRef] = mocks.refs;
  const [leaveOptions, unlockOptions] = mocks.mutationOptions;
  return { element, view: element.props.children as ReactElement<LockScreenViewProps>, dialogRef, formRef, leaveOptions, unlockOptions, onUnlocked };
}

describe("LockScreen: o usuário, as mutações e o que o diálogo faz", () => {
  it("o desbloqueio entra pelo usuário da sessão que bloqueou, com a senha digitada, e só então avisa que desbloqueou", async () => {
    mocks.signInOrRefuse.mockResolvedValue({ ok: true, data: { unlocked: true, userName: "marina" } });
    const { unlockOptions, onUnlocked } = render();

    const result = await (unlockOptions.mutationFn as (password: string) => Promise<unknown>)("a-senha");

    expect(mocks.signInOrRefuse).toHaveBeenCalledExactlyOnceWith({ userName: "marina", password: "a-senha" }, expect.any(AbortSignal));
    expect(result).toEqual({ kind: "unlocked" });
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it("a mutação de entrar não guarda a senha (gcTime 0), sai sem rede e é calada; a de sair também sai sem rede e é calada", () => {
    const { unlockOptions, leaveOptions } = render();

    expect(unlockOptions).toMatchObject({ gcTime: 0, networkMode: "always", meta: { silent: true } });
    expect(leaveOptions).toMatchObject({ networkMode: "always", meta: { silent: true } });
  });

  it("a resposta que não confere leva à saída de verdade (ao login, e tudo é descartado), e o desbloqueio que deu certo não faz mais nada", () => {
    const { unlockOptions } = render();

    (unlockOptions.onSuccess as (result: unknown) => void)({ kind: "mismatch" });
    expect(mocks.leave.mutate).toHaveBeenCalledOnce();

    mocks.leave.mutate.mockClear();
    (unlockOptions.onSuccess as (result: unknown) => void)({ kind: "unlocked" });
    expect(mocks.leave.mutate).not.toHaveBeenCalled();
  });

  it("senha recusada: o campo volta vazio e com o foco; o cofre de um Prism mais novo não é erro de senha, e o que a pessoa digitou fica", () => {
    const field = { value: "senha-errada", focus: vi.fn() };
    const { unlockOptions, formRef } = render();
    formRef.current = { querySelector: (selector: string) => (selector === '[name="password"]' ? field : null) };

    (unlockOptions.onSuccess as (result: unknown) => void)({ kind: "refused", code: "VAULT_FORMAT_UNSUPPORTED" });
    expect(field).toMatchObject({ value: "senha-errada" });
    expect(field.focus).not.toHaveBeenCalled();

    (unlockOptions.onSuccess as (result: unknown) => void)({ kind: "refused", code: "INVALID_CREDENTIALS" });
    expect(field.value).toBe("");
    expect(field.focus).toHaveBeenCalledOnce();
  });

  it("Sair: a saída de verdade leva ao login (trocando a entrada do histórico) e esvazia o cache, que era do usuário", () => {
    const { leaveOptions } = render();

    (leaveOptions.onSuccess as () => void)();

    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(pathsConfig.signIn, { replace: true });
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it("o diálogo abre como modal com o foco na senha, e ao sair de cena fecha (o foco volta a quem o tinha)", () => {
    const password = { focus: vi.fn() };
    const dialog = { showModal: vi.fn(), close: vi.fn(), querySelector: (selector: string) => (selector === '[name="password"]' ? password : null) };
    const { dialogRef } = render();
    dialogRef.current = dialog;

    const cleanup = mocks.layoutEffects[0]() as () => void;

    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(password.focus).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
    cleanup();
    expect(dialog.close).toHaveBeenCalledOnce();
  });

  it("o teclado de fora do diálogo é cortado na janela, na captura, enquanto a tela existe; soltar tira o ouvinte", () => {
    const added: unknown[][] = [];
    const removed: unknown[][] = [];
    vi.stubGlobal("window", { addEventListener: (...args: unknown[]) => void added.push(args), removeEventListener: (...args: unknown[]) => void removed.push(args) });
    render();

    const cleanup = mocks.effects[0]() as () => void;

    expect(added).toHaveLength(1);
    expect(added[0].slice(0, 1)).toEqual(["keydown"]);
    expect(added[0][2]).toBe(true);
    cleanup();
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);
  });

  it("quem decide o que é 'de fora' é o diálogo da tela: o alvo que ele contém passa (a senha sendo digitada), qualquer outro, e a ausência de alvo, é cortado", () => {
    class FakeNode {}
    const inside = new FakeNode();
    const outside = new FakeNode();
    const listeners: ((event: unknown) => void)[] = [];
    vi.stubGlobal("Node", FakeNode);
    vi.stubGlobal("window", { addEventListener: (_type: string, listener: (event: unknown) => void) => void listeners.push(listener), removeEventListener: vi.fn() });
    const { dialogRef } = render();
    dialogRef.current = { contains: (node: unknown) => node === inside };
    mocks.effects[0]();

    const press = (target: unknown) => {
      const event = { target, key: "x", stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() };
      listeners[0](event);
      return event.stopImmediatePropagation;
    };

    expect(press(inside)).not.toHaveBeenCalled();
    expect(press(outside)).toHaveBeenCalledOnce();
    expect(press(null)).toHaveBeenCalledOnce();
  });
});

describe("LockScreen: o que ela entrega ao desenho", () => {
  it("o diálogo leva o conteúdo da tela, ligado ao título", () => {
    const { element } = render();

    expect(element.type).toBe(LockDialog);
    expect(element.props).toMatchObject({ titleId: "id" });
    expect(element.props.children.type).toBe(LockScreenView);
  });

  it("o usuário mostrado é o da sessão, o estado do fechamento é o recebido, e nada está em curso", () => {
    const { view } = render("retrying");

    expect(view.props).toMatchObject({ userName: "marina", closeState: "retrying", unlocking: false, signingOut: false, failure: null, refusal: null });
  });

  it("a recusa que a tela mostra é só a de senha (ou a do cofre mais novo); outro código não vira frase", () => {
    mocks.unlock.data = { kind: "refused", code: "INVALID_CREDENTIALS" };
    expect(render().view.props.refusal).toBe("INVALID_CREDENTIALS");

    mocks.refs.length = mocks.mutationOptions.length = 0;
    mocks.unlock.data = { kind: "refused", code: "VAULT_FORMAT_UNSUPPORTED" };
    expect(render().view.props.refusal).toBe("VAULT_FORMAT_UNSUPPORTED");

    mocks.refs.length = mocks.mutationOptions.length = 0;
    mocks.unlock.data = { kind: "refused", code: "OUTRO_CODIGO" };
    expect(render().view.props.refusal).toBeNull();
  });

  it("a falha de entrar ou de sair vira a frase da própria tela, e o que está em curso desabilita os botões", () => {
    mocks.unlock.isError = true;
    expect(render().view.props.failure).toBe("unlock");

    mocks.refs.length = mocks.mutationOptions.length = 0;
    mocks.unlock.isError = false;
    mocks.leave.isError = true;
    expect(render().view.props.failure).toBe("signOut");

    mocks.refs.length = mocks.mutationOptions.length = 0;
    mocks.leave.isError = false;
    mocks.unlock.isPending = true;
    expect(render().view.props).toMatchObject({ unlocking: true, signingOut: false });

    mocks.refs.length = mocks.mutationOptions.length = 0;
    mocks.unlock.isPending = false;
    mocks.leave.isPending = true;
    expect(render().view.props).toMatchObject({ unlocking: false, signingOut: true });
  });

  it("Sair é o botão que dispara a saída de verdade", () => {
    render().view.props.onSignOut();

    expect(mocks.leave.mutate).toHaveBeenCalledOnce();
  });
});

describe("LockScreen: enviar a senha", () => {
  const submit = (closeState: "closing" | "retrying" | "closed" | "gaveUp") => {
    const event = { preventDefault: vi.fn(), currentTarget: {} };
    render(closeState).view.props.onSubmit(event as never);
    return event;
  };

  it("com o cofre ainda fechando (ou tentando de novo) enviar não faz nada: o desbloqueio abriria o cofre e o fechamento a caminho o fecharia por cima", () => {
    mocks.parseForm.mockReturnValue({ ok: true, data: { password: "a-senha" } });

    for (const state of ["closing", "retrying"] as const) {
      const event = submit(state);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    expect(mocks.unlock.mutate).not.toHaveBeenCalled();
    expect(mocks.unlock.reset).not.toHaveBeenCalled();
  });

  it("com o cofre fechado (ou desistido de fechar) envia a senha digitada, depois de limpar a resposta anterior", () => {
    mocks.parseForm.mockReturnValue({ ok: true, data: { password: "a-senha" } });

    for (const state of ["closed", "gaveUp"] as const) {
      mocks.unlock.mutate.mockClear();
      submit(state);
      expect(mocks.unlock.reset).toHaveBeenCalled();
      expect(mocks.unlock.mutate).toHaveBeenCalledExactlyOnceWith("a-senha");
    }
  });

  it("a senha vazia não vai à API: a recusa fica no campo", () => {
    mocks.parseForm.mockReturnValue({ ok: false, errors: { password: "Informe a senha." } });

    submit("closed");

    expect(mocks.unlock.mutate).not.toHaveBeenCalled();
  });

  it("não envia de novo enquanto um pedido está a caminho", () => {
    mocks.parseForm.mockReturnValue({ ok: true, data: { password: "a-senha" } });
    mocks.unlock.isPending = true;

    submit("closed");

    expect(mocks.unlock.mutate).not.toHaveBeenCalled();
  });
});

describe("LockScreen: Sair e Desbloquear têm prazo, e a falta de resposta é dita (rodada 3)", () => {
  afterEach(() => vi.restoreAllMocks());

  const noResponse = () => new ApiRequestError({ status: 0, code: "NETWORK_ERROR", title: "Sem resposta da API.", detail: null, errors: null, extensions: {} });
  const unavailable = () => new ApiRequestError({ status: 503, code: "VAULT_UNAVAILABLE", title: "Cofre indisponível.", detail: null, errors: null, extensions: {} });

  it("Sair: a chamada leva um sinal que se cancela em userActionDeadlineMs (a API que não responde não deixa a tela em Saindo… para sempre)", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    mocks.signOut.mockResolvedValue({ ok: true, data: undefined });
    const { leaveOptions } = render();

    await (leaveOptions.mutationFn as () => Promise<unknown>)();

    expect(timeout).toHaveBeenCalledExactlyOnceWith(userActionDeadlineMs);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(signal);
  });

  it("Desbloquear: a chamada de entrada leva um sinal com o mesmo prazo, e cada tentativa tem o seu", async () => {
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(first).mockReturnValueOnce(second);
    mocks.signInOrRefuse.mockResolvedValue({ ok: true, data: { unlocked: true, userName: "marina" } });
    const { unlockOptions } = render();
    const unlock = unlockOptions.mutationFn as (password: string) => Promise<unknown>;

    await unlock("a-senha");
    await unlock("a-senha");

    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(userActionDeadlineMs);
    expect(mocks.signInOrRefuse.mock.calls).toEqual([
      [{ userName: "marina", password: "a-senha" }, first],
      [{ userName: "marina", password: "a-senha" }, second],
    ]);
  });

  it("o desbloqueio sem resposta (o prazo acabou, ou a API caiu): a tela diz que o serviço não respondeu, e nada fica pendente: os botões voltam a aceitar ação", () => {
    mocks.unlock.isError = true;
    mocks.unlock.error = noResponse();

    const { view } = render();

    expect(view.props).toMatchObject({ failure: "unlockNoResponse", unlocking: false, signingOut: false });
  });

  it("o Sair sem resposta: a tela diz que o serviço não respondeu, e os botões voltam a aceitar ação", () => {
    mocks.leave.isError = true;
    mocks.leave.error = noResponse();

    const { view } = render();

    expect(view.props).toMatchObject({ failure: "signOutNoResponse", unlocking: false, signingOut: false });
  });

  it("qualquer outra falha segue com a frase de sempre", () => {
    mocks.unlock.isError = true;
    mocks.unlock.error = unavailable();
    expect(render().view.props.failure).toBe("unlock");

    mocks.refs.length = 0;
    mocks.mutationOptions.length = 0;
    mocks.unlock.isError = false;
    mocks.leave.isError = true;
    mocks.leave.error = new Error("outra coisa");
    expect(render().view.props.failure).toBe("signOut");
  });
});
