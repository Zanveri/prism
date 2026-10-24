import { useId } from "react";

import { Button, Dialog, environmentTextColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { AskedCommand, CommandQuestion, ConfirmationContext, WholeColumnQuestion } from "../_lib/command-confirmation";
import { commandConfirmationCopy as copy } from "../_lib/command-confirmation.copy";
import { multiEditCopy } from "../_lib/multi-edit.copy";
import { HighlightedSql } from "./highlighted-sql";

type ConfirmCommandDialogProps = {
  question: CommandQuestion;
  context: ConfirmationContext;
  onConfirm: () => void;
  onCancel: () => void;
  /** Só no "Salvar" das edições (também o da coluna inteira): o "Ver SQL" (RN-EDIT-008) no próprio aviso, que abre os comandos por cima dele. */
  onViewSql?: () => void;
};

/** O título: o irreversível diz que é, e o resto diz o que vai acontecer. */
function titleOf(question: CommandQuestion): string {
  switch (question.kind) {
    case "command":
      return question.command.irreversible === null ? copy.titles.command : copy.titles.irreversible;
    case "script":
      return question.commands.some((command) => command.irreversible !== null) ? copy.titles.scriptIrreversible : copy.titles.script;
    case "save":
      return copy.titles.save;
    case "autoRefresh":
      return copy.titles.autoRefresh;
    case "load":
    case "wholeColumn":
      return question.title;
  }
}

/**
 * Os ids do que o leitor de tela lê junto do título quando o aviso abre (o `aria-describedby`, o `cc-texto` do canvas): o que o comando faz, quando a tela
 * sabe dizer, e o comando; no script e no "Salvar", o resumo (a lista dos comandos do script pode ser longa, e o leitor a percorre no corpo do aviso).
 */
export function describedIds(question: CommandQuestion, base: string): string {
  const does = `${base}-faz`;
  const sql = `${base}-comando`;
  const summary = `${base}-resumo`;
  switch (question.kind) {
    case "command":
      return question.command.irreversible === null ? sql : `${does} ${sql}`;
    case "autoRefresh":
      return `${sql} ${summary}`;
    case "script":
    case "save":
      return summary;
    case "load":
      return `${does} ${sql}`;
    case "wholeColumn":
      return `${summary} ${does}`;
  }
}

/**
 * O comando em código, que rola quando é grande, com o que ele faz quando a tela sabe dizer e o filtro do resultado que vai junto. `ids` só no comando que o
 * aviso descreve (`describedIds`); os da lista do script não têm.
 */
function CommandBlock({ command, ids }: { command: AskedCommand; ids?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {command.number === null ? null : <span className="text-xs font-semibold text-muted">{copy.script.number(command.number)}</span>}
      {command.irreversible === null ? null : (
        <p id={ids === undefined ? undefined : `${ids}-faz`} className="text-body">
          {copy.does(command.irreversible)}
        </p>
      )}
      <code id={ids === undefined ? undefined : `${ids}-comando`} className="block max-h-40 overflow-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm leading-5 whitespace-pre text-ink">
        {command.ranges === undefined ? command.sql : <HighlightedSql text={command.sql} ranges={command.ranges} />}
      </code>
      {command.filter === undefined ? null : <p className="text-xs text-muted">{copy.filter(command.filter)}</p>}
    </div>
  );
}

/**
 * RN-EDIT-019: o corpo da pergunta da coluna inteira: a primeira frase, uma linha por coluna ("preco = 10.00"), as linhas de atenção (no tom de atenção), as
 * outras pendências, o que vem depois, o aviso do banco sem log (no tom de erro) e o `UPDATE`, em código, com a nota dele. O leitor de tela ouve a primeira
 * frase com as colunas e as linhas de atenção (`describedIds`).
 */
function WholeColumnBody({ question, ids }: { question: WholeColumnQuestion; ids: string }) {
  return (
    <>
      <div id={`${ids}-resumo`} className="flex flex-col gap-1">
        <p className="text-body">{question.lead}</p>
        <ul className="flex flex-col gap-0.5 pl-1 font-mono text-sm text-ink">
          {question.assignments.map((assignment) => (
            <li key={assignment}>{assignment}</li>
          ))}
        </ul>
      </div>
      <ul id={`${ids}-faz`} className="flex flex-col gap-1">
        {question.warnings.map((warning) => (
          <li key={warning} className="text-sm text-accent">
            {warning}
          </li>
        ))}
      </ul>
      {question.others === null ? null : <p className="text-body">{question.others}</p>}
      <p className="text-body">{question.after}</p>
      {question.oneAtATime === null ? null : <p className="text-sm font-medium text-danger">{question.oneAtATime}</p>}
      {question.command === null ? null : (
        <div className="flex flex-col gap-1">
          <code className="block max-h-40 overflow-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm leading-5 whitespace-pre text-ink">{question.command.sql}</code>
          {question.command.note === null ? null : <p className="text-xs text-muted">{question.command.note}</p>}
        </div>
      )}
    </>
  );
}

/**
 * O aviso antes de executar (RN-PROT-001, o `ConfirmarComando` do canvas), que ocupa a janela antes de o comando sair da tela. No topo, a faixa do
 * ambiente da conexão (o próprio ou o herdado da pasta, RN-PASTA-005), na cor dele, com a conexão e o banco da aba; sem ambiente, a faixa neutra. Depois o
 * título, o que o comando faz quando a tela sabe dizer ("Este DELETE não tem WHERE: …"), o comando em código (no script, a lista dos que pedem confirmação,
 * cada um com o número dele) e por que o aviso aparece: a proteção da conexão, ou a herdada da pasta.
 *
 * O foco começa em "Cancelar", e Esc, o X e o clique fora cancelam: nada é executado sem "Executar mesmo assim" ("Executar script" no script). Os botões são
 * os do canvas: o que executa só com o contorno do erro, e "Cancelar", a saída segura, cheio. O leitor de tela ouve, com o título, o que o comando faz e o
 * comando (`describedIds`), como o `aria-describedby` do canvas, e não só o título e o "Cancelar" que tem o foco.
 */
export function ConfirmCommandDialog({ question, context, onConfirm, onCancel, onViewSql }: ConfirmCommandDialogProps) {
  const ids = useId();
  const { environment } = context;
  const color = environment?.color ?? null;
  const banner = (
    <div style={color === null ? undefined : { backgroundColor: color, color: environmentTextColor(color) }} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2.5", color === null && "border-b border-border bg-panel text-ink")}>
      {environment === null ? null : <span className="font-semibold">{copy.environment(environment.name)}</span>}
      <span>{copy.place(context.connection, context.database)}</span>
    </div>
  );

  const confirmLabel =
    question.kind === "script"
      ? copy.confirm.script
      : question.kind === "save"
        ? copy.confirm.save
        : question.kind === "autoRefresh"
          ? copy.confirm.autoRefresh
          : question.kind === "load" || question.kind === "wholeColumn"
            ? question.confirm
            : copy.confirm.command;
  // Por que o aviso aparece: a proteção da conexão; na coluna inteira, que pergunta sempre (RN-EDIT-019), a frase dela e, com a proteção, também a desta.
  const protection = context.level === null ? null : copy.why(context.connection, context.level, context.from?.name ?? null);
  const why = question.kind === "wholeColumn" ? [multiEditCopy.question.why, protection].filter((part) => part !== null).join(" ") : protection;

  return (
    <Dialog
      open
      role="alertdialog"
      size="md"
      title={titleOf(question)}
      banner={banner}
      describedBy={describedIds(question, ids)}
      onClose={onCancel}
      footer={
        <>
          {(question.kind === "save" || question.kind === "wholeColumn") && onViewSql !== undefined ? (
            <Button type="button" variant="ghost" onClick={onViewSql} className="mr-auto">
              {copy.save.viewSql}
            </Button>
          ) : null}
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button autoFocus type="button" onClick={onCancel} className="bg-ink px-5 text-panel">
            {copy.cancel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {question.kind === "command" || question.kind === "autoRefresh" ? <CommandBlock command={question.command} ids={ids} /> : null}
        {question.kind === "autoRefresh" ? (
          <p id={`${ids}-resumo`} className="text-body">
            {copy.autoRefresh}
          </p>
        ) : null}
        {question.kind === "save" ? (
          <p id={`${ids}-resumo`} className="text-body">
            {copy.save.description(question.count)}
          </p>
        ) : null}
        {question.kind === "load" ? (
          <div className="flex flex-col gap-2">
            <p id={`${ids}-faz`} className="text-body">
              {question.does}
            </p>
            <code id={`${ids}-comando`} className="block max-h-40 overflow-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-sm leading-5 whitespace-pre text-ink">
              {question.commands.join("\n")}
            </code>
          </div>
        ) : null}
        {question.kind === "script" ? (
          <>
            <p id={`${ids}-resumo`} className="text-body">
              {question.commands.length === question.total ? copy.script.all(question.total) : copy.script.some(question.commands.length, question.total)}
            </p>
            <ol className="flex max-h-80 flex-col gap-4 overflow-y-auto">
              {question.commands.map((command) => (
                <li key={command.number}>
                  <CommandBlock command={command} />
                </li>
              ))}
            </ol>
          </>
        ) : null}
        {question.kind === "wholeColumn" ? <WholeColumnBody question={question} ids={ids} /> : null}
        {why === null ? null : <p className="text-xs text-muted">{why}</p>}
      </div>
    </Dialog>
  );
}
