import type { CSSProperties } from "react";

import { iconColorStyle } from "@/components/ui";

/** A cor que a pessoa escolheu para o ambiente, como a API a grava (RN-CONN-010): `#RRGGBB`, em qualquer caixa. */
const hexColor = /^#[0-9a-f]{6}$/i;

/**
 * RN-AMB-002: a cor do ambiente da aba nos destaques da área de resultado. A variável de estilo `--environment-color` NÃO é token do tema (`--color-*`): não
 * tem as duas colunas das fichas do `globals.css`, existe só na área de resultado da aba de uma conexão com ambiente colorido, e vale o que a pessoa escolheu
 * já com o ajuste do ícone colorido (RN-PASTA-007): `light-dark(<variante dos temas claros>, <variante dos escuros>)`, que passa em 3:1 sobre as superfícies de
 * todos os temas (RN-CONFIG-003). Quem escolhe a coluna é o `color-scheme` do tema, também na janela do resultado, que copia o do `<html>`.
 *
 * Devolve `undefined` sem cor, ou com uma que não é `#RRGGBB` (a leitura da lista de conexões só confere que é texto, `connections.schema.ts`): um valor que o
 * CSS não entende, posto numa variável, deixa a propriedade que a lê inválida no cálculo, e a borda cairia no `currentColor` em vez de usar a reserva do
 * `var()`. Sem a variável, cada destaque fica na cor do tema.
 *
 * Quem a põe é a `<section>` do `ResultPanel`, e só ela: a área de resultado da aba de consulta vai por portal para o painel, para a aba do resultado ou para
 * a janela do resultado (`result-host.tsx`), e variável de CSS herda pelo DOM, não pela árvore do React. Posta na aba de consulta, ela não chegaria lá.
 */
export function environmentColorStyle(color: string | null | undefined): CSSProperties | undefined {
  return color != null && hexColor.test(color) ? ({ "--environment-color": iconColorStyle(color) } as CSSProperties) : undefined;
}

/**
 * As classes que leem a variável de `environmentColorStyle`, cada uma com o tema como reserva: sem a variável (sem ambiente, ambiente sem cor, aba sem
 * conexão) o `var()` cai no token de antes, e o destaque fica exatamente como era. A reserva da barra de rolagem é a cor de rolagem do tema
 * (`--color-border-strong`) sobre o painel, o `scrollbar-color` do `:root` (`globals.css`), e não o acento: sem ambiente, a barra não ganha cor nenhuma.
 *
 * Não são `@utility` do `globals.css` nem token: o projeto usa classes de valor arbitrário para o que é de um lugar só, e token novo pede as duas colunas
 * (`light-dark`) na mesma linha. A lista do que lê a variável está na RN-AMB-002; o que não está nela segue no acento.
 */
export const environmentAccent = {
  /** O sublinhado do título e o das abas (`border-b-2`), e a borda do campo de edição da célula. */
  border: "border-[color:var(--environment-color,var(--color-accent))]",
  /** O contorno da célula ativa da grade (`outline-2`). */
  outline: "outline-[color:var(--environment-color,var(--color-accent))]",
  /** O anel do foco da grade (o `:focus-visible` do `globals.css`, que só troca a cor: a espessura e o recuo são os de lá). */
  focusOutline: "focus-visible:outline-[color:var(--environment-color,var(--color-accent))]",
  /** As barras de rolagem da grade (a vertical, a horizontal e o canto), sobre a cor do painel, a trilha de sempre. */
  scrollbar: "[scrollbar-color:var(--environment-color,var(--color-border-strong))_var(--color-panel)]",
} as const;
