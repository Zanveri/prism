import { formatCount } from "@/lib/utils/format";

/**
 * Os textos do "Filtrar" da grade (RN-GRADE-010 da seção "Filtrar como no DBeaver"), do campo de filtro no resultado da aba de consulta
 * (RN-GRADE-011) e do autocompletar do campo (RN-TABELA-011), num lugar só. Os rótulos das condições não estão aqui: eles são a própria
 * condição, como ela entra no campo.
 */
export const gridFilterCopy = {
  menu: {
    /** O item do menu da célula que abre o submenu (F11). */
    filter: "Filtrar",
    /** O nome do submenu para o leitor de tela. */
    label: "Filtrar",
    byValue: "Filtrar por valor…",
    /** Os títulos dos dois grupos do submenu. */
    cellValue: "Valor da célula",
    custom: "Personalizado",
    clear: "Remover todos os filtros e ordenações",
    /** O lugar do valor no rótulo de uma comparação que não se aplica à célula (nula, cortada, binária). */
    noValue: "(valor da célula)",
    /** O lugar do valor no rótulo do "Personalizado": a pessoa o escreve depois. */
    typed: "…",
    /** O que fica embaixo do rótulo do item que não se aplica. */
    unavailable: (reason: string) => `Não se aplica: ${reason}.`,
  },

  /** Por que uma opção do "Filtrar" não se aplica (completam "Não se aplica: …"). */
  reasons: {
    nullCell: "a célula é nula",
    truncated: "o valor chegou cortado, e a tela não o tem inteiro",
    binary: "a coluna é binária",
    controls: "o valor tem quebra de linha, tabulação ou outro caractere de controle",
    informix: "o Informix não aceita este valor como literal",
    informixOrder: "o Informix não ordena valores lógicos",
    emptyLike: "o valor é vazio, e “contém” casaria tudo",
    textOnly: "só vale em coluna de texto",
    newRow: "a linha nova ainda não está no banco",
    busy: "há um comando em andamento na aba",
    several: "o filtro do campo tem mais de um comando",
    open: "o filtro do campo deixa aspas ou um comentário abertos",
    nothingToRemove: "não há filtro nem ordem",
    noValues: "não há valores para escolher",
  },

  /** O diálogo "Filtrar por valor…". */
  values: {
    title: (column: string) => `Filtrar ${column} por valor`,
    description: (rows: number, more: boolean) => `Os valores distintos das ${formatCount(rows, "linha carregada", "linhas carregadas")}${more ? ", sem as que ainda não foram lidas" : ""}, dos mais frequentes para os menos.`,
    search: "Buscar valor",
    searchPlaceholder: "Buscar…",
    /** A lista para o leitor de tela. */
    list: "Valores da coluna",
    nullValue: "NULL",
    emptyValue: "(vazio)",
    count: (count: number) => count.toLocaleString("pt-BR"),
    countLabel: (count: number) => formatCount(count, "vez", "vezes"),
    selectAll: "Marcar todos",
    selectNone: "Desmarcar todos",
    noMatch: "Nenhum valor tem esse texto.",
    capped: (shown: number, total: number) => `Mostrando ${shown.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} valores. Use a busca para achar os outros.`,
    unusable: (count: number) => (count === 1 ? "1 valor não entra no filtro (cortado ou com caractere de controle)." : `${count.toLocaleString("pt-BR")} valores não entram no filtro (cortados ou com caractere de controle).`),
    chosen: (count: number) => (count === 0 ? "Nenhum valor marcado." : formatCount(count, "valor marcado", "valores marcados") + "."),
    apply: "Filtrar",
    cancel: "Cancelar",
  },

  /** O campo pequeno do "Personalizado", sobre a grade. */
  custom: {
    label: (condition: string) => `Valor para ${condition}`,
    hint: "Enter filtra, Esc cancela. O valor entra como literal do banco.",
    apply: "Filtrar",
    cancel: "Cancelar",
    controls: "O valor não pode ter tabulação nem outro caractere de controle.",
    informix: "O Informix não aceita este valor como literal desta coluna.",
  },

  /** O texto de ajuda do campo vazio, o mesmo nos Registros e no resultado da aba de consulta (RN-GRADE-011). */
  placeholder: "Insira uma expressão SQL para filtrar os resultados (use Ctrl+Espaço)",

  /** O campo de filtro no resultado da aba de consulta (RN-GRADE-011). */
  result: {
    label: "Filtro e ordem do resultado",
    hint: "O que vai junto do comando: uma condição, uma ordem (ORDER BY) ou as duas. O texto do editor não muda.",
    /** Por que o resultado filtrado por fora do comando não se edita. */
    wrapped: "o filtro foi aplicado por fora do comando (SELECT * FROM (…)), e o resultado não diz de que tabela vem cada linha",
  },

  /** O autocompletar do campo de filtro (RN-TABELA-011). */
  completion: {
    column: "coluna",
    keyword: "palavra do filtro",
  },
};
