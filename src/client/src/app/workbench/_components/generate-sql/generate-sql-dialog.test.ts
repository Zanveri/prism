import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryColumn } from "../../_lib/query.schema";
import type { SqlTarget } from "../../_lib/record-edits.schema";
import type { SqlRow } from "../../_lib/generate-sql/generate-sql";
import type { GenerateSqlDeps, GenerateSqlDialogProps, GenerateSqlRequest } from "../../_lib/generate-sql/use-generate-sql";

// O diálogo "Gerar SQL" com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). As decisões são de `generate-sql.ts`,
// `sql-plan.ts` e `generate-sql-flow.ts`, com testes próprios; aqui se confere a ligação do gancho (o pedido, as opções, as saídas, o fechar) e o desenho
// do componente (as propriedades dos elementos que ele devolve).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { sqlTargetAnswer } from "../../_lib/generate-sql/generate-sql-flow";
import { useGenerateSql } from "../../_lib/generate-sql/use-generate-sql";
import { GenerateSqlDialog } from "./generate-sql-dialog";

const columns: QueryColumn[] = [
  { name: "id", type: "integer", kind: "number" },
  { name: "cliente", type: "text", kind: "text" },
];

const target: SqlTarget = {
  tables: [{ schema: "estoque", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "cliente", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const row = (number: number, values: (string | null)[]): SqlRow => ({ number, values, read: values, changed: [], cut: [], generated: [] });

const request = (extra: Partial<GenerateSqlRequest> = {}): GenerateSqlRequest => ({ resultId: "r1", item: "delete", engine: 1, resultColumns: columns, rows: [row(1, ["1", "Ana"])], newRows: 0, records: null, readOnlyConnection: false, ...extra });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Harness = { deps: GenerateSqlDeps; current: () => ReturnType<typeof useGenerateSql>; render: () => ReturnType<typeof useGenerateSql> };

function harness(extra: Partial<GenerateSqlDeps> = {}): Harness {
  const deps: GenerateSqlDeps = {
    target: vi.fn(async () => ({ kind: "target" as const, target })),
    fullValues: vi.fn(async () => ({ kind: "values" as const, valueOf: (): string | undefined => undefined })),
    catalog: vi.fn(async () => ({ kind: "failed" as const, message: null })),
    stillCurrent: () => true,
    openQueryTab: vi.fn(),
    copyText: vi.fn(async () => {}),
    hold: vi.fn(() => vi.fn()),
    ...extra,
  };
  let last: ReturnType<typeof useGenerateSql> | null = null;
  const render = () => (last = rt.render(() => useGenerateSql({ userName: null, deps })));
  render();
  return { deps, render, current: () => last as ReturnType<typeof useGenerateSql> };
}

/** Abre o diálogo e espera o caminho chegar ao fim. */
async function opened(h: Harness, dialog = request()): Promise<GenerateSqlDialogProps> {
  h.current().open(dialog);
  h.render();
  await settle();
  return h.render().dialog as GenerateSqlDialogProps;
}

beforeEach(() => {
  rt.unmount();
  rt.toast.success.mockReset();
  rt.toast.warning.mockReset();
});

describe("o diálogo Gerar SQL ligado (RN-GRADE-018)", () => {
  it("abre conferindo a tabela e a chave, segura a atualização automática, e mostra o texto", async () => {
    const h = harness();
    h.current().open(request());
    expect(h.render().dialog?.view.body).toEqual({ kind: "status", text: "Conferindo a tabela e a chave deste resultado…", cancel: false });
    expect(h.deps.hold).toHaveBeenCalledTimes(1);

    await settle();
    expect(h.render().dialog?.view.body).toEqual({ kind: "text", text: 'DELETE FROM "estoque"."pedido"\nWHERE "id" = 1;' });
  });

  it("as opções refazem o texto na hora, sem pedir nada à API", async () => {
    const h = harness();
    const dialog = await opened(h);

    dialog.onOption({ compact: true, qualified: false });
    expect(h.render().dialog?.view.body).toEqual({ kind: "text", text: 'DELETE FROM "pedido" WHERE "id" = 1;' });
    expect(h.deps.target).toHaveBeenCalledTimes(1);
  });

  it("Copiar leva o texto, fecha e avisa; a falha da área de transferência avisa e o diálogo fica", async () => {
    const h = harness();
    (await opened(h)).onCopy();
    await settle();

    expect(h.deps.copyText).toHaveBeenCalledWith('DELETE FROM "estoque"."pedido"\nWHERE "id" = 1;');
    expect(rt.toast.success).toHaveBeenCalledWith("SQL copiado.");
    expect(h.render().dialog).toBeNull();

    const failing = harness({ copyText: vi.fn(async () => Promise.reject(new Error("negado"))) });
    (await opened(failing)).onCopy();
    await settle();
    expect(rt.toast.warning).toHaveBeenCalledWith("Não foi possível copiar.");
    expect(failing.render().dialog).not.toBeNull();
  });

  it("Abrir numa aba de consulta entrega o texto e fecha; nada é executado", async () => {
    const h = harness();
    (await opened(h)).onOpenInTab();

    expect(h.deps.openQueryTab).toHaveBeenCalledWith('DELETE FROM "estoque"."pedido"\nWHERE "id" = 1;');
    expect(h.render().dialog).toBeNull();
  });

  it("Fechar interrompe o que estava em andamento e solta a atualização automática; nada mais aparece", async () => {
    const release = vi.fn();
    let answer: (value: Awaited<ReturnType<GenerateSqlDeps["target"]>>) => void = () => {};
    const h = harness({ hold: vi.fn(() => release), target: vi.fn(() => new Promise<Awaited<ReturnType<GenerateSqlDeps["target"]>>>((resolve) => (answer = resolve))) });
    h.current().open(request());
    h.render();

    h.render().dialog?.onClose();
    answer({ kind: "target", target });
    await settle();

    expect(release).toHaveBeenCalledTimes(1);
    expect(h.render().dialog).toBeNull();
  });

  it("a resposta do alvo vale para o resultado: a segunda escolha não pergunta de novo, e o plano fica para o submenu", async () => {
    const h = harness({ target: vi.fn(async () => ({ kind: "notEditable" as const, reason: "DISTINCT" })) });
    const first = await opened(h);
    expect(first.view.body).toEqual({ kind: "refused", text: "Só num resultado de uma tabela: DISTINCT." });

    first.onClose();
    await opened(h, request({ item: "selectEquals" }));
    expect(h.deps.target).toHaveBeenCalledTimes(1);
    expect(h.current().planOf("r1")?.unknownReason).toBe("DISTINCT");
    expect(h.current().planOf("outro")).toBeNull();
  });

  it("a falha mostra Tentar de novo, que pergunta outra vez", async () => {
    const target2 = vi.fn<GenerateSqlDeps["target"]>().mockResolvedValueOnce({ kind: "failed", message: "a sessão caiu" }).mockResolvedValueOnce({ kind: "target", target });
    const h = harness({ target: target2 });
    const failed = await opened(h);
    expect(failed.view.body).toEqual({ kind: "failed", title: "Não foi possível saber a tabela e a chave deste resultado.", message: "a sessão caiu" });

    failed.onRetry();
    h.render();
    await settle();
    expect(h.render().dialog?.view.body.kind).toBe("text");
    expect(target2).toHaveBeenCalledTimes(2);
  });

  it("o resultado que muda com o diálogo aberto: nada é gerado, e as saídas ficam desabilitadas", async () => {
    let current = true;
    const h = harness({ stillCurrent: () => current });
    await opened(h);

    current = false;
    expect(h.render().dialog?.view).toMatchObject({ body: { kind: "refused", text: "O resultado mudou desde a escolha das linhas. Escolha as linhas de novo e gere outra vez." }, canOutput: false });
  });

  it("a tabela de destino do INSERT da tabela não conhecida abre vazia a cada vez", async () => {
    const h = harness({ target: vi.fn(async () => ({ kind: "notEditable" as const, reason: "DISTINCT" })) });
    const dialog = await opened(h, request({ item: "insert" }));
    dialog.onTarget({ schema: "", name: "copia" });
    expect(h.render().dialog?.view.body).toEqual({ kind: "text", text: 'INSERT INTO "copia" ("id", "cliente")\nVALUES (1, \'Ana\');' });

    h.render().dialog?.onClose();
    const again = await opened(h, request({ item: "insert" }));
    expect(again.options.target).toBeUndefined();
    expect(again.view.body).toEqual({ kind: "refused", text: "Informe a tabela de destino." });
  });

  it("a resposta da API como o diálogo a usa: o alvo, o só leitura com o motivo, o resultado que mudou e a falha", () => {
    const refusal = (code: string, extensions: Record<string, unknown> = {}) => ({ ok: false as const, error: { status: 422, code, title: `Título de ${code}`, detail: "mensagem do banco", errors: null, extensions } });

    expect(sqlTargetAnswer({ ok: true, data: target })).toEqual({ kind: "target", target });
    expect(sqlTargetAnswer(refusal("RESULT_NOT_EDITABLE", { reason: "DISTINCT" }))).toEqual({ kind: "notEditable", reason: "DISTINCT" });
    expect(sqlTargetAnswer(refusal("RESULT_CHANGED"))).toEqual({ kind: "changed" });
    expect(sqlTargetAnswer(refusal("SESSION_BUSY"))).toEqual({ kind: "failed", message: "mensagem do banco" });
    expect(sqlTargetAnswer(null)).toEqual({ kind: "failed", message: null });
  });
});

describe("o desenho do diálogo (RN-GRADE-018)", () => {
  const base = (props: Partial<GenerateSqlDialogProps["view"]> = {}): GenerateSqlDialogProps => ({
    view: { subtitle: "UPDATE · estoque.pedido · 3 linhas", shown: { qualified: true, compact: true, excludeGenerated: false }, targetFields: false, warnings: [], body: { kind: "text", text: "SELECT 1;" }, canOutput: true, generated: null, ...props },
    options: { qualified: true, compact: false, excludeGenerated: true },
    onOption: vi.fn(),
    onTarget: vi.fn(),
    onRetry: vi.fn(),
    onCopy: vi.fn(),
    onOpenInTab: vi.fn(),
    onClose: vi.fn(),
  });

  const draw = (dialog: GenerateSqlDialogProps) => rt.render(() => GenerateSqlDialog({ dialog, engine: 1, connection: "conexão" })) as ReactElement<Record<string, unknown>>;
  /** O lugar do SQL desenhado (um componente sem estado). */
  const placeOf = (tree: ReactNode) => {
    const place = elementsOf(tree).find((element) => typeof element.type === "function" && element.type.name === "SqlPlace") as Found;
    return (place.type as (props: unknown) => ReactNode)(place.props);
  };

  it("o título, o que se gera e a conexão embaixo; o rodapé com Fechar, Abrir numa aba de consulta e Copiar, o principal", () => {
    const tree = draw(base());

    expect(tree.props.title).toBe("Gerar SQL");
    expect(tree.props.size).toBe("lg");
    expect(elementsOf(tree.props.description as ReactNode).some((element) => element.props.children === "UPDATE · estoque.pedido · 3 linhas")).toBe(true);
    const labels = elementsOf(tree.props.footer as ReactNode)
      .filter((element) => typeof element.props.onClick === "function")
      .map((element) => [element.props.children, element.props.disabled === true, element.props.variant ?? "primary"]);
    expect(labels).toEqual([
      ["Fechar", false, "secondary"],
      ["Abrir numa aba de consulta", false, "secondary"],
      ["Copiar", false, "primary"],
    ]);
  });

  it("as saídas ficam desabilitadas até o texto ficar pronto; a busca dos valores tem Cancelar, que fecha", () => {
    const dialog = base({ body: { kind: "status", text: "Buscando os valores completos…", cancel: true }, canOutput: false });
    const tree = draw(dialog);

    expect(elementsOf(tree.props.footer as ReactNode).filter((element) => element.props.disabled === true).map((element) => element.props.children)).toEqual(["Abrir numa aba de consulta", "Copiar"]);
    const place = placeOf(tree);
    const cancel = elementsOf(place).find((element) => element.props.children === "Cancelar") as Found;
    (cancel.props.onClick as () => void)();
    expect(dialog.onClose).toHaveBeenCalled();
  });

  it("as caixas de Opções que o item tem, com as que mudam; o CREATE não tem nenhuma", () => {
    const dialog = base();
    const boxes = elementsOf(draw(dialog)).filter((element) => typeof element.props.label === "string" && typeof element.props.onChange === "function");

    expect(boxes.map((box) => [box.props.label, box.props.checked])).toEqual([
      ["Nomes completos (esquema.tabela)", true],
      ["SQL compacto (uma linha por comando)", false],
    ]);
    (boxes[1].props.onChange as (checked: boolean) => void)(true);
    expect(dialog.onOption).toHaveBeenCalledWith({ compact: true });

    const create = draw(base({ shown: { qualified: false, compact: false, excludeGenerated: false } }));
    expect(elementsOf(create).some((element) => element.type === "fieldset")).toBe(false);
  });

  it("a tabela de destino: os campos Esquema e Tabela, com o motivo de recusa no campo", () => {
    const dialog = base({ targetFields: true, body: { kind: "refused", text: "Informe a tabela de destino." }, canOutput: false });
    dialog.options = { ...dialog.options, target: { schema: "a\u0007", name: "" } };
    const fields = elementsOf(draw(dialog)).filter((element) => typeof element.props.problem !== "undefined");

    expect(fields.map((field) => [field.props.label, field.props.problem])).toEqual([
      ["Esquema", "O nome não pode ter caractere de controle."],
      ["Tabela", null],
    ]);
    (fields[1].props.onChange as (value: string) => void)("copia");
    expect(dialog.onTarget).toHaveBeenCalledWith({ schema: "a\u0007", name: "copia" });
  });

  it("a falha diz a frase e a mensagem que veio, com Tentar de novo; os avisos ficam no tom de atenção", () => {
    const dialog = base({ body: { kind: "failed", title: "Não foi possível ler o catálogo da tabela.", message: "permissão negada" }, canOutput: false, warnings: ["A conexão é somente leitura: o SQL que grava será recusado nela."] });
    const tree = draw(dialog);

    expect(elementsOf(tree).filter((element) => element.props.tone === "warning").map((element) => element.props.children)).toEqual(["A conexão é somente leitura: o SQL que grava será recusado nela."]);
    const place = placeOf(tree);
    expect(elementsOf(place).map((element) => element.props.children)).toEqual(expect.arrayContaining(["Não foi possível ler o catálogo da tabela.", "permissão negada", "Tentar de novo"]));
    (elementsOf(place).find((element) => element.props.children === "Tentar de novo")?.props.onClick as () => void)();
    expect(dialog.onRetry).toHaveBeenCalled();
  });

  it("com o texto pronto, o lugar do SQL é o editor só de leitura do banco da aba", () => {
    const place = placeOf(draw(base())) as ReactElement<Record<string, unknown>>;

    expect(place.props).toEqual({ text: "SELECT 1;", engine: 1, label: "SQL gerado", autoFocus: true });
    const typing = placeOf(draw(base({ targetFields: true }))) as ReactElement<Record<string, unknown>>;
    expect(typing.props.autoFocus).toBe(false);
  });
});
