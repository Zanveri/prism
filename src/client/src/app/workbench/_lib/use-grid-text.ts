import { useEffect, useMemo, useState } from "react";

import { resolvedFontFamily } from "@/app/settings/_lib/fonts";
import { useHost } from "@/components/ui/host-context";

import { gridFonts, measuredGridText, monoGridText, type GridText } from "./grid-text";

/*
 * O medidor da grade (RN-CONFIG-008 e RN-GRADE-009): o `canvas` que dá a `measuredGridText` a largura de cada caractere na fonte da interface. Mora aqui o que
 * tem documento: o `canvas`, a conferência da fonte e a espera dela carregar. A conta, que é pura, mora em `grid-text.ts`.
 */

/** O `canvas` de cada documento, criado uma vez e nunca anexado à página (medir não pinta nada); `null` quando o documento não tem contexto 2D. */
const contexts = new WeakMap<Document, CanvasRenderingContext2D | null>();

function contextOf(page: Document): CanvasRenderingContext2D | null {
  const held = contexts.get(page);
  if (held !== undefined) return held;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = page.createElement("canvas").getContext("2d");
  } catch {
    // Um ambiente sem `canvas` (ou que o recusa) mede pela conta da mono.
  }
  contexts.set(page, context);
  return context;
}

/** A fonte que não vale para o `canvas` é ignorada em silêncio: a atribuição que não pegou deixa a de antes, e a medida seria de outra fonte. */
const sentinelFont = "10px sans-serif";

function accepts(context: CanvasRenderingContext2D, font: string): boolean {
  context.font = sentinelFont;
  context.font = font;
  return context.font !== sentinelFont;
}

/**
 * A medida da grade nesta página e nesta fonte: pelo `canvas` do documento (o da janela do resultado, quando a grade está nela), ou a conta da mono quando
 * não há documento (os testes), nem contexto 2D, nem o `canvas` aceita alguma das três fontes, nem mede o "0" como largura alguma.
 */
export function gridTextFor(page: Document | undefined, family: string): GridText {
  if (page === undefined) return monoGridText;

  const context = contextOf(page);
  const fonts = gridFonts(family);
  if (context === null || !Object.values(fonts).every((font) => accepts(context, font))) return monoGridText;

  const measure = (font: string, text: string): number => {
    context.font = font;
    return context.measureText(text).width;
  };
  return measure(fonts.cell, "0") > 0 ? measuredGridText(family, measure) : monoGridText;
}

/**
 * As fontes da grade que a página ainda não carregou. Só as do app (`@fontsource`) podem estar nessa situação; a instalada no sistema não está na lista de
 * fontes da página, e para ela a conferência diz que está pronta. Sem a lista (os testes), nenhuma.
 */
export function unloadedFonts(page: Document | undefined, family: string): string[] {
  const set = page?.fonts;
  if (set === undefined) return [];

  try {
    return Object.values(gridFonts(family)).filter((font) => !set.check(font));
  } catch {
    // Uma fonte que o CSS não entende não carrega nunca: não há o que esperar.
    return [];
  }
}

/**
 * A medida do texto da grade na fonte da interface (`preferences.ui.fontFamily`). Troca de identidade só quando muda a fonte, a página (a grade foi para a janela
 * do resultado) ou a fonte do app termina de carregar: a grade então calcula as larguras de saída de novo, uma vez, e as que a pessoa escolheu continuam as dela.
 *
 * Medir antes de a fonte carregar mede a reserva dela (Segoe UI ou a do sistema): este gancho devolve essa medida, pede a fonte e, quando ela chega, devolve
 * a certa. Na prática a fonte já carregou, porque o corpo e os nomes das conexões em seminegrito a usam.
 */
export function useGridText(fontName: string): GridText {
  const page = useHost().document;
  const family = resolvedFontFamily("ui", fontName);
  const [loads, setLoads] = useState(0);

  // `loads` não entra na conta: é o aviso de que a fonte chegou, e a mesma pilha passa a medir outra coisa.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ver acima.
  const text = useMemo(() => gridTextFor(page, family), [page, family, loads]);

  useEffect(() => {
    const missing = unloadedFonts(page, family);
    if (missing.length === 0 || page === undefined) return;

    let stale = false;
    void Promise.allSettled(missing.map((font) => page.fonts.load(font))).then(() => {
      if (!stale) setLoads((count) => count + 1);
    });
    return () => {
      stale = true;
    };
  }, [page, family]);

  return text;
}
