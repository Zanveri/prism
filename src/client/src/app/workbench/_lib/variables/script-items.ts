import type { Engine } from "@/components/ui/engine-tag";

import { itemAt, scriptItems, statementCount, type DeclarationReader, type ScriptItem, type StatementOptions } from "../sql-statements";
import { VariableError } from "./errors";
import { itemShape, parseItem } from "./parser";

/*
 * Os itens do script com as declarações (RN-VAR-001 e 019). O leitor do SQL (`sql-statements.ts`) acha onde cada item pode começar; quem diz se ali começa uma
 * declaração e onde ela acaba é o analisador desta pasta, e por isso ele chega ao leitor como uma função (`DeclarationReader`), e não por um `import`.
 */

/** Onde acaba a linha que contém `offset`: onde a leitura de uma declaração com erro termina, para o erro não engolir o resto do script. */
function endOfLine(source: string, offset: number): number {
  const found = source.indexOf("\n", offset);
  const end = found < 0 ? source.length : found;
  return end > 0 && source.charCodeAt(end - 1) === 13 ? end - 1 : end;
}

/**
 * O leitor das declarações para o banco da aba. Uma declaração que tem erro continua sendo um item (o erro aparece na conferência, RN-VAR-012): ela acaba onde a
 * leitura falhou, no fim dessa linha.
 */
export function declarationReader(engine?: Engine): DeclarationReader {
  return (sql, start, reassignment) => {
    const shape = itemShape(sql, start, reassignment);
    if (shape === null || (shape === "reassignment" && !reassignment)) return null;

    try {
      return { kind: shape, end: parseItem(sql, start, engine).end };
    } catch (error) {
      if (!(error instanceof VariableError)) throw error;
      return { kind: shape, end: Math.max(endOfLine(sql, Math.max(error.offset, start)), start + 1) };
    }
  };
}

/** As opções do leitor do SQL com as declarações ligadas. */
const withDeclarations = (engine: Engine | undefined, options: Pick<StatementOptions, "blankLines">): StatementOptions => ({ ...options, declarations: declarationReader(engine) });

/** Os itens do script (RN-VAR-019): as declarações, as reatribuições e os comandos, na ordem do texto. */
export function splitScript(sql: string, engine?: Engine, options: Pick<StatementOptions, "blankLines"> = {}): ScriptItem[] {
  return scriptItems(sql, engine, withDeclarations(engine, options));
}

/** O item onde está o cursor (RN-VAR-020): a declaração, a reatribuição ou o comando. */
export function scriptItemAt(sql: string, offset: number, engine?: Engine, options: Pick<StatementOptions, "blankLines"> = {}): ScriptItem | null {
  return itemAt(sql, offset, engine, withDeclarations(engine, options));
}

/** Quantos itens o texto tem, só pelo `;` e pelas declarações (RN-VAR-020): a conta da seleção do Ctrl+Enter. */
export function scriptItemCount(sql: string, engine?: Engine): number {
  return statementCount(sql, engine, { declarations: declarationReader(engine) });
}
