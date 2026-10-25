/**
 * O texto de um trecho de HTML, sem as marcas (de `<` até o `>` que a fecha). Percorre os caracteres em vez de trocar por
 * expressão regular, que numa só passada deixa marca para trás quando uma sobra dentro da outra (`<<b>b>`). Só para testes.
 */
export function stripTags(markup: string): string {
  let text = "";
  let inTag = false;

  for (const char of markup) {
    if (char === "<") inTag = true;
    else if (char === ">" && inTag) inTag = false;
    else if (!inTag) text += char;
  }

  return text;
}

/**
 * Tira do texto o marcador do cursor (`|`) e diz onde ele estava. Tira só aquele caractere, na posição achada: o SQL tem o
 * operador `||`, e um `|` que vem depois do marcador fica no texto (o marcador é o primeiro `|`). Sem marcador, devolve o texto como veio e `at` em -1. Só para testes.
 */
export function withoutCursor(text: string, marker = "|"): { doc: string; at: number } {
  const at = text.indexOf(marker);
  if (at < 0) return { doc: text, at };

  return { doc: text.slice(0, at) + text.slice(at + marker.length), at };
}
