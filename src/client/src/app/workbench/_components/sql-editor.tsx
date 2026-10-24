import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { editorFont, type EditorPreferences } from "@/app/settings/_lib/editor-style";
import { resolveScheme, subscribeSystemScheme, systemPrefersLight } from "@/app/settings/_lib/theme";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";
import { isMacPlatform } from "@/lib/utils/platform";

import type { CachedLevel } from "../_lib/navigator-search";
import { completionTheme, highlight } from "../_lib/completion-theme";
import { cachedLevels, sqlCompletion } from "../_lib/sql-completion";
import { tableLinks } from "../_lib/table-link-extension";
import { defaultSchemasOf, linkCatalog, tableLinkAt, type LinkCatalog, type TableLink } from "../_lib/table-links";
import { liveEditors } from "../_lib/live-editors";
import { flashRun, runFlash } from "../_lib/run-flash";
import { scriptMark, scriptMarkEffects } from "../_lib/script-mark";
import { keywordCase } from "../_lib/sql-keyword-case";
import { hasStatement, scriptStatements, statementAt } from "../_lib/sql-statements";
import type { RunTarget } from "../_lib/use-query-runner";
import { variablesCompletion, type VariablesCompletion } from "../_lib/variables-completion";
import { connectVariables, reanalyzeVariables, setShowVariableValues, variablesEditor, type VariablesStore } from "../_lib/variables-extension";
import { workbenchCopy } from "../_lib/workbench.copy";

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
      "&": { height: "100%", backgroundColor: "var(--color-background)", color: "var(--color-ink)", fontSize: font.fontSize },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { fontFamily: font.fontFamily, lineHeight: font.lineHeight },
      ".cm-content": { padding: "12px 16px 12px 0", caretColor: "var(--color-accent)", outline: "none" },
      ".cm-gutters": { backgroundColor: "var(--color-background)", color: "var(--color-subtle)", border: "none" },
      ".cm-lineNumbers .cm-gutterElement": { minWidth: "56px", padding: "0 16px 0 0" },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-ink) 3%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--color-panel)", color: "var(--color-ink)" },
      ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
      ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--color-selection)" },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--color-subtle)" },
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
  autoFocus: boolean;
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
export function SqlEditor({ ref, initialSql, tabId, initialSelection = null, engine, connectionId, database, autoFocus, errorAt, onRun, onRunScript, runningAt = null, onChange, onRunnableChange, onEdited, onOpenTable, variables }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { preferences } = usePreferences();
  // Com "seguir o sistema", o esquema vem do sistema, e muda com o app aberto.
  const systemIsLight = useSyncExternalStore(subscribeSystemScheme, systemPrefersLight, () => false);
  const dark = resolveScheme(preferences.theme, systemIsLight) === "dark";
  const { fontFamily, fontSize, tabSize, autocomplete, uppercaseKeywords, blankLineSeparates, showVariableValues } = preferences.editor;
  // Os nomes sugeridos são os da árvore da conexão DESTA aba, que ela passa por propriedade: as abas ficam todas montadas, e ler a aba ativa
  // daria ao editor de uma aba os nomes da conexão de outra.
  const queryClient = useQueryClient();
  // O que só vale ao criar o editor: a mesma referência em todas as renderizações. As preferências do editor entram aqui para a
  // criação; depois, os efeitos de baixo as reconfiguram ao vivo quando mudam (Configurações abre por cima, com o editor montado).
  const [initial] = useState(() => ({ sql: initialSql, tabId, selection: initialSelection, engine, autoFocus, editor: { fontFamily, fontSize, tabSize }, dark, autocomplete, uppercaseKeywords }));
  const applied = useRef(`${fontFamily}|${fontSize}|${tabSize}|${dark}`);
  // O banco de agora, lido pelas funções do editor na hora em que rodam (executar, separar o comando, sugerir).
  const engineNow = useRef(engine);
  // RN-SQL-018: a linha em branco separa os comandos? Lida na hora de executar: não muda nada no editor, e não precisa de compartimento.
  const blankLinesNow = useRef(blankLineSeparates);
  // RN-VAR-025: o armazém dos valores de agora, lido pelo autocompletar na hora do pedido (o tipo de cada variável).
  const variablesNow = useRef(variables);
  const variableCompletion = useRef<VariablesCompletion | null>(null);
  const appliedToggles = useRef(`${autocomplete}|${uppercaseKeywords}`);

  const emitRun = useEffectEvent((target: RunTarget, flash: FlashRun) => onRun(target, flash));
  const emitChange = useEffectEvent((text: string) => onChange(text));
  const emitRunnable = useEffectEvent((runnable: boolean) => onRunnableChange(runnable));
  const emitEdited = useEffectEvent(() => onEdited());
  // Os níveis da árvore são lidos na hora do pedido, da conexão desta aba (sem busca nenhuma: só o cache).
  const readLevels = useEffectEvent(() => (connectionId === null ? [] : cachedLevels(queryClient, connectionId, database)));
  // RN-LINK-001: o catálogo é o do autocompletar (o cache da árvore do banco da aba, sem consulta nova), e o esquema padrão sai do usuário da conexão.
  const catalogCache = useRef<{ levels: CachedLevel[]; catalog: LinkCatalog } | null>(null);
  const findLink = useEffectEvent((sql: string, offset: number, tokens: Parameters<typeof tableLinkAt>[5]): TableLink | null => {
    if (connectionId === null || onOpenTable === undefined) return null;
    const levels = readLevels();
    if (catalogCache.current === null || !sameLevels(catalogCache.current.levels, levels)) catalogCache.current = { levels, catalog: linkCatalog(levels) };
    const userName = queryClient.getQueryData<{ id: string; userName: string }[]>(connectionsQuery.queryKey)?.find((connection) => connection.id === connectionId)?.userName;
    return tableLinkAt(sql, offset, engineNow.current, catalogCache.current.catalog, defaultSchemasOf(engineNow.current, userName), tokens);
  });
  const openLink = useEffectEvent((link: TableLink) => onOpenTable?.({ schema: link.schema, name: link.name }));
  const completionFor = useEffectEvent(() => {
    // O autocompletar das variáveis guarda o script lido da versão do texto: um só por editor, criado na primeira vez que a lista é montada.
    variableCompletion.current ??= variablesCompletion({ engine: () => engineNow.current, blankLines: () => blankLinesNow.current, values: () => variablesNow.current?.snapshot() ?? null });
    return sqlCompletion({ dialect: dialectOf(engineNow.current), engine: engineNow.current, levels: () => readLevels(), variables: variableCompletion.current });
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

    const clamp = (position: number) => Math.min(position, initial.sql.length);
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.sql,
        ...(initial.selection === null ? {} : { selection: EditorSelection.single(clamp(initial.selection.anchor), clamp(initial.selection.head)) }),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          languageSlot.of(sql({ dialect: dialectOf(initial.engine) })),
          syntaxHighlighting(highlight),
          themeSlot.of(editorTheme(initial.editor, initial.dark)),
          tabSlot.of(tabSettings(initial.editor.tabSize)),
          caseSlot.of(initial.uppercaseKeywords ? keywordCase(initial.engine, () => blankLinesNow.current) : []),
          errorMark,
          variablesEditor({ engine: () => engineNow.current, blankLines: () => blankLinesNow.current }),
          runFlash,
          scriptMark,
          tableLinks({ engine: () => engineNow.current, find: (sql, offset, tokens) => findLink(sql, offset, tokens), open: (link) => openLink(link), mac: isMac }),
          // À frente do mapa padrão, que usa Ctrl+Enter para abrir uma linha em branco.
          Prec.highest(keymap.of([{ key: "Mod-Enter", run }])),
          completionSlot.of(initial.autocomplete ? completionFor() : []),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": workbenchCopy.editor.label, "data-sql-editor": "" }),
          EditorView.domEventHandlers({ blur: flush }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              if (pending !== null) clearTimeout(pending);
              pending = setTimeout(flush, changeDelayMs);
              emitEdited();
            }

            if (!update.docChanged && !update.selectionSet) return;
            const next = isRunnable(update.state, engineNow.current);
            if (next !== runnable) emitRunnable((runnable = next));
          }),
        ],
      }),
    });

    view.current = editor;
    emitRunnable((runnable = isRunnable(editor.state, engineNow.current)));
    if (initial.selection !== null) editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: "center" }) });
    if (initial.autoFocus) editor.focus();
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
    const editor = view.current;
    const key = `${autocomplete}|${uppercaseKeywords}`;
    if (editor === null || key === appliedToggles.current) return;

    appliedToggles.current = key;
    editor.dispatch({ effects: [completionSlot.reconfigure(autocomplete ? completionFor() : []), caseSlot.reconfigure(uppercaseKeywords ? keywordCase(engineNow.current, () => blankLinesNow.current) : [])] });
  }, [autocomplete, uppercaseKeywords]);

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
    }),
    [onRun, onRunScript],
  );

  return <div ref={host} className="h-full" />;
}
