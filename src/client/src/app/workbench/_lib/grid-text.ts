/*
 * A largura do texto da grade do resultado (RN-GRADE-009 e RN-CONFIG-008), em funções puras. A grade usa a fonte da interface, que é proporcional: a
 * largura de saída de uma coluna não sai de contar caracteres, e sim de medir cada um na fonte (o `measureText` de um `canvas` que não entra na página,
 * que o `use-grid-text.ts` entrega a `measuredGridText`). Sem `canvas` (os testes, a renderização fora do navegador) vale a conta de antes, a da mono.
 *
 * Todas as medidas são as de 100% de zoom: quem desenha multiplica pelo zoom (RN-GRADE-010).
 */

/** Quanto o texto de cada parte da grade mede, em pixels de 100% de zoom. */
export type GridText = {
  /** Quem mede igual: a mesma `key` é a mesma conta (`mono` ou a pilha de fontes do `canvas`). */
  readonly key: string;
  /**
   * A largura do valor de uma célula. Com `limit`, a conta para assim que a soma passa dele e devolve o que somou até ali (maior que o limite): o valor de
   * 10.000 caracteres custa só o que cabe na coluna mais larga.
   */
  cell(text: string, limit?: number): number;
  /** A largura do nome da coluna no cabeçalho (seminegrito). */
  name(text: string): number;
  /** A largura do tipo da coluna, e da marca "somente leitura", no cabeçalho (11 px). */
  type(text: string): number;
};

/** A IBM Plex Mono a 13 px tem 0,6 em por caractere; o tipo, no cabeçalho, vai a 11 px. */
const monoCharWidth = 7.8;
const monoTypeCharWidth = 6.6;

/** A conta de antes da fonte proporcional: contar os caracteres de uma fonte de largura fixa. É o padrão quando não há como medir. */
export const monoGridText: GridText = {
  key: "mono",
  cell: (text) => text.length * monoCharWidth,
  name: (text) => text.length * monoCharWidth,
  type: (text) => text.length * monoTypeCharWidth,
};

/** As três fontes que a grade desenha, na sintaxe do `canvas`: a célula, o nome no cabeçalho (`font-semibold`) e o tipo (11 px). */
export function gridFonts(family: string): { cell: string; name: string; type: string } {
  return { cell: `400 13px ${family}`, name: `600 13px ${family}`, type: `400 11px ${family}` };
}

/** O respiro de cada texto medido: o ajuste fino do navegador (o avanço do glifo, o arredondamento) não pode custar o último caractere. */
const slack = 1;

/**
 * A largura de um texto numa fonte: cada ponto de código é medido uma vez e guardado (a soma é o que se repete, dez mil vezes por página), mais o
 * respiro, arredondada para cima. Sem o ajuste entre pares de letras a soma sobra um pouco, que é o lado seguro: o que não pode é cortar o nome. O
 * caractere que o `canvas` mede como zero ou como nada (o `canvas` sem a fonte, um controle) vale o que valia na mono, que também sobra.
 */
function summed(font: string, fallback: number, measure: (font: string, text: string) => number): (text: string, limit?: number) => number {
  const known = new Map<number, number>();

  return (text, limit = Infinity) => {
    if (text === "") return 0;

    let total = 0;
    for (const char of text) {
      const point = char.codePointAt(0) ?? 0;
      let width = known.get(point);
      if (width === undefined) {
        const measured = measure(font, char);
        width = Number.isFinite(measured) && measured > 0 ? measured : fallback;
        known.set(point, width);
      }
      total += width;
      if (total > limit) break;
    }
    return Math.ceil(total + slack);
  };
}

/**
 * A largura pela fonte, medida por `measure(fonte, texto)` (a do `canvas`): `family` é a pilha de fontes sem `var()` (`resolvedFontFamily`). Os testes
 * passam um `measure` de mentira (um mapa de caractere para largura) e contam as chamadas.
 */
export function measuredGridText(family: string, measure: (font: string, text: string) => number): GridText {
  const fonts = gridFonts(family);

  return {
    key: family,
    cell: summed(fonts.cell, monoCharWidth, measure),
    name: summed(fonts.name, monoCharWidth, measure),
    type: summed(fonts.type, monoTypeCharWidth, measure),
  };
}
