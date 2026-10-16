import { describe, expect, it } from "vitest";

import { exportPassphraseError, exportPassphraseOf, importPassphraseError, importPassphraseOf, samePassphrase } from "./passphrase";
import { transferCopy } from "./transfer.copy";

const exportErrors = transferCopy.export.passphraseErrors;
const importErrors = transferCopy.import.passphraseErrors;

// Os mesmos casos de teste valem na tela e na API (RN-TRANSF-004): a lista dos espaços das pontas é a do `White_Space` do Unicode, e não o `trim()` do
// JavaScript (que tira o U+FEFF e deixa o U+0085) nem o `Trim()` do .NET.
const twelve = "senha-de-exp";
const composed = "caf\u00E9-exportado";
const decomposed = "cafe\u0301-exportado";
// A lista inteira da RN-TRANSF-004: U+0009 a U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 a U+200A, U+2028, U+2029, U+202F, U+205F e U+3000.
const edgeSpaces = [
  ...["0009", "000A", "000B", "000C", "000D", "0020", "0085", "00A0", "1680"],
  ...["2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "200A"],
  ...["2028", "2029", "202F", "205F", "3000"],
].map((code) => [code, String.fromCharCode(Number.parseInt(code, 16))] as const);
const bom = "\uFEFF";

describe("exportPassphraseError: a senha de exportação que a pessoa cria (RN-TRANSF-004)", () => {
  it("de 12 a 128 caracteres, contados em unidades UTF-16 como a senha do Prism, sem regra de composição", () => {
    expect(exportPassphraseError("")).toBe(exportErrors.required);
    expect(exportPassphraseError("a".repeat(11))).toBe(exportErrors.tooShort);
    expect(exportPassphraseError("a".repeat(12))).toBeNull();
    expect(exportPassphraseError("a".repeat(128))).toBeNull();
    expect(exportPassphraseError("a".repeat(129))).toBe(exportErrors.tooLong);
    // Um emoji conta dois: 6 emojis são 12 unidades.
    expect(exportPassphraseError("\u{1F511}".repeat(6))).toBeNull();
    expect(exportPassphraseError("\u{1F511}".repeat(5) + "a")).toBe(exportErrors.tooShort);
  });

  it("conta na forma NFC: o “é” colado como “e” mais o acento conta um", () => {
    // 11 unidades na forma composta, 12 na decomposta: é a composta que conta.
    expect(exportPassphraseError("senha-caf\u00E9x")).toBe(exportErrors.tooShort);
    expect(exportPassphraseError("senha-cafe\u0301x")).toBe(exportErrors.tooShort);
  });

  it.each(edgeSpaces)("não começa nem termina com o espaço U+%s", (_code, space) => {
    expect(exportPassphraseError(space + twelve)).toBe(exportErrors.edgeSpace);
    expect(exportPassphraseError(twelve + space)).toBe(exportErrors.edgeSpace);
  });

  it("os espaços de dentro contam, e o U+FEFF nas pontas não é espaço (o `trim()` do JavaScript o tiraria)", () => {
    expect(exportPassphraseError("senha com espaços dentro")).toBeNull();
    expect(exportPassphraseError(bom + twelve)).toBeNull();
  });

  it("não tem caractere de controle, nem dentro (a tabulação no meio também é recusada)", () => {
    expect(exportPassphraseError("senha\u0000-de-exportação")).toBe(exportErrors.control);
    expect(exportPassphraseError("senha\tde-exportação")).toBe(exportErrors.control);
    expect(exportPassphraseError("senha\u0085de-exportação")).toBe(exportErrors.control);
    expect(exportPassphraseError("senha\u007Fde-exportação")).toBe(exportErrors.control);
  });

  it("a senha vai à API na forma NFC", () => {
    expect(exportPassphraseOf(decomposed)).toBe(composed);
  });
});

describe("samePassphrase: “Repita a senha de exportação”, só na tela", () => {
  it("as duas são iguais na forma NFC: o “é” de uma vez num campo e o “e” mais o acento no outro", () => {
    expect(samePassphrase(composed, decomposed)).toBe(true);
    expect(samePassphrase(composed, `${composed} `)).toBe(false);
    expect(samePassphrase("Senha-de-exportação", "senha-de-exportação")).toBe(false);
  });
});

describe("importPassphraseOf e importPassphraseError: a senha digitada na importação (RN-TRANSF-009 e 010)", () => {
  it.each(edgeSpaces)("perde o espaço U+%s das pontas, que a cópia de uma mensagem traz", (_code, space) => {
    expect(importPassphraseOf(`${space}${space}${twelve}${space}`)).toBe(twelve);
  });

  it("não perde o U+FEFF nem os espaços de dentro, e passa à forma NFC", () => {
    expect(importPassphraseOf(`${bom}senha de exp${bom}`)).toBe(`${bom}senha de exp${bom}`);
    expect(importPassphraseOf(` ${decomposed} `)).toBe(composed);
  });

  it("vazia (só com espaços) ou com mais de 128 caracteres é recusada antes de ir, sem derivar nada", () => {
    expect(importPassphraseError("")).toBe(importErrors.required);
    expect(importPassphraseError(" \u00A0\u3000 ")).toBe(importErrors.required);
    expect(importPassphraseError("a".repeat(128))).toBeNull();
    expect(importPassphraseError(` ${"a".repeat(128)} `)).toBeNull();
    expect(importPassphraseError("a".repeat(129))).toBe(importErrors.tooLong);
    // Na importação não há mínimo: quem decide se a senha confere é a cifra.
    expect(importPassphraseError("x")).toBeNull();
  });

  it("toda senha que a exportação aceitou chega igual à importação", () => {
    for (const passphrase of [twelve, composed, "senha com espaços dentro", bom + twelve, "\u{1F511}".repeat(6)]) {
      expect(exportPassphraseError(passphrase)).toBeNull();
      expect(importPassphraseOf(passphrase)).toBe(exportPassphraseOf(passphrase));
    }
  });
});
