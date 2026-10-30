# Notas — redesign do diagrama e code review do Construir

Sessão de 2026-10-30. Arquivo vivo: cada etapa anota aqui o que fez e o que falta,
para retomar sem reler o código se a sessão cair.

## Estado

- [x] Canvas de design: https://claude.ai/artifact/3b4pfkF9ocB5WLYNbE4iJW (Main, Construir, Anatomia)
- [x] Novo design do diagrama (área de trabalho + Construir), resumo abaixo
- [x] Code review geral do Construir (46 achados abaixo; nenhum código alterado)

### Próximos passos (para retomar)
1. Corrigir os bugs de prioridade alta do review (autosave, painel de texto, arrasto/desfazer) com teste antes.
2. Extrair `DiagramCanvas` para `src/components/diagram/` com cartões em HTML, conforme "Implementação sugerida".
3. Criar os tokens `--color-warning` e `--color-diagram-edge` em `globals.css`, nos temas também.
   Hoje `diagram-canvas.tsx` usa `fill-warning`, mas `--color-warning` não existe, então o aviso sai sem cor.
4. Aplicar o design primeiro na área de trabalho (só leitura), depois os estados de edição do Construir.

## Design do diagrama

Canvas: https://claude.ai/artifact/3b4pfkF9ocB5WLYNbE4iJW. Artboards: `Main` (área de trabalho, interativo:
clique numa tabela), `Construir` (edição) e `Anatomia` (estados). Tweak `dark` alterna tema claro/escuro.

### Cartão de tabela (um componente só, usado nas duas telas)
- Caixa com `rounded-lg` (8px), fundo `raised`, borda `border-strong`, sombra suave. Nada de texto SVG solto como hoje.
- Cabeçalho 39px: faixa de 3px no topo com a cor do grupo/esquema (como o `headerColor` do dbdiagram), nome em
  sans 13px semibold, contagem de colunas à direita. O cabeçalho é um `<button>` (selecionar; no Construir também arrasta).
- Linha de coluna 26px: ícone 14px (chave âmbar = PK, elo azul = FK), nome em mono 12px, chip `UQ` quando única,
  tipo em mono 11px `subtle` alinhado à direita, truncando com reticências. Hover da linha com fundo leve.
- Geometria fixa: topo da 1ª linha = `y + 40`; centro da linha i = `y + 40 + i*26 + 13`. As relações saem desse ponto.

### Relações
- Curva Bézier coluna→coluna (não tabela→tabela, não ortogonal). Lado: se o alvo está à direita sai pela direita;
  à esquerda, pela esquerda; mesma coluna do layout (ou auto-relação), as duas pontas pela esquerda em laço.
  Controle = `max(36, |dx|*0.5)`; laço = `40 + |dy|*0.06`.
- Notação pé-de-galinha: "muitos" (3 traços) no lado da FK, "um e só um" (duas barras) no lado da PK.
  FK anulável: linha tracejada e círculo no lado "muitos" (ver Anatomia). FK única (1:1): barras nas duas pontas.
- Cor neutra (`#566170` escuro / `#9AA3AF` claro) por padrão; a seleção destaca em `link` 2px e apaga o resto (30%).

### Área de trabalho (Main)
- Barra superior: esquema + motor, segmentado Dados/Estrutura/Diagrama, busca (Ctrl F), Organizar, Exportar ▾, Reler.
  Some a barra de legenda e a fileira de 6 botões de hoje (Exportar PNG/Mermaid/Copiar viram um menu).
- Barra flutuante embaixo, centrada: selecionar/mover, − 100% +, ajustar, mini-mapa. Mini-mapa no canto inferior esquerdo.
- Selecionar uma tabela: borda âmbar, tabelas sem relação a 38%, colunas ligadas com fundo azul leve e painel lateral
  flutuante (272px) com Abrir dados / Estrutura / Gerar SELECT e as listas "Referencia" e "Referenciada por",
  cada item clicável para pular para a outra tabela.
- Grupos (regiões com tinta 4% e rótulo em caixa alta): por esquema quando o diagrama junta mais de um, ou
  `TableGroup` do DBML no Construir.

### Construir
- Três colunas: lista de tabelas (220px, marcas + nova / ~ alterada / ! problema), diagrama, editor da tabela (resto).
- Estados no cartão: nova (borda e faixa verdes, selo "nova"), alterada (selo), coluna nova (verde com +),
  tipo alterado (tipo em laranja), coluna removida (riscada em vermelho), problema (selo "! n" e balão W* com ação).
- Ligar colunas: alça (círculo) aparece nas duas bordas da linha em hover; arrastar desenha curva tracejada âmbar,
  a linha-alvo acende e uma dica mostra `cupom_id → cupom.id` antes de soltar.
- "Adicionar coluna" (Enter) no pé do cartão selecionado; barra flutuante com "+ Tabela" e "Ligar colunas (L)".
- Editor: nome, abas Colunas/Chaves/Índices (`Segmented`), linhas nome + tipo (`Select`) + NN + PK como toggles,
  resumo "nesta tabela: 1 coluna nova, 1 tipo alterado" e atalho para o ALTER da tabela.

### Implementação sugerida
- Um só `DiagramCanvas` em `components/` (hoje há `diagram-canvas.tsx` na área de trabalho e `build-diagram.tsx`
  em cima dele): props `editable`, `diffState` por tabela/coluna, `onConnect`, `onMove`.
- Cartão em HTML (`foreignObject` não; cartões como `div` absolutos num plano transformado com `translate/scale`),
  relações num `<svg>` por baixo no mesmo plano. Texto HTML resolve truncamento, foco, hover e tema sem medir texto.
- Cores só por tokens (`--color-*`); faltam dois: `--color-warning` (laranja) e `--color-diagram-edge`.
- Botões da barra = `Button` / `IconButton` do app com `Tooltip`; menu Exportar = `ContextMenu`; abas = `Segmented`.

## Code review

Caminhos relativos a `src/client/src/app/build/` salvo indicação.

### 1. Bugs de correção

- **[alta]** [_lib/model-save.ts:167](../../src/client/src/app/build/_lib/model-save.ts#L167) — `dispose()` cancela o timer e descarta `pendingModel` sem gravar; trocar de aba ou sair do Construir até 1 s depois de editar perde a alteração (RN-CONSTRUIR-080). Correção: no `dispose`, chamar `flush()` (fire-and-forget) antes de desregistrar.
- **[alta]** [_lib/use-model-document.ts:88](../../src/client/src/app/build/_lib/use-model-document.ts#L88) — `handleSaved`/`handleStateChange` não conferem o `id`: a gravação em voo do modelo A, ao terminar depois da troca para B, põe o nome de A em `docState.name` de B, e a próxima gravação de B (que manda `name: docState.name`, linha 82) renomeia B para A. Correção: ignorar callbacks cujo `dto.id`/id do agendador difere de `docState.id`, e não mandar `name` no autosave.
- **[média]** [_lib/model-save.ts:101](../../src/client/src/app/build/_lib/model-save.ts#L101) — em falha (não conflito) o modelo que não gravou já saiu de `pendingModel`, então Ctrl+S (`flush`) não tenta de novo e o estado fica "failed" até a próxima edição. Correção: devolver `modelToSave` a `pendingModel` quando ainda for null antes do `break`.
- **[alta]** [page.tsx:809](../../src/client/src/app/build/page.tsx#L809) — "Abrir arquivo" passa sempre `"postgresql"` a `modelFromFile`, ignorando o `database_type` do DBML e sem perguntar o destino do `.sql` (RN-CONSTRUIR-059); o caminho `needsEngine` de `build-files.ts:53` nunca é usado e erro de leitura (`!parsed.ok`) some em silêncio. Correção: passar `null`, abrir um diálogo de destino em `needsEngine` e mostrar `parsed.error` (com a linha) antes de criar.
- **[média]** [page.tsx:694](../../src/client/src/app/build/page.tsx#L694) — `readAt: "agora"` (também 742, 747, 790, 796) grava o literal "agora" no modelo; o cabeçalho do DDL "lida em <readAt>" e a lista de modelos mostram "agora" para sempre. Idem `ddlContext` (903): `prismVersion: "0.6.0"` fixo e `generatedAt: "hoje"`. Correção: `new Date().toISOString()` para `readAt`, data/hora formatadas e a versão do `package.json`/preload para o cabeçalho.
- **[média]** [page.tsx:597](../../src/client/src/app/build/page.tsx#L597) — "Exportar DDL (.sql)" grava `writeModelSql` (o texto da aba SQL, sem cabeçalho) e não bloqueia com erros; RN-CONSTRUIR-082 pede o DDL e "só sem erros". Correção: gerar com `ddl-full`/`ddl-changes` conforme o escopo e desabilitar o item quando `checkModel` tem erro.
- **[média]** [page.tsx:622](../../src/client/src/app/build/page.tsx#L622) — `loadCatalogPreview` não cancela a leitura anterior: trocar de conexão/banco rápido deixa a resposta velha sobrescrever `catalogSchemas`/`catalogDatabases` da nova; em erro os esquemas antigos ficam na tela. Correção: um token/AbortController por chamada e ignorar respostas que não são a última; limpar esquemas no erro.
- **[média]** [page.tsx:683](../../src/client/src/app/build/page.tsx#L683) — `handleNewModelSubmit`/`handleImportTablesSubmit`/`handleReread` não têm `catch`: um abort (botão Cancelar leitura) ou exceção de `readCatalog` vira promessa rejeitada sem tratamento (`void ...`), e `handleReread` some em silêncio quando a sessão não abre (780). Correção: `catch` que ignora `AbortError` e põe o resto em `catalogError`/toast.
- **[média]** [page.tsx:482](../../src/client/src/app/build/page.tsx#L482) — `selectedTableKey` e `rereadNotes` não são zerados ao trocar de aba: a chave de uma tabela do modelo A vai para o B (editor vazio em vez da primeira tabela) e os avisos W8 de A aparecem em B. Correção: guardar ambos por id de modelo ou zerá-los em `updateTabs` quando `active` muda.
- **[baixa]** [page.tsx:797](../../src/client/src/app/build/page.tsx#L797) — todas as notas de releitura viram `code: "W8"`, embora o tipo preveja `W13` (base trocada). Correção: classificar a nota que vem de `rereadModel` ou devolver o código de lá.
- **[baixa]** [page.tsx:820](../../src/client/src/app/build/page.tsx#L820) — rename/duplicate/delete ignoram o `Result` da API (falha some, e o `onSuccess` roda mesmo com erro: o delete fecha a aba de um modelo que não foi excluído). Correção: lançar quando `!res.ok` e mostrar toast em `onError`.
- **[baixa]** [page.tsx:855](../../src/client/src/app/build/page.tsx#L855) — o atalho global de teclado ignora diálogos abertos: F5, Alt+N e Esc agem por baixo do `NewModelDialog`/`ScopeDialog`. Correção: sair cedo quando algum diálogo está aberto (ou `event.defaultPrevented`).

- **[alta]** [_components/text-pane.tsx:44](../../src/client/src/app/build/_components/text-pane.tsx#L44) — o texto do SQL/DBML é escrito só na montagem (`useState` + `key` por aba/painel) e `applyTextRead` troca `tables` inteiro pelo lido (`_lib/text-merge.ts:182`): com a aba SQL aberta, mover/ligar/excluir tabela no diagrama ou desfazer pela barra e depois digitar uma letra no texto apaga essas mudanças. Correção: reescrever o documento do CodeMirror quando `model` muda por fora (comparando com o último modelo aplicado pelo próprio texto).
- **[média]** [_components/text-pane.tsx:150](../../src/client/src/app/build/_components/text-pane.tsx#L150) — o efeito que cria o `EditorView` depende de `preferences.editor`/`theme` e recria o estado com `initialText`: mudar fonte ou tema com o painel aberto descarta o que foi digitado e não aplicado; o timer de 'aplicar' também não é limpo no desmonte. Correção: trocar tema/fonte por `Compartment.reconfigure` e limpar `timerRef` no cleanup.
- **[alta]** [_components/build-diagram.tsx:70](../../src/client/src/app/build/_components/build-diagram.tsx#L70) — `onMoveTable` é chamado a cada `pointermove` (`diagram-canvas.tsx:570`) e cada chamada vira `doc.change` → um passo de desfazer por pixel: um arrasto enche os 100 passos (RN-CONSTRUIR-014) e reagenda o autosave sem parar. Correção: posição local durante o arrasto e um único `onChange` no `pointerup`.
- **[média]** [_lib/use-model-document.ts:137](../../src/client/src/app/build/_lib/use-model-document.ts#L137) — `change/undo/redo` leem `docState.history` da renderização (closure velha): duas mudanças antes do re-render (conectar + selecionar, aplicação do texto logo após um clique) perdem a primeira. Correção: `setDocState(prev => ...)` com `commit(prev.history, next)` e chamar o agendador com o resultado.
- **[média]** [_components/build-diagram.tsx:75](../../src/client/src/app/build/_components/build-diagram.tsx#L75) — a página não passa `onNeedsForeignKeyDialog`, então ligar coluna a uma tabela com PK composta (ou sem PK) cria em silêncio uma FK para a primeira coluna ou para `"id"` inexistente. Correção: passar o callback da página abrindo o diálogo de FK de `foreign-keys-section.tsx`.
- **[média]** [_components/build-diagram.tsx:91](../../src/client/src/app/build/_components/build-diagram.tsx#L91) — o aviso "tabela removida / Desfazer" nunca some e o Desfazer restaura `previousModel` inteiro, descartando tudo o que foi feito depois. Correção: `useToast()` com `ToastAction` (expira sozinho) e desfazer pelo histórico (`doc.undo`) em vez do snapshot.
- **[média]** [_components/base-menu.tsx:88](../../src/client/src/app/build/_components/base-menu.tsx#L88) — `ChangeBaseDialog` é aberto sem `databasesByConnection` nem `loadingProgress`: a lista de bancos tem só o banco padrão da conexão (o banco atual da base, se outro, fica fora das opções do `Select`) e o diálogo fecha sem mostrar a leitura. Correção: carregar `getDatabases` da conexão escolhida e repassar o progresso de `handleReread`.
- **[média]** [_components/simple-editor.tsx:322](../../src/client/src/app/build/_components/simple-editor.tsx#L322) — o check da coluna é achado por `ck.expression.includes(column.name)`: a coluna `id` pega o check de `paid > 0`, e editar ali reescreve o check errado. Correção: guardar o vínculo coluna→check (nome do check = nome da coluna, RN-CONSTRUIR-031) e casar por ele.
- **[média]** [_components/simple-editor.tsx:326](../../src/client/src/app/build/_components/simple-editor.tsx#L326) — `ColumnRow key={idx}` com estado interno `expanded` (`column-row.tsx:87`): excluir ou reordenar uma coluna faz os detalhes abertos pularem para a vizinha. Idem `foreign-keys-section.tsx:170` e `indexes-section.tsx:66`. Correção: key estável (`originName ?? name` + índice de criação, ou um id no modelo).

### 2. Componentes próprios não usados

Nota: `title=` **é** a dica do app (`components/ui/tooltip.ts` troca o `title` nativo pela dica própria), então os `title=` não são defeito; o defeito é botão de ícone sem `aria-label` (seção 5). Também não há componente de checkbox: `<input type="checkbox" className="size-4 accent-accent">` é o padrão do resto do app (connections) e está certo em `ddl-view.tsx`, `import-tables-dialog.tsx` e `new-model-dialog.tsx`.

- **[média]** [page.tsx:1154](../../src/client/src/app/build/page.tsx#L1154) — o botão de mostrar/esconder a barra lateral reimplementa `NavigatorToggle` (`app/workbench/_components/navigator-toggle.tsx`) sem dica, atalho (Ctrl+B) nem `aria-controls`. Correção: usar `NavigatorToggle` (ou extraí-lo para `components/layout`).
- **[média]** [page.tsx:400](../../src/client/src/app/build/page.tsx#L400) — o seletor Simplificado/SQL/DBML é `<button aria-pressed>` cru com sublinhado próprio. Correção: `Segmented` + `segmentedItem`, ou o padrão de abas de `table-view-tabs.tsx` (`role="tablist"`).
- **[média]** [_components/ddl-view.tsx:165](../../src/client/src/app/build/_components/ddl-view.tsx#L165) — o escopo "Só as diferenças / Tudo" (165, 179) é um par de `<button aria-checked>` com estilo próprio. Correção: `Segmented`/`segmentedItem`, como `new-model-dialog.tsx:345` já faz para o destino.
- **[média]** [_components/model-tabs.tsx:46](../../src/client/src/app/build/_components/model-tabs.tsx#L46) — a faixa de abas de modelos é um `<nav>` com botões crus, sem `role="tablist"`/`tab`, setas, nem fechar com botão do meio. Correção: reaproveitar `TabStrip`/o padrão de `app/workbench/_components/tab-strip.tsx`.
- **[média]** [_components/model-toolbar.tsx:121](../../src/client/src/app/build/_components/model-toolbar.tsx#L121) — ícones de desfazer/refazer em `<svg>` inline (121, 147); idem reticências em `models-list.tsx:287` e `simple-editor.tsx:244`, alça de arrastar em `column-row.tsx:135` e `MinusIcon`/`MoveIcon` em `workbench/_components/table-tab/diagram-canvas.tsx:39-60` (o `MinusIcon` já existe em `components/ui/icons.tsx`). Correção: adicionar `UndoIcon`, `RedoIcon`, `MoreIcon`, `GripIcon`, `MoveIcon` a `components/ui/icons.tsx` e importar de lá.
- **[média]** [_components/build-sidebar.tsx:145](../../src/client/src/app/build/_components/build-sidebar.tsx#L145) — campo de filtro montado à mão (`label` + `SearchIcon` + `<input>` cru), repetido em `models-list.tsx:120`. Correção: `NavigatorSearchField` (`app/workbench/_components/navigator-search-field.tsx`) ou `Input` de `components/ui/field.tsx` com o ícone.
- **[baixa]** [_components/build-sidebar.tsx:123](../../src/client/src/app/build/_components/build-sidebar.tsx#L123) — botões de ícone crus com classe própria (123, 132; `model-tabs.tsx:59,74,84`; `indexes-section.tsx:120`), cada um com tamanho/raio diferentes (`h-8 w-8 rounded-md`, `h-5 w-5 rounded`, `size-7 rounded-sm` no canvas); onde usa `Button` força `className="h-8 w-8 p-0"` (`model-toolbar.tsx:119`). Correção: um `size: "icon"` em `buttonVariants` e `<Button variant="ghost" size="icon">` em todos.
- **[baixa]** [_components/build-sidebar.tsx:291](../../src/client/src/app/build/_components/build-sidebar.tsx#L291) — "Gerar DDL" da barra lateral e o link do rodapé (`build-footer.tsx:66`) e "Lista de modelos" (`model-tabs.tsx:84`) são `<button>` crus com borda/hover próprios. Correção: `Button variant="secondary"`/`"ghost"` `size="compact"`.
- **[baixa]** [_components/scope-dialog.tsx:85](../../src/client/src/app/build/_components/scope-dialog.tsx#L85) — grupos de rádio feitos de `<button role="radio">` (aqui, `connection-choice-dialog.tsx:105`, `base-menu.tsx:181`, cartões de `new-model-dialog.tsx:298,317`), três estilos diferentes e sem setas. Correção: um único `ChoiceCard`/rádio compartilhado (ou `Segmented` para os de 2 opções) com navegação por setas.
- **[baixa]** [_components/build-sidebar.tsx:174](../../src/client/src/app/build/_components/build-sidebar.tsx#L174) — selos "existente"/"nova"/"excluir"/"alterada" reimplementados (174, 178, 225, 229; `existing-table-banner.tsx:27,32`; `column-row.tsx:176,181`). Correção: `StatusBadge` com `tone` (`neutral`/`success`/`warning`/`error`).
- **[baixa]** [_components/column-row.tsx:199](../../src/client/src/app/build/_components/column-row.tsx#L199) — os quatro toggles PK/NN/UQ/AI (199-257) e o UQ de `indexes-section.tsx:88` repetem a mesma string de classe. Correção: um `KeyToggle` local em `_components` (ou `segmentedItem`).

### 3. Cores e espaçamentos fora dos tokens

Nenhuma cor hexadecimal ou `rgb()` em `app/build` nem nos arquivos do diagrama: as cores passam pelos tokens (`text-ink`, `bg-panel`, `border-accent`, `var(--color-*)` no CodeMirror). O desvio é de tamanhos arbitrários (40 ocorrências em `app/build`).

- **[baixa]** [_components/new-model-dialog.tsx:289](../../src/client/src/app/build/_components/new-model-dialog.tsx#L289) — `text-[13px]` (15 vezes em `app/build`) é exatamente o token `text-sm` (0.8125rem, `styles/globals.css:101`). Correção: trocar por `text-sm`.
- **[baixa]** [_components/column-row.tsx:210](../../src/client/src/app/build/_components/column-row.tsx#L210) — `text-[10px]` (12 vezes), `leading-[18px]` (10), `h-[30px]` (4), `top-[5px] right-[7px]` (`column-row.tsx:176`) sem token equivalente; o resto do app não usa 10px. Correção: `text-xs`/`StatusBadge` para os selos e a escala do Tailwind (`h-7.5`, `top-1`) para alturas e posições.
- **[baixa]** [_components/simple-editor.tsx:279](../../src/client/src/app/build/_components/simple-editor.tsx#L279) — a grade das colunas `grid-cols-[12px_minmax(0,1fr)_112px_repeat(4,26px)_24px]` é repetida no cabeçalho e em `column-row.tsx:114`. Correção: uma constante compartilhada para não desalinhar quando uma mudar.

### 4. Código morto, duplicação e arquivos grandes

- **[média]** [page.tsx:457](../../src/client/src/app/build/page.tsx#L457) — `BuildPage` tem 720 linhas: estado de abas, leitura de catálogo, CRUD de modelos, atalhos e oito diálogos num componente só. Correção: extrair `useCatalogReader` (sessão + `readCatalog` + abort + fechar, hoje repetido em 622, 675, 721 e 776), `useBuildTabs` e `useBuildShortcuts`.
- **[média]** [page.tsx:1069](../../src/client/src/app/build/page.tsx#L1069) — os `onSelectConnection`/`onSelectDatabase` do `NewModelDialog` e do `ImportTablesDialog` (1096) são cópias; os dois diálogos também duplicam a árvore de esquemas com checkbox e recolher (`new-model-dialog.tsx:460-530`, `import-tables-dialog.tsx:313-385`). Correção: um `SchemaTablePicker` em `_components` usado pelos dois.
- **[média]** [page.tsx:145](../../src/client/src/app/build/page.tsx#L145) — `PaneResizeHandle` é cópia do separador de `app/workbench/page.tsx:66` (mesma classe, mesmas props). Correção: mover para `components/layout` e usar nos dois; aproveitar para lembrar a largura como o Workbench lembra.
- **[média]** [page.tsx:268](../../src/client/src/app/build/page.tsx#L268) — `BuildPageView` recalcula `checkModel` quando `problems` não vem, e a página também calcula (533): duas fontes de verdade, e a do View ignora `rereadNotes`. Correção: tornar `problems` obrigatório no View.
- **[baixa]** [page.tsx:113](../../src/client/src/app/build/page.tsx#L113) — props mortas: `onToggleSidebar` (nunca desestruturada no View), `onChangeBase` (nunca passada pela página, então o item do toolbar não faz nada), `databasesByConnection`/`loadingProgress` de `ChangeBaseDialog`, `name` de `useModelDocument` (a página usa `activeDto.name`). Correção: remover ou ligar.
- **[baixa]** [workbench/_components/table-tab/diagram-canvas.tsx:818](../../src/client/src/app/workbench/_components/table-tab/diagram-canvas.tsx#L818) — a mesma regra "terminar a ligação" está escrita quatro vezes (818, 841, 889 e no `pointerup` da janela, 594). O canvas é compartilhado (sem segundo canvas no Construir, o que é bom), mas cresceu para 927 linhas misturando zoom/pan do Workbench com edição do Construir. Correção: extrair `finishConnect(targetKey)` e um hook `useDiagramEditing` só para o modo editável.
- **[baixa]** [_components/build-diagram.tsx:68](../../src/client/src/app/build/_components/build-diagram.tsx#L68) — `onOpenTable` monta a chave com `` `${schema}.${name}` `` à mão em vez de `tableKey()`; e `onMoveTable`/`onConnect` inline mudam de identidade a cada render, fazendo o efeito de `diagram-canvas.tsx:544` re-registrar os listeners de janela em todo render (inclusive durante o arrasto). Correção: `tableKey(ref)` e `useCallback`/`useEffectEvent` nos handlers.

### 5. Acessibilidade

- **[média]** [_components/simple-editor.tsx:326](../../src/client/src/app/build/_components/simple-editor.tsx#L326) — "Adicionar coluna" e "Nova tabela" (Alt+N) não movem o foco para o nome criado, como pede RN-CONSTRUIR-031; não há `focus()`/`autoFocus` em nenhum componente de `_components`. Correção: ref no input de nome da linha nova e `focus()` após o `onChange`.
- **[baixa]** [_components/import-tables-dialog.tsx:344](../../src/client/src/app/build/_components/import-tables-dialog.tsx#L344) — o checkbox do esquema usa só `checked={schemaState === "checked"}`: esquema parcialmente marcado aparece desmarcado, sem `indeterminate`/`aria-checked="mixed"` (idem `new-model-dialog.tsx:494`). Correção: ref que liga `el.indeterminate = schemaState === "partial"`.
- **[baixa]** [_components/scope-dialog.tsx:81](../../src/client/src/app/build/_components/scope-dialog.tsx#L81) — `role="radiogroup"` com `<button role="radio">` sem setas nem `tabIndex` móvel (também `connection-choice-dialog.tsx:98`, `base-menu.tsx:178`, `ddl-view.tsx:160`): o teclado passa por todas as opções com Tab, ao contrário do padrão de rádio. Correção: o componente de escolha compartilhado da seção 2 com navegação por setas.
- **[baixa]** [workbench/_components/table-tab/diagram-canvas.tsx:600](../../src/client/src/app/workbench/_components/table-tab/diagram-canvas.tsx#L600) — a ligação "presa" (`sticky`) não tem Esc para cancelar nem alternativa por teclado para mover/ligar tabelas. Correção: Esc limpa `connectSession`; setas movem a tabela selecionada.

### Testes e typecheck

`vitest run src/app/build src/app/workbench/_lib`: 266 arquivos, 8117 testes, todos passam (rodado com o `node_modules` do checkout principal, porque a worktree não tem um). `tsc --noEmit -p tsconfig.json`: zero erros. Os testes cobrem bem `_lib` e as fixtures de `src/test-fixtures/build/`, mas nada exercita `page.tsx`, `use-model-document.ts` com troca de modelo, `text-pane.tsx` com mudança externa ou o arrasto no diagrama, que é onde estão os bugs acima.

### Prioridades

1. Autosave: gravar o pendente no `dispose` e isolar os callbacks por id em `use-model-document.ts` (perda de alteração e renomeação de um modelo com o nome de outro).
2. `text-pane.tsx`: sincronizar o texto com mudanças vindas do diagrama, do formulário e do desfazer, senão digitar no SQL/DBML apaga o que foi feito fora.
3. Diagrama: um passo de histórico e uma gravação por arrasto, e diálogo de FK quando a ligação é ambígua, em vez de criar FK para `"id"`.
4. "Abrir arquivo": respeitar `database_type`, perguntar o destino do `.sql` e mostrar erros de leitura (RN-CONSTRUIR-059); gravar `readAt` e o cabeçalho do DDL com data real.
5. Trocar os controles feitos à mão por `NavigatorToggle`, `Segmented`, `StatusBadge`, ícones de `components/ui/icons.tsx` e um `Button size="icon"`, e partir `page.tsx` (`useCatalogReader`, `useBuildTabs`).
