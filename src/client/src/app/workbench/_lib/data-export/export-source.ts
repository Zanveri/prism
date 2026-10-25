import type { Engine } from "@/components/ui/engine-tag";

import type { BoundCommand, BoundParameter } from "../variables/bind";
import { sentSql } from "../variables/sent-sql";
import { dataExportCopy } from "./data-export.copy";

/**
 * De onde vêm as linhas de uma exportação (RN-EXPORT-001 e 002), como cada entrada a entrega ao assistente: a tabela ou a visão pelo navegador, os Registros
 * de uma tabela (o comando que a grade mostra, com o filtro e a ordem aplicados) ou o resultado de um comando da aba de consulta (o comando daquele
 * resultado, com o filtro dele). Puro: os textos que cada origem dá (o subtítulo do diálogo, o nome da origem, o da barra de status e o dos avisos) moram
 * aqui, testados.
 */

export type ExportOrigin =
  | { kind: "table"; view: boolean; schema: string; name: string }
  /** `sql`: o comando que a grade mostra (o `RunTarget` das linhas); `filter`: o filtro e a ordem aplicados, como o campo os tem ("" sem nenhum). */
  | { kind: "records"; schema: string; name: string; sql: string; filter: string; params?: readonly BoundParameter[] }
  /**
   * `tabTitle`: o nome da aba; `scriptNumber`: o número do comando no script (RN-SQL-020), ou nulo fora dele. `filter`: o do resultado (RN-GRADE-011). `table`:
   * a tabela única que o alvo da edição já conhece (RN-EDIT-002), que preenche a de destino do SQL e do DbUnit sem perguntar ao banco. `params` (RN-VAR-033): o
   * comando com variáveis vai pelo texto enviado (`sql`, com os marcadores) e pelos parâmetros dele, e nunca pelo texto do editor. `bound` (RN-EXPORT-015): o comando
   * trocado inteiro, para a Confirmação mostrar o "SQL enviado" com os valores no lugar.
   */
  | { kind: "result"; tabTitle: string; scriptNumber: number | null; sql: string; filter: string | null; table: { schema: string; name: string } | null; params?: readonly BoundParameter[]; bound?: BoundCommand };

/**
 * O comando da origem como a Origem do assistente o mostra (RN-EXPORT-015): o do resultado, ou, no comando com variáveis, o texto com os valores no lugar como literais
 * do banco, o mesmo do "SQL enviado" (RN-VAR-018), com a linha de comentário do alto quando algum valor ficou sem literal. A tabela não tem comando.
 */
export function originCommandText(origin: ExportOrigin, engine: Engine | undefined): string | null {
  if (origin.kind === "table") return null;
  if (origin.kind === "result" && origin.bound !== undefined) {
    const shown = sentSql(origin.bound, engine);
    return shown.header === null ? shown.text : `${shown.header}\n${shown.text}`;
  }
  return origin.sql;
}

/** Uma coluna da origem, como a grade (ou o catálogo, na tabela pelo navegador) a mostra. `generated: "always"` é a que o banco calcula sempre (RN-CAT-001). */
export type SourceColumn = { name: string; type: string; generated?: "always" | "byDefault" | null };

export type ExportSource = {
  connectionId: string;
  /** RN-ARVORE-006: o outro banco do servidor em que a aba (ou o nó do navegador) está; ausente, o da conexão. */
  database?: string;
  origin: ExportOrigin;
  /** As colunas do resultado na tela; nulas na tabela pelo navegador, que as lê do catálogo ao abrir a Extração. */
  columns: readonly SourceColumn[] | null;
  /** RN-EDIT-007 e RN-EXPORT-015: as alterações não salvas da grade de onde a exportação saiu (a Confirmação avisa que elas não vão). */
  unsavedEdits: number;
  /**
   * RN-EXPORT-001 e 005: aberto pela grade com colunas inteiras escolhidas (RN-GRADE-022), as posições delas em `columns`: só elas vêm marcadas na Extração,
   * com a frase que diz isso. Ausente, todas vêm marcadas.
   */
  checkedColumns?: readonly number[];
};

/**
 * As caixas da Extração ao abrir (RN-EXPORT-005): todas marcadas, ou, com as colunas inteiras escolhidas na grade, só elas (as posições fora das colunas não
 * contam; sem nenhuma que valha, todas).
 */
export function initialChecked(columns: readonly SourceColumn[], checkedColumns: readonly number[] | undefined): boolean[] {
  const chosen = new Set(checkedColumns?.filter((position) => position >= 0 && position < columns.length) ?? []);
  return columns.map((_, position) => chosen.size === 0 || chosen.has(position));
}

const w = dataExportCopy.wizard;

/** O subtítulo do diálogo (RN-EXPORT-003): "Tabela estoque.pedido", "Visão estoque.v_pedido", "…, com o filtro e a ordem da aba", "Resultado de consulta-1.sql". */
export function sourceTitle(origin: ExportOrigin): string {
  switch (origin.kind) {
    case "table":
      return origin.view ? w.sourceView(origin.schema, origin.name) : w.sourceTable(origin.schema, origin.name);
    case "records":
      return origin.filter === "" ? w.sourceTable(origin.schema, origin.name) : w.sourceRecordsFiltered(origin.schema, origin.name);
    case "result":
      return origin.scriptNumber === null ? w.sourceResult(origin.tabTitle) : w.sourceScriptResult(origin.scriptNumber, origin.tabTitle);
  }
}

/** O nome da origem (RN-EXPORT-006): a tabela ou a visão, sem o esquema; `resultado` no resultado de uma consulta. É o `${tabela}` do nome do arquivo. */
export function originName(origin: ExportOrigin): string {
  return origin.kind === "result" ? "resultado" : origin.name;
}

/** O esquema da origem, o `${esquema}` do nome do arquivo: vazio no resultado. */
export function originSchema(origin: ExportOrigin): string {
  return origin.kind === "result" ? "" : origin.schema;
}

/** Como a barra de status e os avisos de erro chamam a exportação (RN-EXPORT-021): "pedido", ou "resultado de consulta-1.sql". */
export function progressName(origin: ExportOrigin): string {
  return origin.kind === "result" ? `resultado de ${origin.tabTitle}` : origin.name;
}

/** O sujeito do aviso de sucesso (RN-EXPORT-022): "Tabela pedido" (feminino), "Visão v_pedido", "Resultado de consulta-1.sql" (masculino). */
export function toastSubject(origin: ExportOrigin): { subject: string; feminine: boolean } {
  if (origin.kind === "result") return { subject: `Resultado de ${origin.tabTitle}`, feminine: false };
  return { subject: `${origin.kind === "table" && origin.view ? "Visão" : "Tabela"} ${origin.name}`, feminine: true };
}

/** A tabela de destino do SQL e do DbUnit (RN-EXPORT-011 e 012): a da origem na tabela e nos Registros; no resultado, a do alvo da edição ou vazia. */
export function targetDefaults(origin: ExportOrigin): { schema: string; table: string } {
  if (origin.kind === "result") return origin.table === null ? { schema: "", table: "" } : { schema: origin.table.schema, table: origin.table.name };
  return { schema: origin.schema, table: origin.name };
}

/** A tabela do SQL e do DbUnit é obrigatória quando não há de onde tirá-la: o resultado de uma consulta sem uma tabela só (RN-EXPORT-011). */
export function tableRequired(origin: ExportOrigin): boolean {
  return origin.kind === "result";
}

/** "Incluir as colunas que o banco calcula" só aparece onde o catálogo diz quais são: na tabela e nos Registros (RN-EXPORT-011). */
export function knowsGenerated(origin: ExportOrigin): boolean {
  return origin.kind !== "result";
}
