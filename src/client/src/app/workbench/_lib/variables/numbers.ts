/*
 * Os números da linguagem (RN-VAR-005): o `number` é o `double` do JavaScript, e o texto exato de um número que veio do banco ou foi escrito no script anda
 * junto com ele, para ir ao banco inteiro enquanto nenhuma conta o mudar.
 */

/** O maior inteiro que o JavaScript conta sem perder precisão, escrito como a frase do erro o mostra. */
export const maxSafeIntegerText = "9.007.199.254.740.991";

/** Um decimal como `dígitos × 10^expoente`, sem zeros à esquerda nem à direita nos dígitos: a forma em que dois decimais escritos diferente se comparam. */
type Decimal = { negative: boolean; digits: string; exponent: number };

const decimalText = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** O decimal que `text` escreve, ou `null` quando o texto não é um número (`1_000` e o resto da gramática já foram resolvidos antes de chegar aqui). */
function decimalOf(text: string): Decimal | null {
  const match = decimalText.exec(text);
  if (match === null || (match[2] === "" && (match[3] ?? "") === "")) return null;

  const integer = match[2];
  const fraction = match[3] ?? "";
  let digits = integer + fraction;
  let exponent = Number(match[4] ?? 0) - fraction.length;

  const leading = /^0*/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(leading);
  // Um laço de trás para frente: `/0*$/` é quadrática numa corrida longa de zeros seguida de outro dígito, e um texto de 60 mil dígitos travaria a
  // tela por segundos (RN-VAR-013, 014), sem o Meter poder interromper uma chamada nativa.
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end -= 1;
  if (end < digits.length) {
    exponent += digits.length - end;
    digits = digits.slice(0, end);
  }
  return digits === "" ? { negative: false, digits: "", exponent: 0 } : { negative: match[1] === "-", digits, exponent };
}

/**
 * Se o `double` mais próximo de `text` escreve o mesmo número (RN-VAR-005): `12.50`, `100.00`, `1e3` e `0.1` são exatos; `9007199254740993` e
 * `1234567890123.4567` não são. Os dois lados se comparam como decimais, sem os zeros à esquerda e sem os do fim depois do ponto.
 */
export function isExactNumber(text: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const written = decimalOf(text);
  const rounded = decimalOf(String(value));
  return written !== null && rounded !== null && written.negative === rounded.negative && written.digits === rounded.digits && written.exponent === rounded.exponent;
}

/** O texto de um número escrito no script na forma canônica (RN-VAR-005): sem `_` nem `+`, com o zero antes do ponto (`.5` vai `0.5`). */
export function canonicalNumberText(raw: string): string {
  // O caminho comum, o número escrito já na forma canônica: não há o que trocar.
  if (!/[_+]|^\./.test(raw)) return raw;
  let text = raw.replaceAll("_", "");
  if (text.startsWith(".")) text = `0${text}`;
  return text.replace(/^\+/, "").replace(/([eE])\+/, "$1");
}

/** O número com milhares separados por ponto, como a frase do erro o escreve (`9.007.199.254.740.991`). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Se o texto de um número é um inteiro (sem ponto nem expoente), para escolher a frase do erro de precisão. */
export const isIntegerText = (text: string): boolean => /^[+-]?\d+$/.test(text);

/** Quantos dígitos significativos o texto de um número tem, para o limite do `DECIMAL` do Db2 e do Informix (31): os zeros à esquerda da parte inteira não contam. */
export function significantDigits(text: string): number {
  const match = /^[+-]?(\d*)(?:\.(\d*))?/.exec(text);
  const integer = (match?.[1] ?? "").replace(/^0+/, "");
  return integer.length + (match?.[2] ?? "").length;
}
