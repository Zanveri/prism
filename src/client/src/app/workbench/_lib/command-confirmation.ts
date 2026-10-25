import type { Confirmation, Folder } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import type { ShownProtections } from "@/app/connections/_lib/protections";
import type { Engine } from "@/components/ui/engine-tag";

import { irreversibleOf, type Irreversible } from "./irreversible";

/** Um comando que vai ao banco, como o executor o recebe: o texto, o banco da aba (que diz como ler o texto) e o filtro do resultado (RN-GRADE-011). */
export type ConfirmedTarget = {
  sql: string;
  engine?: Engine;
  filter?: string;
  /**
   * RN-VAR-018: o comando com variáveis mostra o texto com os valores que já se sabem como literais do banco (`sentSql`), e `ranges` diz onde, nele, entrou o texto
   * de uma variável `sql` (destacado no fundo de atenção). `irreversible` é a análise do comando enviado, que o texto com literais não substitui (RN-VAR-019:
   * o comando com uma variável `sql` é irreversível na dúvida). Sem eles, o aviso analisa o `sql`.
   */
  ranges?: readonly { start: number; end: number }[];
  irreversible?: Irreversible | null;
};

/** Um comando no aviso: o número dele no script (nulo fora do script), o texto, o filtro do resultado que vai junto e por que ele é irreversível. */
export type AskedCommand = { number: number | null; sql: string; filter?: string; irreversible: Irreversible | null; ranges?: readonly { start: number; end: number }[] };

/**
 * O que o aviso de confirmação pergunta (RN-PROT-001): executar um comando (o "Executar", o Ctrl+Enter, o "Executar este comando" das abas do script, o F5,
 * o "Executar de novo", o filtro e a ordem do resultado), executar um script (Alt+X, uma vez, com a lista dos comandos que pedem confirmação), o "Salvar"
 * das edições (só em "Todos os comandos", com quantas alterações vão) ou ligar a atualização automática (só em "Todos os comandos", uma vez).
 */
export type CommandQuestion =
  | { kind: "command"; command: AskedCommand }
  | { kind: "script"; commands: AskedCommand[]; total: number }
  | { kind: "save"; count: number }
  | { kind: "autoRefresh"; command: AskedCommand }
  /**
   * A importação de dados e a cópia para outro banco (RN-IMPORT-013 e 025), pela conexão de destino: o título ("Esvaziar a tabela e importar?"), o que ela
   * faz, os comandos (o `DELETE` do esvaziamento e o `INSERT` com as colunas mapeadas) e o botão ("Importar mesmo assim", "Copiar mesmo assim").
   */
  | { kind: "load"; title: string; does: string; commands: string[]; confirm: string }
  | WholeColumnQuestion;

/**
 * RN-EDIT-019: a pergunta do "Salvar" com a coluna inteira, que vem SEMPRE, também sem a proteção "Confirmar antes de executar" (ela altera linhas que a pessoa
 * não viu), e é a única daquele "Salvar". Os textos já vêm prontos (`wholeColumnQuestion`, em `whole-column-question.ts`), de cima para baixo: o título, a
 * primeira frase com uma linha por coluna, as linhas de atenção, as outras pendências, o que vem depois, o aviso do banco sem log, o `UPDATE` como o
 * `queries/edits/preview` o devolve (com a nota dele) e o botão. `rows` são as linhas contadas.
 */
export type WholeColumnQuestion = {
  kind: "wholeColumn";
  title: string;
  lead: string;
  assignments: readonly string[];
  warnings: readonly string[];
  others: string | null;
  after: string;
  oneAtATime: string | null;
  command: { sql: string; note: string | null } | null;
  confirm: string;
  rows: number;
};

/**
 * De quem é o aviso: a conexão, o banco da aba, o ambiente (próprio ou herdado, RN-PASTA-005) e a proteção que o pede, com a pasta de onde ela vem. Na
 * pergunta da coluna inteira (RN-EDIT-019), que vem também sem a proteção, `level` é nulo quando a conexão não tem nenhuma.
 */
export type ConfirmationContext = { connection: string; database: string; environment: ShownEnvironment | null; level: Confirmation | null; from: Folder | null };

/** A confirmação que vale (nula: "Não") e se a conexão é somente leitura, de `shownProtections`. */
type Protections = Pick<ShownProtections, "confirm" | "readOnly">;

const asked = (target: ConfirmedTarget, number: number | null, irreversible: Irreversible | null): AskedCommand => ({
  number,
  sql: target.sql,
  ...(target.filter === undefined ? {} : { filter: target.filter }),
  irreversible,
  ...(target.ranges === undefined || target.ranges.length === 0 ? {} : { ranges: target.ranges }),
});

/** A análise do comando: a que o chamador já fez (o comando com variáveis), ou a do texto. */
const irreversibleOfTarget = (target: ConfirmedTarget): Irreversible | null => (target.irreversible !== undefined ? target.irreversible : irreversibleOf(target.sql, target.engine));

/**
 * Se a proteção pede o aviso para este comando (RN-PROT-001), e o que ele mostra; nulo quando o comando sai sem perguntar. Em "Todos os comandos", todo
 * comando pergunta, e o aviso diz também se ele é irreversível. Em "Só comandos irreversíveis", só o irreversível (`irreversibleOf`), e nunca numa conexão
 * somente leitura (RN-PROT-002): a API recusa o irreversível antes de ele chegar ao banco. Com o filtro do resultado, o comando que vai ao banco é o do
 * resultado com o filtro junto, e quem diz se ele é irreversível é o do resultado.
 */
export function commandQuestion(protections: Protections, target: ConfirmedTarget): CommandQuestion | null {
  const level = protections.confirm?.level ?? null;
  if (level === null) return null;

  const irreversible = irreversibleOfTarget(target);
  if (level === "irreversible" && (protections.readOnly !== null || irreversible === null)) return null;
  return { kind: "command", command: asked(target, null, irreversible) };
}

/**
 * O aviso do "Executar script" (RN-PROT-001 e RN-SQL-019): uma vez, antes do primeiro comando, com a lista dos que pedem confirmação (cada um com o número
 * dele no script): em "Todos os comandos", todos; em "Só comandos irreversíveis", os irreversíveis, e nenhum numa conexão somente leitura. Nulo quando
 * nenhum pede: o script roda sem perguntar.
 */
export function scriptQuestion(protections: Protections, targets: readonly ConfirmedTarget[]): CommandQuestion | null {
  const level = protections.confirm?.level ?? null;
  if (level === null || targets.length === 0 || (level === "irreversible" && protections.readOnly !== null)) return null;

  const commands = targets.map((target, index) => asked(target, index + 1, irreversibleOfTarget(target))).filter((command) => level === "all" || command.irreversible !== null);
  return commands.length === 0 ? null : { kind: "script", commands, total: targets.length };
}

/**
 * O aviso do "Executar script" com variáveis (RN-PROT-001, RN-VAR-019): como o `scriptQuestion`, mas os comandos já chegam com o número deles no script (as
 * declarações também têm número, RN-VAR-022) e com os valores que se sabem no texto. `total` é quantos itens o script tem.
 */
export function numberedScriptQuestion(protections: Protections, targets: readonly (ConfirmedTarget & { number: number })[], total: number): CommandQuestion | null {
  const level = protections.confirm?.level ?? null;
  if (level === null || targets.length === 0 || (level === "irreversible" && protections.readOnly !== null)) return null;

  const commands = targets.map((target) => asked(target, target.number, irreversibleOfTarget(target))).filter((command) => level === "all" || command.irreversible !== null);
  return commands.length === 0 ? null : { kind: "script", commands, total };
}

/**
 * O aviso do "Salvar" das edições (RN-PROT-001 e RN-EDIT-005): só em "Todos os comandos", uma vez por "Salvar", com quantas alterações vão. Em "Só
 * comandos irreversíveis" não pergunta: cada comando do Salvar é pela chave da linha, com `WHERE`.
 */
export function saveQuestion(protections: Protections, count: number): CommandQuestion | null {
  return protections.confirm?.level === "all" && count > 0 ? { kind: "save", count } : null;
}

/**
 * O aviso de ligar a atualização automática (RN-PROT-001 e RN-GRADE-014): só em "Todos os comandos", ao ligar, e nunca a cada intervalo nem ao trocar só o
 * intervalo. Ela só liga sobre uma leitura, que nunca é irreversível.
 */
export function autoRefreshQuestion(protections: Protections, target: ConfirmedTarget): CommandQuestion | null {
  return protections.confirm?.level === "all" ? { kind: "autoRefresh", command: asked(target, null, irreversibleOfTarget(target)) } : null;
}

/**
 * O aviso da importação de dados e da cópia para outro banco (RN-PROT-001, RN-IMPORT-013 e 025), pela conexão de destino, uma vez, antes de começar: em
 * "Todos os comandos", sempre; em "Só comandos irreversíveis", só com "Esvaziar a tabela antes" ligado (o `DELETE` sem `WHERE` é irreversível; os `INSERT`
 * não são). Nulo quando não pergunta.
 */
export function loadQuestion(protections: Protections, load: { empty: boolean; title: string; does: string; commands: string[]; confirm: string }): CommandQuestion | null {
  const level = protections.confirm?.level ?? null;
  if (level === null || (level === "irreversible" && !load.empty)) return null;
  return { kind: "load", title: load.title, does: load.does, commands: load.commands, confirm: load.confirm };
}
