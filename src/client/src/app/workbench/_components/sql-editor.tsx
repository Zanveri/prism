import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type DecorationSet,
} from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { editorFont, type EditorPreferences } from "@/app/settings/_lib/editor-style";
import { resolveScheme, subscribeSystemScheme, systemPrefersLight } from "@/app/settings/_lib/theme";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { ContextMenu, ForeignKeyIcon, type Engine } from "@/components/ui";
import { isMacPlatform } from "@/lib/utils/platform";

import type { ObjectNames } from "../_lib/database-sessions.schema";
import { objectNamesKey } from "../_lib/database-sessions.service";
import type { CachedLevel } from "../_lib/navigator-search";
import { completionTheme, highlight } from "../_lib/completion-theme";
import { catalogCompletion, type CatalogCompletion } from "../_lib/sql-catalog-completion";
import { cachedLevels, sqlCompletion } from "../_lib/sql-completion";
import { tableLinks } from "../_lib/table-link-extension";
import { defaultSchemasOf, linkCatalog, tableLinkAt, type LinkCatalog, type TableLink } from "../_lib/table-links";
import { liveEditors } from "../_lib/live-editors";
import { flashRun, runFlash } from "../_lib/run-flash";
import { scriptMark, scriptMarkEffects } from "../_lib/script-mark";
import { formatSql, type SqlFormatOptions } from "../_lib/sql-format";
import { keywordCase } from "../_lib/sql-keyword-case";
import { hasStatement, scriptStatements, splitStatements, statementAt } from "../_lib/sql-statements";
import type { RunTarget } from "../_lib/use-query-runner";
import { variablesCompletion, type VariablesCompletion } from "../_lib/variables-completion";
import { connectVariables, reanalyzeVariables, setShowVariableValues, variablesEditor, type VariablesStore } from "../_lib/variables-extension";
import { workbenchCopy } from "../_lib/workbench.copy";
import { insertAtCursor } from "../_lib/history";
import {
  applySearchQueryState,
  defaultFindOptions,
  findNextState,
  goToLineOffset,
  indentGuides,
  insertBlankLineAbove,
  replaceAllState,
  replaceNextState,
  searchState,
  selectAllOccurrencesState,
  selectFullLine,
  selectionMatchHighlight,
  selectNextOccurrenceState,
  setSearchQuery,
  skipLastOccurrenceState,
  sqlIndentationFold,
  type FindOptions,
} from "../_lib/sql-editor-vscode";
import { JoinSuggestionsDialog } from "./join-suggestions-dialog";
import { SqlEditorFindBar, type EditorOverlayMode } from "./sql-editor-find-bar";

/** Quanto o editor espera, depois da última tecla, para entregar o texto a quem o guarda. */
const changeDelayMs = 400;

/** O PostgreSQL é o banco de número 1 (`engineOptions`); Db2 e Informix usam o SQL padrão. */
const postgres: Engine = 1;
const dialectOf = (engine: Engine | undefined) => (engine === postgres ? PostgreSQL : StandardSQL);

/** Quantas linhas do começo do texto bastam, quase sempre, para saber que há um comando nele. */
const headLines = 50;

/**
 * As cores do canvas (`Workbench.dc.html`), pelos tokens: fundo da página, números de linha
 * apagados, linha do cursor um tom acima. O fundo da linha do cursor é translúcido porque a seleção
 * é desenhada atrás do texto, e um fundo opaco a esconderia.
 *
 * A fonte, o tamanho dela e a altura da linha são as preferências do usuário (Configurações → Editor SQL, RN-CONFIG-001); `dark` diz ao
 * CodeMirror se o tema aplicado é escuro (o claro troca os tokens, e o CodeMirror usa o dele nos detalhes que o tema abaixo não pinta).
 * Os dois entram num compartimento (`themeSlot`): a área de trabalho fica montada enquanto as Configurações estão abertas, e o editor que já
 * existe os recebe ao vivo, sem ser recriado.
 */
const editorTheme = (preferences: EditorPreferences, dark: boolean) => {
  const font = editorFont(preferences);

  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "var(--color-background)",
        color: "var(--color-ink)",
        fontSize: font.fontSize,
        "--cm-indent-step": `${preferences.tabSize}ch`,
      },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: font.fontFamily, lineHeight: font.lineHeight },
      ".cm-content": { padding: "12px 16px 12px 0", caretColor: "var(--color-accent)", outline: "none" },
      ".cm-gutters": { backgroundColor: "var(--color-background)", color: "var(--color-subtle)", border: "none" },
      ".cm-lineNumbers .cm-gutterElement": { minWidth: "48px", padding: "0 4px 0 0" },
      ".cm-foldGutter .cm-gutterElement": { padding: "0 6px 0 2px", color: "var(--color-subtle)", userSelect: "none" },
      ".cm-foldGutter span": { display: "inline-block", opacity: "0", cursor: "pointer", transition: "opacity 120ms ease" },
      "&:hover .cm-foldGutter span, .cm-foldGutter span[data-folded]": { opacity: "1" },
      ".cm-foldGutter span:hover": { color: "var(--color-ink)" },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--color-raised)",
        border: "1px solid var(--color-border-strong)",
        color: "var(--color-muted)",
        borderRadius: "4px",
        padding: "0 5px",
        margin: "0 3px",
      },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-ink) 3%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--color-panel)", color: "var(--color-ink)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)" },
      ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--color-selection)" },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--color-subtle)" },
      ".cm-indent-guides": {
        backgroundImage: "repeating-linear-gradient(to right, var(--color-border) 0 1px, transparent 1px var(--cm-indent-step))",
        backgroundRepeat: "repeat-y",
      },
      ".cm-selection-match": {
        backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
        outline: "1px solid color-mix(in srgb, var(--color-accent) 55%, transparent)",
        borderRadius: "2px",
      },
      ".cm-search-match": { backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)", borderRadius: "2px" },
      ".cm-search-match-current": { backgroundColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)", outline: "1px solid var(--color-accent)" },
      // RN-LINK-001: o nome de uma tabela com o Ctrl apertado. A cor de link do tema também por cima da cor de sintaxe do que estiver dentro (o nome entre aspas).
      ".cm-table-link": { color: "var(--color-link)", textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
      ".cm-table-link *": { color: "var(--color-link)", cursor: "pointer" },
      ".cm-sql-error": { textDecoration: "underline wavy var(--color-danger)", textDecorationSkipInk: "none", textUnderlineOffset: "3px" },

      // A lista de sugestões (RN-CONFIG-004), a mesma do campo de filtro.
      ...completionTheme(font.fontFamily),
    },
    { dark },
  );
};


/**
 * As partes do editor que as preferências mudam com ele já montado, cada uma num compartimento do CodeMirror: reconfigurar um
 * compartimento troca só aquela parte, e o editor continua o mesmo (o cursor, a seleção, o histórico de desfazer e a rolagem ficam).
 */
const themeSlot = new Compartment();
const tabSlot = new Compartment();
/** Autocompletar (RN-CONFIG-004) e converter palavras-chave para maiúsculas: cada um liga e desliga sozinho. Desligado, o compartimento fica vazio: sem lista, sem as teclas dela. */
const completionSlot = new Compartment();
const caseSlot = new Compartment();
/** A gramática do banco (as cores e o que o `lang-sql` lê): troca quando a aba passa a ter outro banco, como a aba sem conexão que recebe uma (RN-SCRIPT-003). */
const languageSlot = new Compartment();
const wrapSlot = new Compartment();

/** A largura da tabulação: a de um caractere de tabulação e o que a tecla Tab insere (em espaços). */
const tabSettings = (tabSize: number) => [EditorState.tabSize.of(tabSize), indentUnit.of(" ".repeat(tabSize))];

const setErrorMark = StateEffect.define<number | null>();

/** O trecho que o banco apontou (RN-SQL-009): a palavra que começa na posição do erro, ou um caractere quando não há palavra ali. */
function errorRange(state: EditorState, position: number): { from: number; to: number } | null {
  const at = Math.min(Math.max(position, 0), state.doc.length);
  const word = state.wordAt(at);
  if (word !== null) return { from: word.from, to: word.to };

  const line = state.doc.lineAt(at);
  if (at < line.to) return { from: at, to: at + 1 };
  return at > line.from ? { from: at - 1, to: at } : null;
}

/** A marca do erro. Qualquer edição a desfaz: a posição era a do texto que foi enviado. */
const errorMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setErrorMark)) continue;
      const range = effect.value === null ? null : errorRange(transaction.state, effect.value);
      return range === null ? Decoration.none : Decoration.set(Decoration.mark({ class: "cm-sql-error" }).range(range.from, range.to));
    }
    return transaction.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * O que "Executar" envia (RN-SQL-001): o texto selecionado, como está; sem seleção, o comando onde
 * está o cursor, separado pelas regras do banco da aba (RN-SQL-002) e, com `blankLines` (a preferência
 * "A linha em branco separa os comandos", RN-SQL-018), também pela linha em branco. Sem comando nenhum
 * o texto vai vazio: quem executa é que diz "não há comando", e também quando a seleção tem mais de um.
 */
export function runTarget(state: EditorState, engine: Engine | undefined, blankLines: boolean): RunTarget {
  const { from, to, head } = state.selection.main;
  if (from !== to) return { sql: state.sliceDoc(from, to), offset: from, engine };

  const statement = statementAt(state.doc.toString(), head, engine, { blankLines });
  return statement === null ? { sql: "", offset: head, engine } : { sql: statement.text, offset: statement.start, engine };
}

/**
 * O que "Executar script" envia (RN-SQL-019): os comandos da seleção, quando há, ou do texto inteiro, um por um, divididos pelas regras do Ctrl+Enter (o
 * `;` e, com `blankLines`, a linha em branco, que no script divide também a seleção), com o bloco de `;` no corpo como um comando só (`scriptStatements`).
 * Cada um leva onde começa no texto do editor: é por aí que o erro e a marca do comando em execução acham o lugar.
 */
export function scriptTargets(state: EditorState, engine: Engine | undefined, blankLines: boolean): RunTarget[] {
  const { from, to } = state.selection.main;
  const [text, start] = from === to ? [state.doc.toString(), 0] : [state.sliceDoc(from, to), from];
  return scriptStatements(text, engine, { blankLines }).map((statement) => ({ sql: statement.text, offset: start + statement.start, engine }));
}

/**
 * O trecho que pisca quando "Executar" envia `target` (RN-SQL-018): sem seleção, o comando do cursor, exatamente o que foi enviado; com a linha em
 * branco separando, é assim que a pessoa vê qual comando o cursor pegou. A seleção já está à vista e não pisca; sem comando, nada pisca.
 */
export function formatTarget(state: EditorState, options: SqlFormatOptions): { from: number; to: number; insert: string } | null {
  const { from, to } = state.selection.main;
  const [rangeFrom, rangeTo, raw] = from !== to ? [from, to, state.sliceDoc(from, to)] : [0, state.doc.length, state.doc.toString()];
  if (raw.trim().length === 0) return null;
  const insert = formatSql(raw, options);
  return insert === raw ? null : { from: rangeFrom, to: rangeTo, insert };
}

/**
 * Mantém o cursor no mesmo comando após formatar o documento inteiro sem seleção, evitando que o encolhimento de espaços/linhas
 * jogue o offset bruto para dentro do comando seguinte separado por linha em branco.
 */
export function formatCursor(state: EditorState, insert: string, options: SqlFormatOptions): number {
  const { head } = state.selection.main;
  const raw = state.doc.toString();
  const splitOpts = { blankLines: options.blankLines ?? false };
  const beforeList = splitStatements(raw, options.engine, splitOpts);
  const afterList = splitStatements(insert, options.engine, splitOpts);

  if (beforeList.length > 0 && afterList.length > 0 && head < beforeList[0].start) {
    return Math.min(head, afterList[0].start > 0 ? afterList[0].start - 1 : 0);
  }

  const target = statementAt(raw, head, options.engine, splitOpts);
  if (target !== null && beforeList.length === afterList.length) {
    const index = beforeList.findIndex((item) => item.start === target.start && item.end === target.end);
    if (index >= 0) {
      const mapped = afterList[index];
      if (head <= target.start) return mapped.start;
      if (head >= target.end) return Math.min(mapped.end, insert.length);
      const ratio = (head - target.start) / Math.max(1, target.end - target.start);
      const offsetInMapped = Math.round(ratio * (mapped.end - mapped.start));
      return mapped.start + Math.min(Math.max(0, offsetInMapped), mapped.end - mapped.start);
    }
  }

  return Math.min(head, insert.length);
}

export function flashRangeOf(state: EditorState, target: RunTarget): { from: number; to: number } | null {
  if (!state.selection.main.empty || target.sql === "") return null;
  return { from: target.offset, to: target.offset + target.sql.length };
}

/**
 * O efeito que acende agora o destaque de `range` (de `flashRangeOf`, no instante do Ctrl+Enter), ou `null` quando nada pisca: entre apertar e
 * enviar pode vir a pergunta das alterações não salvas da grade (RN-EDIT-007), e o trecho só pisca se ainda é o texto `sql` que foi enviado.
 */
export function flashEffect(state: EditorState, range: { from: number; to: number } | null, sql: string): StateEffect<unknown> | null {
  return range !== null && state.sliceDoc(range.from, range.to) === sql ? flashRun(range.from, range.to) : null;
}

/**
 * O que "Executar" envia agora (`runTarget`) e o destaque dele (RN-SQL-018), que quem executa acende só quando o comando vai mesmo ao banco: com a
 * aba ocupada, sem conexão ou com a pergunta das alterações não salvas cancelada, nada foi enviado, e nada pode piscar.
 */
function sendFrom(view: EditorView, engine: Engine | undefined, blankLines: boolean): { target: RunTarget; flash: FlashRun } {
  const target = runTarget(view.state, engine, blankLines);
  const range = flashRangeOf(view.state, target);
  const withoutSelection = view.state.selection.main.empty;
  return {
    target,
    flash: (item) => {
      // O executor com variáveis diz qual item foi (RN-VAR-025): o comando ou a declaração que ele leu, e não o que o leitor sem declarações achou no cursor.
      const shown = item === undefined ? range : withoutSelection ? { from: item.offset, to: item.offset + item.text.length } : null;
      const effect = flashEffect(view.state, shown, item?.text ?? target.sql);
      if (effect !== null) view.dispatch({ effects: effect });
    },
  };
}

/** Acende o destaque (RN-SQL-018). Sem argumento, o do comando que `runTarget` achou; com o item do executor com variáveis, o dele. */
export type FlashRun = (item?: { offset: number; text: string }) => void;

/**
 * Se o texto tem comando, sem copiá-lo inteiro a cada tecla: quase sempre o começo já responde. O
 * corte é em fim de linha, onde nenhum `--` ou barra-asterisco fica pela metade. Só o texto que
 * começa com mais de 50 linhas em branco ou de comentário é lido até o fim.
 */
function docHasStatement(doc: Text, engine: Engine | undefined): boolean {
  if (doc.lines <= headLines) return hasStatement(doc.toString(), engine);
  return hasStatement(doc.sliceString(0, doc.line(headLines).to), engine) || hasStatement(doc.toString(), engine);
}

/**
 * Se há comando para enviar, sem separar os comandos: roda a cada tecla e a cada movimento do
 * cursor, e o texto pode ter milhares de linhas. Sem seleção, há comando no cursor sempre que o
 * texto tem algum (`statementAt`), menos com o cursor na linha em branco que só separou um
 * comentário do comando de baixo, sem comando acima (RN-SQL-018): o botão continua habilitado, e
 * quem executa diz que não há comando. É o que habilita o botão "Executar".
 */
function isRunnable(state: EditorState, engine: Engine | undefined): boolean {
  const { from, to } = state.selection.main;
  return from === to ? docHasStatement(state.doc, engine) : hasStatement(state.sliceDoc(from, to), engine);
}

export type SqlEditorHandle = {
  /** Executa o que o editor mandaria com Ctrl+Enter e devolve o foco a ele. */
  run: () => void;
  /** RN-SQL-019: "Executar script" (o botão e o Alt+X): os comandos da seleção ou do texto inteiro (`scriptTargets`), e o foco volta ao editor. */
  runScript: () => void;
  focus: () => void;
  /** RN-HIST-006: insere o comando na posição do cursor (ou substitui a seleção), numa única ação de desfazer. */
  insertText: (text: string) => void;
};

type SqlEditorProps = {
  ref: Ref<SqlEditorHandle>;
  /** O texto com que o editor nasce. Dali em diante o texto vive no editor: mudar esta propriedade não o altera. */
  initialSql: string;
  /** RN-ABAS-002: a aba deste editor, para quem a manda a outra janela ler o texto e a seleção deste instante (`liveEditors`). */
  tabId?: string;
  /** RN-ABAS-002: a seleção com que a aba chegou de outra janela. Lida uma vez, ao criar o editor. */
  initialSelection?: { anchor: number; head: number } | null;
  /**
   * O banco da conexão escolhe o dialeto das cores e as regras de separar os comandos. Segue a propriedade com o editor montado: a lista de conexões que chega
   * depois do editor, e a aba sem conexão que recebe uma (RN-SCRIPT-003), mudam o banco sem recriar o editor (o texto e o desfazer ficam).
   */
  engine: Engine | undefined;
  /** A conexão da aba deste editor: de onde vêm os nomes da árvore que o autocompletar sugere. Lida na hora do pedido de sugestão. Nula na aba sem conexão (RN-SCRIPT-003): nada a sugerir. */
  connectionId: string | null;
  /** RN-ARVORE-006: o outro banco do servidor da aba; o completar usa os nomes dele. */
  database?: string;
  /** A posição, no texto, do erro que o banco apontou. */
  errorAt: number | null;
  /**
   * Ctrl+Enter e o botão "Executar": `target` é o que vai ao executor, e `flash` acende o destaque do comando enviado (RN-SQL-018). Quem executa só
   * chama `flash` quando o comando vai mesmo ao banco, e depois da pergunta das alterações não salvas, quando ela vier.
   */
  onRun: (target: RunTarget, flash: FlashRun) => void;
  /** RN-SQL-019: "Executar script": os comandos, na ordem. Quem executa pergunta das alterações não salvas antes, e recusa com a aba ocupada. */
  onRunScript?: (targets: RunTarget[]) => void;
  /**
   * RN-SQL-019: o comando do script em execução (o texto e onde ele estava quando o script começou), que o editor marca até o seguinte começar; nulo sem
   * script rodando. Com o texto editado depois disso, o lugar já não é o mesmo, e nada é marcado.
   */
  runningAt?: { offset: number; sql: string } | null;
  /** O texto, com atraso: depois de uma pausa na digitação, ao perder o foco e ao desmontar. */
  onChange: (sql: string) => void;
  onRunnableChange: (runnable: boolean) => void;
  /**
   * O texto mudou, a cada alteração e sem atraso: a posição de um erro era a do texto enviado, e
   * deixa de valer, esteja a marca na tela ou o comando ainda rodando.
   */
  onEdited: () => void;
  /** RN-LINK-001: o Ctrl+clique no nome de uma tabela ou visão que o catálogo do banco da aba conhece. Sem ele (a aba sem conexão), nada vira link. */
  onOpenTable?: (table: { schema: string; name: string }) => void;
  /**
   * RN-VAR-025: os valores das variáveis da aba, do armazém de quem executa (RN-VAR-023). O editor lê o tipo e o valor de cada uma, na dica do ponteiro e no fim da
   * linha da declaração, e se inscreve para ser avisado quando mudam. `value` é o texto como o painel Variáveis o escreve (o editor corta em 200 caracteres na dica e
   * em 60 no fim da linha); `stale` diz que o valor é de antes de a declaração mudar. Sem a propriedade, o editor pinta e confere as declarações, e não mostra valores.
   */
  variables?: VariablesStore;
};

/** O macOS usa o ⌘ onde os outros usam o Ctrl (RN-LINK-001). */
const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

/** Os níveis da árvore são os mesmos objetos enquanto nenhuma consulta deles mudou: o catálogo dos links só é refeito quando algum muda. */
const sameLevels = (a: readonly CachedLevel[], b: readonly CachedLevel[]) => a.length === b.length && a.every((level, index) => level.key === b[index].key && level.nodes === b[index].nodes);

/**
 * O editor de SQL (CodeMirror 6). O texto não é estado do React: mora no editor, que avisa quem o
 * guarda com atraso, para uma tecla não redesenhar a área de trabalho. Ctrl+Enter executa
 * (RN-SQL-001). Tab recua; Esc e depois Tab saem do editor pelo teclado.
 */
export function SqlEditor({ ref, initialSql, tabId, initialSelection = null, engine, connectionId, database, errorAt, onRun, onRunScript, runningAt = null, onChange, onRunnableChange, onEdited, onOpenTable, variables }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { preferences } = usePreferences();
  // Com "seguir o sistema", o esquema vem do sistema, e muda com o app aberto.
  const systemIsLight = useSyncExternalStore(subscribeSystemScheme, systemPrefersLight, () => false);
  const dark = resolveScheme(preferences.theme, systemIsLight) === "dark";
  const { fontFamily, fontSize, tabSize, autocomplete, uppercaseKeywords, formatStyle, blankLineSeparates, showVariableValues } = preferences.editor;
  // Os nomes sugeridos são os da árvore da conexão DESTA aba, que ela passa por propriedade: as abas ficam todas montadas, e ler a aba ativa
  // daria ao editor de uma aba os nomes da conexão de outra.
  const queryClient = useQueryClient();
  // O que só vale ao criar o editor: a mesma referência em todas as renderizações. As preferências do editor entram aqui para a
  // criação; depois, os efeitos de baixo as reconfiguram ao vivo quando mudam (Configurações abre por cima, com o editor montado).
  const [initial] = useState(() => ({ sql: initialSql, tabId, selection: initialSelection, engine, editor: { fontFamily, fontSize, tabSize }, dark, autocomplete, uppercaseKeywords }));
  const applied = useRef(`${fontFamily}|${fontSize}|${tabSize}|${dark}`);
  // O banco de agora, lido pelas funções do editor na hora em que rodam (executar, separar o comando, sugerir).
  const engineNow = useRef(engine);
  // RN-SQL-018: a linha em branco separa os comandos? Lida na hora de executar: não muda nada no editor, e não precisa de compartimento.
  const blankLinesNow = useRef(blankLineSeparates);
  const uppercaseKeywordsNow = useRef(uppercaseKeywords);
  const formatStyleNow = useRef(formatStyle);
  const tabSizeNow = useRef(tabSize);
  // RN-VAR-025: o armazém dos valores de agora, lido pelo autocompletar na hora do pedido (o tipo de cada variável).
  const variablesNow = useRef(variables);
  const variableCompletion = useRef<VariablesCompletion | null>(null);
  const appliedToggles = useRef(`${autocomplete}|${uppercaseKeywords}`);

  const [contextMenuState, setContextMenuState] = useState<{
    point: { x: number; y: number };
    initialFocus: "first" | "menu";
    cursorOffset: number;
  } | null>(null);
  const [joinModalState, setJoinModalState] = useState<{
    sql: string;
    cursorOffset: number;
  } | null>(null);
  const focusSeqRef = useRef(0);
  const wordWrapRef = useRef(false);
  const [overlayState, setOverlayState] = useState<{
    mode: EditorOverlayMode;
    showReplace: boolean;
    focusRequest: { target: "find" | "replace" | "goto"; seq: number };
  } | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findReplacement, setFindReplacement] = useState("");
  const [findOptions, setFindOptions] = useState<FindOptions>(defaultFindOptions);
  const [goToValue, setGoToValue] = useState("");
  const [searchStats, setSearchStats] = useState(() => ({
    total: 0,
    active: -1,
    invalidRegex: false,
    lineCount: Math.max(1, initialSql.split("\n").length),
  }));

  function syncStatsFromEditor(editor: EditorView) {
    const search = editor.state.field(searchState);
    const next = {
      total: search.matches.length,
      active: search.activeIndex,
      invalidRegex: search.invalidRegex,
      lineCount: editor.state.doc.lines,
    };
    setSearchStats((prev) =>
      prev.total === next.total &&
      prev.active === next.active &&
      prev.invalidRegex === next.invalidRegex &&
      prev.lineCount === next.lineCount
        ? prev
        : next,
    );
  }

  function openOverlay(mode: EditorOverlayMode, showReplace = false, preferSelection = true) {
    const editor = view.current;
    let nextQuery = findQuery;
    if (editor !== null && mode === "find") {
      if (preferSelection && !editor.state.selection.main.empty) {
        const selected = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
        if (!selected.includes("\n") && selected.length <= 200) {
          nextQuery = selected;
          setFindQuery(selected);
        }
      }
      editor.dispatch(applySearchQueryState(editor.state, nextQuery, findOptions, false));
      syncStatsFromEditor(editor);
    } else if (editor !== null && mode === "goto") {
      if (editor.state.field(searchState).query !== "") {
        editor.dispatch({ effects: setSearchQuery.of(null) });
      }
      const line = editor.state.doc.lineAt(editor.state.selection.main.head);
      setGoToValue(String(line.number));
      syncStatsFromEditor(editor);
    }
    const target = mode === "goto" ? "goto" : showReplace && overlayState?.mode === "find" && !overlayState.showReplace ? "replace" : "find";
    setOverlayState({
      mode,
      showReplace: mode === "find" ? showReplace : false,
      focusRequest: { target, seq: ++focusSeqRef.current },
    });
  }

  function closeOverlay() {
    setOverlayState(null);
    const editor = view.current;
    if (editor !== null) {
      if (editor.state.field(searchState).query !== "") {
        editor.dispatch({ effects: setSearchQuery.of(null) });
      }
      editor.focus();
    }
  }

  function handleQueryChange(nextQuery: string) {
    setFindQuery(nextQuery);
    const editor = view.current;
    if (editor === null) return;
    editor.dispatch(applySearchQueryState(editor.state, nextQuery, findOptions, true));
    syncStatsFromEditor(editor);
  }

  function handleOptionsChange(nextOptions: FindOptions) {
    setFindOptions(nextOptions);
    const editor = view.current;
    if (editor === null || overlayState?.mode !== "find") return;
    editor.dispatch(applySearchQueryState(editor.state, findQuery, nextOptions, true));
    syncStatsFromEditor(editor);
  }

  function stepFind(direction: 1 | -1): boolean {
    const editor = view.current;
    if (editor === null) return false;
    let query = findQuery;
    if (query === "" && !editor.state.selection.main.empty) {
      const selected = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
      if (!selected.includes("\n") && selected.length <= 200) {
        query = selected;
        setFindQuery(selected);
      }
    }
    const spec = findNextState(editor.state, direction, { query, options: findOptions });
    if (spec === null) return false;
    editor.dispatch(spec);
    if (overlayState !== null) syncStatsFromEditor(editor);
    return true;
  }

  function handleReplaceOne() {
    const editor = view.current;
    if (editor === null) return;
    const spec = replaceNextState(editor.state, findReplacement);
    if (spec !== null) {
      editor.dispatch(spec);
      syncStatsFromEditor(editor);
    }
  }

  function handleReplaceAll() {
    const editor = view.current;
    if (editor === null) return;
    const spec = replaceAllState(editor.state, findReplacement);
    if (spec !== null) {
      editor.dispatch(spec);
      syncStatsFromEditor(editor);
    }
  }

  function handleSubmitGoToLine() {
    const editor = view.current;
    if (editor === null) return;
    const offset = goToLineOffset(editor.state, goToValue);
    if (offset === null) return;
    setOverlayState(null);
    editor.dispatch({
      selection: EditorSelection.cursor(offset),
      effects: EditorView.scrollIntoView(offset, { y: "center" }),
    });
    editor.focus();
  }

  const emitRun = useEffectEvent((target: RunTarget, flash: FlashRun) => onRun(target, flash));
  const emitChange = useEffectEvent((text: string) => onChange(text));
  const emitRunnable = useEffectEvent((runnable: boolean) => onRunnableChange(runnable));
  const emitEdited = useEffectEvent(() => onEdited());
  // Os níveis da árvore são lidos na hora do pedido, da conexão desta aba (só o cache: as colunas de `tabela.` e as chaves da junção quem busca é o `catalogCompletion`, RN-CONFIG-004).
  const readLevels = useEffectEvent(() => (connectionId === null ? [] : cachedLevels(queryClient, connectionId, database)));
  const readObjectNames = useEffectEvent(() => (connectionId === null ? undefined : queryClient.getQueryData<ObjectNames>(objectNamesKey(connectionId, database))));
  // RN-LINK-001: o catálogo é o do autocompletar (o cache da árvore do banco da aba, sem consulta nova), e o esquema padrão sai do usuário da conexão.
  const catalogCache = useRef<{ levels: CachedLevel[]; names: ObjectNames | undefined; catalog: LinkCatalog } | null>(null);
  const findLink = useEffectEvent((sql: string, offset: number, tokens: Parameters<typeof tableLinkAt>[5]): TableLink | null => {
    if (connectionId === null || onOpenTable === undefined) return null;
    const levels = readLevels();
    const names = readObjectNames();
    if (catalogCache.current === null || catalogCache.current.names !== names || !sameLevels(catalogCache.current.levels, levels)) {
      catalogCache.current = { levels, names, catalog: linkCatalog(levels, names) };
    }
    const userName = queryClient.getQueryData<{ id: string; userName: string }[]>(connectionsQuery.queryKey)?.find((connection) => connection.id === connectionId)?.userName;
    return tableLinkAt(sql, offset, engineNow.current, catalogCache.current.catalog, defaultSchemasOf(engineNow.current, userName), tokens);
  });
  const openLink = useEffectEvent((link: TableLink) => onOpenTable?.({ schema: link.schema, name: link.name }));
  // RN-SQL-025: as colunas de `nome.` e a junção buscam no banco o que a árvore ainda não trouxe, só com a sessão da árvore aberta. Uma por editor, criada na primeira vez.
  const catalogCompletionRef = useRef<CatalogCompletion | null>(null);
  const connectionNow = useEffectEvent(() => connectionId);
  const databaseNow = useEffectEvent(() => database);
  const userNameNow = useEffectEvent(() => (connectionId === null ? undefined : queryClient.getQueryData<{ id: string; userName: string }[]>(connectionsQuery.queryKey)?.find((connection) => connection.id === connectionId)?.userName));
  const openContextMenuFromShortcut = useEffectEvent((editor: EditorView) => {
    const cursorOffset = editor.state.selection.main.head;
    const coords = editor.coordsAtPos(cursorOffset);
    const rect = editor.dom.getBoundingClientRect();
    const point = coords !== null ? { x: coords.left, y: coords.bottom + 4 } : { x: rect.left + 32, y: rect.top + 32 };
    setContextMenuState({ point, initialFocus: "first", cursorOffset });
  });
  const openOverlayFromShortcut = useEffectEvent((mode: EditorOverlayMode, showReplace = false) => {
    openOverlay(mode, showReplace, true);
  });
  const closeOverlayFromShortcut = useEffectEvent((editor: EditorView) => {
    // Com múltiplos cursores, Esc colapsa primeiro para o cursor principal (`simplifySelection`), como no VS Code.
    if (editor.state.selection.ranges.length > 1 || overlayState === null) return false;
    closeOverlay();
    return true;
  });
  const stepFindFromShortcut = useEffectEvent((direction: 1 | -1) => stepFind(direction));
  const selectNextFromShortcut = useEffectEvent((editor: EditorView) => {
    const spec = selectNextOccurrenceState(editor.state, findOptions.matchCase);
    if (spec !== null) editor.dispatch(spec);
    return true;
  });
  const skipOccurrenceFromShortcut = useEffectEvent((editor: EditorView) => {
    const spec = skipLastOccurrenceState(editor.state, findOptions.matchCase);
    if (spec !== null) editor.dispatch(spec);
    return true;
  });
  const selectAllOccurrencesFromShortcut = useEffectEvent((editor: EditorView) => {
    const spec = selectAllOccurrencesState(editor.state, findOptions.matchCase);
    if (spec !== null) editor.dispatch(spec);
    return true;
  });
  const syncOverlayStats = useEffectEvent((editor: EditorView) => {
    if (overlayState !== null) syncStatsFromEditor(editor);
  });
  const openContextMenuFromPointer = useEffectEvent((event: MouseEvent, editor: EditorView) => {
    event.preventDefault();
    const clickedPos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
    const selection = editor.state.selection.main;
    let cursorOffset = selection.head;
    if (clickedPos !== null && (selection.empty || clickedPos < selection.from || clickedPos > selection.to)) {
      cursorOffset = clickedPos;
      editor.dispatch({ selection: EditorSelection.cursor(clickedPos) });
    }
    setContextMenuState({
      point: { x: event.clientX, y: event.clientY },
      initialFocus: "menu",
      cursorOffset,
    });
  });

  const completionFor = useEffectEvent(() => {
    // O autocompletar das variáveis guarda o script lido da versão do texto: um só por editor, criado na primeira vez que a lista é montada.
    variableCompletion.current ??= variablesCompletion({ engine: () => engineNow.current, blankLines: () => blankLinesNow.current, values: () => variablesNow.current?.snapshot() ?? null });
    catalogCompletionRef.current ??= catalogCompletion({
      queryClient,
      engine: () => engineNow.current,
      connectionId: () => connectionNow(),
      database: () => databaseNow(),
      userName: () => userNameNow(),
      blankLines: () => blankLinesNow.current,
      uppercaseKeywords: () => uppercaseKeywordsNow.current,
      autoConnect: () => true,
    });
    return sqlCompletion({ dialect: dialectOf(engineNow.current), engine: engineNow.current, levels: () => readLevels(), catalog: catalogCompletionRef.current, variables: variableCompletion.current });
  });

  useEffect(() => {
    if (host.current === null) return;

    let pending: ReturnType<typeof setTimeout> | null = null;
    let runnable = false;

    function flush() {
      if (pending === null) return;
      clearTimeout(pending);
      pending = null;
      emitChange(editor.state.doc.toString());
    }

    function run(view: EditorView) {
      const { target, flash } = sendFrom(view, engineNow.current, blankLinesNow.current);
      emitRun(target, flash);
      return true;
    }

    function formatEditorSql(view: EditorView) {
      const options: SqlFormatOptions = {
        style: formatStyleNow.current,
        uppercaseKeywords: uppercaseKeywordsNow.current,
        tabSize: tabSizeNow.current,
        engine: engineNow.current,
        blankLines: blankLinesNow.current,
      };
      const change = formatTarget(view.state, options);
      if (change !== null) {
        const hadSelection = !view.state.selection.main.empty;
        view.dispatch({
          changes: change,
          selection: hadSelection
            ? EditorSelection.single(change.from, change.from + change.insert.length)
            : EditorSelection.cursor(formatCursor(view.state, change.insert, options)),
        });
      }
      return true;
    }

    function openContextMenuShortcut(view: EditorView) {
      openContextMenuFromShortcut(view);
      return true;
    }

    function toggleWordWrap(view: EditorView) {
      wordWrapRef.current = !wordWrapRef.current;
      view.dispatch({ effects: wrapSlot.reconfigure(wordWrapRef.current ? EditorView.lineWrapping : []) });
      return true;
    }

    const ownerDoc = host.current.ownerDocument;
    const clamp = (position: number) => Math.min(position, initial.sql.length);
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.sql,
        ...(initial.selection === null ? {} : { selection: EditorSelection.single(clamp(initial.selection.anchor), clamp(initial.selection.head)) }),
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          EditorState.phrases.of({
            "folded code": workbenchCopy.editor.foldedCode,
            unfold: workbenchCopy.editor.unfold,
          }),
          EditorView.clickAddsSelectionRange.of((event) => !event.shiftKey && (event.altKey || (isMac ? event.metaKey : event.ctrlKey))),
          rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey }),
          crosshairCursor({ key: "Alt" }),
          dropCursor(),
          scrollPastEnd(),
          closeBrackets(),
          sqlIndentationFold,
          lineNumbers(),
          foldGutter({
            markerDOM(open) {
              const marker = ownerDoc.createElement("span");
              marker.textContent = open ? "▾" : "▸";
              if (!open) marker.dataset.folded = "";
              return marker;
            },
          }),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          indentGuides,
          searchState,
          selectionMatchHighlight,
          languageSlot.of(sql({ dialect: dialectOf(initial.engine) })),
          syntaxHighlighting(highlight),
          themeSlot.of(editorTheme(initial.editor, initial.dark)),
          tabSlot.of(tabSettings(initial.editor.tabSize)),
          caseSlot.of(initial.uppercaseKeywords ? keywordCase(initial.engine, () => blankLinesNow.current) : []),
          wrapSlot.of([]),
          errorMark,
          variablesEditor({ engine: () => engineNow.current, blankLines: () => blankLinesNow.current }),
          runFlash,
          scriptMark,
          tableLinks({ engine: () => engineNow.current, find: (sql, offset, tokens) => findLink(sql, offset, tokens), open: (link) => openLink(link), mac: isMac }),
          // À frente do mapa padrão: preserva o Ctrl+Enter (Executar SQL), o Ctrl+. (menu do editor) e adiciona os atalhos de edição/busca do VS Code.
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run },
              { key: "Mod-Shift-Enter", run: insertBlankLineAbove },
              { key: "Mod-.", run: openContextMenuShortcut },
              { key: "Mod-Shift-f", run: formatEditorSql },
              {
                key: "Mod-f",
                run: () => {
                  openOverlayFromShortcut("find", false);
                  return true;
                },
              },
              {
                key: "Mod-h",
                mac: "Mod-Alt-f",
                run: () => {
                  openOverlayFromShortcut("find", true);
                  return true;
                },
              },
              {
                key: "Ctrl-g",
                run: () => {
                  openOverlayFromShortcut("goto");
                  return true;
                },
              },
              {
                key: "F3",
                mac: "Mod-g",
                run: () => stepFindFromShortcut(1),
                shift: () => stepFindFromShortcut(-1),
              },
              { key: "Mod-d", run: selectNextFromShortcut },
              { key: "Mod-k Mod-d", run: skipOccurrenceFromShortcut },
              { key: "Mod-Shift-l", run: selectAllOccurrencesFromShortcut },
              { key: "Mod-F2", run: selectAllOccurrencesFromShortcut },
              { key: "Mod-l", run: selectFullLine },
              { key: "Alt-z", run: toggleWordWrap },
            ]),
          ),
          completionSlot.of(initial.autocomplete ? completionFor() : []),
          keymap.of([
            { key: "Escape", run: closeOverlayFromShortcut },
            ...closeBracketsKeymap,
            ...foldKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.contentAttributes.of({ "aria-label": workbenchCopy.editor.label, "data-sql-editor": "" }),
          EditorView.domEventHandlers({
            blur: flush,
            contextmenu: (event, view) => {
              openContextMenuFromPointer(event, view);
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              if (pending !== null) clearTimeout(pending);
              pending = setTimeout(flush, changeDelayMs);
              emitEdited();
            }

            if (!update.docChanged && !update.selectionSet) return;
            syncOverlayStats(update.view);
            const next = isRunnable(update.state, engineNow.current);
            if (next !== runnable) emitRunnable((runnable = next));
          }),
        ],
      }),
    });

    view.current = editor;
    emitRunnable((runnable = isRunnable(editor.state, engineNow.current)));
    if (initial.selection !== null) editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: "center" }) });
    const unregister = initial.tabId === undefined ? () => {} : liveEditors.register(initial.tabId, () => ({ sql: editor.state.doc.toString(), anchor: editor.state.selection.main.anchor, head: editor.state.selection.main.head }));

    return () => {
      unregister();
      // Sair da área de trabalho desmonta o editor: o texto vai antes para quem o guarda.
      flush();
      editor.destroy();
      view.current = null;
    };
  }, [initial]);

  useEffect(() => {
    if (blankLinesNow.current === blankLineSeparates) return;
    blankLinesNow.current = blankLineSeparates;
    // Onde a linha em branco separa os comandos decide quais itens são declarações (RN-VAR-001): o script se lê de novo.
    view.current?.dispatch({ effects: reanalyzeVariables.of(null) });
  }, [blankLineSeparates]);

  // RN-VAR-025: os valores das variáveis da aba (tipo e valor na dica do ponteiro, o valor no fim da linha). O armazém avisa a cada mudança; sem armazém, nenhum valor.
  useEffect(() => {
    variablesNow.current = variables;
    const editor = view.current;
    if (editor === null) return;
    return connectVariables(editor, variables, () => view.current === editor);
  }, [variables]);

  // RN-CONFIG-004: "Mostrar o valor das variáveis no fim da linha", ao vivo.
  useEffect(() => {
    view.current?.dispatch({ effects: setShowVariableValues.of(showVariableValues) });
  }, [showVariableValues]);

  // A fonte, o tamanho, a tabulação e o esquema de cor mudam no editor que já existe, sem recriá-lo.
  useEffect(() => {
    const editor = view.current;
    const key = `${fontFamily}|${fontSize}|${tabSize}|${dark}`;
    if (editor === null || key === applied.current) return;

    applied.current = key;
    editor.dispatch({ effects: [themeSlot.reconfigure(editorTheme({ fontFamily, fontSize, tabSize }, dark)), tabSlot.reconfigure(tabSettings(tabSize))] });
  }, [fontFamily, fontSize, tabSize, dark]);

  // Autocompletar e maiúsculas ligam e desligam no editor que já existe. Efeito à parte: ligar uma caixa não refaz o tema.
  useEffect(() => {
    uppercaseKeywordsNow.current = uppercaseKeywords;
    formatStyleNow.current = formatStyle;
    tabSizeNow.current = tabSize;
    const editor = view.current;
    const key = `${autocomplete}|${uppercaseKeywords}`;
    if (editor === null || key === appliedToggles.current) return;

    appliedToggles.current = key;
    editor.dispatch({ effects: [completionSlot.reconfigure(autocomplete ? completionFor() : []), caseSlot.reconfigure(uppercaseKeywords ? keywordCase(engineNow.current, () => blankLinesNow.current) : [])] });
  }, [autocomplete, uppercaseKeywords, formatStyle, tabSize]);

  // O banco mudou com o editor montado: a gramática, as maiúsculas e o completar passam a ser os dele, e "há o que executar?" é refeito pelas regras dele.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || engine === engineNow.current) return;

    engineNow.current = engine;
    editor.dispatch({
      effects: [
        languageSlot.reconfigure(sql({ dialect: dialectOf(engine) })),
        completionSlot.reconfigure(autocomplete ? completionFor() : []),
        caseSlot.reconfigure(uppercaseKeywords ? keywordCase(engine, () => blankLinesNow.current) : []),
        // O banco decide onde o `@` é operador, o que é corpo de rotina e como o `E'...'` se lê (RN-VAR-015): o script se lê de novo.
        reanalyzeVariables.of(null),
      ],
    });
    emitRunnable(isRunnable(editor.state, engine));
  }, [engine, autocomplete, uppercaseKeywords]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || (errorAt === null && editor.state.field(errorMark).size === 0)) return;

    editor.dispatch({ effects: errorAt === null ? setErrorMark.of(null) : [setErrorMark.of(errorAt), EditorView.scrollIntoView(Math.min(errorAt, editor.state.doc.length))] });
  }, [errorAt]);

  // RN-SQL-019: a marca do comando do script em execução segue o executor; o texto e o lugar dizem qual é, e um script novo no mesmo lugar é outra marca.
  const runningOffset = runningAt?.offset ?? null;
  const runningSql = runningAt?.sql ?? null;
  useEffect(() => {
    const editor = view.current;
    if (editor === null) return;

    const effects = scriptMarkEffects(editor.state, runningOffset === null || runningSql === null ? null : { offset: runningOffset, sql: runningSql });
    if (effects.length > 0) editor.dispatch({ effects });
  }, [runningOffset, runningSql]);

  useImperativeHandle(
    ref,
    () => ({
      run: () => {
        const editor = view.current;
        if (editor === null) return;

        const { target, flash } = sendFrom(editor, engineNow.current, blankLinesNow.current);
        onRun(target, flash);
        editor.focus();
      },
      runScript: () => {
        const editor = view.current;
        if (editor === null) return;

        onRunScript?.(scriptTargets(editor.state, engineNow.current, blankLinesNow.current));
        editor.focus();
      },
      focus: () => view.current?.focus(),
      insertText: (text: string) => {
        const editor = view.current;
        if (editor === null) return;
        const current = editor.state.doc.toString();
        const sel = editor.state.selection.main;
        const res = insertAtCursor(current, sel.head, text);
        editor.dispatch({
          changes: { from: 0, to: current.length, insert: res.doc },
          selection: EditorSelection.cursor(res.cursor),
          scrollIntoView: true,
        });
        editor.focus();
      },
    }),
    [onRun, onRunScript],
  );

  const currentUserName =
    connectionId === null
      ? undefined
      : queryClient.getQueryData<{ id: string; userName: string }[]>(connectionsQuery.queryKey)?.find((connection) => connection.id === connectionId)?.userName;

  function handleApplyJoins(replacement: { from: number; to: number; text: string }) {
    const editor = view.current;
    if (editor === null) return;
    const clampedFrom = Math.min(Math.max(0, replacement.from), editor.state.doc.length);
    const clampedTo = Math.min(Math.max(clampedFrom, replacement.to), editor.state.doc.length);
    editor.dispatch({
      changes: { from: clampedFrom, to: clampedTo, insert: replacement.text },
      selection: EditorSelection.cursor(clampedFrom + replacement.text.length),
      scrollIntoView: true,
    });
    editor.focus();
  }

  return (
    <>
      <div className="relative h-full">
        <div ref={host} className="h-full" />

        {overlayState !== null && (
          <SqlEditorFindBar
            mode={overlayState.mode}
            showReplace={overlayState.showReplace}
            focusRequest={overlayState.focusRequest}
            query={findQuery}
            replacement={findReplacement}
            options={findOptions}
            totalMatches={searchStats.total}
            activeMatch={searchStats.active}
            invalidRegex={searchStats.invalidRegex}
            goToValue={goToValue}
            lineCount={searchStats.lineCount}
            mac={isMac}
            onQueryChange={handleQueryChange}
            onReplacementChange={setFindReplacement}
            onToggleReplace={() => {
              const seq = ++focusSeqRef.current;
              setOverlayState((prev) =>
                prev === null
                  ? null
                  : {
                      ...prev,
                      showReplace: !prev.showReplace,
                      focusRequest: { target: !prev.showReplace ? "replace" : "find", seq },
                    },
              );
            }}
            onOptionsChange={handleOptionsChange}
            onFindNext={() => {
              stepFind(1);
            }}
            onFindPrevious={() => {
              stepFind(-1);
            }}
            onReplaceOne={handleReplaceOne}
            onReplaceAll={handleReplaceAll}
            onGoToValueChange={setGoToValue}
            onSubmitGoToLine={handleSubmitGoToLine}
            onSwitchMode={(mode, showReplace = false) => openOverlay(mode, showReplace, false)}
            onClose={closeOverlay}
          />
        )}
      </div>

      {contextMenuState !== null && (
        <ContextMenu
          label={workbenchCopy.editor.contextMenu.label}
          point={contextMenuState.point}
          initialFocus={contextMenuState.initialFocus}
          onClose={() => {
            setContextMenuState(null);
            view.current?.focus();
          }}
          groups={[
            [
              {
                id: "format-sql",
                label: workbenchCopy.editor.contextMenu.formatSql,
                shortcut: isMac
                  ? workbenchCopy.editor.contextMenu.formatSqlShortcutMac
                  : workbenchCopy.editor.contextMenu.formatSqlShortcut,
                onSelect: () => {
                  const editor = view.current;
                  setContextMenuState(null);
                  if (editor === null) return;
                  const options: SqlFormatOptions = {
                    style: formatStyleNow.current,
                    uppercaseKeywords: uppercaseKeywordsNow.current,
                    tabSize: tabSizeNow.current,
                    engine: engineNow.current,
                    blankLines: blankLinesNow.current,
                  };
                  const change = formatTarget(editor.state, options);
                  if (change !== null) {
                    const hadSelection = !editor.state.selection.main.empty;
                    editor.dispatch({
                      changes: change,
                      selection: hadSelection
                        ? EditorSelection.single(change.from, change.from + change.insert.length)
                        : EditorSelection.cursor(formatCursor(editor.state, change.insert, options)),
                    });
                  }
                  editor.focus();
                },
              },
              {
                id: "autocomplete-joins",
                label: workbenchCopy.editor.contextMenu.autocompleteJoins,
                icon: <ForeignKeyIcon className="h-3.5 w-3.5" />,
                shortcut: isMac
                  ? workbenchCopy.editor.contextMenu.autocompleteJoinsShortcutMac
                  : workbenchCopy.editor.contextMenu.autocompleteJoinsShortcut,
                onSelect: () => {
                  const editor = view.current;
                  const cursorOffset = contextMenuState.cursorOffset;
                  setContextMenuState(null);
                  if (editor === null) return;
                  setJoinModalState({
                    sql: editor.state.doc.toString(),
                    cursorOffset,
                  });
                },
              },
            ],
            [
              {
                id: "find",
                label: workbenchCopy.editor.contextMenu.find,
                shortcut: isMac
                  ? workbenchCopy.editor.contextMenu.findShortcutMac
                  : workbenchCopy.editor.contextMenu.findShortcut,
                onSelect: () => {
                  setContextMenuState(null);
                  openOverlay("find", false, true);
                },
              },
              {
                id: "replace",
                label: workbenchCopy.editor.contextMenu.replace,
                shortcut: isMac
                  ? workbenchCopy.editor.contextMenu.replaceShortcutMac
                  : workbenchCopy.editor.contextMenu.replaceShortcut,
                onSelect: () => {
                  setContextMenuState(null);
                  openOverlay("find", true, true);
                },
              },
              {
                id: "go-to-line",
                label: workbenchCopy.editor.contextMenu.goToLine,
                shortcut: isMac
                  ? workbenchCopy.editor.contextMenu.goToLineShortcutMac
                  : workbenchCopy.editor.contextMenu.goToLineShortcut,
                onSelect: () => {
                  setContextMenuState(null);
                  openOverlay("goto");
                },
              },
            ],
          ]}
        />
      )}

      <JoinSuggestionsDialog
        open={joinModalState !== null}
        sql={joinModalState?.sql ?? ""}
        cursorOffset={joinModalState?.cursorOffset ?? 0}
        engine={engine}
        connectionId={connectionId}
        database={database}
        userName={currentUserName}
        blankLines={blankLineSeparates}
        uppercaseKeywords={uppercaseKeywords}
        onClose={() => {
          setJoinModalState(null);
          view.current?.focus();
        }}
        onApply={handleApplyJoins}
      />
    </>
  );
}
