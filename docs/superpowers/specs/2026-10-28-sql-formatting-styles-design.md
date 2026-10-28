# Estilos de formatação SQL (`Ctrl+Shift+F`) — Design

## Intenção e motivação
Permitir que o usuário escolha seu estilo preferido de indentação e formatação de consultas SQL em **Configurações → Editor SQL** e aplique-o rapidamente no editor com o atalho `Ctrl+Shift+F` (`⌘+Shift+F` no macOS) ou pelo menu de contexto do editor, respeitando sempre a preferência de caixa das palavras-chave (`uppercaseKeywords`) e a largura de tabulação (`tabSize`).

## Objetivos, não-objetivos e anti-objetivos
- **Objetivos**:
  - Disponibilizar os 6 estilos de formatação SQL:
    1. **River (`river`)**: palavras-chave principais alinhadas à direita formando um rio vertical de espaço antes do conteúdo.
    2. **Expandido (`expanded`, padrão)**: cada cláusula principal em sua própria linha e conteúdo indentado abaixo com `tabSize` espaços.
    3. **Alinhado à esquerda / tabular (`tabular`)**: cláusulas alinhadas à esquerda e conteúdo começando na mesma coluna.
    4. **Vírgula à esquerda (`leadingComma`)**: vírgulas no início das linhas seguintes nas listas de colunas/expressões.
    5. **Compacto / colapsado (`compact`)**: cada comando colapsado em uma única linha.
    6. **Moderno / dbt (`modern`)**: cláusulas em linha própria ou diretas (`FROM`/`JOIN` no nível raiz com `ON` indentado, `SELECT` com colunas indentadas abaixo, CTEs `WITH ... AS (...)` espaçadas com linha em branco).
  - Respeitar `preferences.editor.uppercaseKeywords` em **todos** os 6 estilos (`true` → `MAIÚSCULAS`, `false` → `minúsculas`, inclusive no estilo Moderno).
  - Aplicar a formatação via `Ctrl+Shift+F` (`Mod-Shift-f`) e pelo menu de contexto do `SqlEditor`: sem seleção, formata o documento inteiro; com seleção, formata apenas o trecho selecionado.
- **Não-objetivos**:
  - Reescrever semântica da consulta (converter subqueries em CTEs automaticamente ou alterar tipos de `JOIN` omitidos pelo autor além do que já está no comando).
- **Anti-objetivos**:
  - Corromper literais entre aspas simples (`'...'` e `E'...'`), identificadores entre aspas duplas (`"..."`), blocos `$tag$...$tag$` do PostgreSQL, comentários (`--`, `/* ... */`, `{ ... }` do Informix) ou declarações de variáveis (`let` / `const`) do Prism.
  - Ignorar a preferência `uppercaseKeywords` do usuário por causa do estilo escolhido.

## Restrições
- Zero dependências externas novas (`src/client/package.json` permanece enxuto).
- Preservar o histórico de desfazer (`Ctrl+Z`) do CodeMirror ao aplicar a formatação.
- Seguir os padrões de acessibilidade, cópia em português e testes puros (`vitest`) de `src/client`.

## Abordagens consideradas
1. **Formatador próprio sobre o leitor SQL do Prism (`sql-format.ts`) — Escolhida**:
   - Reutiliza o conhecimento dos dialetos do Prism (PostgreSQL, Db2 e Informix) e o vocabulário de palavras-chave (`uppercaseWords`) para tokenizar e estruturar cláusulas SQL e renderizar os 6 estilos com precisão.
   - *Vantagem*: respeita nativamente `{ ... }` do Informix, `$tag$` do PostgreSQL e declarações `let`/`const`, sem pacotes de terceiros.
2. **Biblioteca externa (`sql-formatter`) + pós-processamento**:
   - *Descartada*: adiciona dependência externa, não conhece declarações `let`/`const` nem `{ ... }` do Informix e ainda exigiria pós-processamento manual para os estilos River, Tabular e Compacto.

## Decisões acordadas
- **Escopo do `Ctrl+Shift+F`**: sem texto selecionado, formata todo o documento da aba; com texto selecionado, formata apenas a seleção.
- **Caixa das palavras-chave**: controlada exclusivamente por `preferences.editor.uppercaseKeywords` (`true` = `SELECT`, `false` = `select`) em todos os estilos.
- **Persistência**: novo campo `formatStyle: SqlFormatStyle` em `preferences.editor` (`"expanded"` como valor inicial padrão), validado e salvo por usuário em `localStorage` junto às demais preferências.

## Decisões a cargo da implementação
- Grupo de escolha `<fieldset>` (`name="cfg-formatacao"`) em `EditorSection` com os 6 estilos (seguindo o padrão de `AppearanceSection` e `ResultsSection`) e atualização ao vivo da prévia `SqlSample` em **Configurações → Editor SQL** refletindo o estilo, `tabSize` e `uppercaseKeywords`.
- Item "Formatar SQL" (`Ctrl+Shift+F` / `⇧⌘F`) também no menu de contexto do `SqlEditor`, ao lado de "Autocompletar JOINs".
- Preservação intacta de declarações `let`/`const` e blocos de rotina (`CREATE PROCEDURE/FUNCTION/TRIGGER`) ao formatar o documento inteiro.
