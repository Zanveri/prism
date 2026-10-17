import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Os diálogos com os ganchos do React simulados (`createHookRuntime`): o vitest deste projeto não tem DOM, e o formato, as opções e a fase são estado.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { Button, Dialog, FormMessage } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { previewOf, type CopyOutcome, type CopyPhase, type CopyRequest, type CopyScope, type CopySource } from "../../_lib/copy-as/copy-as";
import type { CopyAsChoices } from "../../_lib/copy-as/copy-as-choices";
import { defaultOptions, type FormatOptions } from "../../_lib/data-export/export-options";
import type { DocumentFormat } from "../../_lib/grid-export/document";
import { FormattingStep } from "../data-export/export-wizard-steps";
import { ConfigureCopyAsDialog, refusedFormats } from "./configure-copy-as-dialog";
import { CopyAdvancedDialog, type CopyAdvancedDialogProps } from "./copy-advanced-dialog";
import { CopyFormatList } from "./copy-format-list";

const choices = (target = { schema: "", table: "" }): CopyAsChoices => ({ format: "json", options: defaultOptions(target) });

const source = (rows: number, columns: number, table: CopySource["table"] = { schema: "estoque", name: "pedido" }): CopySource => ({
  engine: 1,
  sourceName: "pedido",
  table,
  columns: Array.from({ length: columns }, (_, index) => ({ name: `c${index}`, type: "text", kind: "text" as const, generated: null })),
  rows: Array.from({ length: rows }, (_, row) => ({ number: row + 1, values: Array.from({ length: columns }, (_, column) => `v${row}-${column}`) })),
});

const sources: Record<CopyScope, CopySource> = { cells: source(3, 2), rows: source(3, 5), loaded: source(200, 5) };

const ofType = (tree: unknown, type: unknown) => elementsOf(tree as Parameters<typeof elementsOf>[0]).filter((element) => element.type === type);
const one = (tree: unknown, type: unknown): Found => ofType(tree, type)[0];
const buttons = (tree: unknown) => ofType(tree, Button);
/** O botão cujo texto é este (o do ícone e do texto também). */
const buttonWith = (tree: unknown, label: string) => buttons(tree).find((button) => [button.props.children].flat().includes(label));

describe("Configurar comandos 'Copiar como' (RN-GRADE-017)", () => {
  const render = (props: Parameters<typeof ConfigureCopyAsDialog>[0]) => rt.render(() => ConfigureCopyAsDialog(props));

  it("o diálogo grande, com os nove formatos e a frase de cada um, o CSV escolhido ao abrir, e as opções sem a tabela de destino", () => {
    rt.unmount();
    const tree = render({ initial: choices(), onSave: () => {}, onClose: () => {} });
    const dialog = one(tree, Dialog);
    const list = one(tree, CopyFormatList);
    const step = one(tree, FormattingStep);

    expect(dialog.props).toMatchObject({ title: "Configurar comandos 'Copiar como'", size: "lg" });
    expect(list.props).toMatchObject({ format: "csv", describe: true, label: "Formatos do 'Copiar como'" });
    expect(step.props).toMatchObject({ format: "csv", target: false, informix: false, showGenerated: true });
  });

  it("trocar de formato guarda o que mudou no outro, e Salvar entrega as opções de todos de uma vez, com o formato lembrado", () => {
    rt.unmount();
    const onSave = vi.fn();
    let tree = render({ initial: choices(), onSave, onClose: () => {} });
    const csv = one(tree, FormattingStep).props.options as FormatOptions;
    (one(tree, FormattingStep).props.onChange as (options: FormatOptions) => void)({ ...csv, csv: { ...csv.csv, delimiter: "," } });
    tree = render({ initial: choices(), onSave, onClose: () => {} });
    (one(tree, CopyFormatList).props.onChoose as (format: DocumentFormat) => void)("txt");
    tree = render({ initial: choices(), onSave, onClose: () => {} });
    const txt = one(tree, FormattingStep).props.options as FormatOptions;
    expect(one(tree, FormattingStep).props.format).toBe("txt");
    (one(tree, FormattingStep).props.onChange as (options: FormatOptions) => void)({ ...txt, txt: { ...txt.txt, maxWidth: "40" } });
    tree = render({ initial: choices(), onSave, onClose: () => {} });
    (buttonWith(tree, "Salvar")?.props.onClick as () => void)();

    const saved = onSave.mock.calls[0][0] as CopyAsChoices;
    expect(saved.format).toBe("json");
    expect(saved.options.csv.delimiter).toBe(",");
    expect(saved.options.txt.maxWidth).toBe("40");
  });

  it("um campo recusado desabilita Salvar e marca o formato na lista, para o leitor de tela também", () => {
    rt.unmount();
    const options = defaultOptions({ schema: "", table: "" });
    const bad = { ...options, txt: { ...options.txt, minWidth: "0" } };
    const tree = render({ initial: { format: "csv", options: bad }, onSave: () => {}, onClose: () => {} });

    expect(refusedFormats(bad)).toEqual(["txt"]);
    expect(buttonWith(tree, "Salvar")?.props.disabled).toBe(true);
    const refused = one(tree, CopyFormatList).props.refused as (format: DocumentFormat) => boolean;
    expect([refused("txt"), refused("csv")]).toEqual([true, false]);
    const markup = renderToStaticMarkup(createElement(CopyFormatList, { format: "csv", onChoose: () => {}, idPrefix: "f", label: "Formatos", refused }));
    expect(markup).toContain('TXT<span class="sr-only">, com um campo recusado</span>');
  });

  it("Cancelar fecha sem gravar", () => {
    rt.unmount();
    const onSave = vi.fn();
    const onClose = vi.fn();
    (buttonWith(render({ initial: choices(), onSave, onClose }), "Cancelar")?.props.onClick as () => void)();

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("a lista dos formatos do Copiar como", () => {
  it("os nove, na ordem do submenu, o escolhido marcado e o único no Tab", () => {
    const markup = renderToStaticMarkup(createElement(CopyFormatList, { format: "sql", onChoose: () => {}, idPrefix: "f", label: "Formato da cópia" }));

    expect([...markup.matchAll(/<span class="font-medium text-ink">([^<]+)/g)].map((match) => match[1])).toEqual(["CSV", "Código fonte", "DbUnit", "HTML", "JSON", "Markdown", "SQL", "TXT", "XML"]);
    expect(markup).toMatch(/id="f-sql" role="option" aria-selected="true" tabindex="0"/);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
  });
});

describe("Copiar avançado (RN-GRADE-003)", () => {
  const base = (change: Partial<CopyAdvancedDialogProps> = {}): CopyAdvancedDialogProps => ({
    sources,
    initial: choices({ schema: "estoque", table: "pedido" }),
    onCopy: async () => ({ kind: "copied", text: "", notice: { tone: "success", text: "" } }),
    onRemember: () => {},
    onClose: () => {},
    ...change,
  });
  const render = (props: CopyAdvancedDialogProps) => rt.render(() => CopyAdvancedDialog(props));
  const radios = (tree: unknown) => ofType(tree, "input").filter((input) => input.props.type === "radio");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("abre no formato lembrado e em \"As células escolhidas\", com o tamanho de cada escolha e a frase das linhas carregadas", () => {
    rt.unmount();
    const tree = render(base());
    const details = radios(tree).map((radio) => ofType(tree, "span").find((span) => span.props.id === radio.props["aria-describedby"])?.props.children);

    expect(one(tree, CopyFormatList).props.format).toBe("json");
    expect(radios(tree).map((radio) => radio.props.checked)).toEqual([true, false, false]);
    expect(details).toEqual([
      ["3 linhas e 2 colunas", ""],
      ["3 linhas e 5 colunas", ""],
      ["200 linhas e 5 colunas", ". As linhas que ainda não foram carregadas não entram. Para todas, use Exportar dados…"],
    ]);
  });

  it("as opções são as da exportação, com a tabela de destino da origem, e a prévia é o começo do texto da escolha", () => {
    rt.unmount();
    let tree = render(base());
    expect(one(tree, FormattingStep).props).toMatchObject({ format: "json", showGenerated: true, informix: false });
    expect(JSON.stringify(tree)).toContain(JSON.stringify(previewOf("json", defaultOptions({ schema: "estoque", table: "pedido" }), sources.cells).text).slice(1, 40));

    (radios(tree)[2].props.onChange as () => void)();
    tree = render(base());
    expect(radios(tree).map((radio) => radio.props.checked)).toEqual([false, false, true]);
  });

  it("o \"Copiar como SQL\" sem tabela conhecida abre no SQL com o foco no campo da tabela, e Copiar fica desabilitado até ela ser informada", () => {
    rt.unmount();
    const unknown = { cells: source(1, 1, null), rows: source(1, 1, null), loaded: source(1, 1, null) };
    const tree = render(base({ sources: unknown, initial: choices(), initialFormat: "sql", focusTable: true }));
    const step = one(tree, FormattingStep);

    expect(step.props).toMatchObject({ format: "sql", focusTable: true, showGenerated: false });
    expect(step.props.problems).toEqual({ "options.table": "Informe a tabela de destino." });
    expect(buttonWith(tree, "Copiar")?.props.disabled).toBe(true);
  });

  it("o foco no campo da tabela é só do abrir: trocar de formato o desliga, e o campo do DbUnit ou do SQL que aparece depois não tira o foco da lista", () => {
    rt.unmount();
    const unknown = { cells: source(1, 1, null), rows: source(1, 1, null), loaded: source(1, 1, null) };
    const props = base({ sources: unknown, initial: choices(), initialFormat: "sql", focusTable: true });
    const choose = (format: DocumentFormat) => (one(render(props), CopyFormatList).props.onChoose as (format: DocumentFormat) => void)(format);

    choose("dbUnit");
    expect(one(render(props), FormattingStep).props).toMatchObject({ format: "dbUnit", focusTable: false });
    choose("sql");
    expect(one(render(props), FormattingStep).props).toMatchObject({ format: "sql", focusTable: false });
    // Sem o caso do "Copiar como SQL" sem tabela, o foco nunca vai ao campo.
    rt.unmount();
    expect(one(render(base({ initialFormat: "dbUnit" })), FormattingStep).props.focusTable).toBe(false);
  });

  it("Copiar lembra o formato e as opções, copia a escolha, e fecha quando copiou", async () => {
    rt.unmount();
    const onRemember = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn(async (): Promise<CopyOutcome> => ({ kind: "copied", text: "x", notice: { tone: "success", text: "1 linha copiada em JSON." } }));
    let tree = render(base({ onRemember, onClose, onCopy }));
    (radios(tree)[1].props.onChange as () => void)();
    tree = render(base({ onRemember, onClose, onCopy }));
    (buttonWith(tree, "Copiar")?.props.onClick as () => void)();
    await settle();

    expect(onRemember).toHaveBeenCalledWith({ format: "json", options: defaultOptions({ schema: "estoque", table: "pedido" }) });
    expect((onCopy.mock.calls[0] as unknown as [CopyRequest])[0].source).toBe(sources.rows);
    expect(onClose).toHaveBeenCalled();
  });

  it("RN-GRADE-016: no SQL, duas colunas de mesmo nome são recusadas nas opções e na prévia, e Copiar fica desabilitado; nos outros formatos, não", () => {
    rt.unmount();
    const join = (columns: number): CopySource => ({ ...source(1, columns), columns: [...source(1, columns).columns.slice(0, columns - 1), { name: "c0", type: "text", kind: "text", generated: null }] });
    const joined = { cells: join(2), rows: join(3), loaded: join(3) };
    const refusal = "O resultado tem duas colunas chamadas c0: deixe uma de fora da seleção.";
    let tree = render(base({ sources: joined, initialFormat: "sql" }));

    expect(one(tree, FormattingStep).props.problems).toEqual({ columns: refusal });
    expect(buttonWith(tree, "Copiar")?.props.disabled).toBe(true);
    expect(ofType(tree, "pre")[0].props.children).toBe(refusal);

    (one(tree, CopyFormatList).props.onChoose as (format: DocumentFormat) => void)("json");
    tree = render(base({ sources: joined, initialFormat: "sql" }));
    expect(one(tree, FormattingStep).props.problems).toEqual({});
    expect(buttonWith(tree, "Copiar")?.props.disabled).toBe(false);
    expect(ofType(tree, "pre")[0].props.children).toBe(previewOf("json", defaultOptions({ schema: "estoque", table: "pedido" }), joined.cells).text);
  });

  it("a recusa do limite de 10 MiB aparece no alto, e o diálogo fica aberto", async () => {
    rt.unmount();
    const onClose = vi.fn();
    const props = base({ onClose, onCopy: async () => ({ kind: "tooLarge", message: "O texto passou de 10 MiB, o limite da área de transferência." }) });
    (buttonWith(render(props), "Copiar")?.props.onClick as () => void)();
    await settle();
    const tree = render(props);

    expect(ofType(tree, FormMessage).map((message) => message.props.children)).toEqual(["O texto passou de 10 MiB, o limite da área de transferência."]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a cópia que lança não deixa o diálogo preso em \"Copiando…\": a fase volta, o Esc e o X voltam a valer, e a recusa aparece no alto", async () => {
    rt.unmount();
    const onClose = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = base({ onClose, onCopy: async () => Promise.reject(new TypeError("navigator.clipboard is undefined")) });
    (buttonWith(render(props), "Copiar")?.props.onClick as () => void)();
    await settle();
    const tree = render(props);

    expect(one(tree, Dialog).props.pending).toBe(false);
    expect(buttonWith(tree, "Cancelar")?.props.disabled).toBe(false);
    expect(ofType(tree, FormMessage).map((message) => message.props.children)).toEqual(["Não foi possível copiar."]);
    expect(onClose).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("enquanto copia diz \"Copiando…\" e não fecha; a busca dos completos aparece no diálogo, e \"Cancelar a busca\" desiste", async () => {
    rt.unmount();
    let control: { signal: AbortSignal; onPhase: (phase: CopyPhase) => void } | undefined;
    let finish: (outcome: CopyOutcome) => void = () => {};
    const props = base({
      onCopy: (_request, given) => {
        control = given;
        return new Promise<CopyOutcome>((resolve) => (finish = resolve));
      },
    });
    (buttonWith(render(props), "Copiar")?.props.onClick as () => void)();
    control?.onPhase("fetching");
    const tree = render(props);

    expect(one(tree, Dialog).props.pending).toBe(true);
    expect(JSON.stringify(tree)).toContain("Copiando…");
    expect(JSON.stringify(tree)).toContain("Buscando os valores completos…");
    (buttonWith(tree, "Cancelar a busca")?.props.onClick as () => void)();
    expect(control?.signal.aborted).toBe(true);

    finish({ kind: "cancelled" });
    await settle();
    const after = render(props);
    expect(one(after, Dialog).props.pending).toBe(false);
    expect(JSON.stringify(after)).not.toContain("Buscando os valores completos…");
  });
});
