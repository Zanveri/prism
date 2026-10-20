import { isMacPlatform } from "@/lib/utils/platform";

import { scriptRunCopy } from "./script-run.copy";
import { commandStart } from "./sql-statements";
import type { RowsState, RunTarget } from "./use-query-runner";

/**
 * O "Executar script" (seção 31, RN-SQL-019 a 022), sem React: o atalho, o estado do script que o executor da aba publica (`createQueryRunner`, que roda
 * os comandos) e as contas que a tela faz com ele (as abas, as Estatísticas, a aba que vem à frente, o aviso do fim). Funções puras, com teste.
 */

const copy = scriptRunCopy;

/** Quantas abas de resultado o script guarda (RN-SQL-020): as dos 20 primeiros comandos que devolvem linhas, e a do último, que tem o cursor aberto. */
export const scriptResultCap = 20;

/**
 * Alt+X, como no DBeaver (RN-SQL-019); no macOS, Cmd+Option+X, porque lá o Option+X escreve um caractere (`≈` no teclado americano) e o atalho o
 * tiraria do editor. A tecla vale pelo caractere e pela posição (`code`): no macOS o Option muda o caractere. Sem Ctrl: no Windows o AltGr chega como
 * Ctrl+Alt, e AltGr+X continua escrevendo o que escreve; com Shift, também não.
 */
export function scriptShortcut(event: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, platform: string): boolean {
  if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey !== isMacPlatform(platform)) return false;
  return event.key.toLowerCase() === "x" || event.code === "KeyX";
}

/** O atalho como a plataforma o escreve, no botão e para o leitor de tela (`aria-keyshortcuts`). */
export function scriptShortcutLabel(platform: string): { label: string; aria: string } {
  return isMacPlatform(platform) ? { label: copy.editor.shortcutMac, aria: "Meta+Alt+X" } : { label: copy.editor.shortcut, aria: "Alt+X" };
}

/**
 * O atalho desta plataforma, para os textos que ensinam o script fora da barra (RN-SQL-001 e 019): o aviso da seleção com mais de um comando e a dica da
 * área de resultado vazia.
 */
export const platformScriptShortcut = scriptShortcutLabel(typeof navigator === "undefined" ? "" : navigator.platform).label;

/** Na fila, executando, ok, erro (o script parou nele), pulado (falhou, e a pessoa seguiu), cancelado, não executado. */
export type ScriptEntryStatus = "pending" | "running" | "ok" | "error" | "skipped" | "cancelled" | "notRun";

/** O erro de um comando, como veio (RN-SQL-009): o título, a mensagem do banco ou da API e o SQLSTATE. */
export type ScriptError = { title: string; message: string | null; sqlState: string | null };

/** O que o item do script é (RN-VAR-019 e 022): um comando SQL, ou uma declaração ou reatribuição de variável. */
export type ScriptEntryKind = "statement" | "declaration";

/** Um comando do script, e o que se sabe dele. */
export type ScriptEntry = {
  /**
   * O comando como vai à API, com o lugar dele no texto do editor quando o script começou (`offset`): é por ele que o erro e a marca acham o lugar. No comando
   * com variáveis, `target.sent` leva o texto enviado e os parâmetros (RN-VAR-033), que o "SQL enviado" mostra (RN-VAR-018) e "Executar este comando" repete.
   */
  target: RunTarget;
  /** RN-VAR-022: a declaração e a reatribuição são itens do script como os comandos, mas não vão ao banco e têm os totais delas. */
  kind: ScriptEntryKind;
  status: ScriptEntryStatus;
  /** O comando devolveu linhas: quantas foram lidas, se havia mais a ler e, no que grava e devolve linhas (RN-SQL-013), o total. */
  rows: { read: number; more: boolean; total: number | null } | null;
  /** As linhas afetadas do comando que não devolve linhas (negativo: o banco não conta, RN-SQL-008). */
  affected: number | null;
  elapsedMs: number | null;
  error: ScriptError | null;
  /** O resultado dele tem aba (`ScriptRun.results`); falso quando passou do limite (RN-SQL-020). Nulo no comando que não devolveu linhas. */
  kept: boolean | null;
};

/**
 * `running`: um comando roda (ou vai rodar). `paused`: a pergunta de erro espera a resposta (RN-SQL-021). No fim: `done` (todos foram tentados),
 * `stopped` (a pessoa parou na pergunta, ou uma falha que não é do comando parou o script) ou `cancelled` (RN-SQL-022).
 */
export type ScriptPhase = "running" | "paused" | "done" | "stopped" | "cancelled";

/** Uma aba de resultado guardada: o comando (a posição dele no script, `entryAt`) e as linhas como estavam quando ele terminou. */
export type ScriptResult = { entry: number; rows: RowsState };

/**
 * Os totais das Estatísticas (RN-SQL-020): os que deram certo, quantos o script tem, os com erro, as linhas alteradas, o tempo e os resultados sem aba.
 * `returning` são os comandos que gravaram e devolveram linhas (RN-SQL-013, o `INSERT … RETURNING`): a API diz quantas linhas eles devolveram, e não
 * quantas alteraram (um `WITH` que apaga mil linhas e devolve a contagem delas devolve uma), então eles não somam nas linhas alteradas, e as
 * Estatísticas dizem quantos ficaram de fora.
 */
export type ScriptTotals = {
  /** Os comandos SQL que deram certo e quantos o script tem (RN-VAR-022: "Comandos executados: 8 de 9" conta só os comandos). */
  ok: number;
  total: number;
  /** As declarações e reatribuições avaliadas e quantas o script tem ("Declarações avaliadas: 3 de 3"; só aparece no script que as tem). */
  declarationsOk: number;
  declarations: number;
  errors: number;
  changed: number;
  returning: number;
  /** O tempo total soma os comandos e as avaliações, sem o tempo das perguntas. */
  elapsedMs: number;
  dropped: number;
};

/** Quantos comandos vão numa página do script (`ScriptRun.pages`). */
const pageSize = 256;

export type ScriptRun = {
  /** Muda a cada script: a tela volta às Estatísticas quando ele muda. */
  id: number;
  /**
   * Os comandos, em páginas de 256 (leia com `entryAt` e `entriesOf`). O script muda duas vezes por comando, e mudar um copia só a página dele e a lista
   * das páginas: com a lista inteira copiada a cada mudança, um script de milhares de comandos levava um tempo que crescia com o quadrado do tamanho.
   */
  pages: readonly (readonly ScriptEntry[])[];
  /** Quantos comandos o script tem. */
  size: number;
  /** Os totais, acertados a cada mudança (`withEntry`, `finishRun`): a tela os lê a cada comando sem percorrer o script inteiro. */
  totals: ScriptTotals;
  results: readonly ScriptResult[];
  /**
   * O comando cujo resultado é o do executor, com o cursor aberto (RN-SQL-007): só no fim, e só quando o último comando executado devolveu linhas. A aba
   * dele mostra o estado do executor, e não a cópia guardada: "Carregar mais", contar, o filtro, a edição e a atualização automática valem nela.
   */
  live: number | null;
  phase: ScriptPhase;
  /** O comando em execução, ou o da pergunta de erro; nulo no fim. */
  current: number | null;
};

/** A resposta da pergunta de erro (RN-SQL-021). */
export type ScriptChoice = "stop" | "retry" | "skip" | "skipAll";

/** O script que vai começar: todos os itens na fila. `kinds` diz quais são declarações (RN-VAR-022); sem ele, todos são comandos. */
export function createScriptRun(id: number, commands: readonly RunTarget[], kinds: readonly ScriptEntryKind[] = []): ScriptRun {
  const pages: ScriptEntry[][] = [];
  for (let start = 0; start < commands.length; start += pageSize) {
    pages.push(commands.slice(start, start + pageSize).map((target, offset) => ({ target, kind: kinds[start + offset] ?? "statement", status: "pending", rows: null, affected: null, elapsedMs: null, error: null, kept: null })));
  }
  const declarations = commands.reduce((count, _, index) => count + (kinds[index] === "declaration" ? 1 : 0), 0);
  return {
    id,
    pages,
    size: commands.length,
    totals: { ok: 0, total: commands.length - declarations, declarationsOk: 0, declarations, errors: 0, changed: 0, returning: 0, elapsedMs: 0, dropped: 0 },
    results: [],
    live: null,
    phase: "running",
    current: null,
  };
}

/** O comando `index` do script. */
export function entryAt(run: ScriptRun, index: number): ScriptEntry {
  return run.pages[Math.floor(index / pageSize)][index % pageSize];
}

/** Os comandos de `from` até antes de `to` (por padrão, todos), na ordem. */
export function entriesOf(run: ScriptRun, from = 0, to = run.size): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  for (let index = from; index < to; index++) entries.push(entryAt(run, index));
  return entries;
}

/** Os totais com o comando `entry` somado (`sign` 1) ou tirado (-1). */
function weigh(totals: ScriptTotals, entry: ScriptEntry, sign: 1 | -1): ScriptTotals {
  const declaration = entry.kind === "declaration";
  return {
    ...totals,
    ok: totals.ok + (!declaration && entry.status === "ok" ? sign : 0),
    declarationsOk: totals.declarationsOk + (declaration && entry.status === "ok" ? sign : 0),
    errors: totals.errors + (entry.status === "error" || entry.status === "skipped" ? sign : 0),
    // O comando para o qual o banco não conta linhas responde um número negativo (RN-SQL-008): não soma.
    changed: totals.changed + (entry.affected !== null && entry.affected > 0 ? sign * entry.affected : 0),
    // RN-SQL-013: o que gravou e devolveu linhas tem o total das devolvidas, e não o das alteradas: fica de fora da soma, e conta aqui.
    returning: totals.returning + (entry.rows !== null && entry.rows.total !== null ? sign : 0),
    elapsedMs: totals.elapsedMs + sign * (entry.elapsedMs ?? 0),
    dropped: totals.dropped + (entry.kept === false ? sign : 0),
  };
}

/** O comando `index` com o que mudou nele. As outras páginas são as mesmas, e os totais trocam o comando de antes pelo de agora. */
export function withEntry(run: ScriptRun, index: number, patch: Partial<ScriptEntry>): ScriptRun {
  const at = Math.floor(index / pageSize);
  const before = run.pages[at][index % pageSize];
  const after = { ...before, ...patch };
  const page = run.pages[at].slice();
  page[index % pageSize] = after;
  const pages = run.pages.slice();
  pages[at] = page;
  return { ...run, pages, totals: weigh(weigh(run.totals, before, -1), after, 1) };
}

/** O comando `index` começa: executando, sem o erro de uma tentativa anterior ("Tentar de novo"). */
export function startEntry(run: ScriptRun, index: number): ScriptRun {
  return { ...withEntry(run, index, { status: "running", error: null }), phase: "running", current: index };
}

/** O fim do script: os comandos que não chegaram a rodar ficam "não executado", e o que estava executando, com o `current` que o fim diz. */
export function finishRun(run: ScriptRun, phase: Exclude<ScriptPhase, "running" | "paused">, running: ScriptEntryStatus = "notRun"): ScriptRun {
  let totals = run.totals;
  const pages = run.pages.map((page) => {
    if (!page.some((entry) => entry.status === "pending" || entry.status === "running")) return page;
    return page.map((entry) => {
      if (entry.status !== "pending" && entry.status !== "running") return entry;
      const ended: ScriptEntry = { ...entry, status: entry.status === "pending" ? "notRun" : running };
      totals = weigh(weigh(totals, entry, -1), ended, 1);
      return ended;
    });
  });
  return { ...run, phase, current: null, pages, totals };
}

/** Os totais das Estatísticas (RN-SQL-020): os que deram certo, os com erro, as linhas alteradas, o tempo e os resultados que não ganharam aba. */
export function scriptTotals(run: ScriptRun): ScriptTotals {
  return run.totals;
}

/** Quantas linhas as Estatísticas desenham enquanto o script roda (`statisticsRange`), e quantas delas vêm antes do comando em execução. */
export const statisticsWindow = 50;
const statisticsLead = 5;

/**
 * As linhas que as Estatísticas desenham (RN-SQL-020), de `from` até antes de `to`. Enquanto o script roda ou espera a pergunta, só as em volta do comando
 * em execução, com ele perto do alto: elas ficam à frente e mudam a cada comando, e a tabela inteira, refeita e medida de novo a cada um, fazia o script
 * levar um tempo que crescia com o quadrado do tamanho (3.000 comandos levavam 115 s, com a janela sem responder). No fim, todas, uma vez.
 */
export function statisticsRange(run: ScriptRun): { from: number; to: number } {
  if (run.phase !== "running" && run.phase !== "paused") return { from: 0, to: run.size };
  const from = Math.max(0, Math.min((run.current ?? 0) - statisticsLead, run.size - statisticsWindow));
  return { from, to: Math.min(run.size, from + statisticsWindow) };
}

/** O que a barra da área de resultado diz do script: o comando em execução ("Executando 3 de 12…"), ou onde ele espera a pergunta; nada no fim. */
export function scriptProgress(run: ScriptRun | null): string | null {
  if (run === null || run.current === null) return null;
  return run.phase === "paused" ? copy.paused(run.current + 1, run.size) : copy.progress(run.current + 1, run.size);
}

/** O que a barra da área recolhida diz das Estatísticas (RN-SQL-020): o comando em execução, ou os totais. */
export function statisticsSummary(run: ScriptRun): string {
  const progress = scriptProgress(run);
  if (progress !== null) return progress;
  const totals = scriptTotals(run);
  return [copy.statistics.executed(totals.ok, totals.total), ...(totals.errors === 0 ? [] : [copy.statistics.withErrors(totals.errors)]), copy.statistics.totalTime(totals.elapsedMs)].join(" · ");
}

/** Quanto do começo do texto vai no título da aba e na coluna das Estatísticas. */
const headLength = 32;

/**
 * O começo do comando, numa linha: sem os espaços e os comentários de cima (o comentário logo acima do comando vai com ele, RN-SQL-018), lidos pelo leitor
 * do projeto nas regras do banco do comando (`commandStart`: o aninhado do PostgreSQL e do Db2, o `{ … }` só no Informix), e com os espaços e as quebras de
 * linha juntos num espaço só, cortado com reticências. Só comentário (não acontece: não é comando), o texto como está, cortado.
 */
export function commandHead(target: Pick<RunTarget, "sql" | "engine">, length = headLength): string {
  const text = target.sql.slice(commandStart(target.sql, target.engine));
  const line = (text === "" ? target.sql : text).replace(/\s+/g, " ").trim();
  return line.length <= length ? line : `${line.slice(0, length - 1).trimEnd()}…`;
}

/** A dica com o texto inteiro do comando: um texto muito grande vai cortado, para a dica caber na tela. */
export function commandHint(sql: string): string {
  const limit = 2_000;
  return sql.length <= limit ? sql : `${sql.slice(0, limit)}…`;
}

/**
 * RN-SQL-024: os `resultID` que o comando seguinte manda à API (`keep`), para ela continuar guardando o que a edição precisa deles: os das abas do script
 * que ficam na tela depois dele, todas menos a do último comando (`live`), cujo resultado o comando substitui (o F5, o filtro, a atualização automática).
 * Enquanto o script roda não há `live`, e vão todas: a do comando anterior também, quando ele ganhou aba. Sem script, nenhum.
 */
export function keptResultIds(run: ScriptRun | null): string[] {
  if (run === null) return [];
  return run.results.flatMap((result) => (result.entry === run.live || result.rows.resultId == null ? [] : [result.rows.resultId]));
}

/**
 * RN-SQL-023 e RN-EDIT-009: o "Salvar" de uma aba guardada deixa nela o que foi salvo (`patch`: as linhas, as excluídas fora, o que o banco preencheu),
 * sem executar de novo. As Estatísticas não mudam: o "Salvar" não é comando do script, e as linhas de cada comando continuam as que ele leu. Sem a aba
 * (o script já é outro), o mesmo script.
 */
export function withSavedResult(run: ScriptRun, resultId: string, patch: Partial<RowsState>): ScriptRun {
  const at = run.results.findIndex((result) => result.entry !== run.live && result.rows.resultId === resultId);
  if (at < 0) return run;
  const results = run.results.slice();
  results[at] = { ...results[at], rows: { ...results[at].rows, ...patch } };
  return { ...run, results };
}

/** As abas da área de resultado, na ordem: os resultados guardados e, por último, as Estatísticas. */
export type ScriptTab = number | "statistics";

/** As abas, na ordem: uma por resultado guardado, pelo número do comando, e as Estatísticas por último. */
export function scriptTabsOf(run: ScriptRun): ScriptTab[] {
  return [...run.results.map((result) => result.entry), "statistics"];
}

/** As setas, Home e End na lista das abas (RN-SQL-020), como numa lista de abas: a seta dá a volta. Outra tecla: nulo, e ela segue o caminho dela. */
export function scriptTabKeyTarget(key: string, tabs: readonly ScriptTab[], current: ScriptTab): ScriptTab | null {
  const at = Math.max(0, tabs.indexOf(current));
  switch (key) {
    case "ArrowRight":
      return tabs[(at + 1) % tabs.length];
    case "ArrowLeft":
      return tabs[(at - 1 + tabs.length) % tabs.length];
    case "Home":
      return tabs[0];
    case "End":
      return tabs[tabs.length - 1];
    default:
      return null;
  }
}

/**
 * A aba à frente (RN-SQL-020): a que a pessoa escolheu, enquanto ela existe; senão, enquanto o script roda, as Estatísticas, que se preenchem; no fim, a do
 * último comando, quando ele devolveu linhas (a do cursor aberto), ou as Estatísticas.
 */
export function shownScriptTab(run: ScriptRun, chosen: ScriptTab | null): ScriptTab {
  if (chosen !== null && (chosen === "statistics" || run.results.some((result) => result.entry === chosen))) return chosen;
  return run.live !== null && run.results.some((result) => result.entry === run.live) ? run.live : "statistics";
}

/**
 * O aviso do fim do script (RN-SQL-020): um só, e não um por comando, com o nome da aba (`tab`), porque o script de uma aba que não está à vista também
 * termina. Nulo enquanto ele não acabou.
 */
export function scriptEndToast(run: ScriptRun, tab: string | null = null): { tone: "success" | "warning"; message: string } | null {
  const { ok, total, errors } = scriptTotals(run);
  switch (run.phase) {
    case "done":
      return errors === 0 ? { tone: "success", message: copy.toasts.done(tab, total) } : { tone: "warning", message: copy.toasts.doneWithErrors(tab, errors, ok, total) };
    case "stopped":
      return { tone: "warning", message: copy.toasts.stopped(tab, ok, total) };
    case "cancelled":
      return { tone: "warning", message: copy.toasts.cancelled(tab, ok, total) };
    default:
      return null;
  }
}
