import { Fragment } from "react";

import { segmentsOf } from "../_lib/highlight-ranges";

/**
 * O texto do comando com o trecho que veio de uma variável `sql` no fundo de atenção (RN-VAR-018), no "SQL enviado" e na pergunta da proteção. O realce não muda
 * o texto: quem lê (e copia) vê os mesmos caracteres.
 */
export function HighlightedSql({ text, ranges }: { text: string; ranges?: readonly { start: number; end: number }[] }) {
  return (
    <>
      {segmentsOf(text, ranges).map((segment, index) =>
        segment.marked ? (
          <mark key={index} className="rounded-sm bg-accent/20 text-inherit">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
