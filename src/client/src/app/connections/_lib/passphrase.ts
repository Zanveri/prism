import { transferCopy } from "./transfer.copy";

/**
 * O que conta como espaço nas pontas da senha de exportação (RN-TRANSF-004): U+0009 a U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 a U+200A, U+2028,
 * U+2029, U+202F, U+205F e U+3000 (o `White_Space` do Unicode, que é o `char.IsWhiteSpace` do .NET). A tela e a API usam esta lista, e não o `trim()` do
 * JavaScript, que tira também o U+FEFF e deixa o U+0085: a importação apara o que a exportação recusou nas pontas, e nada além disso.
 */
// `\t-\r` é U+0009 a U+000D.
const space = /[\t-\r\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/u.source;
const edgeSpace = new RegExp(`^${space}|${space}$`, "u");
const edgeSpaces = new RegExp(`^${space}+|${space}+$`, "gu");
/** O caractere de controle (a categoria `Cc`: U+0000 a U+001F e U+007F a U+009F). */
const control = /\p{Cc}/u;

/** Os tetos da senha de exportação, contados em unidades UTF-16, como a senha do Prism (RN-COFRE-010). */
export const passphraseMinLength = 12;
export const passphraseMaxLength = 128;

const exportErrors = transferCopy.export.passphraseErrors;
const importErrors = transferCopy.import.passphraseErrors;

/**
 * A senha de exportação como vai à API: na forma composta do Unicode (NFC), a mesma que a API usa. O "é" digitado de uma vez e o "é" colado como "e" mais o
 * acento são a mesma senha, e o arquivo exportado num sistema abre no outro (RN-TRANSF-004).
 */
export function exportPassphraseOf(typed: string): string {
  return typed.normalize("NFC");
}

/**
 * A recusa da senha de exportação que a pessoa cria (RN-TRANSF-004), conferida na forma NFC, ou `null` quando ela serve: de 12 a 128 caracteres, sem espaço
 * nas pontas e sem caractere de controle. Os espaços de dentro contam. São as mesmas regras e as mesmas frases da API (422 `EXPORT_PASSPHRASE_INVALID`).
 */
export function exportPassphraseError(typed: string): string | null {
  const passphrase = exportPassphraseOf(typed);
  if (passphrase === "") return exportErrors.required;
  if (passphrase.length < passphraseMinLength) return exportErrors.tooShort;
  if (passphrase.length > passphraseMaxLength) return exportErrors.tooLong;
  if (edgeSpace.test(passphrase)) return exportErrors.edgeSpace;
  if (control.test(passphrase)) return exportErrors.control;
  return null;
}

/** "Repita a senha de exportação": iguais na forma NFC, que é a que vai. Só a tela confere (a API recebe uma). */
export function samePassphrase(first: string, second: string): boolean {
  return exportPassphraseOf(first) === exportPassphraseOf(second);
}

/**
 * A senha de exportação digitada na importação, como vai à API (RN-TRANSF-009): sem os espaços das pontas (os da lista acima, que a cópia de uma mensagem
 * traz sem ninguém ver; a exportação os recusou, então nenhuma senha aceita muda) e na forma NFC.
 */
export function importPassphraseOf(typed: string): string {
  return typed.replace(edgeSpaces, "").normalize("NFC");
}

/** A recusa da senha digitada na importação, antes de ir (RN-TRANSF-010, etapa 2, a mesma da API): vazia, ou com mais de 128 caracteres. */
export function importPassphraseError(typed: string): string | null {
  const passphrase = importPassphraseOf(typed);
  if (passphrase === "") return importErrors.required;
  if (passphrase.length > passphraseMaxLength) return importErrors.tooLong;
  return null;
}
