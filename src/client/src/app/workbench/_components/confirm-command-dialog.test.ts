import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// O aviso é chamado como função (o vitest deste projeto não tem DOM): o `useId` dele devolve sempre o mesmo id, para o teste conferir o `aria-describedby`.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), useId: () => ":r1:" }));

import { unprotected, type Folder } from "@/app/connections/_lib/connections.schema";
import { Button, Dialog } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import type { CommandQuestion, ConfirmationContext } from "../_lib/command-confirmation";
import { commandConfirmationCopy as copy } from "../_lib/command-confirmation.copy";
import { ConfirmCommandDialog } from "./confirm-command-dialog";

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, confirmCommands: "irreversible", readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const context: ConfirmationContext = { connection: "MES Produção", database: "mes", environment: { name: "Produção", color: "#FF8A7A", folder: fabrica }, level: "irreversible", from: fabrica };
const deleteAll: CommandQuestion = { kind: "command", command: { number: null, sql: "DELETE FROM producao.apontamento;", irreversible: { kind: "delete", target: "producao.apontamento" } } };

/** Os elementos da árvore, com os componentes sem estado de dentro (o bloco do comando) desenhados também; o `Dialog` e o `Button` ficam como estão. */
function expanded(node: ReactNode): Found[] {
  return elementsOf(node).flatMap((element) => (typeof element.type === "function" && element.type !== Dialog && element.type !== Button ? [element, ...expanded((element.type as (props: unknown) => ReactNode)(element.props))] : [element]));
}

/** O diálogo, o que ele desenha (corpo, rodapé e a faixa do topo) e os textos de tudo. */
function drawn(question: CommandQuestion, over: Partial<ConfirmationContext> = {}, onViewSql?: () => void) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const root = ConfirmCommandDialog({ question, context: { ...context, ...over }, onConfirm, onCancel, onViewSql }) as Found;
  const dialog = elementsOf(root).find((element) => element.type === Dialog) as Found;
  const all = [...expanded(root), ...elementsOf(dialog.props.banner as ReactNode)];
  const texts = all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
  const buttons = all.filter((element) => element.type === Button);
  return { dialog, all, texts, buttons, onConfirm, onCancel };
}

describe("o aviso de confirmação antes de executar (RN-PROT-001, o ConfirmarComando do canvas)", () => {
  it("é um alertdialog com o ambiente na cor dele no topo, a conexão e o banco da aba, o título, o que o comando faz, o comando e por que o aviso aparece", () => {
    const { dialog, texts } = drawn(deleteAll);
    const banner = dialog.props.banner as Found;

    expect(dialog.props).toMatchObject({ role: "alertdialog", title: copy.titles.irreversible });
    expect(banner.props.style).toEqual({ backgroundColor: "#FF8A7A", color: "#14181D" });
    expect(texts).toEqual(
      expect.arrayContaining([
        copy.environment("Produção"),
        copy.place("MES Produção", "mes"),
        "Este DELETE não tem WHERE: ele apaga todas as linhas de producao.apontamento.",
        "DELETE FROM producao.apontamento;",
        "Você vê este aviso porque a conexão MES Produção herda da pasta Fábrica a proteção “Só comandos irreversíveis”.",
      ]),
    );
  });

  it("os botões são “Executar mesmo assim” e “Cancelar”; o foco começa em Cancelar, e fechar por fora (Esc, o X, o clique fora) é cancelar", () => {
    const { dialog, buttons, onConfirm, onCancel } = drawn(deleteAll);

    expect(buttons.map((button) => button.props.children)).toEqual([copy.confirm.command, copy.cancel]);
    expect(buttons[1].props.autoFocus).toBe(true);
    expect(buttons[0].props.variant).toBe("danger");

    (buttons[0].props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledOnce();
    (dialog.props.onClose as () => void)();
    (buttons[1].props.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("sem ambiente, a faixa é neutra, só com a conexão e o banco; a proteção própria diz que é da conexão", () => {
    const { dialog, texts } = drawn({ kind: "command", command: { number: null, sql: "SELECT 1", irreversible: null } }, { environment: null, level: "all", from: null });
    const banner = dialog.props.banner as Found;

    expect(dialog.props.title).toBe(copy.titles.command);
    expect(banner.props.style).toBeUndefined();
    expect(texts).not.toContain(copy.environment("Produção"));
    expect(texts).toContain("Você vê este aviso porque a conexão MES Produção tem a proteção “Todos os comandos”.");
  });

  it("o script lista os comandos que pedem confirmação, cada um com o número dele, e o botão é “Executar script”", () => {
    const question: CommandQuestion = {
      kind: "script",
      total: 12,
      commands: [
        { number: 3, sql: "DELETE FROM producao.apontamento", irreversible: { kind: "delete", target: "producao.apontamento" } },
        { number: 7, sql: "DROP TABLE tmp_turno", irreversible: { kind: "drop", target: "tmp_turno" } },
      ],
    };
    const { dialog, texts, buttons } = drawn(question);

    expect(dialog.props.title).toBe(copy.titles.scriptIrreversible);
    expect(texts).toEqual(expect.arrayContaining([copy.script.some(2, 12), copy.script.number(3), copy.script.number(7), "DROP TABLE tmp_turno", "Este DROP exclui tmp_turno, e o que ele apaga não volta."]));
    expect(buttons.map((button) => button.props.children)).toEqual([copy.confirm.script, copy.cancel]);
  });

  it("o Salvar diz quantas alterações vão e tem o “Ver SQL” no próprio aviso", () => {
    const onViewSql = vi.fn();
    const { dialog, texts, buttons } = drawn({ kind: "save", count: 3 }, { level: "all" }, onViewSql);

    expect(dialog.props.title).toBe(copy.titles.save);
    expect(texts).toContain(copy.save.description(3));
    expect(buttons.map((button) => button.props.children)).toEqual([copy.save.viewSql, copy.confirm.save, copy.cancel]);
    (buttons[0].props.onClick as () => void)();
    expect(onViewSql).toHaveBeenCalledOnce();
  });

  it("ligar a atualização automática mostra o comando que ela repete e diz que ela não pergunta a cada intervalo", () => {
    const { dialog, texts, buttons } = drawn({ kind: "autoRefresh", command: { number: null, sql: "SELECT * FROM producao.apontamento", irreversible: null } }, { level: "all" });

    expect(dialog.props.title).toBe(copy.titles.autoRefresh);
    expect(texts).toEqual(expect.arrayContaining(["SELECT * FROM producao.apontamento", copy.autoRefresh]));
    expect(buttons.map((button) => button.props.children)).toEqual([copy.confirm.autoRefresh, copy.cancel]);
  });

  it("o filtro do resultado que vai junto aparece embaixo do comando", () => {
    const { texts } = drawn({ kind: "command", command: { number: null, sql: "SELECT * FROM t", filter: "turno = 2", irreversible: null } }, { level: "all" });

    expect(texts).toContain(copy.filter("turno = 2"));
  });
});

describe("o que o leitor de tela ouve com o título (o aria-describedby, o cc-texto do canvas)", () => {
  /** Os elementos que o `describedBy` do aviso aponta, na ordem dele, com o texto de cada um. */
  function described(question: CommandQuestion, over: Partial<ConfirmationContext> = {}) {
    const { dialog, all } = drawn(question, over);
    const ids = (dialog.props.describedBy as string).split(" ");
    return ids.map((id) => {
      const found = all.filter((element) => element.props.id === id);
      expect(found, id).toHaveLength(1);
      return found[0].props.children;
    });
  }

  it("o comando irreversível: o que ele faz e o comando, e não só o título e o “Cancelar” que tem o foco", () => {
    expect(described(deleteAll)).toEqual(["Este DELETE não tem WHERE: ele apaga todas as linhas de producao.apontamento.", "DELETE FROM producao.apontamento;"]);
  });

  it("o comando que a tela não sabe dizer o que faz (“Todos os comandos”): o comando", () => {
    expect(described({ kind: "command", command: { number: null, sql: "SELECT 1", irreversible: null } }, { level: "all" })).toEqual(["SELECT 1"]);
  });

  it("o script: o resumo, sem a lista dos comandos, que o leitor percorre no corpo", () => {
    const question: CommandQuestion = { kind: "script", total: 12, commands: [{ number: 3, sql: "DELETE FROM producao.apontamento", irreversible: { kind: "delete", target: "producao.apontamento" } }] };

    expect(described(question)).toEqual([copy.script.some(1, 12)]);
  });

  it("o “Salvar”, o resumo; a atualização automática, o comando que ela repete e o que ela faz", () => {
    expect(described({ kind: "save", count: 3 }, { level: "all" })).toEqual([copy.save.description(3)]);
    expect(described({ kind: "autoRefresh", command: { number: null, sql: "SELECT * FROM t", irreversible: null } }, { level: "all" })).toEqual(["SELECT * FROM t", copy.autoRefresh]);
  });
});

describe("os textos do script no aviso", () => {
  it("todos os comandos pedem confirmação, no singular e no plural; o script de um comando só não tem “todos”", () => {
    expect(copy.script.all(1)).toBe("O comando do script pede confirmação. Confirmado, ele roda sem perguntar de novo.");
    expect(copy.script.all(2)).toBe("Todos os 2 comandos do script pedem confirmação. Confirmado, o script roda até o fim sem perguntar de novo.");
    expect(copy.script.all(1500)).toBe("Todos os 1.500 comandos do script pedem confirmação. Confirmado, o script roda até o fim sem perguntar de novo.");
  });

  it("só alguns: “Um comando” no singular", () => {
    expect(copy.script.some(1, 3)).toBe("Um comando de 3 é irreversível. Confirmado, o script roda até o fim sem perguntar de novo.");
    expect(copy.script.some(2, 1500)).toBe("2 comandos de 1.500 são irreversíveis. Confirmado, o script roda até o fim sem perguntar de novo.");
  });

  it("o script de um comando só em “Todos os comandos” mostra a frase dele", () => {
    const { texts } = drawn({ kind: "script", total: 1, commands: [{ number: 1, sql: "SELECT 1", irreversible: null }] }, { level: "all" });

    expect(texts).toContain("O comando do script pede confirmação. Confirmado, ele roda sem perguntar de novo.");
  });
});

describe("a pergunta do \"Salvar\" com a coluna inteira (RN-EDIT-019)", () => {
  const whole: CommandQuestion = {
    kind: "wholeColumn",
    title: "Alterar preco em 1.234 linhas de estoque.pedido?",
    lead: "O valor vai para todas as linhas que o comando do resultado devolve agora, também as que a grade não carregou:",
    assignments: ["preco = 10.00"],
    warnings: ["Gatilhos e chaves estrangeiras com ON UPDATE agem sobre essas linhas, e o número acima conta só as da tabela."],
    others: "O Salvar grava também a outra alteração não salva.",
    after: "Depois, a aba executa o comando de novo, para mostrar o que o banco tem.",
    oneAtATime: "Este banco não tem log de transação: a alteração é gravada na hora, e não há como desfazê-la; se o banco recusar no meio, parte das linhas fica alterada.",
    command: { sql: 'UPDATE "estoque"."pedido" SET "preco" = 10.00', note: "nota" },
    confirm: "Alterar 1.234 linhas",
    rows: 1234,
  };

  it("o título, a primeira frase com as colunas, as linhas de atenção, as outras pendências, o depois, o sem log, o UPDATE com a nota, o Ver SQL e os botões", () => {
    const onViewSql = vi.fn();
    const { dialog, texts, buttons } = drawn(whole, { level: null, from: null }, onViewSql);

    expect(dialog.props).toMatchObject({ role: "alertdialog", title: whole.title, describedBy: ":r1:-resumo :r1:-faz" });
    expect(texts).toEqual(expect.arrayContaining([whole.lead, "preco = 10.00", ...whole.warnings, whole.others, whole.after, whole.oneAtATime, 'UPDATE "estoque"."pedido" SET "preco" = 10.00', "nota", "Você vê este aviso sempre que uma alteração vale para a coluna inteira."]));
    const labels = buttons.map((button) => button.props.children);
    expect(labels).toEqual(["Ver SQL", "Alterar 1.234 linhas", copy.cancel]);
    (buttons[0].props.onClick as () => void)();
    expect(onViewSql).toHaveBeenCalledOnce();
    // O foco começa em "Cancelar".
    expect(buttons[2].props.autoFocus).toBe(true);
  });

  it("com a proteção da conexão, a frase dela vem junto da da coluna inteira", () => {
    const { texts } = drawn(whole, { level: "all", from: null });
    expect(texts).toContain("Você vê este aviso sempre que uma alteração vale para a coluna inteira. Você vê este aviso porque a conexão MES Produção tem a proteção “Todos os comandos”.");
  });
});
