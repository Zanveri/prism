import { beforeEach, describe, expect, it, vi } from "vitest";

// O gancho da cópia com os ganchos do React simulados (`createHookRuntime`), o cache de mentira (cada consulta responde pela chave) e a rota da prévia da
// cópia simulada: o que se confere é o que vem escolhido, a própria origem, a contagem obrigatória, o mapeamento que chega da prévia e as escolhas.
const rt = await vi.hoisted(async () => ({
  ...(await import("@/lib/testing/react-hooks")).createHookRuntime(),
  data: new Map<string, unknown>(),
  enabled: new Map<string, boolean>(),
  preview: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const key = JSON.stringify(options.queryKey);
    rt.enabled.set(key, options.enabled !== false);
    const data = options.enabled === false ? undefined : rt.data.get(key);
    return { data, isSuccess: data !== undefined, isError: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../../_lib/data-import/imports.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../_lib/data-import/imports.service")>()), previewCopy: rt.preview }));

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";

import type { ExportSource } from "../../_lib/data-export/export-source";
import type { WizardStep } from "../../_lib/data-export/export-wizard";
import type { ImportTable } from "../../_lib/data-import/imports.schema";
import { navKey } from "../../_lib/navigator-model";
import { useCopyWizard } from "./use-copy-wizard";

const now = "2026-10-16T12:00:00Z";
const connection = (id: string, change: Partial<Connection> = {}): Connection => ({
  id,
  folderID: null,
  name: id,
  engine: 1,
  host: "db.example.invalid",
  port: 5432,
  database: "loja",
  userName: "app",
  hasPassword: true,
  environmentName: null,
  environmentColor: null,
  confirmCommands: null,
  readOnly: false,
  ...newVerification,
  protections: unprotected,
  createdAt: now,
  updatedAt: now,
  ...change,
});

const key = (value: readonly unknown[]) => JSON.stringify(value);
const node = (label: string, kind = "schema") => ({ key: label, kind, label, depth: 0, hasChildren: true });

const source: ExportSource = { connectionId: "loja", origin: { kind: "table", view: false, schema: "estoque", name: "pedido" }, columns: null, unsavedEdits: 0 };
const sourceColumns = [
  { name: "id", type: "integer" },
  { name: "foto", type: "bytea" },
  { name: "Total", type: "numeric(12,2)" },
];
const chosen = [
  { position: 0, name: "id" },
  { position: 1, name: "foto" },
  { position: 2, name: "Total" },
];

const table: ImportTable = {
  schema: "dw",
  name: "pedido_hist",
  oneAtATime: false,
  columns: [
    { name: "id", type: "integer", nullable: false, defaultValue: null, generated: null, class: "number", importable: true, reason: null },
    { name: "foto", type: "text", nullable: true, defaultValue: null, generated: null, class: "text", importable: true, reason: null },
    { name: "total", type: "numeric(12,2)", nullable: true, defaultValue: null, generated: null, class: "number", importable: true, reason: null },
  ],
  referencedBy: [],
};

function lists({ connections = [connection("loja"), connection("dw", { host: "192.0.2.20" })] }: { connections?: Connection[] } = {}) {
  rt.data.set(key(["connections"]), connections);
  rt.data.set(key(["folders"]), []);
  for (const id of ["loja", "dw"]) {
    rt.data.set(key(["database-session", id]), { id: `s-${id}` });
    rt.data.set(key(["tree", id, "databases"]), [{ key: navKey({ type: "database", connectionId: id }), kind: "database", label: "loja", depth: 0, hasChildren: true }]);
    rt.data.set(key(["tree", id, "schemas"]), [node("dw"), node("estoque")]);
  }
  rt.data.set(key(["tree", "loja", "schema", "estoque", "objects", "tables"]), [node("item", "table"), node("pedido", "table"), node("v_pedido", "view")]);
  rt.data.set(key(["tree", "dw", "schema", "estoque", "objects", "tables"]), [node("pedido", "table")]);
  rt.data.set(key(["tree", "dw", "schema", "dw", "objects", "tables"]), [node("pedido_hist", "table")]);
}

const hook = (step: WizardStep = "target", input: { columns?: typeof chosen; source?: ExportSource; engine?: 1 | 2 | 3 } = {}) =>
  rt.render(() => useCopyWizard({ source: input.source ?? source, sourceEngine: input.engine ?? 1, sourceColumns, chosen: input.columns ?? chosen, active: true, step }));

beforeEach(() => {
  rt.unmount();
  rt.data.clear();
  rt.enabled.clear();
  rt.preview.mockReset();
  lists();
});

describe("useCopyWizard: a tabela de destino (RN-IMPORT-023)", () => {
  it("antes da etapa, nada é pedido; na etapa, vêm escolhidos a conexão, o esquema e a tabela de mesmo nome, que é a própria origem", () => {
    hook("extraction");
    expect(rt.enabled.get(key(["database-session", "loja"]))).toBe(false);

    const copy = hook("target");
    expect(copy.target).toEqual({ connectionId: "loja", schema: "estoque", table: "pedido" });
    expect(copy.tableNames).toEqual(["item", "pedido"]);
    expect(copy.isSource).toBe(true);
    expect(copy.targetProblem).toBe("A tabela de destino é a própria origem. Escolha outra tabela.");

    copy.chooseTable("item");
    expect(hook("target").targetProblem).toBeNull();
  });

  it("outra conexão: o banco padrão dela e o esquema e a tabela de mesmo nome de novo; a escolha da pessoa vale dali em diante", () => {
    hook("target").chooseConnection("dw");
    const copy = hook("target");
    expect(copy.target).toEqual({ connectionId: "dw", schema: "estoque", table: "pedido" });
    expect(copy.isSource).toBe(false);

    copy.chooseSchema("dw");
    const other = hook("target");
    expect(other.target).toEqual({ connectionId: "dw", schema: "dw", table: null });
    expect(other.targetProblem).toBe("Escolha a tabela de destino.");
    other.chooseTable("pedido_hist");
    expect(hook("target").targetProblem).toBeNull();
  });

  it("a conexão somente leitura segura a etapa e não é aberta", () => {
    lists({ connections: [connection("loja", { protections: { ...unprotected, readOnly: true } })] });
    const copy = hook("target");
    expect(copy.targetProblem).toBe("A conexão é somente leitura, e a cópia grava na tabela. Escolha outra conexão.");
    expect(rt.enabled.get(key(["database-session", "loja"]))).toBe(false);
  });

  it("no Db2 e no Informix com a origem e o destino no mesmo banco, a contagem é obrigatória; outro banco a libera", () => {
    lists({ connections: [connection("loja", { engine: 2, port: 50000 }), connection("dw", { engine: 2, port: 50000, database: "DW" })] });
    expect(hook("extraction", { engine: 2 }).countForced).toBe("A origem e o destino estão no mesmo banco: a contagem é obrigatória.");
    hook("target", { engine: 2 }).chooseConnection("dw");
    expect(hook("target", { engine: 2 }).countForced).toBeNull();
  });
});

describe("useCopyWizard: o mapeamento (RN-IMPORT-024)", () => {
  async function toMapping() {
    hook("target").chooseConnection("dw");
    hook("target").chooseSchema("dw");
    hook("target").chooseTable("pedido_hist");
    await hook("mapping").loadPreview();
    return hook("mapping");
  }

  it("a prévia vai sem mapeamento; o sugerido chega sem o par binário de um lado só, e as notas e os bloqueios saem dos tipos da origem", async () => {
    rt.preview.mockResolvedValue({ ok: true, data: { table, mapping: [{ source: 0, target: "id" }, { source: 1, target: "foto" }, { source: 2, target: "total" }] } });
    const copy = await toMapping();

    expect(rt.preview).toHaveBeenCalledWith({
      source: { kind: "table", connectionID: "loja", schema: "estoque", table: "pedido" },
      columns: chosen,
      target: { connectionID: "dw", schema: "dw", table: "pedido_hist" },
    });
    expect(copy.targets).toEqual(["id", null, "total"]);
    expect(copy.mappingProblem).toBeNull();
    expect(copy.pairBlocker(1, table.columns[1])).toBe("Binário só vai para uma coluna binária.");
    expect(copy.pairNote(0, table.columns[0])).toBeNull();
  });

  it("a escolha à mão tira a coluna de quem a tinha, com a frase; \"Não importar nenhuma\" segura a etapa; \"Mapear pelo nome\" volta ao automático", async () => {
    rt.preview.mockResolvedValue({ ok: true, data: { table, mapping: [{ source: 0, target: "id" }, { source: 2, target: "total" }] } });
    const copy = await toMapping();

    copy.setTarget(0, "total");
    const moved = hook("mapping");
    expect(moved.targets).toEqual(["total", null, null]);
    expect(moved.moved).toBe("total deixou de receber Total.");

    moved.mapNone();
    expect(hook("mapping").mappingProblem).toBe("Escolha ao menos uma coluna da tabela para receber valores.");
    hook("mapping").mapByName();
    expect(hook("mapping").targets).toEqual(["id", null, "total"]);
  });

  it("voltar à Extração e marcar outras colunas leva as escolhas pelo nome; a recusa da prévia fica na etapa", async () => {
    rt.preview.mockResolvedValue({ ok: true, data: { table, mapping: [{ source: 0, target: "id" }, { source: 2, target: "total" }] } });
    await toMapping();
    hook("mapping").setTarget(0, null);

    const fewer = [chosen[2], chosen[0]];
    await hook("mapping", { columns: fewer }).loadPreview();
    expect(hook("mapping", { columns: fewer }).targets).toEqual(["total", null]);

    rt.preview.mockResolvedValue({ ok: false, error: { status: 404, code: "IMPORT_TABLE_NOT_FOUND", title: "x", detail: null, errors: null, extensions: {} } });
    await hook("mapping").loadPreview(true);
    const refused = hook("mapping");
    expect(refused.preview).toMatchObject({ status: "refused", message: "A tabela dw.pedido_hist não existe mais.", retry: false });
    expect(refused.mappingProblem).toBe("A tabela dw.pedido_hist não existe mais.");
  });
});

describe("useCopyWizard: a carga e a Confirmação (RN-IMPORT-025)", () => {
  it("ligar ou desligar o esvaziamento desmarca a caixa; a Confirmação a desmarca ao abrir", () => {
    hook().setUnderstood(true);
    expect(hook().understood).toBe(true);
    hook().setEmpty(true);
    expect(hook()).toMatchObject({ empty: true, understood: false });
    hook().setUnderstood(true);
    hook().resetUnderstood();
    expect(hook().understood).toBe(false);
  });
});
