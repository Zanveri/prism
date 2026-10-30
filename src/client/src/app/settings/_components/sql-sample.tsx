import type { CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";

import type { SqlFormatStyle } from "../_lib/preferences";

/** O papel de cada trecho do exemplo: palavra-chave, texto entre aspas, número, comentário ou o resto. */
export type SampleKind = "kw" | "str" | "num" | "com" | "fg";
export type SampleLine = readonly (readonly [SampleKind, string])[];

/** As cores com que o exemplo se desenha: as de um tema (a prévia do tema) ou as variáveis do CSS (o tema que está aplicado). */
export type SamplePalette = { bg: string; fg: string; kw: string; str: string; num: string; com: string; rolagem: string };

/** As cores do editor, que são as do tema aplicado: o mesmo que o CodeMirror usa (`sql-editor.tsx`). */
export const appliedPalette: SamplePalette = {
  bg: "var(--color-background)",
  fg: "var(--color-ink)",
  kw: "var(--color-syntax-keyword)",
  str: "var(--color-syntax-string)",
  num: "var(--color-syntax-number)",
  com: "var(--color-syntax-comment)",
  rolagem: "var(--color-border-strong)",
};

/** O mesmo código da prévia do canvas (`Configuracoes.dc.html`). */
export const themeSample: readonly SampleLine[] = [
  [["com", "-- Refugo por máquina nas últimas 24 horas"]],
  [["kw", "SELECT"], ["fg", " m.tag, "], ["kw", "SUM"], ["fg", "(a.refugo) "], ["kw", "AS"], ["fg", " refugo"]],
  [["kw", "FROM"], ["fg", " producao.apontamento a"]],
  [["kw", "JOIN"], ["fg", " producao.maquina m "], ["kw", "ON"], ["fg", " m.id = a.maquina_id"]],
  [["kw", "WHERE"], ["fg", " a.registrado_em >= now() - "], ["kw", "interval "], ["str", "'24 hours'"]],
  [["kw", "GROUP BY"], ["fg", " m.tag"]],
  [["kw", "ORDER BY"], ["fg", " refugo "], ["kw", "DESC"]],
  [["kw", "LIMIT "], ["num", "10"], ["fg", ";"]],
];

/** Uma linha só, para a prévia da fonte do editor em Aparência (RN-CONFIG-008): letras estreitas e largas, aspas e número. */
export const fontSample: readonly SampleLine[] = [[["kw", "SELECT"], ["fg", " id, nome, 'Ilha' "], ["kw", "AS"], ["fg", " mm, 1.0 "], ["kw", "FROM"], ["fg", " clientes;"]]];

/** Um exemplo curto, com uma linha recuada por uma tabulação de verdade: é nela que a largura da tabulação aparece. */
export const editorSample: readonly SampleLine[] = [
  [["kw", "SELECT"], ["fg", " m.tag,"]],
  [["fg", "\t"], ["kw", "SUM"], ["fg", "(a.refugo) "], ["kw", "AS"], ["fg", " refugo"]],
  [["kw", "FROM"], ["fg", " producao.apontamento a"]],
  [["kw", "WHERE"], ["fg", " a.registrado_em >= now() - "], ["kw", "interval "], ["str", "'24 hours'"]],
];

/** A prévia de Editor SQL: ilustra o estilo de formatação (`formatStyle`) e a caixa das palavras-chave (`uppercaseKeywords`). */
export function editorSampleOf(style: SqlFormatStyle, uppercaseKeywords: boolean): readonly SampleLine[] {
  const kw = (word: string): readonly [SampleKind, string] => ["kw", uppercaseKeywords ? word.toUpperCase() : word.toLowerCase()];

  switch (style) {
    case "river":
      return [
        [kw("SELECT"), ["fg", " c.nome,"]],
        [["fg", "       "], kw("COUNT"), ["fg", "(p.id) "], kw("AS"), ["fg", " total_pedidos"]],
        [["fg", "  "], kw("FROM"), ["fg", " clientes "], kw("AS"), ["fg", " c"]],
        [["fg", " "], kw("WHERE"), ["fg", " c.ativo = "], ["num", "1"]],
        [["fg", "   "], kw("AND"), ["fg", " p.data >= "], ["str", "'2026-01-01'"], ["fg", ";"]],
      ];
    case "expanded":
      return [
        [kw("SELECT")],
        [["fg", "\tc.nome,"]],
        [["fg", "\t"], kw("COUNT"), ["fg", "(p.id) "], kw("AS"), ["fg", " total_pedidos"]],
        [kw("FROM")],
        [["fg", "\tclientes "], kw("AS"), ["fg", " c"]],
        [kw("WHERE")],
        [["fg", "\tc.ativo = "], ["num", "1"], ["fg", ";"]],
      ];
    case "tabular":
      return [
        [kw("SELECT"), ["fg", "   c.nome,"]],
        [["fg", "         "], kw("COUNT"), ["fg", "(p.id) "], kw("AS"), ["fg", " total_pedidos"]],
        [kw("FROM"), ["fg", "     clientes "], kw("AS"), ["fg", " c"]],
        [kw("WHERE"), ["fg", "    c.ativo = "], ["num", "1"]],
        [kw("ORDER BY"), ["fg", " total_pedidos "], kw("DESC"), ["fg", ";"]],
      ];
    case "leadingComma":
      return [
        [kw("SELECT"), ["fg", " c.nome"]],
        [["fg", "     , c.email"]],
        [["fg", "     , "], kw("COUNT"), ["fg", "(p.id) "], kw("AS"), ["fg", " total_pedidos"]],
        [kw("FROM"), ["fg", " clientes "], kw("AS"), ["fg", " c;"]],
      ];
    case "compact":
      return [[kw("SELECT"), ["fg", " c.nome, c.email "], kw("FROM"), ["fg", " clientes "], kw("AS"), ["fg", " c "], kw("WHERE"), ["fg", " c.ativo = "], ["num", "1"], ["fg", ";"]]];
    case "modern":
      return [
        [kw("WITH"), ["fg", " pedidos_2026 "], kw("AS"), ["fg", " ("]],
        [["fg", "\t"], kw("SELECT"), ["fg", " * "], kw("FROM"), ["fg", " pedidos "], kw("WHERE"), ["fg", " data >= "], ["str", "'2026-01-01'"]],
        [["fg", ")"]],
        [kw("SELECT")],
        [["fg", "\tc.nome,"]],
        [["fg", "\t"], kw("COUNT"), ["fg", "(p.id) "], kw("AS"), ["fg", " total_pedidos"]],
        [kw("FROM"), ["fg", " clientes "], kw("AS"), ["fg", " c;"]],
      ];
  }
}

type SqlSampleProps = {
  lines: readonly SampleLine[];
  palette: SamplePalette;
  /** Como o editor desenha o texto; ausente, o do canvas (13 px, linha de 22 px, a fonte mono do app). */
  font?: Pick<CSSProperties, "fontFamily" | "fontSize" | "lineHeight" | "tabSize">;
  className?: string;
};

/**
 * Um trecho de SQL colorido à mão, sem o CodeMirror: serve às prévias. Quem lê com leitor de tela já tem os controles; o
 * código é só para os olhos, e por isso fica escondido dele (`aria-hidden`). Como ele rola, o Chrome o tornaria um ponto de parada do
 * Tab, e um elemento focável dentro de uma região escondida do leitor de tela é erro: `tabIndex={-1}` o tira da ordem do teclado.
 */
export function SqlSample({ lines, palette, font, className }: SqlSampleProps) {
  return (
    <div
      aria-hidden="true"
      tabIndex={-1}
      className={cn("overflow-auto px-3 py-2.5 font-mono text-sm whitespace-pre", className)}
      style={{ background: palette.bg, color: palette.fg, scrollbarColor: `${palette.rolagem} ${palette.bg}`, lineHeight: "22px", ...font }}
    >
      {lines.map((line, index) => (
        <div key={index}>
          {line.map(([kind, text], at) => (
            <span key={at} style={{ color: palette[kind], fontStyle: kind === "com" ? "italic" : undefined }}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
