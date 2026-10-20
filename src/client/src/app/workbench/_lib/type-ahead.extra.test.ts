import { describe, expect, it } from "vitest";

import { noTypeAhead, typeAheadStep, type TypeAheadState } from "./type-ahead";

// Casos de tabela escritos a partir da RN-ARVORE-009 (docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md), não da execução do módulo.

/** Uma tecla: o caractere, ou o caractere com o instante (ms) em que foi digitado. Sem instante, cada tecla vem 100 ms depois da anterior. */
type Press = string | [key: string, at: number];

/** Digita as teclas na ordem, como a árvore: o foco vai ao item achado e fica onde está se nenhum casa. */
function pressAll(keys: readonly Press[], list: readonly string[], current: number, start: TypeAheadState = noTypeAhead) {
  let state = start;
  let focus = current;
  let clock = 0;
  const targets: (number | null)[] = [];

  for (const press of keys) {
    const key = typeof press === "string" ? press : press[0];
    const at = typeof press === "string" ? (clock += 100) : press[1];
    const step = typeAheadStep(state, key, at, list, focus);
    state = step.state;
    if (step.target !== null) focus = step.target;
    targets.push(step.target);
  }
  return { targets, state, focus };
}

describe("a última letra da lista e a volta ao começo (RN-ARVORE-009)", () => {
  // `ajuda` é o último item e tem o foco: a volta ao começo acha `alfa` (índice 0) para a letra `a`.
  const list = ["alfa", "bravo", "ajuda"];

  it("uma letra com o foco no último: a procura volta ao começo e acha o primeiro que começa por ela", () => {
    expect(typeAheadStep(noTypeAhead, "a", 0, list, 2).target).toBe(0);
    expect(typeAheadStep(noTypeAhead, "b", 0, list, 2).target).toBe(1);
  });

  it("um texto de várias letras com o foco no último também volta ao começo", () => {
    expect(typeAheadStep({ text: "br", at: 0 }, "a", 500, list, 2)).toEqual({ state: { text: "bra", at: 500 }, target: 1 });
  });

  it("depois de voltar ao começo, o texto segue e chega ao item do fim da lista", () => {
    // `a` acha `alfa` pela volta; `aj` procura a partir de `alfa` e chega a `ajuda`, que é o último.
    expect(pressAll(["a", "j"], list, 2).targets).toEqual([0, 2]);
  });
});

describe("o texto de várias letras que casa com o item atual fica nele (RN-ARVORE-009)", () => {
  const list = ["batch_pallet_items", "batch_produced_stock_pallet_items", "batch_products", "customers"];

  it("o atual casa com o texto inteiro: o foco fica nele", () => {
    expect(typeAheadStep({ text: "bat", at: 0 }, "c", 500, list, 1)).toEqual({ state: { text: "batc", at: 500 }, target: 1 });
    expect(typeAheadStep({ text: "batch_pr", at: 0 }, "o", 500, list, 1)).toEqual({ state: { text: "batch_pro", at: 500 }, target: 1 });
  });

  it("o atual é olhado antes dos de cima: `batch_` casa com o item 0 e com o 1, e o foco fica no 1", () => {
    expect(typeAheadStep({ text: "batch", at: 0 }, "_", 500, list, 1).target).toBe(1);
  });
});

describe("o texto de várias letras que não casa com nada: o foco fica (RN-ARVORE-009)", () => {
  const list = ["batch_pallet_items", "batch_produced_stock_pallet_items", "batch_products", "customers"];

  it("a letra que quebra o casamento não move o foco, e o texto segue para o que vier", () => {
    expect(typeAheadStep({ text: "bat", at: 0 }, "x", 500, list, 2)).toEqual({ state: { text: "batx", at: 500 }, target: null });
  });

  it("digitando `batx` a partir de `customers`: o foco vai a `batch…` com o `b`, fica nele com `ba` e `bat`, e não sai com o `x`", () => {
    expect(pressAll(["b", "a", "t", "x"], list, 3)).toMatchObject({ targets: [0, 0, 0, null], focus: 0, state: { text: "batx" } });
  });
});

describe("a janela de 1 segundo na borda (RN-ARVORE-009)", () => {
  const list = ["bola", "bala", "alfa"];

  it.each<[string, number, string, number]>([
    ["exatamente 1000 ms: a segunda letra se junta à primeira, e `ba` acha `bala`", 1000, "ba", 1],
    ["1001 ms: a primeira letra já passou do prazo, e `a` sozinho acha `alfa`", 1001, "a", 2],
  ])("%s", (_name, gap, text, expected) => {
    expect(typeAheadStep({ text: "b", at: 0 }, "a", gap, list, 0)).toEqual({ state: { text, at: gap }, target: expected });
  });

  it("o prazo conta de uma tecla para a outra: em 1000 ms o texto `ba` vale; em 1001 ms, `a` começa de novo", () => {
    expect(pressAll([["b", 0], ["a", 1000]], list, 0).targets).toEqual([1, 1]);
    expect(pressAll([["b", 0], ["a", 1001]], list, 0).targets).toEqual([1, 2]);
  });
});

describe("a mesma letra repetida com um item só (RN-ARVORE-009)", () => {
  const list = ["alfa", "bravo", "charlie"];

  it("o único item com a letra fica com o foco, quantas vezes a letra vier", () => {
    expect(pressAll(["a", "a", "a"], list, 0).targets).toEqual([0, 0, 0]);
    expect(pressAll(["a", "a"], list, 2).targets).toEqual([0, 0]);
  });

  it("o único item é o próprio atual: a letra repetida dá a volta e volta a ele", () => {
    expect(pressAll(["c", "c"], list, 0).targets).toEqual([2, 2]);
  });
});

describe("a letra repetida que vira texto (RN-ARVORE-009)", () => {
  const list = ["bravo", "bbalde", "bala", "bbalao", "alfa"];

  it("`bb` anda pela letra; um `a` logo em seguida faz o texto `bba`, que procura a partir do atual, incluído", () => {
    // `bbalao` (3) é o primeiro, a partir de `bala` (2, o atual), que começa por `bba`; `bbalde` (1) fica para trás.
    expect(pressAll(["b", "b", "a"], list, 0)).toMatchObject({ targets: [1, 2, 3], focus: 3, state: { text: "bba" } });
  });

  it("`bb`, uma pausa de mais de 1 s e o `a`: o texto recomeça no `a` sozinho, que procura a partir do atual + 1", () => {
    expect(pressAll([["b", 100], ["b", 200], ["a", 5200]], list, 0).targets).toEqual([1, 2, 4]);
  });
});

describe("acento dos dois lados (RN-ARVORE-009)", () => {
  it("a letra acentuada digitada acha o nome sem acento", () => {
    expect(typeAheadStep(noTypeAhead, "é", 0, ["alfa", "elenco", "bravo"], 0).target).toBe(1);
  });

  it("a letra sem acento digitada acha o nome com acento", () => {
    expect(typeAheadStep(noTypeAhead, "e", 0, ["alfa", "Éter", "bravo"], 0).target).toBe(1);
  });

  it("o texto em maiúsculas com acento: `É` acha `elenco`; `ÉT` e `ÉTE` acham `Éter`", () => {
    expect(pressAll(["É", "T", "E"], ["alfa", "elenco", "Éter"], 0).targets).toEqual([1, 2, 2]);
  });
});

describe("maiúsculas nos nomes (RN-ARVORE-009)", () => {
  const list = ["ALFA", "Bravo", "charlie"];

  it("a letra, em maiúscula ou não, acha o nome em qualquer caixa", () => {
    expect(typeAheadStep(noTypeAhead, "a", 0, list, 2).target).toBe(0);
    expect(typeAheadStep(noTypeAhead, "B", 0, list, 0).target).toBe(1);
    expect(typeAheadStep(noTypeAhead, "C", 0, list, 0).target).toBe(2);
  });

  it("o texto com caixas misturadas acha o nome inteiro, a partir do atual", () => {
    expect(pressAll(["b", "R", "A"], list, 2).targets).toEqual([1, 1, 1]);
    expect(pressAll(["C", "H", "A"], list, 0).targets).toEqual([2, 2, 2]);
  });
});

describe("nomes que começam por número ou sublinhado (RN-ARVORE-009)", () => {
  const list = ["1_nota", "2024_totals", "_audit", "9_vendas", "usr_log"];

  it("o número e o sublinhado sozinhos acham o primeiro nome que começa por eles, abaixo do atual", () => {
    expect(typeAheadStep(noTypeAhead, "2", 0, list, 0).target).toBe(1);
    expect(typeAheadStep(noTypeAhead, "_", 0, list, 0).target).toBe(2);
    expect(typeAheadStep(noTypeAhead, "9", 0, list, 2).target).toBe(3);
  });

  it("o texto com número segue como texto, e `1_` volta ao começo da lista para achar `1_nota`", () => {
    expect(pressAll(["2", "0", "2"], list, 0).targets).toEqual([1, 1, 1]);
    expect(pressAll(["1", "_"], list, 1).targets).toEqual([0, 0]);
  });

  it("o sublinhado repetido, com um só nome que começa por ele, fica nesse nome", () => {
    expect(pressAll(["_", "_"], list, 0).targets).toEqual([2, 2]);
  });
});

describe("a lista vazia e o foco fora dela (RN-ARVORE-009)", () => {
  it("sem nenhum item, a tecla não acha nada e o texto fica para a vez seguinte, com ou sem foco", () => {
    expect(typeAheadStep(noTypeAhead, "a", 0, [], 0)).toEqual({ state: { text: "a", at: 0 }, target: null });
    expect(typeAheadStep(noTypeAhead, "a", 0, [], -1)).toEqual({ state: { text: "a", at: 0 }, target: null });
  });

  it("várias letras numa lista vazia não acham nada, e o foco fica em -1", () => {
    expect(pressAll(["a", "b"], [], -1)).toMatchObject({ targets: [null, null], focus: -1, state: { text: "ab" } });
  });
});

describe("nenhum item com o foco, índice -1 (RN-ARVORE-009)", () => {
  const list = ["bravo", "alfa", "bola"];

  it("sem foco, a procura começa no topo, e o primeiro item conta", () => {
    expect(typeAheadStep(noTypeAhead, "b", 0, list, -1).target).toBe(0);
  });

  it("sem foco, a mesma letra repetida vai ao topo e depois anda um a um", () => {
    expect(pressAll(["b", "b", "b"], list, -1).targets).toEqual([0, 2, 0]);
  });

  it("sem foco, o texto de várias letras acha a partir do topo", () => {
    expect(pressAll(["a", "l"], list, -1).targets).toEqual([1, 1]);
    expect(pressAll(["b", "o"], list, -1).targets).toEqual([0, 2]);
  });
});

describe("nome com espaço no começo (RN-ARVORE-009)", () => {
  // A regra compara pelo nome que o item mostra e tira só o selo do banco ou do ambiente, o "padrão" e a contagem. O espaço do começo não está na lista: é do nome,
  // e "começa por" é literal. Por isso ` bravo` não casa com `b`, e a busca pula esse item.
  it("a letra não acha o nome que começa por espaço", () => {
    expect(typeAheadStep(noTypeAhead, "b", 0, ["alfa", " bravo"], 0).target).toBeNull();
  });

  it("a letra pula o nome com espaço no começo e acha o próximo que começa pela letra", () => {
    expect(typeAheadStep(noTypeAhead, "b", 0, ["alfa", " bravo", "bravo"], 0).target).toBe(2);
  });

  it("o texto de letras nunca casa com o nome que começa por espaço, e o foco fica", () => {
    expect(pressAll(["b", "r", "a"], ["alfa", " bravo"], 0)).toMatchObject({ targets: [null, null, null], focus: 0 });
  });
});
