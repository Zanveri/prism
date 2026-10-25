import { describe, expect, it } from "vitest";

import { isTypeAheadKey, noTypeAhead, typeAheadAlive, typeAheadStep, typeAheadWindow, type TypeAheadKey, type TypeAheadState } from "./type-ahead";

// Os nomes de uma lista visível, na ordem da árvore (RN-ARVORE-009). O índice de cada um está no comentário; `""` é a linha sem nome (carregando, erro).
const labels = [
  "batch_pallet_items", // 0
  "batch_pallets", // 1
  "batch_produced_stock_pallet_items", // 2
  "batch_products", // 3
  "customers", // 4
  "Ética", // 5
  "orders", // 6
  "order_items", // 7
  "2024_totals", // 8
  "_audit", // 9
  "usr.log", // 10
  "", // 11
];

type Press = string | [key: string, at: number];

/** Digita as teclas na ordem, a 100 ms uma da outra (ou no instante dado), como a árvore: o foco vai ao item achado e fica onde está se nenhum casa. */
function typeKeys(keys: readonly Press[], list: readonly string[] = labels, current = 0) {
  let state: TypeAheadState = noTypeAhead;
  let focus = current;
  let clock = 0;
  const targets: (number | null)[] = [];

  for (const press of keys) {
    const [key, at] = typeof press === "string" ? [press, (clock += 100)] : press;
    const step = typeAheadStep(state, key, at, list, focus);
    state = step.state;
    if (step.target !== null) focus = step.target;
    targets.push(step.target);
  }
  return { targets, state, focus };
}

describe("uma letra (RN-ARVORE-009)", () => {
  it.each<[string, string, number, number | null]>([
    ["o próximo item abaixo do atual, nunca o atual", "b", 0, 1],
    ["abaixo do atual, saltando os que não casam", "c", 0, 4],
    ["o último que casa, voltando ao começo da árvore", "b", 3, 0],
    ["depois do último item da lista, volta ao topo", "b", 10, 0],
    ["o único que casa é o próprio atual: fica nele", "e", 5, 5],
    ["sem item que comece pela letra: nenhum", "x", 0, null],
    ["o sublinhado e o ponto contam como caractere", "_", 0, 9],
    ["o número", "2", 0, 8],
    ["a letra em maiúscula acha o nome em minúsculas", "C", 0, 4],
    ["a linha sem nome nunca casa", "", 0, null],
  ])("%s", (_name, key, current, expected) => {
    expect(typeAheadStep(noTypeAhead, key, 1000, labels, current).target).toBe(expected);
  });

  it("o texto guardado é o digitado, com o instante da tecla", () => {
    expect(typeAheadStep(noTypeAhead, "B", 1234, labels, 0).state).toEqual({ text: "B", at: 1234 });
  });
});

describe("várias letras juntas (RN-ARVORE-009)", () => {
  it("as letras digitadas em seguida formam o texto, e o foco vai ao primeiro item, a partir do atual (incluído), que começa por ele", () => {
    // De customers: `b` vai ao primeiro `batch…` (a volta ao topo), e `a` e `t` ficam nele, que também começa por `bat`.
    expect(typeKeys(["b", "a", "t"], labels, 4).targets).toEqual([0, 0, 0]);
    // O atual é olhado antes dos de baixo: a partir do segundo `batch_pallets`, `bat` não sai dele.
    expect(typeKeys(["b", "a", "t"], labels, 0).targets).toEqual([1, 1, 1]);
  });

  it("continuar o texto leva ao item mais específico, passando por cima dos que não casam mais", () => {
    expect(typeKeys(["b", "a", "t", "c", "h", "_", "p", "r"], labels, 4)).toMatchObject({ targets: [0, 0, 0, 0, 0, 0, 0, 2], focus: 2, state: { text: "batch_pr" } });
    expect(typeKeys(["b", "a", "t", "c", "h", "_", "p", "r", "o", "d", "u", "c", "t"], labels, 4).focus).toBe(3);
  });

  it("a procura volta ao começo da árvore se abaixo do atual nenhum casa", () => {
    expect(typeKeys(["c", "u"], labels, 10).targets).toEqual([4, 4]);
    expect(typeKeys(["o", "r", "d", "e", "r", "_"], labels, 10)).toMatchObject({ targets: [6, 6, 6, 6, 6, 7], focus: 7 });
  });

  it("sem item que comece pelo texto, o foco fica onde está, e o texto continua, para o que vier depois", () => {
    const typed = typeKeys(["c", "x", "y"], labels, 0);

    expect(typed.targets).toEqual([4, null, null]);
    expect(typed.focus).toBe(4);
    expect(typed.state.text).toBe("cxy");
  });

  it("os nomes com sublinhado, ponto e número casam pelo texto inteiro", () => {
    expect(typeKeys([...("order_i")], labels, 0).focus).toBe(7);
    expect(typeKeys([...("usr.l")], labels, 0).focus).toBe(10);
    expect(typeKeys([...("2024_t")], labels, 0).focus).toBe(8);
    expect(typeKeys([...("_au")], labels, 0).focus).toBe(9);
  });

  it("o Espaço entra no texto como qualquer caractere", () => {
    const names = ["Nova pasta", "Novo script", "Nova conexão"];

    expect(typeKeys([...("nova c")], names, 0)).toMatchObject({ targets: [1, 1, 1, 2, 2, 2], focus: 2 });
  });
});

describe("o tempo do texto: 1 segundo (RN-ARVORE-009)", () => {
  it("a tecla na borda, 1 s depois da anterior, ainda se junta ao texto", () => {
    expect(typeKeys([["c", 0], ["u", typeAheadWindow]], labels, 0)).toMatchObject({ targets: [4, 4], state: { text: "cu", at: typeAheadWindow } });
  });

  it("a tecla 1 ms depois da borda recomeça o texto: é a primeira letra de uma procura nova", () => {
    // `u` sozinha acha o `usr.log`; juntada a `c`, `cu` acharia `customers`.
    expect(typeKeys([["c", 0], ["u", typeAheadWindow + 1]], labels, 0)).toMatchObject({ targets: [4, 10], state: { text: "u" } });
  });

  it("o prazo conta da última tecla, não da primeira: o texto cresce enquanto a pessoa não para", () => {
    const typed = typeKeys([["b", 0], ["a", 900], ["t", 1800], ["c", 2700], ["h", 3600]], labels, 4);

    expect(typed.state.text).toBe("batch");
    expect(typed.focus).toBe(0);
  });

  it("depois da pausa, a mesma letra da vez anterior segue para o próximo item, não repete o texto", () => {
    expect(typeKeys([["b", 0], ["b", 5000], ["b", 10000]], labels, 4).targets).toEqual([0, 1, 2]);
  });

  it.each<[string, TypeAheadState, number, boolean]>([
    ["sem texto", noTypeAhead, 0, false],
    ["no instante da tecla", { text: "b", at: 500 }, 500, true],
    ["a 1000 ms", { text: "b", at: 500 }, 1500, true],
    ["a 1001 ms", { text: "b", at: 500 }, 1501, false],
    ["o relógio que voltou", { text: "b", at: 500 }, 100, false],
  ])("o texto dura: %s", (_name, state, now, expected) => {
    expect(typeAheadAlive(state, now)).toBe(expected);
  });
});

describe("a mesma letra repetida (RN-ARVORE-009)", () => {
  it("percorre um a um os itens que começam por ela, e volta ao primeiro depois do último", () => {
    expect(typeKeys(["b", "b", "b", "b", "b", "b"], labels, 4).targets).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("não procura o texto `bb`: só anda pela letra, mesmo que um nome comece por `bb`", () => {
    const names = ["bb_one", "b_two", "bc"];

    expect(typeKeys(["b", "b", "b"], names, 2).targets).toEqual([0, 1, 2]);
  });

  it("com um item só que começa pela letra, ele fica com o foco", () => {
    expect(typeKeys(["e", "e", "e"], labels, 0).targets).toEqual([5, 5, 5]);
  });

  it("deixa de percorrer quando vem outra letra: o texto passa a ser o inteiro (`bba` não abre nenhum item, e o foco fica)", () => {
    expect(typeKeys(["b", "b", "a"], labels, 4)).toMatchObject({ targets: [0, 1, null], focus: 1, state: { text: "bba" } });
  });

  it("vale para maiúscula e minúscula juntas", () => {
    expect(typeKeys(["b", "B", "b"], labels, 4).targets).toEqual([0, 1, 2]);
  });
});

describe("maiúsculas, minúsculas e acentos (RN-ARVORE-009)", () => {
  it.each<[string, string, number | null]>([
    ["a letra sem acento acha o nome com acento", "e", 5],
    ["a letra com acento acha o mesmo nome", "é", 5],
    ["a maiúscula com acento acha o mesmo nome", "É", 5],
    ["o texto sem acento e em maiúsculas", "ETI", 5],
    ["o texto com acento", "étic", 5],
  ])("%s", (_name, typed, expected) => {
    expect(typeKeys([...typed], labels, 0).focus).toBe(expected);
  });

  it("o nome com o acento solto (decomposto, como alguns bancos devolvem) casa também", () => {
    const decomposed = "Produção".normalize("NFD");

    expect(typeKeys([...("produc")], ["Alfa", decomposed, "Zeta"], 0).focus).toBe(1);
    expect(typeKeys([...("PRODUÇ")], ["Alfa", decomposed, "Zeta"], 0).focus).toBe(1);
  });

  it("o ç é o c, como na busca do navegador", () => {
    expect(typeKeys(["c"], ["Alfa", "Ção"], 0).targets).toEqual([1]);
  });
});

describe("os casos de borda da lista (RN-ARVORE-009)", () => {
  it("a lista vazia: nenhum item, e o texto vale mesmo assim", () => {
    expect(typeKeys(["a", "b"], [], 0)).toMatchObject({ targets: [null, null], state: { text: "ab" } });
  });

  it("o item atual fora da lista (o foco numa linha que o filtro escondeu): a procura começa no topo, incluído o primeiro", () => {
    expect(typeKeys(["b"], labels, -1).targets).toEqual([0]);
    expect(typeKeys(["b"], labels, 99).targets).toEqual([0]);
    expect(typeKeys(["o", "r"], labels, -1).focus).toBe(6);
  });

  it("só o item atual na lista", () => {
    expect(typeKeys(["a"], ["alfa"], 0).targets).toEqual([0]);
    expect(typeKeys(["b"], ["alfa"], 0).targets).toEqual([null]);
  });

  it("a linha sem nome (carregando, erro) nunca casa, nem com o texto vazio de nomes", () => {
    expect(typeKeys(["a"], ["", "", ""], 0).targets).toEqual([null]);
    expect(typeKeys(["a"], ["", "alfa", ""], 1).targets).toEqual([1]);
  });

  it("o caractere de acento sozinho (que o dobrado esvazia) não acha nada", () => {
    expect(typeAheadStep(noTypeAhead, "́", 0, labels, 0).target).toBeNull();
  });

  it("o caractere fora do plano básico conta como um só", () => {
    expect(typeKeys(["😀"], ["alfa", "😀 feliz"], 0).targets).toEqual([1]);
  });
});

describe("isTypeAheadKey: a tecla é de ir ao item?", () => {
  const key = (name: string, over: Partial<TypeAheadKey> = {}): TypeAheadKey => ({ key: name, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...over });
  const typing: TypeAheadState = { text: "b", at: 1000 };

  it.each(["a", "Z", "é", "ç", "5", "_", ".", "-", "*", "(", "😀"])("o caractere %s vale", (name) => {
    expect(isTypeAheadKey(key(name), noTypeAhead, 5000)).toBe(true);
  });

  it.each(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageDown", "Delete", "Backspace", "F2", "F5", "F10", "ContextMenu", "Shift", "Control", "Dead", "Process", "Unidentified"])("a tecla %s, que tem nome, não vale", (name) => {
    expect(isTypeAheadKey(key(name), typing, 1100)).toBe(false);
  });

  it.each<[string, Partial<TypeAheadKey>]>([
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Cmd", { metaKey: true }],
    ["Ctrl e Alt (o AltGr)", { ctrlKey: true, altKey: true }],
  ])("com %s, não vale: o Ctrl+F e os atalhos seguem como são", (_name, modifiers) => {
    expect(isTypeAheadKey(key("f", modifiers), noTypeAhead, 5000)).toBe(false);
    expect(isTypeAheadKey(key("f", modifiers), typing, 1100)).toBe(false);
  });

  it("o Shift vale: é a maiúscula", () => {
    expect(isTypeAheadKey(key("B"), noTypeAhead, 5000)).toBe(true);
  });

  it("a letra no meio da composição de um acento não vale", () => {
    expect(isTypeAheadKey(key("a", { isComposing: true }), noTypeAhead, 5000)).toBe(false);
  });

  it.each<[string, TypeAheadState, number, boolean]>([
    ["sozinho, não é do type-ahead: faz o que faz hoje", noTypeAhead, 5000, false],
    ["no meio do texto, entra nele", typing, 1500, true],
    ["a 1 s da última tecla, ainda entra", typing, 2000, true],
    ["passado 1 s, o texto acabou, e ele é sozinho de novo", typing, 2001, false],
  ])("o Espaço %s", (_name, state, now, expected) => {
    expect(isTypeAheadKey(key(" "), state, now)).toBe(expected);
  });
});
