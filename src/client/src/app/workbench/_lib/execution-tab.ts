import type { RunValueEntry } from "./scripts.schema";
import { entryOf, inputOfEntry, valueOf, type VariableField } from "./variable-fields";
import type { Value } from "./variables/values";
import type { QueryTab } from "./workbench-model";

/**
 * RN-VAR-029: a aba de execução, sem a tela. O título ("Pedidos do período", e "Pedidos do período (2)" para a segunda do mesmo script nesta janela), a aba que o
 * "Executar" do navegador reusa, os valores da aba como campos do diálogo e as fichas do cabeçalho.
 */
export function executionTitle(tabs: readonly QueryTab[], scriptId: string, name: string): string {
  const open = tabs.filter((tab) => tab.execution?.scriptId === scriptId).length;
  return open === 0 ? name : `${name} (${open + 1})`;
}

/** A aba de execução mais recente do script nesta janela (a mais à direita na faixa) na mesma conexão e no mesmo banco; nenhuma, e o navegador abre outra. */
export function reusableExecution(tabs: readonly QueryTab[], scriptId: string, place: { connectionId: string | null; database?: string }): QueryTab | undefined {
  return tabs.findLast((tab) => tab.execution?.scriptId === scriptId && tab.connectionId === place.connectionId && tab.database === place.database);
}

/**
 * Os valores da aba como as respostas do diálogo, pelo nome dos campos de agora (o script pode ter mudado desde a execução de antes). Nulo quando algum não
 * serve mais (o tipo mudou) ou falta o de um campo sem padrão (a variável nova sem valor): aí o diálogo abre, com eles. O campo com padrão que não tem valor
 * na aba fica com o padrão do script, como no diálogo que a pessoa não mexeu.
 */
export function answersByName(fields: readonly VariableField[], values: Readonly<Record<string, RunValueEntry>>): ReadonlyMap<number, Value> | null {
  const answers = new Map<number, Value>();
  for (const field of fields) {
    const input = Object.hasOwn(values, field.name) ? inputOfEntry(values[field.name]) : null;
    if (input === null) {
      if (field.fallback.kind === "none") return null;
      continue;
    }
    const read = valueOf(field, input);
    if (!read.ok) return null;
    answers.set(field.index, read.value);
  }
  return answers;
}

/** As respostas do diálogo pelo nome do campo, como a aba as guarda (e as leva para outra janela). */
export function entriesOf(fields: readonly VariableField[], answers: ReadonlyMap<number, Value>): Record<string, RunValueEntry> {
  return Object.fromEntries(fields.flatMap((field) => {
    const value = answers.get(field.index);
    return value === undefined ? [] : [[field.name, entryOf(value)]];
  }));
}

const textOf = (entry: RunValueEntry): string => (entry.type === "null" ? "NULL" : entry.type === "list" ? `[${entry.items.map(textOf).join(", ")}]` : entry.value);

/** O tamanho da ficha no cabeçalho; o valor inteiro vai na dica. */
export const chipLimit = 40;

/** As fichas do cabeçalho, na ordem dos valores: "cliente_id = 7", cortada em 40 caracteres; a do `sql` leva o ícone de atenção. */
export function chipsOf(values: Readonly<Record<string, RunValueEntry>>): { name: string; text: string; full: string; sql: boolean }[] {
  return Object.entries(values).map(([name, entry]) => {
    const full = `${name} = ${textOf(entry)}`;
    return { name, full, text: full.length > chipLimit ? `${full.slice(0, chipLimit - 1)}…` : full, sql: entry.type === "sql" };
  });
}
