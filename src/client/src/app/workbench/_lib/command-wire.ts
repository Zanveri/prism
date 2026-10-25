import type { ConfirmedTarget } from "./command-confirmation";
import { irreversibleOfCommand } from "./irreversible";
import { requestParams, type BoundCommand, type BoundParameter } from "./variables/bind";
import { sentSql } from "./variables/sent-sql";
import type { QueryParam } from "./query.service";
import type { RunTarget } from "./use-query-runner";

/**
 * O comando de um resultado como a API o recebe (RN-VAR-033). O alvo de uma execução guarda o texto do editor (`sql`, para a marca do script e a posição do
 * erro) e, quando o comando tinha variáveis, o comando trocado pelos marcadores (`sent`: o texto enviado, os parâmetros e o mapa das posições). Tudo o que
 * executa de novo a partir do resultado (o F5, o filtro, a atualização automática, "Executar este comando", a exportação, a cópia) manda o texto ENVIADO e os
 * mesmos parâmetros, e nunca avalia as variáveis de novo.
 */

/** O texto que vai à API: o enviado, com os marcadores; sem variáveis, o do editor. */
export const sentTextOf = (target: Pick<RunTarget, "sql" | "sent">): string => target.sent?.sql ?? target.sql;

/** Os parâmetros do alvo, como a tela os guarda (com `variable` e `item`, para o "SQL enviado"); nulos no comando sem variáveis. */
export const parametersOf = (target: Pick<RunTarget, "sent">): readonly BoundParameter[] | undefined => (target.sent === undefined || target.sent.params.length === 0 ? undefined : target.sent.params);

/** Os parâmetros como o pedido os leva (só `type` e `value`, RN-VAR-032). */
export const queryParamsOf = (target: Pick<RunTarget, "sent">): QueryParam[] => (target.sent === undefined ? [] : requestParams(target.sent.params));

/** O comando trocado do alvo, quando tem variáveis. */
export const boundOf = (target: Pick<RunTarget, "sent">): BoundCommand | undefined => target.sent;

/**
 * O comando como o aviso da proteção o mostra (RN-PROT-001 e RN-VAR-018): o do editor, ou, com variáveis, o texto enviado com os valores no lugar, como
 * literais do banco, com o trecho de cada variável `sql` marcado. A análise de irreversível é a do texto enviado (com os marcadores) e conta o comando com uma
 * variável `sql` como irreversível, na dúvida (RN-VAR-019).
 */
export function confirmedOf(target: RunTarget): ConfirmedTarget {
  const filter = target.filter === undefined ? {} : { filter: target.filter };
  const engine = target.engine === undefined ? {} : { engine: target.engine };
  if (target.sent === undefined) return { sql: target.sql, ...engine, ...filter };

  const shown = sentSql(target.sent, target.engine);
  const sqlNames = target.sent.replacements.filter((replacement) => replacement.kind === "sql").map((replacement) => replacement.name);
  return { sql: shown.text, ...engine, ...filter, ranges: shown.sqlRanges, irreversible: irreversibleOfCommand(target.sent.sql, target.engine, sqlNames) };
}
