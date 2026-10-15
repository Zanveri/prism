import { z } from "zod";

import { appFonts, fontNameSchema } from "./fonts";

/**
 * As preferências desta instalação (RN-CONFIG-001): o que muda só o jeito de a tela se mostrar e de se comportar. Ficam no
 * `localStorage` da janela, fora do cofre, numa chave por usuário do cofre. Nada de segredo nem de dado de conexão passa por
 * aqui; quem apagar o `localStorage` perde só o gosto, e a tela volta ao padrão.
 *
 * Quem só lê usa `usePreferences()` e o nome do campo como está aqui, em grupos: `preferences.theme`, `preferences.ui.fontFamily`,
 * `preferences.editor.fontSize`, `preferences.results.nullText`, `preferences.security.lockAfterMinutes`.
 */

/**
 * Os temas do canvas (RN-CONFIG-001 e RN-CONFIG-003): o Prism Escuro (`dark`) e o Prism Claro (`light`), Monokai, Dracula, Nord e GitHub Claro.
 * "system" não é um tema, e sim "seguir o sistema": o CSS decide, pelo `prefers-color-scheme`, entre o Prism Escuro e o Prism Claro.
 */
export const themeModes = ["dark", "light", "system", "monokai", "dracula", "nord", "github-light"] as const;

/**
 * Os passos do zoom da grade do resultado (RN-GRADE-010), em porcentagem: 100% é o tamanho de antes do zoom existir. Uma preferência só, a mesma para as
 * duas grades (a da aba de consulta e a dos Registros). Independente do zoom do programa inteiro (RN-ZOOM-001).
 */
export const gridZoomSteps = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

export const preferenceLimits = {
  fontSize: { min: 10, max: 24 },
  tabSize: { min: 1, max: 8 },
  nullText: { max: 12 },
  lockMinutes: { min: 1, max: 240 },
} as const;

/**
 * O texto que a grade mostra no lugar do nulo (RN-CONFIG-005): de 1 a 12 caracteres, que não sejam só espaços e não tenham
 * caractere de controle nem de direção de texto. Um texto vazio (ou de espaços) deixaria o nulo igual ao texto vazio na grade.
 *
 * O limite conta unidades UTF-16 (`length`), como o campo de texto (`maxLength`) e a grade (a largura da coluna). O `.max()` do zod conta pontos de código:
 * um emoji valeria um aqui e dois no campo, e de 7 a 12 emoji passariam por aqui sem o campo conseguir escrevê-los.
 */
const nullText = z
  .string()
  .refine((text) => text.length <= preferenceLimits.nullText.max)
  .regex(/^[^\p{C}]+$/u)
  .refine((text) => text.trim() !== "");

const fields = {
  theme: z.enum(themeModes),
  /** RN-CONFIG-008: a fonte da interface, todo o texto fora do código. A do app ou uma instalada, pelo nome (`fonts.ts`). */
  ui: {
    fontFamily: fontNameSchema,
  },
  editor: {
    /** RN-CONFIG-008: a fonte do editor SQL. Qualquer nome que pode virar CSS: a escolha da lista fixa de antes (Consolas…) continua valendo. */
    fontFamily: fontNameSchema,
    fontSize: z.int().min(preferenceLimits.fontSize.min).max(preferenceLimits.fontSize.max),
    tabSize: z.int().min(preferenceLimits.tabSize.min).max(preferenceLimits.tabSize.max),
    /** RN-CONFIG-004: autocompletar ao digitar. */
    autocomplete: z.boolean(),
    /** RN-CONFIG-004: converter palavra-chave para maiúsculas ao digitar. */
    uppercaseKeywords: z.boolean(),
    /** RN-SQL-018: sem seleção, a linha em branco também termina o comando do cursor. Desligada, só o `;`, como antes. */
    blankLineSeparates: z.boolean(),
  },
  results: {
    /** RN-CONFIG-005: o texto do valor nulo na grade. */
    nullText,
    /** RN-CONFIG-005: a grade busca a página seguinte sozinha ao rolar até o fim. */
    autoLoadMore: z.boolean(),
    /** RN-CONFIG-006: o cabeçalho das colunas mostra o tipo de dado ao lado do nome. */
    showColumnTypes: z.boolean(),
    /** RN-GRADE-010: o zoom da grade, num dos passos. */
    gridZoom: z.literal(gridZoomSteps),
  },
  security: {
    /** RN-SEG-001: bloquear o Prism depois de um tempo sem uso. */
    lockEnabled: z.boolean(),
    lockAfterMinutes: z.int().min(preferenceLimits.lockMinutes.min).max(preferenceLimits.lockMinutes.max),
  },
};

const strict = z.object({
  theme: fields.theme,
  ui: z.object(fields.ui),
  editor: z.object(fields.editor),
  results: z.object(fields.results),
  security: z.object(fields.security),
});

export type Preferences = z.infer<typeof strict>;
export type ThemeMode = Preferences["theme"];
export type GridZoom = Preferences["results"]["gridZoom"];

/** Uma mudança: os grupos entram pela metade (`{ results: { autoLoadMore: true } }` não toca em `results.nullText`). */
export type PreferencesPatch = { [K in keyof Preferences]?: Preferences[K] extends object ? Partial<Preferences[K]> : Preferences[K] };

function freeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) if (typeof nested === "object" && nested !== null) freeze(nested);
  return Object.freeze(value);
}

/**
 * O padrão: o do canvas (`Configuracoes.dc.html`) onde ele diz, e o combinado com as outras frentes onde o canvas não diz
 * (as fontes que o app traz: RN-CONFIG-008; maiúsculas desligadas, bloqueio ligado em 10 minutos, "buscar mais ao rolar" desligado, o tipo no cabeçalho ligado, como a grade
 * sempre o mostrou: RN-CONFIG-006, o zoom da grade em 100%: RN-GRADE-010, e a linha em branco separando os comandos, como no DBeaver: RN-SQL-018). Congelado: é o mesmo objeto para
 * todo mundo que ainda não escolheu nada. A ordem dos campos é a de `fields`.
 */
export const defaultPreferences: Preferences = freeze({
  theme: "dark",
  ui: { fontFamily: appFonts.ui },
  editor: { fontFamily: appFonts.editor, fontSize: 13, tabSize: 4, autocomplete: true, uppercaseKeywords: false, blankLineSeparates: true },
  results: { nullText: "NULL", autoLoadMore: false, showColumnTypes: true, gridZoom: 100 },
  security: { lockEnabled: true, lockAfterMinutes: 10 },
} as const satisfies Preferences);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Shape = Record<string, z.ZodType>;
type Group<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

/** Um grupo lido campo a campo: o que não confere volta ao padrão dele, e um campo estragado não leva os outros junto. */
function readGroup<S extends Shape>(shape: S, defaults: Group<S>, raw: unknown): Group<S> {
  const source = isRecord(raw) ? raw : {};
  const group = {} as Group<S>;

  for (const key of Object.keys(shape) as (keyof S & string)[]) {
    const parsed = shape[key].safeParse(source[key]);
    group[key] = parsed.success ? (parsed.data as Group<S>[typeof key]) : defaults[key];
  }

  return group;
}

/**
 * A primeira versão guardava o editor em três campos soltos (`editorFontFamily`, `editorFontSize`, `editorTabSize`): quem já
 * os tinha escolhido não os perde. Com o grupo novo presente, os soltos são ignorados.
 */
function upgradeLegacy(value: Record<string, unknown>): Record<string, unknown> {
  if ("editor" in value) return value;

  const { editorFontFamily, editorFontSize, editorTabSize } = value;
  if (editorFontFamily === undefined && editorFontSize === undefined && editorTabSize === undefined) return value;

  return { ...value, editor: { fontFamily: editorFontFamily, fontSize: editorFontSize, tabSize: editorTabSize } };
}

/** O que está gravado pode ser qualquer coisa (editado à mão, de uma versão antiga, cortado): nunca lança. */
export function parsePreferences(raw: string | null): Preferences {
  if (raw === null) return defaultPreferences;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaultPreferences;
  }
  if (!isRecord(value)) return defaultPreferences;

  const source = upgradeLegacy(value);
  const theme = fields.theme.safeParse(source.theme);

  return {
    theme: theme.success ? theme.data : defaultPreferences.theme,
    ui: readGroup(fields.ui, defaultPreferences.ui, source.ui),
    editor: readGroup(fields.editor, defaultPreferences.editor, source.editor),
    results: readGroup(fields.results, defaultPreferences.results, source.results),
    security: readGroup(fields.security, defaultPreferences.security, source.security),
  };
}

/** O texto do nulo que um campo digitado representa, ou `null` se ele não serve (vazio, só espaços, longo, com caractere de controle). */
export function parseNullText(text: string): string | null {
  const parsed = fields.results.nullText.safeParse(text);
  return parsed.success ? parsed.data : null;
}

/** O nome como a API o grava (RN-COFRE-010): sem espaços nas pontas e em minúsculas, para a tela e a API concordarem. */
export function preferencesKey(userName: string): string {
  return `prism:preferences:${userName.trim().toLowerCase()}`;
}

export type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

/** Os grupos da mudança entram nos do que já está valendo, campo a campo; o resto substitui. */
function merge(current: Preferences, patch: PreferencesPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    const base = next[key];
    next[key] = isRecord(base) && isRecord(value) ? { ...base, ...value } : value;
  }

  return next;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return a === b;

  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]));
}

/**
 * O armazenamento das preferências. `getStorage` é chamado a cada acesso e pode devolver `null` (sem `localStorage`) ou
 * lançar (a janela recusa o acesso): nos dois casos, e quando ler ou gravar falha, as preferências vivem na memória da
 * sessão e a tela continua funcionando. Cada usuário tem o seu objeto, e é o MESMO objeto até a próxima gravação:
 * `useSyncExternalStore` compara por referência.
 */
export function createPreferencesStore(getStorage: () => PreferencesStorage | null) {
  const cache = new Map<string, Preferences>();
  const listeners = new Set<() => void>();

  function storage() {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function get(userName: string): Preferences {
    const key = preferencesKey(userName);
    let preferences = cache.get(key);

    if (preferences === undefined) {
      let raw: string | null = null;
      try {
        raw = storage()?.getItem(key) ?? null;
      } catch {
        // Leitura recusada: vale o padrão.
      }

      preferences = parsePreferences(raw);
      cache.set(key, preferences);
    }

    return preferences;
  }

  /**
   * Muda os campos do patch. Um valor que o esquema recusa não muda nada (nem o que veio junto): a tela valida antes, mas o
   * armazenamento não confia nela.
   */
  function set(userName: string, patch: PreferencesPatch): void {
    const current = get(userName);
    const merged = strict.safeParse(merge(current, patch));
    if (!merged.success || sameValue(merged.data, current)) return;

    const key = preferencesKey(userName);
    cache.set(key, merged.data);
    try {
      storage()?.setItem(key, JSON.stringify(merged.data));
    } catch {
      // Cota cheia ou acesso bloqueado: a mudança vale até fechar o app.
    }

    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  /**
   * Outra janela do app gravou (RN-ABAS-004: as mesmas preferências em todas): o que estava guardado daquela chave sai, e quem lê lê de novo do
   * armazenamento. `null` é o armazenamento inteiro apagado. Chave que não é de preferências não muda nada.
   */
  function refresh(key: string | null): void {
    if (key === null) cache.clear();
    else if (!key.startsWith(preferencesKey(""))) return;
    else cache.delete(key);

    for (const listener of listeners) listener();
  }

  return { get, set, subscribe, refresh };
}

function browserStorage(): PreferencesStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** O armazenamento da janela: o gancho `usePreferences` e a tela de Configurações falam com este. */
export const preferencesStore = createPreferencesStore(browserStorage);

// O `storage` chega a cada janela quando OUTRA janela do app grava: o tema, o editor e o bloqueio mudam em todas ao mesmo tempo.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("storage", (event) => preferencesStore.refresh(event.key));
