import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, sql, StandardSQL } from "@codemirror/lang-sql";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, Prec, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { editorFont, type EditorPreferences } from "@/app/settings/_lib/editor-style";
import { resolveScheme, subscribeSystemScheme, systemPrefersLight } from "@/app/settings/_lib/theme";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";

import type { CachedLevel } from "../_lib/navigator-search";
import { cachedLevels, sqlCompletion } from "../_lib/sql-completion";
import { tableLinks } from "../_lib/table-link-extension";
import { defaultSchemasOf, linkCatalog, tableLinkAt, type LinkCatalog, type TableLink } from "../_lib/table-links";
import { liveEditors } from "../_lib/live-editors";
import { keywordCase } from "../_lib/sql-keyword-case";
import { hasStatement, statementAt } from "../_lib/sql-statements";
import type { RunTarget } from "../_lib/use-query-runner";
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

      // A lista de sugestões (RN-CONFIG-004) é o que flutua, como a lista do Select: fundo elevado, borda forte, sombra. Os seletores
      // repetem os da biblioteca, que tem o mesmo peso e vem antes; só pares de cor que o teste de contraste já cobre (texto sobre elevado e sobre selecionado).
      ".cm-tooltip": { backgroundColor: "var(--color-raised)", color: "var(--color-body)", border: "1px solid var(--color-border-strong)", borderRadius: "6px", boxShadow: "var(--shadow-2xl)" },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: font.fontFamily, padding: "4px", minWidth: "260px" },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", borderRadius: "4px", lineHeight: "1.4" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-selected)", color: "var(--color-ink)" },
      ".cm-completionDetail": { color: "var(--color-muted)", fontStyle: "normal" },
      ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600", color: "var(--color-accent)" },
      ".cm-completion-keyword .cm-completionLabel": { color: "var(--color-syntax-keyword)" },
    },
    { dark },
  );
};

/**
 * As cores de sintaxe do tema (RN-CONFIG-003): palavra-chave e tipo, texto entre aspas simples, número e comentário. Cada tema do canvas
 * define as quatro (`kw`, `str`, `num` e `com`); no Prism Escuro são o azul do PostgreSQL, o verde, o acento e o apagado.
 * O nome entre aspas duplas é um nome, e não texto. O canvas pinta em rosa a função do banco
 * (`now`); a gramática do `lang-sql` não distingue função de nome, então ela fica na cor do texto.
 */
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName], color: "var(--color-syntax-keyword)" },
  { tag: tags.string, color: "var(--color-syntax-string)" },
  { tag: tags.special(tags.string), color: "var(--color-ink)" },
  { tag: tags.number, color: "var(--color-syntax-number)" },
  { tag: [tags.lineComment, tags.blockComment], color: "var(--color-syntax-comment)", fontStyle: "italic" },
]);

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
 * está o cursor, separado pelas regras do banco da aba (RN-SQL-002). Sem comando nenhum o texto vai
 * vazio: quem executa é que diz "não há comando", e também quando a seleção tem mais de um.
 */
function runTarget(state: EditorState, engine: Engine | undefined): RunTarget {
  const { from, to, head } = state.selection.main;
  if (from !== to) return { sql: state.sliceDoc(from, to), offset: from, engine };

  const statement = statementAt(state.doc.toString(), head, engine);
  return statement === null ? { sql: "", offset: head, engine } : { sql: statement.text, offset: statement.start, engine };
}

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
 * texto tem algum (`statementAt`). É o que habilita o botão "Executar".
 */
function isRunnable(state: EditorState, engine: Engine | undefined): boolean {
  const { from, to } = state.selection.main;
  return from === to ? docHasStatement(state.doc, engine) : hasStatement(state.sliceDoc(from, to), engine);
}

export type SqlEditorHandle = {
  /** Executa o que o editor mandaria com Ctrl+Enter e devolve o foco a ele. */
  run: () => void;
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
  onRun: (target: RunTarget) => void;
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
};

/** O macOS usa o ⌘ onde os outros usam o Ctrl (RN-LINK-001). */
const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/** Os níveis da árvore são os mesmos objetos enquanto nenhuma consulta deles mudou: o catálogo dos links só é refeito quando algum muda. */
const sameLevels = (a: readonly CachedLevel[], b: readonly CachedLevel[]) => a.length === b.length && a.every((level, index) => level.key === b[index].key && level.nodes === b[index].nodes);

/**
 * O editor de SQL (CodeMirror 6). O texto não é estado do React: mora no editor, que avisa quem o
 * guarda com atraso, para uma tecla não redesenhar a área de trabalho. Ctrl+Enter executa
 * (RN-SQL-001). Tab recua; Esc e depois Tab saem do editor pelo teclado.
 */
export function SqlEditor({ ref, initialSql, tabId, initialSelection = null, engine, connectionId, database, autoFocus, errorAt, onRun, onChange, onRunnableChange, onEdited, onOpenTable }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const { preferences } = usePreferences();
  // Com "seguir o sistema", o esquema vem do sistema, e muda com o app aberto.
  const systemIsLight = useSyncExternalStore(subscribeSystemScheme, systemPrefersLight, () => false);
  const dark = resolveScheme(preferences.theme, systemIsLight) === "dark";
  const { fontFamily, fontSize, tabSize, autocomplete, uppercaseKeywords } = preferences.editor;
  // Os nomes sugeridos são os da árvore da conexão DESTA aba, que ela passa por propriedade: as abas ficam todas montadas, e ler a aba ativa
  // daria ao editor de uma aba os nomes da conexão de outra.
  const queryClient = useQueryClient();
  // O que só vale ao criar o editor: a mesma referência em todas as renderizações. As preferências do editor entram aqui para a
  // criação; depois, os efeitos de baixo as reconfiguram ao vivo quando mudam (Configurações abre por cima, com o editor montado).
  const [initial] = useState(() => ({ sql: initialSql, tabId, selection: initialSelection, engine, autoFocus, editor: { fontFamily, fontSize, tabSize }, dark, autocomplete, uppercaseKeywords }));
  const applied = useRef(`${fontFamily}|${fontSize}|${tabSize}|${dark}`);
  // O banco de agora, lido pelas funções do editor na hora em que rodam (executar, separar o comando, sugerir).
  const engineNow = useRef(engine);
  const appliedToggles = useRef(`${autocomplete}|${uppercaseKeywords}`);

  const emitRun = useEffectEvent((target: RunTarget) => onRun(target));
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
  const completionFor = useEffectEvent(() => sqlCompletion({ dialect: dialectOf(engineNow.current), engine: engineNow.current, levels: () => readLevels() }));

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

    function run(state: EditorState) {
      emitRun(runTarget(state, engineNow.current));
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
          caseSlot.of(initial.uppercaseKeywords ? keywordCase(initial.engine) : []),
          errorMark,
          tableLinks({ engine: () => engineNow.current, find: (sql, offset, tokens) => findLink(sql, offset, tokens), open: (link) => openLink(link), mac: isMac }),
          // À frente do mapa padrão, que usa Ctrl+Enter para abrir uma linha em branco.
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: (target) => run(target.state) }])),
          completionSlot.of(initial.autocomplete ? completionFor() : []),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": workbenchCopy.editor.label }),
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
    editor.dispatch({ effects: [completionSlot.reconfigure(autocomplete ? completionFor() : []), caseSlot.reconfigure(uppercaseKeywords ? keywordCase(engineNow.current) : [])] });
  }, [autocomplete, uppercaseKeywords]);

  // O banco mudou com o editor montado: a gramática, as maiúsculas e o completar passam a ser os dele, e "há o que executar?" é refeito pelas regras dele.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || engine === engineNow.current) return;

    engineNow.current = engine;
    editor.dispatch({ effects: [languageSlot.reconfigure(sql({ dialect: dialectOf(engine) })), completionSlot.reconfigure(autocomplete ? completionFor() : []), caseSlot.reconfigure(uppercaseKeywords ? keywordCase(engine) : [])] });
    emitRunnable(isRunnable(editor.state, engine));
  }, [engine, autocomplete, uppercaseKeywords]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || (errorAt === null && editor.state.field(errorMark).size === 0)) return;

    editor.dispatch({ effects: errorAt === null ? setErrorMark.of(null) : [setErrorMark.of(errorAt), EditorView.scrollIntoView(Math.min(errorAt, editor.state.doc.length))] });
  }, [errorAt]);

  useImperativeHandle(
    ref,
    () => ({
      run: () => {
        const editor = view.current;
        if (editor === null) return;

        onRun(runTarget(editor.state, engineNow.current));
        editor.focus();
      },
      focus: () => view.current?.focus(),
    }),
    [onRun],
  );

  return <div ref={host} className="h-full" />;
}
