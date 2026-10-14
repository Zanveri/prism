import type { Engine } from "@/components/ui/engine-tag";

import type { QueryColumn } from "./query.schema";
import { sqlTokens, statementCount } from "./sql-statements";

/**
 * O nome de um esquema, tabela ou coluna no texto de um comando (RN-TABELA-002): sempre entre aspas duplas, com a
 * aspa de dentro dobrada, exatamente como o catálogo o devolve, nos três bancos. As aspas fazem do nome um pedaço
 * só: nada nele (`;`, `--`, `/*`, `{`, espaço, barra invertida) separa comandos nem vira comentário. No Informix
 * também: a sonda do projeto mostrou que este driver abre a sessão com identificadores delimitados, então as aspas
 * duplas são identificador, e sem elas um nome com maiúsculas seria dobrado para minúsculas pelo servidor (outra
 * tabela, ou nenhuma) e `insert` ou `update` faria a API tratar o comando como gravação.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export type SortDirection = "asc" | "desc";

/** A coluna e o sentido em que os registros estão ordenados, quando a ordem é de uma coluna só: é o que a seta do cabeçalho mostra (RN-TABELA-005 e 010). */
export type RecordsSort = { column: string; direction: SortDirection };

/**
 * O filtro em vigor como a memória da aba o guarda (`tab-memory.ts`). `where` é o texto do campo como foi enviado: a condição, a ordem ou as duas
 * (RN-TABELA-010). `sort` é do tempo em que a ordem do cabeçalho vivia fora do texto: a vista grava `null`, e a ordem se lê do próprio texto (`sortOf`).
 */
export type RecordsQuery = { where: string; sort: RecordsSort | null };

/**
 * O texto do filtro como vai no comando (RN-TABELA-005): sem o espaço das pontas e sem o `;` do FIM, que é só o fim do comando que a pessoa
 * escreveu. Só do fim: um `;` no meio continua sendo dois comandos, e é recusado.
 */
export function conditionOf(where: string): string {
  let condition = where.trim();
  while (condition.endsWith(";")) condition = condition.slice(0, -1).trimEnd();
  return condition;
}

/**
 * O que o texto do filtro tem (RN-TABELA-010), lido pelo leitor único de comandos (`sqlTokens`, com as aspas, os comentários e o `$tag$` de cada banco):
 * `code` são os pedaços dele, sem o `;` do fim; `order` é a posição, entre eles, do `ORDER` da ordem DE FORA, ou -1 (a que está entre parênteses é da
 * subconsulta, ou da função, que a tem); `start` e `end` dizem onde, no texto, a ordem começa e onde o código acaba (sem ordem, os dois são o fim do
 * código, que é onde ela entra). A ordem vai do `ORDER BY` de fora ATÉ O FIM do código.
 *
 * ponytail: o que a pessoa digitar depois da ordem (`LIMIT 10`, `FETCH FIRST ...`) conta como parte dela e sai com ela no clique do cabeçalho, e sem
 * ordem o clique a escreve DEPOIS dele, o que o banco recusa. A regra só conhece condição e ordem, que é o que a RN-TABELA-010 dá ao campo; se o campo
 * passar a aceitar outras cláusulas, a ordem acaba na primeira palavra de cláusula de fora, por banco.
 */
function filterShape(text: string, engine?: Engine) {
  const tokens = sqlTokens(text, engine);
  let last = tokens.length;
  while (last > 0 && tokens[last - 1].text === ";") last--;
  const code = tokens.slice(0, last);

  let depth = 0;
  let order = -1;
  for (let index = 0; index < code.length && order < 0; index++) {
    const token = code[index];
    const next = code[index + 1];

    if (token.text === "(") depth++;
    else if (token.text === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && token.word && token.text === "order" && next?.word && next.text === "by") order = index;
  }

  const end = code.at(-1)?.end ?? 0;
  return { code, order, start: order < 0 ? end : code[order].start, end };
}

/**
 * O texto do filtro em duas partes (RN-GRADE-010 do "Filtrar"): `condition` vai do começo até o fim do último pedaço de código ANTES da ordem de fora (sem
 * comentário nem espaço no fim), e `tail` é o resto, aparado: a ordem, o `;` e os comentários do fim. É onde o "Filtrar" junta a condição nova, sem tocar a
 * ordem que a pessoa escreveu.
 */
export function filterParts(text: string, engine?: Engine): { condition: string; tail: string } {
  const { code, order } = filterShape(text, engine);
  const last = order < 0 ? code.length - 1 : order - 1;
  const cut = last < 0 ? 0 : code[last].end;
  return { condition: text.slice(0, cut), tail: text.slice(cut).trim() };
}

/** A ordem de fora do texto do filtro, como foi escrita (`ORDER BY ...`, sem o `;` e sem o comentário do fim), ou vazio se ele não tem. */
export function orderOf(text: string, engine?: Engine): string {
  const { start, end } = filterShape(text, engine);
  return text.slice(start, end);
}

/**
 * O texto do filtro com a ordem de fora trocada por esta: é o que o clique no cabeçalho escreve no campo (RN-TABELA-010). A coluna vai entre
 * aspas, pela regra única (`quoteIdentifier`); com `null` a ordem sai do texto; sem ordem no texto, ela entra no fim do CÓDIGO, antes do `;` e do
 * comentário do fim (o campo é de uma linha só: depois de um `-- comentário` ela seria comentário também). A condição fica como a pessoa a escreveu.
 */
export function withOrder(text: string, sort: RecordsSort | null, engine?: Engine): string {
  const { start, end } = filterShape(text, engine);
  const clause = sort === null ? "" : `ORDER BY ${quoteIdentifier(sort.column)} ${sort.direction === "asc" ? "ASC" : "DESC"}`;
  const head = [text.slice(0, start).trim(), clause].filter((part) => part !== "").join(" ");
  const rest = text.slice(end).trim();

  return head === "" || rest === "" || rest.startsWith(";") ? head + rest : `${head} ${rest}`;
}

/**
 * A ordem do texto do filtro quando é de UMA coluna do resultado, e só dela (a coluna e, se houver, `ASC` ou `DESC`): é o que acende a seta do
 * cabeçalho e o que o clique seguinte continua (RN-TABELA-010). Várias colunas, expressão, posição (`ORDER BY 1`), `NULLS FIRST` ou uma coluna que o
 * resultado não tem: `null`, sem seta. O nome entre aspas é exato; o sem aspas acha a coluna de grafia igual ou, não havendo, a que só difere em
 * maiúsculas (é como o banco o lê). Devolve o nome como o resultado o traz.
 */
export function sortOf(text: string, columns: readonly { name: string }[], engine?: Engine): RecordsSort | null {
  const { code, order } = filterShape(text, engine);
  if (order < 0) return null;

  const [column, direction, ...more] = code.slice(order + 2);
  if (column === undefined || more.length > 0) return null;
  if (direction !== undefined && !(direction.word && (direction.text === "asc" || direction.text === "desc"))) return null;

  const written = text.slice(column.start, column.end);
  const quoted = written.length > 1 && written.startsWith('"') && written.endsWith('"');
  if (!quoted && !column.word) return null;

  const name = quoted ? written.slice(1, -1).replaceAll('""', '"') : written;
  const found = columns.find((candidate) => candidate.name === name) ?? (quoted ? undefined : columns.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase()));
  return found === undefined ? null : { column: found.name, direction: direction?.text === "desc" ? "desc" : "asc" };
}

/**
 * O `SELECT` dos registros de uma tabela (RN-TABELA-002, 005 e 010): todas as colunas, com o nome qualificado pelo esquema, e depois, numa linha
 * só dele, o texto do filtro, que é o que vem depois do nome da tabela: o que começa pela ordem (`ORDER BY ...`) vai como está, e qualquer outro vai
 * depois de `WHERE` (e pode trazer a ordem dele no fim).
 *
 * O texto vai como o usuário o escreveu, só sem o espaço das pontas e sem o `;` do fim (RN-SQL-003, `conditionOf`): não se escapa, não se põe
 * entre parênteses, não se reescreve. Quem manda é a conferência de um comando só (`recordsRunPlan`).
 *
 * O nome da tabela é o mesmo nos três bancos (`quoteIdentifier`): um nome, hostil ou não, nunca vira um segundo comando. `engine` diz como ler o
 * texto do filtro (as aspas e os comentários de cada banco), para saber se ele começa pela ordem.
 */
export function recordsSql(engine: Engine, schema: string, name: string, filter: string): string {
  const table = `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
  const text = conditionOf(filter);
  if (text === "") return table;

  // Há condição quando há código antes da ordem de fora (ou código sem ordem nenhuma): só comentário antes dela não é condição.
  const { code, order } = filterShape(text, engine);
  return `${table}\n${(order < 0 ? code.length > 0 : order > 0) ? "WHERE " : ""}${text}`;
}

/**
 * O `SELECT` dos registros sem filtro nem ordem. É um texto de um comando só, qualquer que seja o nome
 * (`statementCount` vale 1): é o que o executor das abas aceita enviar (RN-SQL-001).
 */
export function selectAllSql(engine: Engine, schema: string, name: string): string {
  return recordsSql(engine, schema, name, "");
}

/**
 * O que "aplicar", "limpar" e o clique no cabeçalho fazem com o filtro pedido: enviar (`filter` é o filtro que passa a valer, como vai no comando, e
 * `sql`, o comando dele), esperar (a aba está ocupada) ou recusar (são vários comandos).
 */
export type RecordsRunPlan = { kind: "send"; filter: string; sql: string } | { kind: "busy" } | { kind: "several" };

/**
 * A decisão antes de a tela registrar um filtro e uma ordem como aplicados (RN-TABELA-005): só o que o executor vai de fato enviar entra como
 * aplicado. Recusado (a aba ocupada, ou mais de um comando), a seta do cabeçalho, o comando à vista e o filtro em vigor ficam como estavam. Quem age
 * sobre o plano é `applyRunPlan` (`table-view.ts`).
 *
 * A recusa de mais de um comando vale no filtro como em qualquer consulta (RN-SQL-001): um `;` seguido de outra coisa, fora de texto entre aspas e
 * de comentário, faria dois comandos, e o executor não os envia. O filtro avisa antes, no próprio campo, em vez de uma frase que fala em seleção e em
 * cursor.
 */
export function recordsRunPlan(engine: Engine, schema: string, name: string, next: string, busy: boolean): RecordsRunPlan {
  if (busy) return { kind: "busy" };

  const filter = conditionOf(next);
  const sql = recordsSql(engine, schema, name, filter);
  return statementCount(sql, engine) === 1 ? { kind: "send", filter, sql } : { kind: "several" };
}

/** Clicar no cabeçalho de uma coluna: sem ordem, crescente; crescente, decrescente; decrescente, sem ordem (RN-TABELA-005). Outra coluna começa crescente. */
export function nextSort(current: RecordsSort | null, column: string): RecordsSort | null {
  if (current === null || current.column !== column) return { column, direction: "asc" };
  return current.direction === "asc" ? { column, direction: "desc" } : null;
}

/** Um número decimal simples, com expoente se tiver: o que um literal numérico do banco aceita sem aspas. */
const plainNumber = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * O valor cabe no campo do filtro, que é de uma linha só? Quebra de linha, tabulação e os demais caracteres de controle não cabem: o valor
 * não chega ao campo como é, e a condição não diria o que o banco guarda. A grade só faz de uma célula um link quando cabe.
 */
export function fitsFilter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Os textos de data e hora que a API manda (RN-SQL-011, `CellFormatter`): a data, a hora e a data e hora com a fração (até seis casas, ou nenhuma). */
const dateText = /^\d{4}-\d{2}-\d{2}$/;
const timeText = /^\d{2}:\d{2}:\d{2}$/;
const dateTimeText = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/;

/**
 * O lógico e a data e hora no Informix, onde o texto entre aspas só vale se casar com a coluna (Tarefa 33a, provado contra o Informix 14.10 pelo driver da
 * IBM, que é o caminho do Prism). `BOOLEAN` só aceita 't' e 'f' (`'true'` dá -1260): `true` e `false` viram os dois, e nenhum outro texto vira literal. Uma
 * data (`DATE`, `DATETIME YEAR TO DAY`) e uma hora (`DATETIME HOUR TO SECOND`) vão entre aspas, que o servidor lê. A data e hora com fração não: o texto
 * `2024-01-02 03:04:05.000000` dá -1264 em toda coluna com fração, porque o literal tem de ter as casas da coluna, e a API não diz quais são (o driver chama
 * todas de `DATETIME YEAR TO FRACTION(5)`). O literal tipado `DATETIME (...) YEAR TO FRACTION(5)` vale em qualquer qualificador de `YEAR TO ...`, no `INSERT`,
 * no `UPDATE` e nas comparações. O Informix guarda até cinco casas: as que passam de cinco têm de ser zeros, senão o valor perderia um dígito e não vira
 * literal. Qualquer outra forma de data e hora também não vira literal (`null`).
 */
function informixLiteral(kind: "boolean" | "datetime", value: string): string | null {
  if (kind === "boolean") return value === "true" ? "'t'" : value === "false" ? "'f'" : null;
  if (dateText.test(value) || timeText.test(value)) return `'${value}'`;

  const match = dateTimeText.exec(value);
  if (match === null) return null;

  const fraction = match[2] ?? "";
  return /^0*$/.test(fraction.slice(5)) ? `DATETIME (${match[1]}.${fraction.slice(0, 5).padEnd(5, "0")}) YEAR TO FRACTION(5)` : null;
}

/**
 * O valor de uma célula como literal do banco, para o filtro que a chave estrangeira leva à tabela referenciada (RN-TABELA-007): número só se
 * a coluna é numérica E o valor é um número (um texto que parece número, numa coluna de texto, vai entre aspas); o resto vai entre aspas
 * simples, com a aspa dobrada. A barra invertida só muda o literal no PostgreSQL: lá o literal com barra vira `E'...'` com ela dobrada (vale
 * com `standard_conforming_strings` ligado ou desligado). No Db2 e no Informix ela vai como está, porque dentro de aspas simples é um caractere
 * comum: provado nos dois servidores pelo driver da IBM, que é o caminho do Prism (Db2 12.1.5 e 11.5.8, em modo padrão e com os vetores de
 * compatibilidade ORA e MYS da instância; Informix 14.10 pela DRDA; Ruling 133). É também como a contagem de comandos da tela (`sql-statements.ts`)
 * e a da API leem a barra nesses dois bancos, e o driver da IBM divide `VALUES 'a\'; VALUES 'b'` em dois: o texto fecha na aspa, e só a aspa
 * dobrada a mantém dentro dele. Nunca sobra uma aspa solta, então o literal não vira outro comando. `null` só quando o valor tem caractere de
 * controle (quebra de linha, tabulação): não cabe numa linha de filtro. No Informix o lógico e a data e hora têm a forma que o servidor aceita (`informixLiteral`).
 */
export function sqlLiteral(engine: Engine, value: string, kind: QueryColumn["kind"]): string | null {
  if (!fitsFilter(value)) return null;
  if (kind === "number" && plainNumber.test(value)) return value;
  if (engine === 3 && (kind === "boolean" || kind === "datetime")) return informixLiteral(kind, value);

  const quoted = value.replaceAll("'", "''");
  return engine === 1 && value.includes("\\") ? `E'${quoted.replaceAll("\\", "\\\\")}'` : `'${quoted}'`;
}

/** A condição `"coluna" = valor` que o clique numa chave estrangeira escreve no filtro da tabela referenciada, ou `null` se o valor não cabe (`sqlLiteral`). */
export function equalsCondition(engine: Engine, column: string, value: string, kind: QueryColumn["kind"]): string | null {
  const literal = sqlLiteral(engine, value, kind);
  return literal === null ? null : `${quoteIdentifier(column)} = ${literal}`;
}
