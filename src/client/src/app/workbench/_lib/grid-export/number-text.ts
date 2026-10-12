/** A gramática do número do JSON (sem `+`, sem zero à esquerda, sem `.5` nem `5.`, só os dígitos de 0 a 9): o que o JSON e a planilha aceitam como número escrito. */
export const strictNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Um número escrito como texto (`12.50`, `1e5`, `100`, `-0.5`) em partes: o sinal, os dígitos SIGNIFICATIVOS (sem os zeros da frente e sem os do fim) e o
 * expoente do último deles. `null` quando o texto não é um decimal. Vazio em `digits` é o zero.
 */
export function decimalParts(text: string): { sign: string; digits: string; exponent: number } | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match === null) return null;

  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const digits = (whole + fraction).replace(/^0+/, "");
  const significant = digits.replace(/0+$/, "");

  return { sign, digits: significant, exponent: Number(exponent) - fraction.length + (digits.length - significant.length) };
}
