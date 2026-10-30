# Animated Icons on Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animar todos os ícones de interface do Prism ao passar o mouse (estilo Resend / `lucide-animated`), mantendo-os estáticos em repouso e respeitando `prefers-reduced-motion`.

**Architecture:** Marcamos cada `<svg>` de ícone com `data-icon="<familia>"` e identificamos sub-elementos móveis (tampa da lixeira, arco do cadeado, ponteiros, cursores dos sliders, setas duplas, barras do gráfico) com classes `icon-part-*`. Em `src/client/src/styles/globals.css`, dentro de `@media (prefers-reduced-motion: no-preference)`, definimos o seletor de hover composto (que dispara no controle interativo pai habilitado ou no próprio `<svg>` avulso) e os `@keyframes` semânticos que animam os filhos do SVG sem sobrescrever classes utilitárias de rotação (`rotate-180`, `-rotate-90`) aplicadas no `<svg>`.

**Tech Stack:** TypeScript, React 19, Tailwind CSS 4, CSS Keyframes, Vitest (`renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-10-30-animated-icons-on-hover-design.md`

## Global Constraints

- Zero dependências externas novas em `src/client/package.json`.
- Total compatibilidade com SSR (`renderToStaticMarkup` nos testes Vitest sem DOM).
- Todas as regras de animação devem ficar dentro de `@media (prefers-reduced-motion: no-preference)` em `src/client/src/styles/globals.css`.
- Controles desabilitados (`:disabled`, `[aria-disabled="true"]`) não disparam animação nos ícones filhos.
- Preservar os `d="..."` verificados diretamente por testes existentes (`ArrowUpIcon`: `M8 13V3M4 7l4-4 4 4`, `ArrowDownIcon`: `M8 3v10M4 9l4 4 4-4`, `CheckIcon`: `M3.5 8.5l3 3 6-7`, `AlertIcon`: `M8 2.5l6 10.5H2z`, e chevron de submenu em `context-menu.tsx`: `M6 4l4 4-4 4`).

## Review Focus

- Ícones que recebem classes de rotação externas no `<svg>` (como `<ChevronIcon className="rotate-180" />` em `result-actions.tsx` ou `-rotate-90` na árvore) não podem perder sua rotação quando a animação de hover rodar: a animação deve atuar nos elementos filhos (`> *` ou `.icon-part-*`), nunca sobrescrevendo o `transform` do `<svg>` raiz.
- Botões desabilitados via atributo HTML `disabled` (como em `GridZoomControls`) ou via `aria-disabled="true"` (como em `NavigatorToolbar` e `ContextMenuItems`) não devem animar seus ícones ao receber hover.
- Ícones avulsos fora de botões (como `AlertIcon` em banners, `LockIcon` em cabeçalhos de diálogo ou ícones de aviso em `TableCommands` e `ToastCard`) devem animar quando o usuário passa o mouse diretamente sobre o `<svg>`.
- Nenhum dos 68 ícones exportados por `src/client/src/components/ui/icons.tsx` pode ficar sem `data-icon` ou com um valor de `data-icon` sem regra correspondente em `globals.css`.
- O teste de navegação de Configurações (`src/client/src/app/settings/page.test.ts`), que verifica que cada seção tem um `<svg aria-hidden="true">` único, deve continuar passando.

---

### Task 1: Animações dos 68 ícones centrais (`icons.tsx`) e motor CSS (`globals.css`)

**Files:**
- Modify: `src/client/src/components/ui/icons.tsx`
- Modify: `src/client/src/styles/globals.css`
- Create: `src/client/src/components/ui/icons.test.ts`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils/cn`
- Produces:
  - Atributo `data-icon="<familia>"` em todos os 68 componentes exportados de `src/client/src/components/ui/icons.tsx`
  - Classes de sub-elementos articulados (`.icon-part-lid`, `.icon-part-shackle`, `.icon-part-hand`, `.icon-part-up`, `.icon-part-down`, `.icon-part-left`, `.icon-part-right`, `.icon-part-ne`, `.icon-part-bar`, `.icon-part-knob-left`, `.icon-part-knob-right`, `.icon-part-hammer`, `.icon-part-pop`) e seletores `[data-icon="..."]` em `src/client/src/styles/globals.css`

- [ ] **Step 1: Escrever o teste de cobertura de ícones e regras CSS (`src/client/src/components/ui/icons.test.ts`)**

Criar `src/client/src/components/ui/icons.test.ts` verificando que:
1. Todos os componentes exportados por `icons.tsx` renderizam um `<svg>` com `aria-hidden="true"` e um atributo `data-icon` não vazio.
2. O arquivo `src/client/src/styles/globals.css` declara o bloco `@media (prefers-reduced-motion: no-preference)`, protege contra controles desabilitados (`:not(:disabled):not([aria-disabled="true"])`) e contém seletores `[data-icon="<valor>"]` para cada valor de `data-icon` emitido pelos ícones.
3. Ícones com partes articuladas (`TrashIcon`, `LockIcon`, `LockOpenIcon`, `ClockIcon`, `TimerIcon`, `ArrowsUpDownIcon`, `TransactionIcon`, `DownloadIcon`, `UploadIcon`, `ChartIcon`, `BuildIcon`, `DuplicateIcon`) marcam suas partes móveis com as classes `icon-part-*` sem alterar o desenho em repouso.

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as Icons from "./icons";

const css = readFileSync(resolve(__dirname, "../../styles/globals.css"), "utf8");

describe("ícones animados em hover (icons.tsx + globals.css)", () => {
  const entries = Object.entries(Icons).filter(([name, value]) => name.endsWith("Icon") && typeof value === "function");

  it("todos os 68 ícones exportados renderizam <svg aria-hidden='true' data-icon='...'>", () => {
    expect(entries.length).toBeGreaterThanOrEqual(68);

    for (const [name, Component] of entries) {
      const markup = renderToStaticMarkup(createElement(Component));
      expect(markup, `${name} deve ter aria-hidden="true"`).toMatch(/^<svg[^>]*\baria-hidden="true"/);
      expect(markup, `${name} deve ter data-icon`).toMatch(/^<svg[^>]*\bdata-icon="[a-z-]+"/);
    }
  });

  it("cada família data-icon usada pelos ícones tem regra de animação em globals.css sob prefers-reduced-motion: no-preference", () => {
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain(':not(:disabled):not([aria-disabled="true"])');

    const families = new Set(
      entries.map(([, Component]) => {
        const markup = renderToStaticMarkup(createElement(Component));
        return /\bdata-icon="([a-z-]+)"/.exec(markup)?.[1] ?? "";
      }),
    );

    for (const family of families) {
      expect(css, `globals.css deve estilizar [data-icon="${family}"]`).toContain(`[data-icon="${family}"]`);
    }
  });

  it("preserva os caminhos SVG exigidos pelos testes de grade, menu e alertas e separa partes móveis com icon-part-*", () => {
    expect(renderToStaticMarkup(createElement(Icons.ArrowUpIcon))).toContain('d="M8 13V3M4 7l4-4 4 4"');
    expect(renderToStaticMarkup(createElement(Icons.ArrowDownIcon))).toContain('d="M8 3v10M4 9l4 4 4-4"');
    expect(renderToStaticMarkup(createElement(Icons.CheckIcon))).toContain('d="M3.5 8.5l3 3 6-7"');
    expect(renderToStaticMarkup(createElement(Icons.AlertIcon))).toContain('d="M8 2.5l6 10.5H2z"');
    expect(renderToStaticMarkup(createElement(Icons.TrashIcon))).toContain('class="icon-part-lid"');
    expect(renderToStaticMarkup(createElement(Icons.LockIcon))).toContain('class="icon-part-shackle"');
    expect(renderToStaticMarkup(createElement(Icons.ClockIcon))).toContain('class="icon-part-hand"');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm --prefix src/client test -- src/components/ui/icons.test.ts`
Expected: FAIL (`ChevronIcon deve ter data-icon`)

- [ ] **Step 3: Implementar `data-icon` e classes de partes articuladas em `src/client/src/components/ui/icons.tsx` e os `@keyframes` em `src/client/src/styles/globals.css`**

Em `src/client/src/components/ui/icons.tsx`:
- Aceitar `data-icon` em `Icon` e definir a família semântica em cada um dos 68 componentes:
  - `ChevronIcon`: `data-icon="chevron"`
  - `ArrowUpIcon`: `data-icon="arrow-up"`
  - `ArrowDownIcon`: `data-icon="arrow-down"`
  - `ArrowsUpDownIcon`: `data-icon="arrows-up-down"` com duas `<path>`: `className="icon-part-up"` (`M5.5 13V3M3 5.5L5.5 3 8 5.5`) e `className="icon-part-down"` (`M10.5 3v10M8 10.5l2.5 2.5 2.5-2.5`)
  - `FolderIcon`: `data-icon="folder"`, `FolderPlusIcon`: `data-icon="folder-plus"` (`className="icon-part-pop"` no `+`), `FolderMoveIcon`: `data-icon="folder-move"` (`className="icon-part-right"` na seta)
  - `PencilIcon`: `data-icon="pencil"`
  - `TrashIcon`: `data-icon="trash"` separando a tampa `<path className="icon-part-lid" d="M2.5 4.5h11M6.25 4.5V3h3.5v1.5" />` do corpo `<path d="M4 4.5l.6 8.5h6.8l.6-8.5M6.75 7v4M9.25 7v4" />`
  - `PlusIcon`: `data-icon="plus"`, `MinusIcon`: `data-icon="minus"`
  - `EyeIcon`: `data-icon="eye"` (`className="icon-part-pop"` na pupila `<circle>`), `EyedropperIcon`: `data-icon="eyedropper"`, `EyeOffIcon`: `data-icon="eye-off"`
  - `LockIcon` e `LockOpenIcon`: `data-icon="lock"` (`className="icon-part-shackle"` no arco `<path>`)
  - `PlugIcon`: `data-icon="plug"`, `PowerIcon`: `data-icon="power"` (`className="icon-part-down"` no pino vertical `M8 2v5.5`)
  - `CheckIcon`: `data-icon="check"`
  - `DatabaseIcon`: `data-icon="database"` (`className="icon-part-up"` na elipse superior)
  - `DiagramIcon`, `ConnectColumnsIcon`, `AutoLayoutIcon`: `data-icon="diagram"`
  - `SearchIcon`: `data-icon="search"`
  - `TableIcon`, `ColumnsIcon`: `data-icon="table"`
  - `IndexIcon`: `data-icon="lines"`
  - `ForeignKeyIcon`, `KeyIcon`: `data-icon="key"`
  - `RoutineIcon`, `CodeIcon`: `data-icon="code"`
  - `SequenceIcon`: `data-icon="sequence"`
  - `RefreshIcon`: `data-icon="refresh"`
  - `TimerIcon`: `data-icon="timer"` (`className="icon-part-hand"` nos ponteiros e `className="icon-part-down"` no botão superior)
  - `ClockIcon`: `data-icon="clock"` (`className="icon-part-hand"` nos ponteiros)
  - `DownloadIcon`: `data-icon="download"` (`className="icon-part-down"` na seta `M8 2.5v7M5 6.8l3 3 3-3` e base `M3 12.5h10`)
  - `UploadIcon`: `data-icon="upload"` (`className="icon-part-up"` na seta `M8 9.5v-7M5 5.2l3-3 3 3` e base `M3 12.5h10`)
  - `DocumentIcon`: `data-icon="document"`
  - `DuplicateIcon`: `data-icon="duplicate"` (`className="icon-part-ne"` na folha da frente)
  - `CloseIcon`: `data-icon="close"`
  - `PlayIcon`: `data-icon="play"`
  - `PlayScriptIcon`: `data-icon="play-script"` (`className="icon-part-right"` no triângulo)
  - `StopIcon`: `data-icon="stop"`
  - `WorkbenchIcon`, `MinimapIcon`: `data-icon="panel"`
  - `PackageIcon`: `data-icon="package"`
  - `NoColorIcon`: `data-icon="no-color"`
  - `ChartIcon`: `data-icon="chart"` separando a base `M2.5 13.5h11` e as barras `className="icon-part-bar"` (`M4.75 13.5V9M8 13.5V3.5M11.25 13.5V6.5`)
  - `LightningIcon`: `data-icon="lightning"`
  - `BugIcon`: `data-icon="bug"`
  - `WrenchIcon`: `data-icon="wrench"`
  - `StarIcon`: `data-icon="star"`
  - `AlertIcon`: `data-icon="alert"`
  - `FlagIcon`: `data-icon="flag"`
  - `BuildIcon`: `data-icon="build"` (`className="icon-part-hammer"` na cabeça e cabo do martelo)
  - `UserIcon`: `data-icon="user"` (`className="icon-part-up"` no `<circle>` da cabeça)
  - `PaletteIcon`: `data-icon="palette"`
  - `InfoIcon`: `data-icon="info"` (`className="icon-part-pop"` no `"i"`)
  - `PuzzleIcon`: `data-icon="puzzle"`
  - `TransactionIcon`: `data-icon="transaction"` (`className="icon-part-right"` na seta superior e `className="icon-part-left"` na inferior)
  - `UndoIcon`: `data-icon="undo"`, `RedoIcon`: `data-icon="redo"`
  - `MoreIcon`, `GripIcon`: `data-icon="dots"`
  - `MoveIcon`: `data-icon="move"`
  - `CursorIcon`: `data-icon="cursor"`
  - `FitIcon`: `data-icon="expand"`
  - `LinkIcon`: `data-icon="link"` (`className="icon-part-right"` na seta)

Em `src/client/src/styles/globals.css`:
- Dentro de `@media (prefers-reduced-motion: no-preference)`, configurar `transform-box: fill-box; transform-origin: center;` para `svg[data-icon] > *` e adicionar as regras de hover e `@keyframes` (~380ms `cubic-bezier(0.22, 1, 0.36, 1)`) para todas as famílias e classes `.icon-part-*`, disparadas quando `:is(button, a, label, summary, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="treeitem"], [role="option"], .group):hover:not(:disabled):not([aria-disabled="true"]) svg[data-icon]` ou `svg[data-icon]:hover` estiver ativo.

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npm --prefix src/client test -- src/components/ui/icons.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components/ui/icons.tsx src/client/src/styles/globals.css src/client/src/components/ui/icons.test.ts
git commit -m "feat(client): anima os 68 ícones centrais em hover estilo Resend"
```

---

### Task 2: Animações nos ícones locais, formatos de exportação e SVGs inline

**Files:**
- Modify: `src/client/src/app/settings/_components/settings-icon.tsx`
- Modify: `src/client/src/app/workbench/_components/data-export/format-icons.tsx`
- Modify: `src/client/src/app/workbench/_components/cell-value-viewer-panel.tsx`
- Modify: `src/client/src/app/workbench/_components/grid-zoom-controls.tsx`
- Modify: `src/client/src/app/workbench/_components/navigator-toolbar.tsx`
- Modify: `src/client/src/app/workbench/_components/result-actions.tsx`
- Modify: `src/client/src/app/workbench/_components/result-place-button.tsx`
- Modify: `src/client/src/components/ui/dialog.tsx`
- Modify: `src/client/src/components/ui/context-menu.tsx`
- Modify: `src/client/src/components/ui/toast.tsx`
- Modify: `src/client/src/app/build/_components/table-commands.tsx`
- Modify: `src/client/src/components/ui/icons.test.ts`

**Interfaces:**
- Consumes: Seletores `[data-icon="..."]` e `.icon-part-*` definidos na Task 1 em `src/client/src/styles/globals.css`
- Produces: Todos os ícones locais e SVGs inline de UI marcados com `data-icon` e classes de partes móveis

- [ ] **Step 1: Expandir `src/client/src/components/ui/icons.test.ts` para cobrir os ícones locais e de formato**

Adicionar em `src/client/src/components/ui/icons.test.ts` asserções para:
- `SettingsIcon` (`data-icon="settings"`, `.icon-part-knob-left` e `.icon-part-knob-right`)
- `DataFormatIcon` para todos os formatos de `dataFormats` (`csv`, `sourceCode`, `dbUnit`, `html`, `json`, `markdown`, `sql`, `txt`, `xlsx`, `xml`) e `DatabaseTargetIcon`
- `ResultTabIcon` e `ResultPlaceIcon`

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npm --prefix src/client test -- src/components/ui/icons.test.ts`
Expected: FAIL (`SettingsIcon` e `DataFormatIcon` ainda não possuem `data-icon`)

- [ ] **Step 3: Adicionar `data-icon` e classes `icon-part-*` nos ícones locais e SVGs inline**

- `src/client/src/app/settings/_components/settings-icon.tsx`: `data-icon="settings"` no `<svg>`, `className="icon-part-knob-left"` no `<circle>` superior e `className="icon-part-knob-right"` no `<circle>` inferior.
- `src/client/src/app/workbench/_components/data-export/format-icons.tsx`: mapear cada `DataFormat` para sua família (`csv`: `"table"`, `sourceCode`: `"code"`, `dbUnit`: `"document"`, `html`: `"code"`, `json`: `"code"`, `markdown`: `"document"`, `txt`: `"lines"`, `xlsx`: `"table"`, `xml`: `"code"`).
- `src/client/src/app/workbench/_components/cell-value-viewer-panel.tsx`: `ExternalEditorIcon` com `data-icon="external-editor"` (`className="icon-part-ne"` na seta) e `WordWrapIcon` com `data-icon="undo"`.
- `src/client/src/app/workbench/_components/grid-zoom-controls.tsx`: `MinusIcon` com `data-icon="minus"`.
- `src/client/src/app/workbench/_components/navigator-toolbar.tsx`: `CollapseAllIcon` com `data-icon="collapse-all"` (`className="icon-part-down"` na seta superior `M4.5 2.5L8 6l3.5-3.5` e `className="icon-part-up"` na inferior `M4.5 13.5L8 10l3.5 3.5`).
- `src/client/src/app/workbench/_components/result-actions.tsx`: `MaximizeIcon` com `data-icon="expand"` e `RestoreIcon` com `data-icon="shrink"`.
- `src/client/src/app/workbench/_components/result-place-button.tsx`: `ResultTabIcon` com `data-icon="table"` e `ResultPlaceIcon` com `data-icon="panel"`.
- `src/client/src/components/ui/dialog.tsx`: SVG do botão Fechar com `data-icon="close"`.
- `src/client/src/components/ui/context-menu.tsx`: SVG do chevron de submenu com `data-icon="chevron-right"` (mantendo `d="M6 4l4 4-4 4"`).
- `src/client/src/components/ui/toast.tsx`: SVG do tom em `ToastCard` com `data-icon={toast.tone === "success" ? "check" : "alert"}`.
- `src/client/src/app/build/_components/table-commands.tsx`: SVG de aviso com `data-icon="alert"`.

- [ ] **Step 4: Rodar toda a suíte de testes de `src/client` para confirmar que tudo passa**

Run: `npm --prefix src/client test`
Expected: PASS em todos os arquivos de teste

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/settings/_components/settings-icon.tsx src/client/src/app/workbench/_components/data-export/format-icons.tsx src/client/src/app/workbench/_components/cell-value-viewer-panel.tsx src/client/src/app/workbench/_components/grid-zoom-controls.tsx src/client/src/app/workbench/_components/navigator-toolbar.tsx src/client/src/app/workbench/_components/result-actions.tsx src/client/src/app/workbench/_components/result-place-button.tsx src/client/src/components/ui/dialog.tsx src/client/src/components/ui/context-menu.tsx src/client/src/components/ui/toast.tsx src/client/src/app/build/_components/table-commands.tsx src/client/src/components/ui/icons.test.ts
git commit -m "feat(client): anima ícones locais, formatos de exportação e SVGs inline em hover"
```
