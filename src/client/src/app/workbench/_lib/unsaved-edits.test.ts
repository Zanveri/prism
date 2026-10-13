import { beforeEach, describe, expect, it, vi } from "vitest";

import { unsavedEdits, unsavedQuestion } from "./unsaved-edits";

beforeEach(() => unsavedEdits.forgetExcept(new Set()));

describe("as alterações não salvas de cada aba (RN-EDIT-007)", () => {
  it("a vista Registros diz quantas tem e como salvá-las; zero tira a aba do registro", () => {
    const save = vi.fn(async () => true);
    unsavedEdits.set("t1", { count: 2, save });

    expect(unsavedEdits.countOf("t1")).toBe(2);
    expect(unsavedEdits.saveOf("t1")).toBe(save);

    unsavedEdits.set("t1", null);
    expect(unsavedEdits.countOf("t1")).toBe(0);
    expect(unsavedEdits.saveOf("t1")).toBeNull();
  });

  it("a aba que fecha leva as pendências dela: o provedor esquece as abas que não existem mais", () => {
    unsavedEdits.set("t1", { count: 1, save: async () => true });
    unsavedEdits.set("t2", { count: 3, save: async () => true });

    unsavedEdits.forgetExcept(new Set(["t2"]));

    expect([unsavedEdits.countOf("t1"), unsavedEdits.countOf("t2")]).toEqual([0, 3]);
  });
});

describe("a pergunta antes de fechar abas com alterações não salvas (RN-EDIT-007)", () => {
  it("sem pendências nas abas que fecham, não pergunta", () => {
    unsavedEdits.set("t9", { count: 4, save: async () => true });

    expect(unsavedQuestion(["t1", "t2"], unsavedEdits.countOf)).toBeNull();
  });

  it("fechar uma aba com pendências pergunta com Salvar, Descartar e Cancelar", () => {
    unsavedEdits.set("t1", { count: 2, save: async () => true });

    expect(unsavedQuestion(["t1"], unsavedEdits.countOf)).toEqual({ count: 2, canSave: true });
  });

  it("fechar várias pergunta uma vez, com a soma, e só Descartar e Cancelar", () => {
    unsavedEdits.set("t1", { count: 2, save: async () => true });
    unsavedEdits.set("t3", { count: 1, save: async () => true });

    expect(unsavedQuestion(["t1", "t2", "t3"], unsavedEdits.countOf)).toEqual({ count: 3, canSave: false });
  });
});
