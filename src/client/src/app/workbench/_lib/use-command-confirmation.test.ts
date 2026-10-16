import { beforeEach, describe, expect, it, vi } from "vitest";

// O gancho com os ganchos do React simulados (`createHookRuntime`) e as listas do cache de mentira: o que se confere é a pergunta montada com as proteções da
// conexão da aba, a resposta que libera ou não o comando, e que nada fica esperando.
const rt = await vi.hoisted(async () => ({ ...(await import("@/lib/testing/react-hooks")).createHookRuntime(), lists: { connections: [] as unknown[], folders: [] as unknown[] } }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: options.queryKey[0] === "connections" ? rt.lists.connections : rt.lists.folders }),
}));

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import { commandQuestion, saveQuestion } from "./command-confirmation";
import { useCommandConfirmation } from "./use-command-confirmation";

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, confirmCommands: "irreversible", readOnly: false, protections: { ...unprotected, confirmCommands: "irreversible" }, createdAt: now, updatedAt: now };
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: { ...unprotected, confirmCommands: "irreversible", confirmCommandsFolderID: "f1" }, createdAt: now, updatedAt: now };
const deleteAll = { sql: "DELETE FROM producao.apontamento", engine: 1 as const };
const read = { sql: "SELECT 1", engine: 1 as const };

const hook = (connectionId: string | null = "c1", database?: string) => rt.render(() => useCommandConfirmation(connectionId, database));

beforeEach(() => {
  rt.unmount();
  rt.lists.connections = [mes];
  rt.lists.folders = [fabrica];
});

describe("useCommandConfirmation: o aviso de uma aba (RN-PROT-001)", () => {
  it("sem pergunta o comando sai na mesma chamada; sem a conexão na lista, também", () => {
    const proceed = vi.fn();
    hook().confirm((protections) => commandQuestion(protections, read), proceed);
    expect(proceed).toHaveBeenCalledOnce();

    rt.unmount();
    rt.lists.connections = [];
    const missing = vi.fn();
    hook().confirm((protections) => commandQuestion(protections, deleteAll), missing);
    expect(missing).toHaveBeenCalledOnce();
  });

  it("o irreversível abre o aviso com a conexão, o banco da aba, o ambiente herdado e a pasta de onde vem a proteção; só “Executar mesmo assim” o libera", () => {
    const proceed = vi.fn();
    const cancelled = vi.fn();
    hook("c1", "mes_historico").confirm((protections) => commandQuestion(protections, deleteAll), proceed, cancelled);
    const open = hook("c1", "mes_historico").open;

    expect(proceed).not.toHaveBeenCalled();
    expect(open?.question).toMatchObject({ kind: "command", command: { irreversible: { kind: "delete" } } });
    expect(open?.context).toEqual({ connection: "MES Produção", database: "mes_historico", environment: { name: "Produção", color: "#FF8A7A", folder: fabrica }, level: "irreversible", from: fabrica });

    open?.onConfirm();
    expect(proceed).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
    expect(hook("c1", "mes_historico").open).toBeNull();
  });

  it("sem o banco da aba, vale o da conexão; Cancelar não executa nada", () => {
    const proceed = vi.fn();
    const cancelled = vi.fn();
    hook().confirm((protections) => commandQuestion(protections, deleteAll), proceed, cancelled);
    const open = hook().open;

    expect(open?.context.database).toBe("mes");
    open?.onCancel();
    expect(proceed).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("um aviso por vez: o pedido novo cancela o de antes; e a vista que sai de cena cancela o que esperava", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { confirm } = hook();
    confirm((protections) => commandQuestion(protections, deleteAll), vi.fn(), first);
    confirm((protections) => commandQuestion(protections, deleteAll), vi.fn(), second);

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    rt.unmount();
    expect(second).toHaveBeenCalledOnce();
  });

  it("`confirmed` responde na hora sem pergunta, e depois da resposta da pessoa com ela", async () => {
    expect(hook().confirmed((protections) => saveQuestion(protections, 2))).toBe(true);

    rt.unmount();
    rt.lists.connections = [{ ...mes, protections: { ...mes.protections, confirmCommands: "all" } }];
    const answer = hook().confirmed((protections) => saveQuestion(protections, 2));
    expect(answer).toBeInstanceOf(Promise);
    hook().open?.onConfirm();
    await expect(answer).resolves.toBe(true);

    const refused = hook().confirmed((protections) => saveQuestion(protections, 2));
    hook().open?.onCancel();
    await expect(refused).resolves.toBe(false);
  });
});
