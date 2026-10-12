import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultPreferences, dueForStartupCheck, parsePreferences, readPreferences, writePreferences } from "./preferences";

const now = new Date("2026-10-10T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe("parsePreferences (RN-ATUALIZA-007): arquivo ilegível ou adulterado vale como o padrão", () => {
  it("lê as quatro preferências", () => {
    const text = JSON.stringify({ checkOnStartup: false, skippedVersion: "0.2.0", lastCheckedAt: "2026-10-10T08:00:00.000Z", receiveBeta: true });

    expect(parsePreferences(text)).toEqual({ checkOnStartup: false, skippedVersion: "0.2.0", lastCheckedAt: "2026-10-10T08:00:00.000Z", receiveBeta: true });
  });

  it("o padrão: verificar ao abrir, nenhuma versão pulada, nunca consultou, e sem as versões beta", () => {
    expect(defaultPreferences).toEqual({ checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false });
  });

  it("'Receber versões beta' (RN-ATUALIZA-010): ausente ou fora do formato vale desligado, e o arquivo de antes do canal beta continua valendo", () => {
    for (const receiveBeta of [undefined, "true", 1, null, {}, [], "sim"]) expect(parsePreferences(JSON.stringify({ receiveBeta })).receiveBeta, JSON.stringify(receiveBeta)).toBe(false);
    expect(parsePreferences(JSON.stringify({ receiveBeta: true })).receiveBeta).toBe(true);
    expect(parsePreferences(JSON.stringify({ checkOnStartup: false, skippedVersion: "0.2.0", lastCheckedAt: "2026-10-10T08:00:00.000Z" }))).toEqual({ checkOnStartup: false, skippedVersion: "0.2.0", lastCheckedAt: "2026-10-10T08:00:00.000Z", receiveBeta: false });
  });

  it("o que não é JSON, ou não é um objeto, vale como o padrão", () => {
    for (const text of ["", "{", "não é json", "null", "42", "[]", '"texto"', "\u0000\u0001"]) expect(parsePreferences(text), JSON.stringify(text)).toEqual(defaultPreferences);
  });

  it("cada campo fora do formato vale como o padrão dele, e os outros ficam", () => {
    expect(parsePreferences(JSON.stringify({ checkOnStartup: "false", skippedVersion: "0.2.0" }))).toEqual({ ...defaultPreferences, skippedVersion: "0.2.0" });
    expect(parsePreferences(JSON.stringify({ checkOnStartup: false, skippedVersion: 2 }))).toEqual({ ...defaultPreferences, checkOnStartup: false });
  });

  it("a versão pulada pode ser um beta: 'Pular esta versão' vale igual nos dois canais", () => {
    expect(parsePreferences(JSON.stringify({ skippedVersion: "0.3.0-beta.2" })).skippedVersion).toBe("0.3.0-beta.2");
  });

  it("versão pulada que não é a de uma release (X.Y.Z ou X.Y.Z-beta.N) é descartada", () => {
    for (const skippedVersion of ["v0.2.0", "0.2", "../x", "0.2.0-alpha.1", "0.2.0-beta", "0.2.0-beta.1/../x", "0.2.0\n", "<script>", {}, []]) expect(parsePreferences(JSON.stringify({ skippedVersion })).skippedVersion, JSON.stringify(skippedVersion)).toBeNull();
  });

  it("hora da última consulta que não é uma data é descartada", () => {
    for (const lastCheckedAt of ["ontem", "", 42, {}, "2026-99-99T00:00:00Z"]) expect(parsePreferences(JSON.stringify({ lastCheckedAt })).lastCheckedAt).toBeNull();
  });
});

describe("dueForStartupCheck (RN-ATUALIZA-002): no máximo uma consulta a cada 24 horas", () => {
  it("quem nunca consultou consulta", () => {
    expect(dueForStartupCheck(defaultPreferences, now)).toBe(true);
  });

  it("menos de 24 horas depois da última, não consulta; a partir de 24 horas, consulta", () => {
    expect(dueForStartupCheck({ ...defaultPreferences, lastCheckedAt: hoursAgo(1) }, now)).toBe(false);
    expect(dueForStartupCheck({ ...defaultPreferences, lastCheckedAt: hoursAgo(23.99) }, now)).toBe(false);
    expect(dueForStartupCheck({ ...defaultPreferences, lastCheckedAt: hoursAgo(24) }, now)).toBe(true);
    expect(dueForStartupCheck({ ...defaultPreferences, lastCheckedAt: hoursAgo(240) }, now)).toBe(true);
  });

  it("com 'não verificar ao abrir', nunca", () => {
    expect(dueForStartupCheck({ ...defaultPreferences, checkOnStartup: false }, now)).toBe(false);
  });

  it("uma hora no futuro (relógio mexido, arquivo adulterado) não adia a consulta para sempre", () => {
    expect(dueForStartupCheck({ ...defaultPreferences, lastCheckedAt: hoursAgo(-48) }, now)).toBe(true);
  });
});

describe("o arquivo de preferências", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-prefs-"));
  const file = join(dir, "update-preferences.json");
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("grava e lê de volta; a pasta é criada se não existe", () => {
    const preferences = { checkOnStartup: false, skippedVersion: "0.3.0", lastCheckedAt: now.toISOString(), receiveBeta: true };
    writePreferences(file, preferences);

    expect(readPreferences(file)).toEqual(preferences);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(preferences);
  });

  it("arquivo que não existe, ilegível ou que é uma pasta: o padrão, sem derrubar nada", () => {
    expect(readPreferences(file)).toEqual(defaultPreferences);

    mkdirSync(file, { recursive: true });
    expect(readPreferences(file)).toEqual(defaultPreferences);
  });

  it("arquivo adulterado: o padrão", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '{"checkOnStartup": false, "skippedVersion": "../../x"');

    expect(readPreferences(file)).toEqual(defaultPreferences);
  });
});
