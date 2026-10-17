import { describe, expect, it } from "vitest";

import { cachedReadOnly, connectionReadOnlyReason, readOnlyReasonNow } from "./grid-action-context";
import { recordsCopy } from "./records.copy";

describe("o somente leitura da conexão na tela (RN-PROT-002 e 003)", () => {
  const cache = (readOnly: boolean | null) => ({ getQueryData: (key: unknown) => (Array.isArray(key) && key[0] === "connections" && readOnly !== null ? [{ id: "c1", protections: { readOnly } }] : undefined) }) as never;

  it("cachedReadOnly: o da lista das conexões em cache; sem a lista, sem a conexão ou sem conexão, não", () => {
    expect(cachedReadOnly(cache(true), "c1")).toBe(true);
    expect(cachedReadOnly(cache(false), "c1")).toBe(false);
    expect(cachedReadOnly(cache(null), "c1")).toBe(false);
    expect(cachedReadOnly(cache(true), "c2")).toBe(false);
    expect(cachedReadOnly(cache(true), null)).toBe(false);
  });

  it("o motivo da conexão somente leitura é o que a API escreve na página", () => {
    expect(connectionReadOnlyReason).toBe("a conexão é somente leitura");
    expect(connectionReadOnlyReason).toBe(recordsCopy.edit.reasons.connectionReadOnly);
  });

  it("readOnlyReasonNow: o motivo dela só vale enquanto ela é somente leitura; desmarcada, a editabilidade é a que não se sabe", () => {
    expect(readOnlyReasonNow(connectionReadOnlyReason, true)).toBe(connectionReadOnlyReason);
    expect(readOnlyReasonNow(connectionReadOnlyReason, false)).toBeNull();
  });

  it("readOnlyReasonNow: os outros motivos valem sempre, e sem motivo continua sem (a conexão marcada depois da leitura: quem recusa é a API)", () => {
    expect(readOnlyReasonNow("união de consultas", false)).toBe("união de consultas");
    expect(readOnlyReasonNow("união de consultas", true)).toBe("união de consultas");
    expect(readOnlyReasonNow(null, true)).toBeNull();
    expect(readOnlyReasonNow(null, false)).toBeNull();
  });
});
