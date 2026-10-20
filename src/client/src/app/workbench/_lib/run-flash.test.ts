import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { clearRunFlash, flashedRange, flashRun, runFlash, runFlashMs } from "./run-flash";

// RN-SQL-018: o destaque do trecho enviado. O vitest não tem DOM: o que se confere é o estado do editor, onde o destaque mora (a vista só o desenha, e o
// relógio que o apaga manda `clearRunFlash`).
const stateOf = (doc: string) => EditorState.create({ doc, extensions: [runFlash] });
/** O trecho, sem o número do destaque. */
const rangeOf = (state: EditorState) => {
  const flashed = flashedRange(state);
  return flashed === null ? null : { from: flashed.from, to: flashed.to };
};

describe("o destaque do comando enviado (RN-SQL-018)", () => {
  it("começa apagado, e flashRun destaca exatamente o trecho, sem mudar o texto, o cursor nem a seleção", () => {
    const state = stateOf("SELECT 1\n\nSELECT 2");
    expect(rangeOf(state)).toBeNull();

    const flashed = state.update({ effects: flashRun(10, 18) }).state;
    expect(rangeOf(flashed)).toEqual({ from: 10, to: 18 });
    expect(flashed.doc.toString()).toBe("SELECT 1\n\nSELECT 2");
    expect(flashed.selection.main).toEqual(state.selection.main);
  });

  it("o destaque novo toma o lugar do anterior, e clearRunFlash o apaga", () => {
    const first = stateOf("SELECT 1\n\nSELECT 2").update({ effects: flashRun(0, 8) }).state;
    const second = first.update({ effects: flashRun(10, 18) }).state;

    expect(rangeOf(second)).toEqual({ from: 10, to: 18 });
    expect(rangeOf(second.update({ effects: clearRunFlash }).state)).toBeNull();
  });

  it("qualquer edição o apaga, porque o trecho era o do texto enviado; mover o cursor, não", () => {
    const flashed = stateOf("SELECT 1").update({ effects: flashRun(0, 8) }).state;

    expect(rangeOf(flashed.update({ selection: { anchor: 3 } }).state)).toEqual({ from: 0, to: 8 });
    expect(rangeOf(flashed.update({ changes: { from: 8, insert: ";" } }).state)).toBeNull();
  });

  it("trecho vazio não destaca nada, e o que passa do fim do texto para no fim", () => {
    expect(rangeOf(stateOf("SELECT 1").update({ effects: flashRun(4, 4) }).state)).toBeNull();
    expect(rangeOf(stateOf("SELECT 1").update({ effects: flashRun(0, 8) }).state.update({ effects: flashRun(5, 5) }).state)).toBeNull();
    expect(rangeOf(stateOf("SELECT 1").update({ effects: flashRun(2, 99) }).state)).toEqual({ from: 2, to: 8 });
  });

  it("dois destaques seguidos no mesmo trecho são marcas diferentes: o editor redesenha a segunda, e ela pisca de novo", () => {
    const first = stateOf("SELECT 1").update({ effects: flashRun(0, 8) }).state;
    const second = first.update({ effects: flashRun(0, 8) }).state;

    expect(flashedRange(second)?.serial).not.toBe(flashedRange(first)?.serial);
  });

  it("é breve: some em menos de um segundo", () => {
    expect(runFlashMs).toBeGreaterThan(0);
    expect(runFlashMs).toBeLessThan(1000);
  });
});
