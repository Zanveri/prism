import { queryOptions } from "@tanstack/react-query";

import { appFonts, isSafeFontName, type FontRole } from "./fonts";

/**
 * As fontes instaladas neste computador (RN-CONFIG-008), lidas na própria máquina, sem rede e sem dependência: pela API de fontes locais do
 * Chromium (`window.queryLocalFonts`), que o processo principal libera só para a origem do app (`electron/permissions.ts`). Sem a API, com a
 * permissão negada ou com a lista vazia, a resposta é `null`, e o campo aceita o nome digitado.
 */

/** O que se usa de cada `FontData` da API: uma por estilo (Regular, Bold…), e várias com a mesma família. */
export type LocalFontData = { family: string };
export type QueryLocalFonts = () => Promise<readonly LocalFontData[]>;

export type SystemFont = { family: string; monospace: boolean };

/** Em ordem de nome como as pessoas leem: sem caixa nem acento, e "Fonte 2" antes de "Fonte 10". */
const byName = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Sem acento e sem caixa: "atila" acha "Átila". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

/** O mínimo do contexto 2D do canvas que a medida usa: o teste passa um de mentira. */
export type MeasureContext = { font: string; measureText: (text: string) => { width: number } };

const probeSize = 32;
/** Uma reserva proporcional: a fonte que o canvas não tem cai nela, e o "i" dela é mais estreito que o "M". */
const proportionalFallback = "sans-serif";
const narrowSample = "iiiiiiiiii";
const wideSample = "MMMMMMMMMM";
/** A diferença que ainda conta como a mesma largura: o arredondamento de uma fonte monoespaçada de verdade fica bem abaixo de 1%. */
const tolerance = 0.01;

/**
 * Monoespaçada é a fonte em que dez "i" medem o mesmo que dez "M", no canvas, com a própria fonte. A pilha tem uma reserva proporcional atrás: a
 * família que o canvas não tem (ou que não desenha letras latinas) é medida na reserva e não passa por monoespaçada. Antes de cada medida a fonte
 * volta à reserva, para uma pilha que o canvas recusasse não medir a fonte da medida anterior.
 */
export function monospaceProbe(context: MeasureContext): (family: string) => boolean {
  return (family) => {
    if (!isSafeFontName(family)) return false;

    context.font = `${probeSize}px ${proportionalFallback}`;
    context.font = `${probeSize}px "${family}", ${proportionalFallback}`;
    const narrow = context.measureText(narrowSample).width;
    const wide = context.measureText(wideSample).width;
    return narrow > 0 && Math.abs(wide - narrow) <= wide * tolerance;
  };
}

/**
 * Lê as fontes do sistema: uma entrada por família, em ordem de nome, cada uma medida uma vez. O nome que não pode virar CSS fica de fora. Nunca
 * lança: o que não deu para ler é `null`.
 */
export async function readSystemFonts(query: QueryLocalFonts | undefined, isMonospace: (family: string) => boolean): Promise<SystemFont[] | null> {
  if (query === undefined) return null;

  let fonts: readonly LocalFontData[];
  try {
    fonts = await query();
  } catch {
    return null;
  }
  if (!Array.isArray(fonts)) return null;

  const families = new Set<string>();
  for (const font of fonts as readonly unknown[]) {
    const family = (font as { family?: unknown } | null)?.family;
    if (isSafeFontName(family)) families.add(family);
  }
  if (families.size === 0) return null;

  return [...families].sort(byName.compare).map((family) => ({ family, monospace: isMonospace(family) }));
}

/** A API da janela, se ela existe (só no Chromium; o TypeScript ainda não a conhece). */
function localFontsApi(): QueryLocalFonts | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  return typeof api === "function" ? () => api.call(window) : undefined;
}

/** A medida de verdade, num canvas que não vai para a tela. Sem canvas, nenhuma é monoespaçada e a lista vem sem os grupos. */
function canvasProbe(): (family: string) => boolean {
  const context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return context === null ? () => false : monospaceProbe(context);
}

/**
 * A lista, lida quando um dos campos de fonte é aberto (a API pede um gesto da pessoa quando a permissão ainda não foi dada) e de novo a cada vez
 * que se volta às Configurações (`gcTime: 0`): a fonte instalada com o app aberto aparece. Calada: o campo diz o que aconteceu.
 */
export const systemFontsQuery = queryOptions({
  queryKey: ["system-fonts"],
  queryFn: () => readSystemFonts(localFontsApi(), canvasProbe()),
  staleTime: Infinity,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  meta: { silent: true },
});

/** Onde a opção fica na lista: a fonte do app; no editor, as monoespaçadas e as outras; na interface, todas juntas. */
export type FontGroup = "app" | "monospace" | "other" | "installed";
export type FontChoice = { family: string; group: FontGroup };

/**
 * As opções de um campo, já filtradas pela busca (pelo pedaço do nome, sem caixa nem acento): a fonte do app primeiro; depois, no editor, as
 * monoespaçadas e então as outras, e na interface todas, cada grupo em ordem de nome. A do app instalada no sistema não se repete.
 */
export function fontChoices(role: FontRole, fonts: readonly SystemFont[] | null | undefined, search: string): FontChoice[] {
  const wanted = normalize(search);
  const matches = (family: string) => normalize(family).includes(wanted);
  const app = appFonts[role];

  const installed = (fonts ?? []).filter((font) => font.family.toLowerCase() !== app.toLowerCase() && matches(font.family));
  const groups: FontChoice[] =
    role === "editor"
      ? [...installed.filter((font) => font.monospace).map((font) => ({ family: font.family, group: "monospace" as const })), ...installed.filter((font) => !font.monospace).map((font) => ({ family: font.family, group: "other" as const }))]
      : installed.map((font) => ({ family: font.family, group: "installed" as const }));

  return matches(app) ? [{ family: app, group: "app" }, ...groups] : groups;
}

/**
 * O nome que o Enter escolhe sem opção marcada. Com a lista lida, só uma fonte dela (ou a do app), escrita com qualquer caixa. Sem a lista, o
 * nome digitado, sem os espaços das pontas, se ele pode virar CSS. `null` é "não serve".
 */
export function typedFont(role: FontRole, text: string, fonts: readonly SystemFont[] | null | undefined): string | null {
  const name = text.trim();
  const same = (family: string) => family.toLowerCase() === name.toLowerCase();

  if (same(appFonts[role])) return appFonts[role];
  if (fonts === null) return isSafeFontName(name) ? name : null;
  return fonts?.find((font) => same(font.family))?.family ?? null;
}

/** A fonte escolhida está instalada? Só se sabe com a lista lida; a do app vai dentro do Prism. */
export function isInstalled(role: FontRole, family: string, fonts: readonly SystemFont[] | null | undefined): boolean | null {
  if (family === appFonts[role]) return true;
  if (fonts === null || fonts === undefined) return null;
  return fonts.some((font) => font.family.toLowerCase() === family.toLowerCase());
}
