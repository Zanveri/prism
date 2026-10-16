import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";

import type { QueryTab } from "./workbench-model";

// O `ConnectionChecks` com os ganchos do React simulados (`createHookRuntime`): as abas, as conexões, as sessões da árvore em cache e o bloqueio são de
// mentira, e o que se confere é o que ele entrega à verificação desta janela (`connectionChecks`) e os avisos de passagem.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    tabs: [] as QueryTab[],
    connections: [] as Connection[],
    treeSessions: new Map<string, string>(),
    locked: false,
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    verify: vi.fn<(connectionId: string) => Promise<unknown>>(() => new Promise(() => {})),
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: rt.connections }),
  useQueries: ({ queries }: { queries: { queryKey: readonly unknown[] }[] }) =>
    queries.map((query) => {
      const id = rt.treeSessions.get(String(query.queryKey[1]));
      return { data: id === undefined ? undefined : { id }, isSuccess: id !== undefined };
    }),
}));
vi.mock("@/app/connections/_lib/connections.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/connections/_lib/connections.service")>()),
  verifyConnection: (connectionId: string) => rt.verify(connectionId),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/vault-lock", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/vault-lock")>();
  return { ...original, vaultLock: { ...original.vaultLock, isLocked: () => rt.locked, subscribe: () => () => {} } };
});
vi.mock("./workbench-state", () => ({ useWorkbench: () => ({ tabs: rt.tabs }) }));

const { ConnectionChecks, checkTargets, connectionChecks, useNotConnectedIds } = await import("./use-connection-checks");
const { useConnectedIds } = await import("./use-connected-ids");

const now = "2026-10-15T12:00:00Z";
function connection(id: string, name: string, over: Partial<Connection> = {}): Connection {
  return { id, folderID: null, name, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now, ...over };
}
const tab = (id: string, connectionId: string, sessionId: string | null): QueryTab => ({ id, title: `${id}.sql`, connectionId, sessionId, sql: "" });

const mes = connection("c1", "MES Produção");
const erp = connection("c2", "ERP", { verificationInterval: 120 });
const off = connection("c3", "BI", { verificationEnabled: false });
const failed = { status: "failed", checkedAt: now, elapsedMs: 9, message: "FATAL: o servidor fechou a conexão", sqlState: "08006" } as const;
const ok = { status: "ok", checkedAt: now, elapsedMs: 2, message: null, sqlState: null } as const;

describe("as conexões que esta janela verifica (RN-VERIF-002)", () => {
  it("as conectadas aqui (pela árvore ou por uma aba) com a verificação ligada, com o intervalo de cada uma e as sessões numa chave", () => {
    const targets = checkTargets([mes, erp, off], [tab("q1", "c2", "s9"), tab("q2", "c2", "s3"), tab("q3", "c3", "s4"), tab("q4", "c1", null)], (id) => (id === "c1" ? "t1" : null), false);

    expect([...targets]).toEqual([
      ["c1", { intervalSeconds: 30, sessions: "t1" }],
      ["c2", { intervalSeconds: 120, sessions: " s3 s9" }],
    ]);
  });

  it("a desconectada (sem sessão da árvore e sem aba conectada) e a de verificação desligada ficam de fora", () => {
    expect([...checkTargets([mes, off], [tab("q1", "c3", "s1")], () => null, false)]).toEqual([]);
  });

  it("com o cofre bloqueado, nenhuma (RN-VERIF-002 e RN-SEG-001)", () => {
    expect([...checkTargets([mes], [], () => "t1", true)]).toEqual([]);
  });
});

describe("ConnectionChecks: a verificação desta janela ligada ao que ela tem (RN-VERIF-002 e 003)", () => {
  beforeEach(() => {
    rt.unmount();
    rt.tabs = [];
    rt.connections = [mes, erp];
    rt.treeSessions = new Map([["c1", "t1"]]);
    rt.locked = false;
    for (const mock of [rt.toast.success, rt.toast.warning]) mock.mockReset();
  });
  afterEach(() => rt.unmount());

  it("a conexão conectada entra na verificação, e a que desconecta (ou com o cofre bloqueado, todas) sai", () => {
    rt.render(() => ConnectionChecks());
    expect(connectionChecks.get("c1")).toEqual({ kind: "waiting", busy: false });
    expect(connectionChecks.get("c2")).toBeNull();

    rt.tabs = [tab("q1", "c2", "s1")];
    rt.render(() => ConnectionChecks());
    expect(connectionChecks.get("c2")).toEqual({ kind: "waiting", busy: false });

    rt.locked = true;
    rt.render(() => ConnectionChecks());
    expect([...connectionChecks.snapshot()]).toEqual([]);
  });

  it("passar a não responder dá o aviso de atenção com o nome da conexão, e voltar a responder dá o de sucesso", () => {
    rt.render(() => ConnectionChecks());
    connectionChecks.peer("c1", failed);
    connectionChecks.peer("c1", ok);

    expect(rt.toast.warning).toHaveBeenCalledExactlyOnceWith("MES Produção não respondeu à verificação");
    expect(rt.toast.success).toHaveBeenCalledExactlyOnceWith("MES Produção voltou a responder à verificação");
  });

  it("sair do cofre (o provedor desmonta) tira tudo da verificação", () => {
    rt.render(() => ConnectionChecks());
    rt.unmount();

    expect([...connectionChecks.snapshot()]).toEqual([]);
  });
});

describe("as conectadas fora do navegador, sem a que a verificação achou sem sessão na API (RN-NAV-013)", () => {
  const notConnected = { status: "notConnected", checkedAt: now, elapsedMs: null, message: null, sqlState: null } as const;

  beforeEach(() => {
    vi.useFakeTimers();
    rt.unmount();
    rt.connections = [mes, erp];
    rt.tabs = [tab("q1", "c2", "s1")];
    rt.treeSessions = new Map([["c1", "t1"]]);
    rt.locked = false;
    rt.verify.mockImplementation(async (connectionId: string) => ({ ok: true, data: connectionId === "c1" ? notConnected : ok }));
  });
  afterEach(() => {
    rt.unmount();
    connectionChecks.track(new Map());
    vi.useRealTimers();
  });

  it("a lista do botão da conexão e a faixa da aba sem conexão (`useConnectedIds`) tiram a conexão “Sem sessão aberta”, e ela volta com uma sessão nova", async () => {
    const connected = () => {
      rt.unmount();
      return [...rt.render(() => useConnectedIds(rt.connections))];
    };
    connectionChecks.track(new Map([["c1", { intervalSeconds: 30, sessions: "t1" }]]));
    expect(connected()).toEqual(["c1", "c2"]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(connectionChecks.get("c1")).toEqual({ kind: "notConnected" });
    // A sessão da árvore em cache ainda está lá, mas a API disse que não há nenhuma: o indicador diz "Sem sessão aberta", e a conta, o mesmo.
    expect(connected()).toEqual(["c2"]);

    // A próxima ação na árvore abriu uma sessão nova: a verificação volta a contar, e a conexão volta a ser conectada.
    rt.treeSessions = new Map([["c1", "t2"]]);
    connectionChecks.track(new Map([["c1", { intervalSeconds: 30, sessions: "t2" }]]));
    expect(connected()).toEqual(["c1", "c2"]);
  });

  it("o gancho só muda quando as conexões sem sessão mudam, e não a cada verificação", async () => {
    connectionChecks.track(new Map([["c1", { intervalSeconds: 30, sessions: "t1" }]]));
    await vi.advanceTimersByTimeAsync(30_000);

    const first = rt.render(() => useNotConnectedIds());
    connectionChecks.track(new Map([["c1", { intervalSeconds: 30, sessions: "t1" }], ["c2", { intervalSeconds: 120, sessions: "s1" }]]));
    const second = rt.render(() => useNotConnectedIds());

    expect([...first]).toEqual(["c1"]);
    expect(second).toBe(first);
  });
});
