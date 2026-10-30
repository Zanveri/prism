# Ícones animados em hover (estilo Resend) — Design

## Intenção e motivação
Substituir o comportamento estático de todos os ícones de interface do Prism por micro-animações sutis e semânticas inspiradas nos ícones do Resend (`lucide-animated`). Os ícones permanecem totalmente parados em repouso e ganham movimento curto (~350–450ms) apenas quando o usuário passa o mouse sobre o controle interativo pai (botão, item de menu, aba, linha da árvore, link, label) ou diretamente sobre o ícone quando ele está avulso.

## Objetivos, não-objetivos e anti-objetivos
- **Objetivos**:
  - Animar todos os ícones de UI de `src/client`:
    - Os 68 ícones centrais em `src/client/src/components/ui/icons.tsx`.
    - Os ícones de formato e destino de exportação em `src/client/src/app/workbench/_components/data-export/format-icons.tsx`.
    - Os ícones locais em `settings-icon.tsx`, `cell-value-viewer-panel.tsx`, `grid-zoom-controls.tsx`, `navigator-toolbar.tsx`, `result-actions.tsx` e `result-place-button.tsx`.
    - Os ícones SVG inline em `dialog.tsx`, `context-menu.tsx`, `toast.tsx` e `table-commands.tsx`.
  - Dar a cada família/ícone um movimento condizente com seu significado (ex.: tampa da lixeira levantando em `TrashIcon`, arco do cadeado abrindo em `LockIcon`/`LockOpenIcon`, rotação em `RefreshIcon`, ponteiros girando em `ClockIcon`/`TimerIcon`, sliders deslizando em `SettingsIcon`, setas deslocando no eixo em `Arrow*`/`DownloadIcon`/`UploadIcon`/`UndoIcon`/`RedoIcon`, etc.).
  - Disparar a animação tanto no hover do controle interativo pai habilitado quanto no hover direto do `<svg>` quando estiver fora de um controle interativo.
- **Não-objetivos**:
  - Alterar as ilustrações de marca (`PrismMark` e `BrandPanel`, que já possuem animações próprias de cena) ou as linhas de relacionamento SVG do canvas do diagrama ER (`diagram-canvas.tsx`).
  - Criar animações em loop infinito enquanto o mouse permanece parado sobre o botão (o movimento executa 1 ciclo curto na entrada do hover e retorna suavemente ao estado inicial, como no Resend).
- **Anti-objetivos**:
  - Animar ícones dentro de botões ou itens desabilitados (`:disabled`, `[aria-disabled="true"]`).
  - Ignorar a preferência de acessibilidade `prefers-reduced-motion: reduce` do sistema operacional.
  - Quebrar asserções existentes nos testes (`renderToStaticMarkup`, classes de `<span class="flex-none ...">` ou `aria-hidden="true"`).

## Restrições
- Zero dependências externas novas (`src/client/package.json` inalterado).
- Total compatibilidade com renderização estática SSR (`renderToStaticMarkup` nos testes Vitest sem DOM).
- Todas as regras de `@keyframes` e transições encapsuladas em `@media (prefers-reduced-motion: no-preference)` em `src/client/src/styles/globals.css`.

## Abordagens consideradas
1. **CSS puro com seletores de container + marcação das partes móveis do SVG (`data-icon` e classes de sub-elementos) — Escolhida**:
   - Os SVGs recebem `data-icon="<tipo>"` e suas partes articuladas (`<path>`, `<circle>`, `<rect>`, `<line>`) recebem classes semânticas (`icon-part-*`) com `transform-box: fill-box` e `transform-origin` adequado.
   - Em `globals.css`, seletores compostos ativam os `@keyframes` quando o controle pai habilitado (`button:hover:not(:disabled)`, `[role="menuitem"]:hover:not([aria-disabled="true"])`, `[role="tab"]:hover`, `[role="treeitem"]:hover`, `[role="option"]:hover`, `a:hover`, `label:hover`, `.group:hover`) ou o próprio `<svg>[data-icon]:hover` recebe hover.
   - *Vantagem*: zero JS/re-renders, zero alteração manual nas dezenas de botões consumidores, e 100% transparente para `renderToStaticMarkup`.
2. **Estado React (`onMouseEnter`) / Web Animations API em cada componente**:
   - *Descartada*: exigiria repassar eventos de hover dos botões/abas/menus pais para os ícones filhos em toda a aplicação e adicionaria estado imperativo desnecessário.

## Decisões acordadas
- **Gatilho estilo Resend**: a animação dispara ao passar o mouse no controle interativo pai (ou diretamente no ícone quando isolado), executando uma micro-animação curta e retornando ao repouso.
- **Implementação via CSS puro**: sem bibliotecas externas nem listeners JS.

## Decisões a cargo da implementação
- Mapeamento de cada ícone para sua família de `@keyframes` e separação de `<path>` compuestos quando uma parte específica precisa se mover de forma independente (ex.: separar tampa e corpo quando necessário, mantendo o desenho idêntico em repouso).
- Testes unitários garantindo que todos os ícones exportados possuem `data-icon` configurado, preservam `aria-hidden="true"` e têm os `@keyframes` correspondentes declarados em `globals.css` sob `@media (prefers-reduced-motion: no-preference)`.
