import { dataExportCopy, formatCount } from "../data-export/data-export.copy";
import type { DocumentFormat } from "../grid-export/document";
import { gridSelectionCopy } from "../grid-selection.copy";
import { recordsCopy } from "../records.copy";

const menu = gridSelectionCopy.menu;

/**
 * Os textos do "Copiar como", do "Copiar avançado…" e do "Configurar comandos 'Copiar como'…" (RN-GRADE-003, 016 e 017), em pt-BR. As frases são as da
 * especificação; as que ela não escreve seguem o tom das vizinhas. Os nomes e as frases dos formatos são os da exportação (`dataExportCopy.formats`).
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

const nameOf = (format: DocumentFormat) => dataExportCopy.formats.names[format];

export const copyAsCopy = {
  // RN-GRADE-003: os itens do submenu "Copiar avançado", os mesmos do menu da grade (`gridSelectionCopy.menu`, que os desenha).
  menu: {
    submenu: menu.advanced,
    advanced: menu.advancedDialog,
    copyAs: (format: DocumentFormat) => menu.copyAs(nameOf(format)),
    configure: menu.configureCopyAs,
  },

  // RN-GRADE-003: o diálogo "Copiar avançado".
  advanced: {
    title: "Copiar avançado",
    format: "Formato",
    formats: "Formato da cópia",
    scope: "O que copiar",
    scopes: { cells: "As células escolhidas", rows: "As linhas inteiras da seleção", loaded: "Todas as linhas carregadas" },
    loadedHint: "As linhas que ainda não foram carregadas não entram. Para todas, use Exportar dados…",
    size: (rows: number, columns: number) => `${formatCount(rows)} ${plural(rows, "linha", "linhas")} e ${formatCount(columns)} ${plural(columns, "coluna", "colunas")}`,
    // RN-GRADE-022: com colunas inteiras, "todas as linhas", ou "todas as 1.234 linhas" com o total sabido.
    wholeSize: (total: number | null, columns: number) => `${total === null ? "todas as linhas" : `todas as ${formatCount(total)} ${plural(total, "linha", "linhas")}`} e ${formatCount(columns)} ${plural(columns, "coluna", "colunas")}`,
    previewLoaded: "Na prévia, só as linhas carregadas; a cópia carrega as que faltam.",
    cancelLoading: "Cancelar",
    options: "Opções",
    preview: "Prévia",
    previewCut: "Na prévia, os valores cortados aparecem como na grade; a cópia leva os completos.",
    previewEmpty: "O texto sai vazio.",
    cancel: "Cancelar",
    copy: "Copiar",
    copying: "Copiando…",
    fetching: "Buscando os valores completos…",
    cancelFetch: "Cancelar a busca",
  },

  // RN-GRADE-017: o diálogo "Configurar comandos 'Copiar como'".
  configure: {
    title: "Configurar comandos 'Copiar como'",
    formats: "Formatos do 'Copiar como'",
    /** Depois do nome do formato, só para o leitor de tela: "CSV, com um campo recusado". */
    refusedSuffix: ", com um campo recusado",
    cancel: "Cancelar",
    save: "Salvar",
    saved: "Opções do 'Copiar como' salvas.",
  },

  // RN-GRADE-016: a faixa sobre a grade enquanto a tela pergunta a tabela do resultado.
  checkingTable: "Conferindo a tabela deste resultado…",

  // RN-GRADE-016 e RN-GRADE-002: os avisos.
  notice: {
    // RN-GRADE-016: a coluna repetida no SQL, com a causa da exportação (RN-EXPORT-011); o que deixar de fora é da seleção, e não da Extração.
    duplicateColumn: (name: string) => `O resultado tem duas colunas chamadas ${name}: deixe uma de fora da seleção.`,
    copied: (rows: number, format: DocumentFormat) => `${formatCount(rows)} ${plural(rows, "linha copiada", "linhas copiadas")} em ${nameOf(format)}.`,
    cutValues: (count: number) => `${formatCount(count)} ${plural(count, "valor cortado", "valores cortados")} na largura máxima do TXT.`,
    removed: (count: number) => (count === 1 ? "1 caractere que o formato não aceita foi tirado." : `${formatCount(count)} caracteres que o formato não aceita foram tirados.`),
    skipped: (count: number) => (count === 1 ? "1 linha não copiada, comentada no SQL: o comentário diz por quê." : `${formatCount(count)} linhas não copiadas, comentadas no SQL: o comentário de cada uma diz por quê.`),
    notWhole: (count: number) => (count === 1 ? "1 valor não pôde vir inteiro e foi cortado." : `${formatCount(count)} valores não puderam vir inteiros e foram cortados.`),
    // A recusa do limite e a falha da área de transferência são as do "Copiar" (RN-GRADE-002): uma frase só para os dois.
    tooLarge: gridSelectionCopy.copy.tooLarge,
    failed: recordsCopy.edit.menu.notCopied,
  },
};
