/**
 * O que um campo numérico das Configurações aceita: um inteiro sem sinal, sem casas e sem unidade, dentro do intervalo.
 * Devolve o número, ou `null` se o texto não serve. Espaços nas pontas não contam.
 */
export function parseWholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}
