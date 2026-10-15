import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { takeAttempt, writeAttempt } from "./install-attempt";

describe("a atualização que o Prism mandou instalar (RN-INSTALA-003)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prism-attempt-"));
    file = join(dir, "update-attempt.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("grava de que versão para qual, e se a instalação é para todos", () => {
    writeAttempt(file, { from: "0.3.0", to: "0.3.1", forAllUsers: true });

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ from: "0.3.0", to: "0.3.1", forAllUsers: true });
  });

  it("abriu de novo na versão de antes: a atualização não foi instalada, e o aviso diz qual era e em qual o Prism continua", () => {
    writeAttempt(file, { from: "0.3.0", to: "0.3.1", forAllUsers: true });

    expect(takeAttempt(file, "0.3.0")).toEqual({ version: "0.3.1", current: "0.3.0", forAllUsers: true });
    expect(existsSync(file)).toBe(false);
  });

  it("vale uma vez: lido, o arquivo some, e a abertura seguinte não avisa de novo", () => {
    writeAttempt(file, { from: "0.3.0", to: "0.3.1", forAllUsers: false });

    expect(takeAttempt(file, "0.3.0")).toEqual({ version: "0.3.1", current: "0.3.0", forAllUsers: false });
    expect(takeAttempt(file, "0.3.0")).toBeNull();
  });

  it("abriu na versão nova: foi instalada, e não há aviso", () => {
    writeAttempt(file, { from: "0.3.0", to: "0.3.1", forAllUsers: true });

    expect(takeAttempt(file, "0.3.1")).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("abriu numa terceira versão (outra instalação passou por cima): o registro não diz nada dela, e não há aviso", () => {
    writeAttempt(file, { from: "0.3.0", to: "0.3.1", forAllUsers: true });

    expect(takeAttempt(file, "0.4.0")).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it("sem arquivo, nada", () => {
    expect(takeAttempt(file, "0.3.0")).toBeNull();
  });

  it("um arquivo que não é o que o Prism grava não vira aviso, e sai", () => {
    for (const content of ["{", "null", "[]", JSON.stringify({ from: "0.3.0", to: "<b>0.3.1</b>", forAllUsers: true }), JSON.stringify({ from: "0.3.0", to: "0.3.1", forAllUsers: "sim" }), JSON.stringify({ from: "0.3.0", to: "0.3.1" }), JSON.stringify({ from: "0.3.0", to: `0.3.1-${"x".repeat(200)}`, forAllUsers: true })]) {
      writeFileSync(file, content);
      expect(takeAttempt(file, "0.3.0"), content).toBeNull();
      expect(existsSync(file), content).toBe(false);
    }
  });

  it("um beta também conta", () => {
    writeAttempt(file, { from: "0.3.0-beta.2", to: "0.3.0-beta.3", forAllUsers: false });

    expect(takeAttempt(file, "0.3.0-beta.2")).toEqual({ version: "0.3.0-beta.3", current: "0.3.0-beta.2", forAllUsers: false });
  });
});
