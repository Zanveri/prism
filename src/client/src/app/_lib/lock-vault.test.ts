import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ApiResult } from "@/lib/api/prism-api";

import { closeBackoffMs, closeDeadlineMs, createLockVaultDeps, createUnlockHandler, lockVault, unlockBlocked, unlockMutationOptions, unlockVault, type CloseState, type LockVaultDeps } from "./lock-vault";

/** As dependências de mentira de `lockVault`: cada uma anota a chamada, na ordem, para o teste conferir a ORDEM. */
function setup(overrides: Partial<LockVaultDeps> = {}) {
  const order: string[] = [];
  const states: CloseState[] = [];
  const deps: LockVaultDeps = {
    arm: vi.fn(() => void order.push("arm")),
    closePortals: vi.fn(() => void order.push("closePortals")),
    discard: vi.fn(() => void order.push("discard")),
    closeVault: vi.fn(async () => {
      order.push("closeVault");
      return true;
    }),
    report: vi.fn((state: CloseState) => {
      states.push(state);
      order.push(`report:${state}`);
    }),
    onError: vi.fn(),
    stillLocked: vi.fn(() => true),
    wait: vi.fn(async () => undefined),
    // Sem recuo: a primeira falha desiste. Os testes da repetição dão o recuo deles.
    backoffMs: [],
    ...overrides,
  };
  return { order, states, deps };
}

describe("lockVault: a ordem do bloqueio (RN-SEG-001)", () => {
  it("arma a barreira PRIMEIRO, depois fecha os portais, descarta a área de trabalho e só então fecha o cofre na API", async () => {
    const { order, deps } = setup();

    await lockVault(deps);

    // Armar depois deixaria um 401 mandar ao login e perder as abas.
    expect(order).toEqual(["arm", "report:closing", "closePortals", "discard", "closeVault", "report:closed"]);
  });

  it("diz que fechou quando o cofre fechou", async () => {
    const { states, deps } = setup();

    await lockVault(deps);

    expect(states).toEqual(["closing", "closed"]);
  });

  it("não fecha o cofre se a barreira não foi armada: a tela não está bloqueada, e o cofre fechado por baixo dela mandaria ao login", async () => {
    const { order, deps } = setup({
      arm: vi.fn(() => {
        throw new Error("não armou");
      }),
    });

    await expect(lockVault(deps)).rejects.toThrow("não armou");

    expect(order).toEqual([]);
    expect(deps.closeVault).not.toHaveBeenCalled();
  });
});

describe("lockVault: o fechamento do cofre não depende de os passos de tela darem certo", () => {
  const boom = (name: string) => () => {
    throw new Error(name);
  };

  it("closePortals lança: o descarte ainda roda, o cofre ainda fecha, e o erro vai a onError", async () => {
    const { order, deps } = setup({ closePortals: vi.fn(boom("portais")) });

    await lockVault(deps);

    expect(order).toEqual(["arm", "report:closing", "discard", "closeVault", "report:closed"]);
    expect(deps.onError).toHaveBeenCalledWith(new Error("portais"));
  });

  it("o descarte lança: o cofre ainda fecha", async () => {
    const { order, deps } = setup({ discard: vi.fn(boom("descarte")) });

    await lockVault(deps);

    expect(order).toEqual(["arm", "report:closing", "closePortals", "closeVault", "report:closed"]);
    expect(deps.onError).toHaveBeenCalledWith(new Error("descarte"));
  });

  it("os dois lançam: o cofre ainda fecha, e cada erro é registrado", async () => {
    const { order, deps } = setup({ closePortals: vi.fn(boom("portais")), discard: vi.fn(boom("descarte")) });

    await lockVault(deps);

    expect(order.at(-2)).toBe("closeVault");
    expect(deps.onError).toHaveBeenCalledTimes(2);
  });
});

describe("lockVault: o cofre não fechou e não há recuo (desiste na primeira)", () => {
  it("a chamada recusada (false) diz que desistiu, e não lança", async () => {
    const { states, deps } = setup({ closeVault: vi.fn(async () => false) });

    await expect(lockVault(deps)).resolves.toBe("gaveUp");

    expect(states.at(-1)).toBe("gaveUp");
  });

  it("a chamada que lança também: é falha de fechar, e não do bloqueio", async () => {
    const { states, deps } = setup({
      closeVault: vi.fn(async () => {
        throw new Error("rede");
      }),
    });

    await expect(lockVault(deps)).resolves.toBe("gaveUp");

    expect(states.at(-1)).toBe("gaveUp");
  });
});

describe("unlockVault: desbloquear com a senha do MESMO usuário (RN-SEG-001)", () => {
  const session = (patch: Partial<{ unlocked: boolean; userName: string | null }> = {}): ApiResult<{ unlocked: boolean; userName: string | null }> => ({ ok: true, data: { unlocked: true, userName: "marina", ...patch } });

  it("entra pelo usuário que bloqueou (nunca por um campo de usuário) e com a senha digitada; só depois de conferir avisa que desbloqueou", async () => {
    const order: string[] = [];
    const signIn = vi.fn(async (credentials: { userName: string; password: string }) => {
      order.push(`signIn:${credentials.userName}`);
      return session();
    });
    const onUnlocked = vi.fn(() => void order.push("onUnlocked"));

    const result = await unlockVault({ userName: "marina", password: "uma-senha", signIn, onUnlocked });

    expect(signIn).toHaveBeenCalledExactlyOnceWith({ userName: "marina", password: "uma-senha" });
    expect(order).toEqual(["signIn:marina", "onUnlocked"]);
    expect(result).toEqual({ kind: "unlocked" });
  });

  it("senha recusada: devolve a recusa e não desbloqueia", async () => {
    const onUnlocked = vi.fn();
    const signIn = vi.fn(async (): Promise<ApiResult<{ unlocked: boolean; userName: string | null }>> => ({ ok: false, error: { status: 401, code: "INVALID_CREDENTIALS", title: "Credenciais inválidas.", detail: null, errors: null, extensions: {} } }));

    const result = await unlockVault({ userName: "marina", password: "errada", signIn, onUnlocked });

    expect(result).toEqual({ kind: "refused", code: "INVALID_CREDENTIALS" });
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("a API respondeu que o cofre não está aberto, ou que é o de OUTRO usuário: não desbloqueia, diz que a resposta não confere", async () => {
    for (const reply of [session({ unlocked: false }), session({ userName: "outra.pessoa" }), session({ userName: null })]) {
      const onUnlocked = vi.fn();

      const result = await unlockVault({ userName: "marina", password: "uma-senha", signIn: async () => reply, onUnlocked });

      expect(result).toEqual({ kind: "mismatch" });
      expect(onUnlocked).not.toHaveBeenCalled();
    }
  });

  it("a chamada que lança (a API fora do ar) chega a quem chamou, e não desbloqueia", async () => {
    const onUnlocked = vi.fn();

    await expect(
      unlockVault({
        userName: "marina",
        password: "uma-senha",
        signIn: async () => {
          throw new Error("sem resposta");
        },
        onUnlocked,
      }),
    ).rejects.toThrow("sem resposta");

    expect(onUnlocked).not.toHaveBeenCalled();
  });
});

describe("unlockMutationOptions: o desbloqueio como mutação", () => {
  const signIn = vi.fn(async () => ({ ok: true, data: { unlocked: true, userName: "marina" } }) as ApiResult<{ unlocked: boolean; userName: string | null }>);

  it("não guarda nada no cache de mutações (a senha ficaria em `variables`), sai mesmo sem rede (a API é local) e calada: toda falha aparece na própria tela", () => {
    const options = unlockMutationOptions({ userName: "marina", signIn, onUnlocked: () => {} });

    expect(options.gcTime).toBe(0);
    expect(options.networkMode).toBe("always");
    expect(options.meta).toEqual({ silent: true });
  });

  it("a mutação entra pelo usuário fixo que bloqueou", async () => {
    signIn.mockClear();
    const onUnlocked = vi.fn();

    const result = await unlockMutationOptions({ userName: "marina", signIn, onUnlocked }).mutationFn("uma-senha");

    expect(signIn).toHaveBeenCalledExactlyOnceWith({ userName: "marina", password: "uma-senha" });
    expect(result).toEqual({ kind: "unlocked" });
    expect(onUnlocked).toHaveBeenCalledOnce();
  });
});

describe("createLockVaultDeps: a fiação do bloqueio com as peças de verdade", () => {
  type FakeLock = { lock: Mock<() => void>; isLocked: Mock<() => boolean> };
  const fakeLock = (): FakeLock => ({ lock: vi.fn<() => void>(), isLocked: vi.fn<() => boolean>(() => true) });
  const sent: { type: string; key: string }[] = [];
  const dialog = { hasAttribute: () => false, querySelector: () => null, dispatchEvent: (event: unknown) => void sent.push(event as { type: string; key: string }) };

  beforeEach(() => {
    sent.length = 0;
    vi.stubGlobal("KeyboardEvent", class { constructor(readonly type: string, init: { key: string }) { this.key = init.key; } readonly key: string; });
  });
  afterEach(() => vi.unstubAllGlobals());

  function build(overrides: Partial<Parameters<typeof createLockVaultDeps>[0]> = {}) {
    const lock = fakeLock();
    const signOut = vi.fn(async (): Promise<ApiResult<void>> => ({ ok: true, data: undefined }));
    const discard = vi.fn();
    const report = vi.fn();
    const deps = createLockVaultDeps({ lock, root: { querySelectorAll: () => [dialog] as unknown as NodeListOf<Element> }, signOut, discard, report, onError: vi.fn(), ...overrides });
    return { deps, lock, signOut, discard, report };
  }

  it("arm arma a barreira (vaultLock.lock), e stillLocked pergunta a ela", () => {
    const { deps, lock } = build();

    deps.arm();

    expect(lock.lock).toHaveBeenCalledOnce();
    expect(deps.stillLocked()).toBe(true);
    lock.isLocked.mockReturnValue(false);
    expect(deps.stillLocked()).toBe(false);
  });

  it("closePortals manda o Esc aos diálogos e menus abertos da raiz", () => {
    const { deps } = build();

    deps.closePortals();

    expect(sent).toEqual([expect.objectContaining({ type: "keydown", key: "Escape" })]);
  });

  it("discard é o descarte da área de trabalho que o provedor deu", () => {
    const { deps, discard } = build();

    deps.discard();

    expect(discard).toHaveBeenCalledOnce();
  });

  it("closeVault é a chamada do Sair: fechou (ou já estava fechado, 401 VAULT_LOCKED) vale true; qualquer outra falha vale false", async () => {
    const closed = build();
    expect(await closed.deps.closeVault()).toBe(true);
    expect(closed.signOut).toHaveBeenCalledOnce();

    const already = build({ signOut: vi.fn(async (): Promise<ApiResult<void>> => ({ ok: false, error: { status: 401, code: "VAULT_LOCKED", title: "Cofre fechado.", detail: null, errors: null, extensions: {} } })) });
    expect(await already.deps.closeVault()).toBe(true);

    const down = build({ signOut: vi.fn(async (): Promise<ApiResult<void>> => ({ ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "Sem resposta da API.", detail: null, errors: null, extensions: {} } })) });
    expect(await down.deps.closeVault()).toBe(false);
  });

  it("a chamada que fecha o cofre tem prazo: o sinal que ela leva é o que se cancela em closeDeadlineMs", async () => {
    const signal = new AbortController().signal;
    const signalFor = vi.fn(() => signal);
    const { deps, signOut } = build({ signalFor });

    await deps.closeVault();

    expect(signalFor).toHaveBeenCalledExactlyOnceWith(closeDeadlineMs);
    expect(signOut).toHaveBeenCalledExactlyOnceWith(signal);
  });

  it("sem `signalFor`, o sinal é o de AbortSignal.timeout com o prazo: o padrão, que é o que vale na tela, também é exercitado", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const { deps, signOut } = build();

    await deps.closeVault();

    expect(timeout).toHaveBeenCalledExactlyOnceWith(closeDeadlineMs);
    expect(signOut).toHaveBeenCalledExactlyOnceWith(signal);
    timeout.mockRestore();
  });

  it("no pior caso (cada tentativa esgota o prazo) o fechamento desiste em cerca de um minuto, e não em dezenas deles", () => {
    const worstCaseMs = closeBackoffMs.reduce((sum, wait) => sum + wait, 0) + (closeBackoffMs.length + 1) * closeDeadlineMs;

    expect(closeDeadlineMs).toBeGreaterThan(0);
    expect(worstCaseMs).toBeLessThanOrEqual(60_000);
  });

  it("wait espera de verdade o tempo pedido", async () => {
    const { deps } = build();
    const started = Date.now();

    await deps.wait(30);

    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("o recuo padrão é finito e cresce: 1 s, 2 s, 4 s, 8 s, 15 s", () => {
    expect(closeBackoffMs).toEqual([1000, 2000, 4000, 8000, 15000]);
    expect(createLockVaultDeps({ lock: fakeLock(), root: { querySelectorAll: () => [] as unknown as NodeListOf<Element> }, signOut: async () => ({ ok: true, data: undefined }), discard: vi.fn(), report: vi.fn(), onError: vi.fn() }).backoffMs).toBe(closeBackoffMs);
  });

  it("report e onError são os da tela", () => {
    const report = vi.fn();
    const onError = vi.fn();
    const { deps } = build({ report, onError });

    deps.report("closing");
    deps.onError(new Error("x"));

    expect(report).toHaveBeenCalledWith("closing");
    expect(onError).toHaveBeenCalledWith(new Error("x"));
  });
});

describe("createUnlockHandler: o que acontece quando o desbloqueio dá certo", () => {
  it("solta a barreira (os pedidos que esperavam seguem, e antes de refazer o que falhou: os pedidos refeitos não podem esperar) e refaz só o que está ativo e falhou", () => {
    const order: string[] = [];
    const unlock = vi.fn(() => void order.push("unlock"));
    const refetchQueries = vi.fn(async () => void order.push("refetch"));

    createUnlockHandler({ lock: { unlock }, queryClient: { refetchQueries } })();

    expect(order).toEqual(["unlock", "refetch"]);
    const [filters] = refetchQueries.mock.calls[0] as unknown as [{ type: string; predicate: (query: { state: { status: string } }) => boolean }];
    expect(filters.type).toBe("active");
    expect(filters.predicate({ state: { status: "error" } })).toBe(true);
    expect(filters.predicate({ state: { status: "success" } })).toBe(false);
    expect(filters.predicate({ state: { status: "pending" } })).toBe(false);
  });
});

describe("lockVault: repete o fechamento do cofre com recuo, e a tela diz a verdade (Important 3)", () => {
  /** `results`: o que cada tentativa devolve, na ordem (um Error faz a tentativa lançar). */
  function attempts(results: (boolean | Error)[], overrides: Partial<LockVaultDeps> = {}) {
    let attempt = 0;
    const waits: number[] = [];
    const setupResult = setup({
      closeVault: vi.fn(async () => {
        const result = results[attempt++];
        if (result instanceof Error) throw result;
        return result;
      }),
      wait: vi.fn(async (ms: number) => void waits.push(ms)),
      backoffMs: [10, 20, 40],
      ...overrides,
    });
    return { ...setupResult, waits };
  }

  it("fechou de primeira: uma chamada, nenhuma espera, nada de 'tentando de novo'", async () => {
    const { states, waits, deps } = attempts([true]);

    expect(await lockVault(deps)).toBe("closed");

    expect(deps.closeVault).toHaveBeenCalledOnce();
    expect(waits).toEqual([]);
    expect(states).toEqual(["closing", "closed"]);
  });

  it("falhou e fechou na segunda: a tela diz 'tentando de novo' no meio, espera o primeiro recuo e termina fechado", async () => {
    const { states, waits, deps } = attempts([false, true]);

    expect(await lockVault(deps)).toBe("closed");

    expect(states).toEqual(["closing", "retrying", "closed"]);
    expect(waits).toEqual([10]);
    expect(deps.closeVault).toHaveBeenCalledTimes(2);
  });

  it("não fecha nunca: tenta uma vez mais que o número de recuos, espera cada recuo na ordem, e desiste de vez", async () => {
    const { states, waits, deps } = attempts([false, false, false, false, true]);

    expect(await lockVault(deps)).toBe("gaveUp");

    expect(deps.closeVault).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([10, 20, 40]);
    expect(states).toEqual(["closing", "retrying", "retrying", "retrying", "gaveUp"]);
  });

  it("a tentativa que lança conta como falha (e fica no registro), e a seguinte pode fechar", async () => {
    const { states, deps } = attempts([new Error("rede"), true]);

    expect(await lockVault(deps)).toBe("closed");

    expect(deps.onError).toHaveBeenCalledWith(new Error("rede"));
    expect(states).toEqual(["closing", "retrying", "closed"]);
  });

  it("a pessoa saiu durante a espera (já não está bloqueado): para ali, sem outra chamada e sem dizer que fechou nem que desistiu", async () => {
    let locked = true;
    const { states, deps } = attempts([false, true], { wait: vi.fn(async () => void (locked = false)), stillLocked: () => locked });

    expect(await lockVault(deps)).toBe("left");

    expect(deps.closeVault).toHaveBeenCalledOnce();
    expect(states).toEqual(["closing", "retrying"]);
  });

  it("com os passos de tela quebrados o cofre ainda é repetido até fechar", async () => {
    const { states, deps } = attempts([false, true], {
      closePortals: () => {
        throw new Error("portais");
      },
      discard: () => {
        throw new Error("descarte");
      },
    });

    expect(await lockVault(deps)).toBe("closed");

    expect(states.at(-1)).toBe("closed");
    expect(deps.onError).toHaveBeenCalledTimes(2);
  });
});

describe("unlockBlocked: 'Desbloquear' só fica livre depois de o cofre ter fechado, ou de a tentativa ter desistido", () => {
  it("fechando e tentando de novo: bloqueado (o desbloqueio abriria o cofre e o fechamento que está a caminho o fecharia por cima)", () => {
    expect(unlockBlocked("closing")).toBe(true);
    expect(unlockBlocked("retrying")).toBe(true);
  });

  it("fechou, ou desistiu de vez: livre (desistindo, o desbloqueio ainda confere a senha na API)", () => {
    expect(unlockBlocked("closed")).toBe(false);
    expect(unlockBlocked("gaveUp")).toBe(false);
  });
});
