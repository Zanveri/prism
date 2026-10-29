# Temas do Obsidian e Seletor de Variantes — Desenho

**Data:** 2026-10-29
**Escopo:** `src/client/` (tokens CSS, preferências, seletor de aparência, superfície de ícones, exportação de diagramas e testes)

## 1. Objetivo

Adicionar suporte nativo a **variantes de tema (sub-temas)** na aba **Configurações › Aparência**, inspirado no seletor de variantes do Obsidian (*Style Settings* / *AnuPpuccin*), e incorporar **10 temas do ecossistema Obsidian** com seus nomes originais e suas respectivas variantes:

1. **AnuPpuccin** (`https://github.com/anubisnekhet/AnuPpuccin`) — *Mocha*, *Frappé*, *Macchiato*, *Latte*, *Rosé Pine*
2. **Blue Topaz** (`https://github.com/pkm-er/Blue-Topaz_Obsidian-css`) — *Dark*, *Light*
3. **Obsidianite** (`https://github.com/bennyxguo/Obsidian-Obsidianite`) — *Dark*, *Light*
4. **Atom** (`https://github.com/kognise/obsidian-atom`) — *Dark*, *Light*
5. **Typewriter** (`https://github.com/crashmoney/obsidian-typewriter`) — *Dark*, *Light*
6. **Willemstad** (`https://github.com/tingmelvin/willemstad-x`) — *Dark*, *Light*
7. **Obsidian gruvbox** (`https://github.com/insanum/obsidian_gruvbox`) — *Dark*, *Light*
8. **Primary** (`https://github.com/primary-theme/obsidian`) — *Dark*, *Light*
9. **Catppuccin** (`https://github.com/catppuccin/obsidian`) — *Mocha*, *Frappé*, *Macchiato*, *Latte*
10. **Prism** (`https://github.com/damiankorcz/Prism-Theme`) — *Raven*, *Mocha*, *Indigo*, *Pine*, *Cherry*, *Swan*, *Latte*, *Periwinkle*, *Pistachio*, *Peach*

Os 7 temas já existentes (`Prism Escuro`, `Prism Claro`, `Monokai`, `Dracula`, `Nord`, `GitHub Claro`, `Kanagawa`) permanecem inalterados como temas sem sub-variantes.

## 2. Abordagens avaliadas

### Abordagem A — Identificador plano por variante (`data-theme="<id>"`) + agrupamento na camada de apresentação *(Recomendada)*
Cada paleta concreta (tema sem variantes ou variante específica de um tema) é um `ThemeId` em `themeModes` com seu bloco `:root[data-theme="<id>"]` em `globals.css`. Na camada de catálogo (`themes.ts`), cada cartão de tema (`ThemeOption`) possui `mode` (variante padrão) e `variants?: readonly ThemeVariantOption[]`.
- **Vantagens:** Zero mudança no formato de `localStorage` (`prism:theme` e `prism:preferences`), `public/theme-boot.js` continua aplicando `dataset.theme` sincronicamente antes do primeiro paint sem flash, e todas as suítes de contraste WCAG AA (`globals.test.ts`, `icon-color.test.ts`, `environment-accent.test.ts`, `prism-mark.test.ts`, `database-logos.test.ts`) validam automaticamente cada uma das 32 novas paletas.
- **Desvantagens:** Mais entradas em `themeModes` e blocos em `globals.css`.

### Abordagem B — Par composto `(theme, variant)` em `UserPreferences` + dois atributos no DOM (`data-theme` e `data-variant`)
Separar família e variante no estado salvo e no DOM.
- **Desvantagens:** Exige migração de formato no `localStorage`, altera `theme-boot.js`, duplica seletores CSS e quebra o contrato das suítes de teste que inspecionam `:root[data-theme="..."]`.

**Decisão:** Seguir a **Abordagem A**.

## 3. Catálogo de temas e variantes

| Cartão (`name`) | `mode` padrão | Variantes (`mode` → `label`, esquema) |
| --- | --- | --- |
| **Prism Escuro** | `dark` | — |
| **Prism Claro** | `light` | — |
| **Monokai** | `monokai` | — |
| **Dracula** | `dracula` | — |
| **Nord** | `nord` | — |
| **GitHub Claro** | `github-light` | — |
| **Kanagawa** | `kanagawa` | — |
| **AnuPpuccin** | `anuppuccin` | `anuppuccin` (*Mocha*, escuro), `anuppuccin-frappe` (*Frappé*, escuro), `anuppuccin-macchiato` (*Macchiato*, escuro), `anuppuccin-latte` (*Latte*, claro), `anuppuccin-rosepine-light` (*Rosé Pine*, claro) |
| **Blue Topaz** | `blue-topaz` | `blue-topaz` (*Dark*, escuro), `blue-topaz-light` (*Light*, claro) |
| **Obsidianite** | `obsidianite` | `obsidianite` (*Dark*, escuro), `obsidianite-light` (*Light*, claro) |
| **Atom** | `atom` | `atom` (*Dark*, escuro), `atom-light` (*Light*, claro) |
| **Typewriter** | `typewriter` | `typewriter` (*Dark*, escuro), `typewriter-light` (*Light*, claro) |
| **Willemstad** | `willemstad` | `willemstad` (*Dark*, escuro), `willemstad-light` (*Light*, claro) |
| **Obsidian gruvbox** | `obsidian-gruvbox` | `obsidian-gruvbox` (*Dark*, escuro), `obsidian-gruvbox-light` (*Light*, claro) |
| **Primary** | `primary` | `primary` (*Dark*, escuro), `primary-light` (*Light*, claro) |
| **Catppuccin** | `catppuccin` | `catppuccin` (*Mocha*, escuro), `catppuccin-frappe` (*Frappé*, escuro), `catppuccin-macchiato` (*Macchiato*, escuro), `catppuccin-latte` (*Latte*, claro) |
| **Prism** | `prism` | `prism` (*Raven*, escuro), `prism-mocha` (*Mocha*, escuro), `prism-indigo` (*Indigo*, escuro), `prism-pine` (*Pine*, escuro), `prism-cherry` (*Cherry*, escuro), `prism-swan` (*Swan*, claro), `prism-latte` (*Latte*, claro), `prism-periwinkle` (*Periwinkle*, claro), `prism-pistachio` (*Pistachio*, claro), `prism-peach` (*Peach*, claro) |

Total: **17 cartões de tema** na grade e **39 paletas (`ThemeId`)** ao todo (7 existentes + 32 novas).

## 4. Comportamento da Interface (`AppearanceSection`)

1. **Grade de temas (`role="group" aria-label="Tema"`):**
   - Renderiza 17 cartões (1 por família de tema).
   - Quando uma variante de um tema está ativa (ex.: `anuppuccin-latte`), o cartão da família (**AnuPpuccin**) permanece marcado com `aria-pressed="true"`, exibe as amostras (`swatches`) e o subtítulo (`Claro` / `Escuro`) da variante ativa, e o clique no cartão de outra família seleciona a variante padrão daquela família.
2. **Seletor de variantes (`role="group" aria-label="Variante do tema"`):**
   - Exibido logo abaixo da grade de temas sempre que a família ativa possui `variants` (2 ou mais variantes).
   - Renderiza botões em formato de pílula para cada variante da família ativa, com bolinha de cor de destaque e fundo da variante, nome da variante (`Mocha`, `Frappé`, `Latte`, `Dark`, `Light`, etc.) e `aria-pressed={preferences.theme === variant.mode}`.
   - Passar o mouse (`onMouseEnter`) ou focar (`onFocus`) numa pílula de variante atualiza em tempo real o painel de **Pré-visualização** abaixo.
3. **Pré-visualização:**
   - Exibe no cabeçalho o nome composto quando há variante ativa (`AnuPpuccin · Latte`, `Prism · Swan`, `Blue Topaz · Dark`) ou apenas o nome do tema nos temas sem variantes (`Dracula`).

## 5. Arquivos impactados

- `src/client/src/styles/globals.css` — blocos `:root[data-theme="<id>"]` para as 32 novas paletas, calibradas a partir do CSS original de cada tema do Obsidian para atender integralmente às regras de contraste WCAG AA (≥ 4.5:1 para texto, sintaxe, links e acentos sobre superfícies e seleção; hierarquia monotônica de luminância `ink` → `body` → `muted` → `subtle`).
- `src/client/src/app/settings/_lib/preferences.ts` — inclusão dos 32 novos `ThemeMode` em `themeModes`.
- `src/client/src/app/settings/_lib/theme.ts` — mapeamento `light` / `dark` em `themeSchemes` para todos os novos `ThemeId`.
- `src/client/public/theme-boot.js` — sincronização da lista `themes` com `themeModes`.
- `src/client/src/app/settings/_lib/settings.copy.ts` — textos dos novos temas, variantes e rótulo do seletor de variantes (`Variante do tema`).
- `src/client/src/app/settings/_lib/themes.ts` — tipos `ThemeVariantOption` e `ThemeOption`, catálogo `themeOptions`, `themePreviews` para todos os 39 `ThemeId` e helper `findThemeOption(id)` para resolver a família e a variante ativa.
- `src/client/src/app/settings/_components/appearance-section.tsx` — renderização do cartão refletindo a variante ativa, barra de pílulas de variantes e pré-visualização.
- `src/client/src/components/ui/icon-color.ts` — inclusão das superfícies das novas paletas claras e escuras em `iconSurfaces`.
- `src/client/src/app/workbench/_lib/diagram-export.ts` — inclusão das novas paletas em `themePalettes` para exportação SVG/PNG de diagramas ER.
- Testes: `themes.test.ts`, `preferences.test.ts`, `page.test.ts`, `globals.test.ts`.
