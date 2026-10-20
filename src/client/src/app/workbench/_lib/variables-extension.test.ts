import { EditorState, type Extension } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import {
  AnalysisScheduler,
  analysisDelayMs,
  analysisEffect,
  analysisMaxDelayMs,
  clipped,
  connectVariables,
  currentAnalysis,
  hoverAt,
  lastDeclared,
  reanalyzeVariables,
  setShowVariableValues,
  setVariableValues,
  tailText,
  variablesDecorations,
  variablesEditor,
  type VariableEntry,
} from "./variables-extension";

const postgres: Engine = 1;

const extension: Extension = variablesEditor({ engine: () => postgres, blankLines: () => true });
const entry = (type: string, value: string, stale = false): VariableEntry => ({ type, value, stale });

/** O estado do editor com o texto lido (o que a leitura depois da pausa faz). */
function read(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [extension] });
  return state.update({ effects: analysisEffect(state, postgres, true) }).state;
}

/** O que há num conjunto de decorações: o trecho e a classe (ou, no valor do fim da linha, o texto). */
function listed(set: DecorationSet, doc: string) {
  const found: string[] = [];
  for (const cursor = set.iter(); cursor.value !== null; cursor.next()) {
    const spec = cursor.value.spec as { class?: string; widget?: { text: string } };
    found.push(spec.widget === undefined ? `${spec.class}:${doc.slice(cursor.from, cursor.to)}` : `valor@${cursor.from}:${spec.widget.text}`);
  }
  return found;
}

const values = (entries: Record<string, VariableEntry>) => new Map(Object.entries(entries));
const tails = (state: EditorState) => listed(variablesDecorations(state).tails, state.doc.toString());

describe("as marcas do editor (RN-VAR-025)", () => {
  it("a leitura entra no estado: as cores do let, do nome e do @nome, o erro e a dica sublinhados", () => {
    const state = read("let a = 1\nlet b = c\nSELECT @a, @x");
    const doc = state.doc.toString();

    expect(listed(variablesDecorations(state).marks, doc)).toEqual(["cm-var-keyword:let", "cm-var-name:a", "cm-var-keyword:let", "cm-var-name:b", "cm-var-name:@a"]);
    expect(listed(variablesDecorations(state).problems, doc)).toEqual(["cm-sql-error:c", "cm-var-hint:@x"]);
  });

  it("o @nome de uma variável sql leva a classe do sublinhado pontilhado", () => {
    const state = read("const t: sql = 'x'\nSELECT * FROM @t");

    expect(listed(variablesDecorations(state).marks, state.doc.toString())).toContain("cm-var-name cm-var-sql:@t");
  });

  it("entre uma leitura e a outra as marcas acompanham a edição, e a leitura de um texto de antes não vale", () => {
    const state = read("let a = 1\nSELECT @a");
    const edited = state.update({ changes: { from: 0, insert: "-- nota\n" } }).state;

    expect(listed(variablesDecorations(edited).marks, edited.doc.toString())).toEqual(["cm-var-keyword:let", "cm-var-name:a", "cm-var-name:@a"]);
    expect(currentAnalysis(state)).not.toBeNull();
    expect(currentAnalysis(edited)).toBeNull();

    // A leitura pedida para o texto de antes chega depois da edição: é descartada.
    const stale = analysisEffect(state, postgres, true);
    const after = edited.update({ effects: stale }).state;
    expect(currentAnalysis(after)).toBeNull();
    expect(listed(variablesDecorations(after).marks, after.doc.toString())).toEqual(listed(variablesDecorations(edited).marks, edited.doc.toString()));
  });

  it("a marca de um trecho apagado some junto com ele", () => {
    const state = read("let a = 1\nSELECT @a");
    const edited = state.update({ changes: { from: 10, to: 19 } }).state;

    expect(listed(variablesDecorations(edited).marks, edited.doc.toString())).toEqual(["cm-var-keyword:let", "cm-var-name:a"]);
  });

  it("os nomes declarados da última leitura continuam à mão mesmo depois de uma edição (o tipo da dica do ponteiro)", () => {
    const state = read("let a: number[] = [1]");
    const edited = state.update({ changes: { from: 0, insert: "x" } }).state;

    expect(lastDeclared(edited).get("a")?.type).toBe("number[]");
  });

  it("o texto grande demais não é lido: nada é pintado, e a leitura anterior se vai", () => {
    const big = `let a = 1\n${"x".repeat(350_000)}`;
    const state = read(big);

    expect(currentAnalysis(state)).toMatchObject({ skipped: true });
    expect(listed(variablesDecorations(state).marks, "")).toEqual([]);
  });
});

describe("o valor no fim da linha (RN-VAR-025)", () => {
  const source = "let a = 7\nconst nome = 'Ana'\nSELECT @a";

  it("depois de avaliada, a declaração mostra o valor, apagado, no fim da última linha dela", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7"), nome: entry("string", "'Ana'") })) }).state;

    expect(tails(state)).toEqual(["valor@9:= 7", "valor@28:= 'Ana'"]);
  });

  it("sem valor na aba, ou com o de antes de a declaração mudar, nada", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7", true) })) }).state;

    expect(tails(state)).toEqual([]);
  });

  it("corta em 60 caracteres, com reticências, e não escreve o que está vazio", () => {
    expect(tailText(entry("string", "x".repeat(100)))).toBe(`= ${"x".repeat(59)}…`);
    expect(tailText(entry("string", "x".repeat(60)))).toBe(`= ${"x".repeat(60)}`);
    expect(tailText(entry("string", ""))).toBeNull();
    expect(tailText(undefined)).toBeNull();
    expect(clipped("😀".repeat(5), 3)).toBe("😀😀…");
  });

  it("acompanha as mudanças do armazém, e a preferência liga e desliga sem perder a leitura", () => {
    let state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7") })) }).state;
    expect(tails(state)).toEqual(["valor@9:= 7"]);

    state = state.update({ effects: setVariableValues.of(values({ a: entry("number", "8") })) }).state;
    expect(tails(state)).toEqual(["valor@9:= 8"]);

    state = state.update({ effects: setShowVariableValues.of(false) }).state;
    expect(tails(state)).toEqual([]);
    state = state.update({ effects: setShowVariableValues.of(true) }).state;
    expect(tails(state)).toEqual(["valor@9:= 8"]);

    state = state.update({ effects: setVariableValues.of(new Map()) }).state;
    expect(tails(state)).toEqual([]);
  });

  it("some quando a pessoa muda a declaração, até a próxima leitura, e volta com ela", () => {
    let state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7"), nome: entry("string", "'Ana'") })) }).state;

    // Escrever no fim da declaração, trocar o valor dela, apagar um pedaço: a declaração mudou.
    for (const changes of [{ from: 9, insert: "0" }, { from: 8, to: 9, insert: "9" }, { from: 4, to: 5 }, { from: 0, insert: "x" }]) {
      const edited = state.update({ changes }).state;
      expect(tails(edited).filter((tail) => tail.includes("= 7")), JSON.stringify(changes)).toEqual([]);
      expect(tails(edited).filter((tail) => tail.includes("'Ana'")), JSON.stringify(changes)).toHaveLength(1);
    }

    // A leitura seguinte (300 ms) não devolve o valor de antes: o armazém só marca `stale` quando o texto chega à aba (400 ms), e o editor sabe por conta própria que mexeram.
    const edited = state.update({ changes: { from: 9, insert: "0" } }).state;
    state = edited.update({ effects: analysisEffect(edited, postgres, true) }).state;
    expect(tails(state)).toEqual(["valor@29:= 'Ana'"]);

    // A dica do ponteiro também diz "desatualizado" nesse meio tempo.
    expect(hoverAt(state, 4)?.lines.map((line) => line.text).join("\n")).toContain("desatualizado");

    // O armazém assume (stale) e depois traz a avaliação nova: o valor volta com ela.
    state = state.update({ effects: setVariableValues.of(values({ a: entry("number", "7", true), nome: entry("string", "'Ana'") })) }).state;
    expect(tails(state)).toEqual(["valor@29:= 'Ana'"]);
    state = state.update({ effects: setVariableValues.of(values({ a: entry("number", "70"), nome: entry("string", "'Ana'") })) }).state;
    expect(tails(state)).toEqual(["valor@10:= 70", "valor@29:= 'Ana'"]);
  });

  it("uma avaliação nova do armazém, sem passar pelo stale, solta o valor escondido, e desfazer a mudança também", () => {
    const base = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7") })) }).state;

    // Avaliada de novo (outro valor, `stale` nunca visto): o valor novo aparece.
    const edited = base.update({ changes: { from: 9, insert: "0" } }).state;
    const reread = edited.update({ effects: analysisEffect(edited, postgres, true) }).state;
    expect(tails(reread)).toEqual([]);
    expect(tails(reread.update({ effects: setVariableValues.of(values({ a: entry("number", "70") })) }).state)).toEqual(["valor@10:= 70"]);

    // Escrever e apagar o que escreveu: a declaração é a de antes, e o valor volta na leitura seguinte.
    const undone = edited.update({ changes: { from: 9, to: 10 } }).state;
    expect(tails(undone.update({ effects: analysisEffect(undone, postgres, true) }).state)).toEqual(["valor@9:= 7"]);
  });

  it("a quebra de linha escrita no fim da declaração, ou acima dela, não é mudar a declaração; a edição em outra linha também não", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7") })) }).state;

    for (const changes of [{ from: 9, insert: "\n" }, { from: 0, insert: "\n" }, { from: 10, insert: "-- x\n" }, { from: 34, insert: " AND 1 = 1" }]) {
      const edited = state.update({ changes }).state;
      expect(tails(edited).filter((tail) => tail.includes("= 7")), JSON.stringify(changes)).toHaveLength(1);
    }
  });

  it("o valor não é texto do documento: o texto do editor não muda", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ a: entry("number", "7") })) }).state;

    expect(state.doc.toString()).toBe(source);
  });
});

describe("a dica do ponteiro (RN-VAR-025)", () => {
  const source = "let cliente_id: number = 7\nlet depois: number\nSELECT * FROM t WHERE c = @cliente_id AND d = @depois AND e = @nada AND f = @cliente_id";
  const at = (text: string, nth = 0) => {
    let index = -1;
    for (let count = 0; count <= nth; count++) index = source.indexOf(text, index + 1);
    return index;
  };

  it("sobre o @nome ou o nome da declaração: o nome, o tipo e o valor de agora", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ cliente_id: entry("number", "7") })) }).state;

    expect(hoverAt(state, at("@cliente_id") + 3)?.lines).toEqual([{ kind: "variable", text: "cliente_id: number = 7" }]);
    expect(hoverAt(state, at("cliente_id") + 2)?.lines).toEqual([{ kind: "variable", text: "cliente_id: number = 7" }]);
    expect(hoverAt(state, at("@cliente_id") + 3)).toMatchObject({ from: at("@cliente_id"), to: at("@cliente_id") + "@cliente_id".length });
  });

  it("o valor de antes de a declaração mudar diz que está desatualizado, e o texto longo é cortado em 200 caracteres", () => {
    const state = read(source).update({ effects: setVariableValues.of(values({ cliente_id: entry("string", "x".repeat(300), true) })) }).state;

    const [line] = hoverAt(state, at("@cliente_id") + 3)!.lines;
    expect(line.text).toBe(`cliente_id: string = ${"x".repeat(199)}… · desatualizado`);
  });

  it("sem valor: o tipo da declaração e como calcular", () => {
    const state = read(source);

    expect(hoverAt(state, at("@depois") + 2)?.lines).toEqual([{ kind: "variable", text: "depois: number · ainda sem valor. Alt+X, ou Ctrl+Enter na declaração, calcula." }]);
  });

  it("o erro e a dica trazem a frase deles, o erro primeiro, e a variável por último", () => {
    const state = read("let a = 1\nSELECT @a, @nada, b\nlet z = c");

    expect(hoverAt(state, state.doc.toString().indexOf("@nada") + 2)?.lines).toEqual([{ kind: "hint", text: "@nada não é uma variável deste script, e vai ao banco como está." }]);
    expect(hoverAt(state, state.doc.toString().indexOf("= c") + 2)?.lines).toEqual([{ kind: "error", text: "c não foi declarada." }]);
  });

  it("fora de uma variável, de um erro e de uma dica, nada; e sem a leitura, nada", () => {
    const state = read(source);

    expect(hoverAt(state, at("SELECT"))).toBeNull();
    expect(hoverAt(EditorState.create({ doc: source }), 3)).toBeNull();
    expect(hoverAt(state, at("@cliente_id") + "@cliente_id".length)).toBeNull();
  });
});

describe("ligar o editor ao armazém dos valores (RN-VAR-025)", () => {
  it("entrega os valores de agora e cada mudança, enquanto o editor é o mesmo; desligar tira a assinatura", () => {
    let current = values({ a: entry("number", "1") });
    const listeners = new Set<() => void>();
    const store = {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const dispatched: unknown[] = [];
    let alive = true;
    const view = { dispatch: (spec: unknown) => void dispatched.push(spec) };

    const disconnect = connectVariables(view, store, () => alive);
    expect(dispatched).toHaveLength(1);
    expect(listeners.size).toBe(1);

    current = values({ a: entry("number", "2") });
    for (const listener of listeners) listener();
    expect(dispatched).toHaveLength(2);

    alive = false;
    for (const listener of listeners) listener();
    expect(dispatched).toHaveLength(2);

    disconnect();
    expect(listeners.size).toBe(0);
  });

  it("sem armazém, os valores se vão", () => {
    const dispatched: { effects: unknown }[] = [];
    const disconnect = connectVariables({ dispatch: (spec) => void dispatched.push(spec as { effects: unknown }) }, undefined, () => true);

    expect(dispatched).toHaveLength(1);
    expect(() => disconnect()).not.toThrow();
  });

  it("o efeito entra no estado de verdade", () => {
    const state = read("let a = 7").update({ effects: [setVariableValues.of(values({ a: entry("number", "7") })), reanalyzeVariables.of(null)] }).state;

    expect(tails(state)).toEqual(["valor@9:= 7"]);
  });
});

// A leitura só roda depois de uma pausa na digitação (RN-VAR-025: 300 ms), e o atraso cresce com o que ela custou: o script grande não é lido a cada pausa curta.
describe("a pausa antes de ler (RN-VAR-025)", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function scheduler(cost = 0) {
    let clock = 0;
    const runs: number[] = [];
    const instance = new AnalysisScheduler(
      () => {
        runs.push(clock);
        clock += cost;
      },
      { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => clock },
    );
    return { instance, runs, tick: (milliseconds: number) => void vi.advanceTimersByTime(milliseconds) };
  }

  it("lê uma vez, 300 ms depois do último pedido: a digitação contínua nunca lê", () => {
    const { instance, runs, tick } = scheduler();

    expect(analysisDelayMs).toBe(300);
    for (let key = 0; key < 10; key++) {
      instance.request();
      if (key < 9) tick(100);
    }
    expect(runs).toHaveLength(0);

    tick(299);
    expect(runs).toHaveLength(0);
    tick(1);
    expect(runs).toHaveLength(1);
  });

  it("o primeiro pedido de um editor novo, e a mudança de banco, não esperam a pausa", () => {
    const { instance, runs, tick } = scheduler();

    instance.request(0);
    tick(0);
    expect(runs).toHaveLength(1);
  });

  it("a leitura cara empurra a seguinte: quatro vezes o custo, de 300 ms até 2 s", () => {
    const slow = scheduler(200);
    slow.instance.request();
    slow.tick(300);
    expect(slow.instance.delay).toBe(800);

    const slowest = scheduler(5000);
    slowest.instance.request();
    slowest.tick(300);
    expect(slowest.instance.delay).toBe(analysisMaxDelayMs);

    const fast = scheduler(10);
    fast.instance.request();
    fast.tick(300);
    expect(fast.instance.delay).toBe(300);
  });

  it("cancelar tira o pedido, e um pedido novo no lugar do antigo lê uma vez só", () => {
    const { instance, runs, tick } = scheduler();

    instance.request();
    instance.cancel();
    tick(1000);
    expect(runs).toHaveLength(0);

    instance.request();
    instance.request();
    tick(1000);
    expect(runs).toHaveLength(1);
  });

  it("uma leitura que lança conta o custo e deixa o pedido seguinte livre", () => {
    let calls = 0;
    const instance = new AnalysisScheduler(() => {
      if (++calls === 1) throw new Error("falha");
    });

    instance.request(0);
    expect(() => vi.advanceTimersByTime(0)).toThrow();
    instance.request(0);
    vi.advanceTimersByTime(0);
    expect(calls).toBe(2);
  });
});
