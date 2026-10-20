/** Um trecho de texto, e se ele é destacado (RN-VAR-018: o que veio de uma variável `sql`). */
export type Segment = { text: string; marked: boolean };

/**
 * Parte o texto nos trechos de dentro e de fora de `ranges` (posições UTF-16 do texto, em ordem). Uma faixa fora do texto é cortada nele, e a vazia some; as que se
 * sobrepõem se juntam. Sem faixas, o texto inteiro como um trecho só.
 */
export function segmentsOf(text: string, ranges: readonly { start: number; end: number }[] | undefined): Segment[] {
  if (ranges === undefined || ranges.length === 0) return [{ text, marked: false }];

  const segments: Segment[] = [];
  let at = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(at, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (end === start) continue;
    if (start > at) segments.push({ text: text.slice(at, start), marked: false });
    segments.push({ text: text.slice(start, end), marked: true });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), marked: false });
  return segments.length === 0 ? [{ text, marked: false }] : segments;
}
