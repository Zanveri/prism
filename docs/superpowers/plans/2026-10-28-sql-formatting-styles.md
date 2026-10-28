# SQL Formatting Styles (`Ctrl+Shift+F`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar em Configurações → Editor SQL a escolha do estilo de formatação SQL (River, Expandido, Alinhado à esquerda / tabular, Vírgula à esquerda, Compacto e Moderno) e aplicar a formatação no editor SQL pelo atalho `Ctrl+Shift+F` (`Mod-Shift-f`) e pelo menu de contexto, respeitando sempre `uppercaseKeywords` e `tabSize`.

**Architecture:** Persistimos `formatStyle` em `preferences.editor` (`preferences.ts`) e expomos a escolha em `EditorSection` com atualização ao vivo da prévia `SqlSample`. O formatador puro (`sql-format.ts`) tokeniza o texto respeitando os dialetos do Prism (PostgreSQL, Db2 e Informix) e declarações `let`/`const`, estrutura as cláusulas SQL e renderiza os 6 estilos aplicando a caixa de `uppercaseKeywords`. O `SqlEditor` expõe `formatTarget` e registra `Mod-Shift-f` e o item de menu de contexto para formatar a seleção (quando houver) ou o documento inteiro.

**Tech Stack:** TypeScript, React 19, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-sql-formatting-styles-design.md`

## Global Constraints

- Zero dependências externas novas em `src/client/package.json`.
- `preferences.editor.uppercaseKeywords` define a caixa das palavras-chave (`true` → `MAIÚSCULAS`, `false` → `minúsculas`) em todos os 6 estilos, inclusive no estilo Moderno (`modern`).
- Literais entre aspas simples (`'...'` e `E'...'`), identificadores entre aspas duplas (`"..."`), blocos `$tag$...$tag$` do PostgreSQL, comentários (`--`, `/* ... */`, `{ ... }` do Informix) e declarações `let`/`const` (RN-VAR-001) nunca têm seu conteúdo alterado.
- Textos visíveis ao usuário e comentários em português; identificadores em inglês.

## Review Focus

- Palavras-chave dentro de strings (`'select from where'`), nomes entre aspas (`"select"`), blocos `$tag$select$tag$` ou comentários (`-- select`, `/* from */`, `{ where }` no Informix) devem permanecer intactos.
- No estilo `modern`, com `uppercaseKeywords: true`, as palavras-chave saem em `MAIÚSCULAS` (`WITH ... SELECT ...`); com `uppercaseKeywords: false`, saem em `minúsculas` (`with ... select ...`).
- Declarações `let` / `const` no topo ou no meio do script devem ser preservadas intactas ao formatar o documento inteiro sem seleção.
- Com seleção ativa no `SqlEditor`, `formatTarget` deve substituir apenas o intervalo `{ from, to }` selecionado; sem seleção, substitui `{ from: 0, to: state.doc.length }`, ou retorna `null` se o texto formatado for idêntico ao atual ou vazio/só espaços.
- Comentários de linha (`-- ...`) não podem engolir o código SQL que vem depois quando formatados no estilo `compact` (se houver comentário `--` no meio do comando, quebrar a linha após o comentário `--`).

---

### Task 1: Preferência `formatStyle` e controles em Configurações → Editor SQL

**Files:**
- Modify: `src/client/src/app/settings/_lib/preferences.ts`
- Modify: `src/client/src/app/settings/_lib/settings.copy.ts`
- Modify: `src/client/src/app/settings/_components/sql-sample.tsx`
- Modify: `src/client/src/app/settings/_components/editor-section.tsx`
- Test: `src/client/src/app/settings/_lib/preferences.test.ts`
- Test: `src/client/src/app/settings/page.test.ts`

**Interfaces:**
- Consumes: `defaultPreferences`, `parsePreferences`, `createPreferencesStore` from `src/client/src/app/settings/_lib/preferences.ts`
- Produces:
  - `export const sqlFormatStyles = ["river", "expanded", "tabular", "leadingComma", "compact", "modern"] as const;`
  - `export type SqlFormatStyle = (typeof sqlFormatStyles)[number];`
  - `Preferences["editor"]["formatStyle"]: SqlFormatStyle` (default `"expanded"`)
  - `export function editorSampleOf(style: SqlFormatStyle, uppercaseKeywords: boolean): readonly SampleLine[]` in `src/client/src/app/settings/_components/sql-sample.tsx`

- [ ] **Step 1: Escrever os testes de preferência e da tela de Configurações**

Adicionar em `src/client/src/app/settings/_lib/preferences.test.ts`:
```ts
describe("o estilo de formatação SQL (Ctrl+Shift+F)", () => {
  it("os seis estilos existem e o padrão é o expandido; quem gravou antes dele existir recebe 'expanded'", () => {
    expect(sqlFormatStyles).toEqual(["river", "expanded", "tabular", "leadingComma", "compact", "modern"]);
    expect(defaultPreferences.editor.formatStyle).toBe("expanded");
    for (const formatStyle of sqlFormatStyles) {
      expect(parsePreferences(JSON.stringify({ editor: { formatStyle } })).editor.formatStyle).toBe(formatStyle);
    }
  });
});
```
E em `src/client/src/app/settings/page.test.ts` (dentro de `describe("Editor SQL")`):
```ts
describe("estilo de formatação (Ctrl+Shift+F)", () => {
  const radios = (html: string) =>
    [...html.matchAll(/(<input type="radio"[^>]*name="cfg-formatacao"[^>]*\/?>)<span>([^<]*)<\/span>/g)].map(([, input, label]) => [
      /value="([^"]*)"/.exec(input)?.[1],
      label,
      / checked=""/.test(input),
    ]);

  it("lista os 6 estilos de formatação com Expandido marcado por padrão e explica o atalho Ctrl+Shift+F", () => {
    const html = editor(render().markup);

    expect(html).toMatch(/<fieldset aria-describedby="cfg-formatacao-dica"[^>]*><legend[^>]*>Estilo de formatação SQL<\/legend>/);
    expect(radios(html)).toEqual([
      ["river", "River (rio)", false],
      ["expanded", "Expandido", true],
      ["tabular", "Alinhado à esquerda (tabular)", false],
      ["leadingComma", "Vírgula à esquerda", false],
      ["compact", "Compacto", false],
      ["modern", "Moderno (dbt / analytics)", false],
    ]);
    expect(html).toContain("Ctrl+Shift+F");
  });

  it("mostra o estilo que o usuário escolheu e atualiza a prévia conforme o estilo e a caixa das palavras-chave", () => {
    const html = editor(render({ editor: { formatStyle: "leadingComma", uppercaseKeywords: false } }).markup);

    expect(radios(html)).toContainEqual(["leadingComma", "Vírgula à esquerda", true]);
    expect(html).toContain(">select<");
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar a falha**

Run: `npm --prefix src/client test -- src/app/settings/_lib/preferences.test.ts src/app/settings/page.test.ts`
Expected: FAIL (`sqlFormatStyles` / `formatStyle` ainda não existem)

- [ ] **Step 3: Implementar `sqlFormatStyles` e `formatStyle` em `preferences.ts`, `settings.copy.ts`, `sql-sample.tsx` e `editor-section.tsx`**

Em `src/client/src/app/settings/_lib/preferences.ts`:
- Exportar `sqlFormatStyles = ["river", "expanded", "tabular", "leadingComma", "compact", "modern"] as const` e `type SqlFormatStyle`.
- Incluir `formatStyle: z.enum(sqlFormatStyles)` em `schemas.editor` e `formatStyle: "expanded"` em `defaultPreferences.editor`.
Em `src/client/src/app/settings/_lib/settings.copy.ts`:
- Adicionar em `settingsCopy.editor.formatStyle`: `label: "Estilo de formatação SQL"`, `hint: "Aplicado ao pressionar Ctrl+Shift+F no editor (no documento inteiro ou apenas no trecho selecionado). A caixa das palavras-chave segue a opção “Converter palavras-chave para maiúsculas”."`, e os nomes dos 6 estilos (`river`, `expanded`, `tabular`, `leadingComma`, `compact`, `modern`).
Em `src/client/src/app/settings/_components/sql-sample.tsx`:
- Implementar `editorSampleOf(style: SqlFormatStyle, uppercaseKeywords: boolean): readonly SampleLine[]` que retorna a amostra formatada no estilo e na caixa (`MAIÚSCULAS` quando `uppercaseKeywords` for `true`, `minúsculas` quando `false`).
Em `src/client/src/app/settings/_components/editor-section.tsx`:
- Renderizar o `<fieldset aria-describedby="cfg-formatacao-dica">` com os 6 rádios (`name="cfg-formatacao"`) e passar `editorSampleOf(preferences.editor.formatStyle, preferences.editor.uppercaseKeywords)` para `<SqlSample />`.

- [ ] **Step 4: Rodar os testes de Configurações para confirmar que passam**

Run: `npm --prefix src/client test -- src/app/settings/_lib/preferences.test.ts src/app/settings/page.test.ts`
Expected: PASS

---

### Task 2: Motor de formatação SQL (`sql-format.ts`) com os 6 estilos

**Files:**
- Create: `src/client/src/app/workbench/_lib/sql-format.ts`
- Test: `src/client/src/app/workbench/_lib/sql-format.test.ts`

**Interfaces:**
- Consumes:
  - `SqlFormatStyle` from `@/app/settings/_lib/preferences`
  - `uppercaseWords` from `./sql-keyword-case`
  - `scriptItems`, `statementHasBody` from `./sql-statements`
  - `readDeclaration` from `./variables/declaration-reader`
  - `Engine` from `@/components/ui/engine-tag`
- Produces:
  - `export type SqlFormatOptions = { style: SqlFormatStyle; uppercaseKeywords: boolean; tabSize: number; engine?: Engine; blankLines?: boolean };`
  - `export function formatSql(sql: string, options: SqlFormatOptions): string;`

- [ ] **Step 1: Escrever a suíte de testes `src/client/src/app/workbench/_lib/sql-format.test.ts`**

Cobrir:
1. A consulta de exemplo do usuário nos **6 estilos** (`river`, `expanded`, `tabular`, `leadingComma`, `compact`, `modern`):
   - `river`: palavras-chave principais alinhadas à direita (`SELECT`, `  FROM`, `  JOIN`, `    ON`, ` WHERE`, `   AND`, ` GROUP BY`, ` ORDER BY`), colunas de `SELECT` alinhadas no rio.
   - `expanded`: cada cláusula principal (`SELECT`, `FROM`, `WHERE`, `GROUP BY`, `ORDER BY`) sozinha na linha, conteúdo recuado com `tabSize` espaços, `JOIN` recuado dentro de `FROM` e `ON` recuado mais um nível.
   - `tabular`: cláusulas alinhadas à esquerda e conteúdo começando na mesma coluna (`SELECT   c.nome,`, `FROM     clientes AS c`, `JOIN     pedidos AS p ON ...`, `WHERE    c.ativo = 1`, `AND      ...`, `GROUP BY ...`, `ORDER BY ...`).
   - `leadingComma`: `SELECT c.nome` na primeira linha e linhas seguintes com `, ` alinhado à coluna do conteúdo (`     , c.email`, `     , COUNT(p.id) AS total_pedidos`).
   - `compact`: comando inteiro em uma linha (`SELECT c.nome, c.email FROM clientes AS c WHERE c.ativo = 1;`), sem que comentário `--` engula o código seguinte.
   - `modern`: CTE `WITH nome AS (...)` seguida de linha em branco, `SELECT` com colunas indentadas abaixo, `FROM` e `JOIN` no nível raiz com `ON` indentado abaixo, `WHERE` / `GROUP BY` / `ORDER BY`.
2. Respeito estrito a `uppercaseKeywords`:
   - Em todos os 6 estilos (incluindo `modern` e `river`), `uppercaseKeywords: true` produz palavras-chave em `MAIÚSCULAS` (`SELECT`, `FROM`, `WHERE`, `COUNT`, `AS`, `DESC`) e `uppercaseKeywords: false` produz palavras-chave em `minúsculas` (`select`, `from`, `where`, `count`, `as`, `desc`).
3. Preservação de literais, identificadores entre aspas, `$tag$`, comentários (`--`, `/* */`, `{ }` no Informix) e declarações `let` / `const`.
4. Múltiplos comandos separados por `;` ou linha em branco.

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm --prefix src/client test -- src/app/workbench/_lib/sql-format.test.ts`
Expected: FAIL (`Cannot find module './sql-format'`)

- [ ] **Step 3: Implementar `formatSql` em `src/client/src/app/workbench/_lib/sql-format.ts`**

Implementar tokenizador dialetal (strings `'...'` e `E'...'`, `"..."`, `$tag$`, comentários `--`, `/* */`, `{ }` do Informix, números, palavras, pontuação e operadores compostos `>=`, `<=`, `<>`, `!=`, `::`, `||`, `->`, `->>`), transformação de caixa para palavras em `uppercaseWords` conforme `uppercaseKeywords`, separação em cláusulas de alto nível e subqueries/CTEs, e renderizadores dedicados para `river`, `expanded`, `tabular`, `leadingComma`, `compact` e `modern`, preservando declarações `let`/`const` e corpos de rotina intactos.

- [ ] **Step 4: Rodar os testes de `sql-format.test.ts` para confirmar que passam**

Run: `npm --prefix src/client test -- src/app/workbench/_lib/sql-format.test.ts`
Expected: PASS

---

### Task 3: Atalho `Ctrl+Shift+F` (`Mod-Shift-f`) e menu de contexto no `SqlEditor`

**Files:**
- Modify: `src/client/src/app/workbench/_lib/workbench.copy.ts`
- Modify: `src/client/src/app/workbench/_components/sql-editor.tsx`
- Test: `src/client/src/app/workbench/_components/sql-editor.test.ts`

**Interfaces:**
- Consumes: `formatSql`, `SqlFormatOptions` from `../_lib/sql-format`
- Produces:
  - `export function formatTarget(state: EditorState, options: SqlFormatOptions): { from: number; to: number; insert: string } | null` in `src/client/src/app/workbench/_components/sql-editor.tsx`
  - Keybinding `Mod-Shift-f` and context menu item `"format-sql"` in `SqlEditor`

- [ ] **Step 1: Escrever os testes de `formatTarget` em `src/client/src/app/workbench/_components/sql-editor.test.ts`**

Testar em `sql-editor.test.ts`:
- Sem seleção (`empty`), formata o documento inteiro (`from: 0, to: state.doc.length`), respeitando `style`, `uppercaseKeywords` e `tabSize`.
- Com seleção (`from !== to`), formata apenas o trecho selecionado (`from`, `to`), preservando o que está fora da seleção intacto.
- Quando o texto já está formatado igual ou está em branco, `formatTarget` retorna `null` (não gera transação desnecessária no histórico de desfazer).

- [ ] **Step 2: Rodar `sql-editor.test.ts` para confirmar a falha**

Run: `npm --prefix src/client test -- src/app/workbench/_components/sql-editor.test.ts`
Expected: FAIL (`formatTarget` não exportado)

- [ ] **Step 3: Implementar `formatTarget`, o atalho `Mod-Shift-f` e o item de menu de contexto em `sql-editor.tsx` e `workbench.copy.ts`**

Em `workbench.copy.ts`:
- Adicionar em `workbenchCopy.editor.contextMenu`: `formatSql: "Formatar SQL"`, `formatSqlShortcut: "Ctrl+Shift+F"`, `formatSqlShortcutMac: "⇧⌘F"`.
Em `sql-editor.tsx`:
- Exportar `formatTarget(state: EditorState, options: SqlFormatOptions): { from: number; to: number; insert: string } | null`.
- Manter `formatStyleNow = useRef(formatStyle)` e `tabSizeNow = useRef(tabSize)` sincronizados com `preferences.editor`.
- Registrar `{ key: "Mod-Shift-f", run: formatEditorSql }` dentro de `Prec.highest(keymap.of([...]))` e adicionar o item `"format-sql"` no `ContextMenu` do editor.

- [ ] **Step 4: Rodar os testes do editor e a suíte completa de `src/client`**

Run: `npm --prefix src/client test -- src/app/workbench/_components/sql-editor.test.ts`
Expected: PASS

---
