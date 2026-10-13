import { describe, expect, it } from "vitest";

import { closeConfirmation, closeConfirmationText, closeShortcutLabel, isCloseShortcut, mergeCloseQueue, moveMenu, nextToClose, overflowOf, revealOffset, scrollStep, stripKeyTarget, tabListLabels, tabMenu, tabsToClose, tabTitleOf, wheelScroll } from "./tab-strip";

const tabs = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("overflowOf: quando a faixa tem aba escondida de cada lado (botões das pontas)", () => {
  it("tudo cabe: nenhum botão", () => {
    expect(overflowOf({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 })).toEqual({ left: false, right: false });
  });

  it("no começo, com excedente: só o da direita", () => {
    expect(overflowOf({ scrollLeft: 0, clientWidth: 800, scrollWidth: 1400 })).toEqual({ left: false, right: true });
  });

  it("no meio: os dois", () => {
    expect(overflowOf({ scrollLeft: 300, clientWidth: 800, scrollWidth: 1400 })).toEqual({ left: true, right: true });
  });

  it("no fim: só o da esquerda", () => {
    expect(overflowOf({ scrollLeft: 600, clientWidth: 800, scrollWidth: 1400 })).toEqual({ left: true, right: false });
  });

  it("um pixel de diferença (tela de densidade fracionária) não acende botão", () => {
    expect(overflowOf({ scrollLeft: 0.5, clientWidth: 800, scrollWidth: 800.6 })).toEqual({ left: false, right: false });
  });

  it("a faixa escondida (sem largura) não tem o que rolar", () => {
    expect(overflowOf({ scrollLeft: 0, clientWidth: 0, scrollWidth: 1400 })).toEqual({ left: false, right: false });
  });
});

describe("revealOffset: trazer a aba ativa à vista", () => {
  const strip = { scrollLeft: 400, clientWidth: 600, scrollWidth: 2000 };

  it("já à vista: nada a rolar", () => {
    expect(revealOffset(strip, { left: 500, width: 200 })).toBeNull();
  });

  it("escondida à direita: rola até o fim dela aparecer, com a folga", () => {
    // O fim da aba (1100) mais 12 de folga fica na borda direita da faixa (400 + 600 = 1000 hoje).
    expect(revealOffset(strip, { left: 900, width: 200 })).toBe(1112 - 600);
  });

  it("escondida à esquerda: rola até o começo dela aparecer, com a folga", () => {
    expect(revealOffset(strip, { left: 100, width: 200 })).toBe(88);
  });

  it("nunca passa dos limites da faixa: nem antes do começo, nem depois do fim", () => {
    expect(revealOffset({ scrollLeft: 400, clientWidth: 600, scrollWidth: 2000 }, { left: 0, width: 150 })).toBe(0);
    expect(revealOffset({ scrollLeft: 0, clientWidth: 600, scrollWidth: 1000 }, { left: 800, width: 200 })).toBe(400);
  });

  it("a aba mais larga que a faixa fica com o começo à mostra", () => {
    expect(revealOffset({ scrollLeft: 0, clientWidth: 300, scrollWidth: 2000 }, { left: 700, width: 500 })).toBe(688);
    expect(revealOffset({ scrollLeft: 688, clientWidth: 300, scrollWidth: 2000 }, { left: 700, width: 500 })).toBeNull();
  });

  it("a faixa escondida (sem largura) não mede nem rola", () => {
    expect(revealOffset({ scrollLeft: 0, clientWidth: 0, scrollWidth: 2000 }, { left: 900, width: 200 })).toBeNull();
  });
});

describe("wheelScroll: a roda comum rola as abas na horizontal", () => {
  it("a roda vertical vira rolagem horizontal, em pixels", () => {
    expect(wheelScroll({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(100);
    expect(wheelScroll({ deltaX: 0, deltaY: -53, deltaMode: 0 })).toBe(-53);
  });

  it("a roda que conta em linhas vale 16 px por linha", () => {
    expect(wheelScroll({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(48);
  });

  it("o gesto horizontal o navegador já trata: não se soma", () => {
    expect(wheelScroll({ deltaX: 80, deltaY: 0, deltaMode: 0 })).toBe(0);
    expect(wheelScroll({ deltaX: 80, deltaY: 20, deltaMode: 0 })).toBe(0);
    expect(wheelScroll({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toBe(0);
  });
});

describe("scrollStep: o passo dos botões das pontas", () => {
  it("70% da faixa, e nunca menos de 120 px", () => {
    expect(scrollStep(1000)).toBe(700);
    expect(scrollStep(100)).toBe(120);
  });
});

describe("stripKeyTarget: o teclado da faixa", () => {
  it("as setas andam uma aba e dão a volta nas pontas", () => {
    expect(stripKeyTarget("ArrowRight", 1, 5)).toBe(2);
    expect(stripKeyTarget("ArrowRight", 4, 5)).toBe(0);
    expect(stripKeyTarget("ArrowLeft", 2, 5)).toBe(1);
    expect(stripKeyTarget("ArrowLeft", 0, 5)).toBe(4);
  });

  it("Home e End vão à primeira e à última", () => {
    expect(stripKeyTarget("Home", 3, 5)).toBe(0);
    expect(stripKeyTarget("End", 1, 5)).toBe(4);
  });

  it("outra tecla segue o caminho dela; sem abas, nada", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "w", "Delete"]) expect(stripKeyTarget(key, 1, 5), key).toBeNull();
    expect(stripKeyTarget("ArrowRight", 0, 0)).toBeNull();
    expect(stripKeyTarget("Home", 0, 0)).toBeNull();
  });
});

describe("isCloseShortcut: Ctrl+W fecha a aba ativa", () => {
  const key = { key: "w", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };

  it("Ctrl+W, ou Cmd+W, com a letra em qualquer caixa", () => {
    expect(isCloseShortcut(key)).toBe(true);
    expect(isCloseShortcut({ ...key, key: "W" })).toBe(true);
    expect(isCloseShortcut({ ...key, ctrlKey: false, metaKey: true })).toBe(true);
  });

  it("a letra sozinha, ou com Shift ou Alt junto (outro atalho), ou outra letra: não", () => {
    expect(isCloseShortcut({ ...key, ctrlKey: false })).toBe(false);
    expect(isCloseShortcut({ ...key, shiftKey: true })).toBe(false);
    expect(isCloseShortcut({ ...key, altKey: true })).toBe(false);
    expect(isCloseShortcut({ ...key, key: "q" })).toBe(false);
    expect(isCloseShortcut({ ...key, key: "Enter" })).toBe(false);
  });
});

describe("tabsToClose: o que cada fechamento fecha", () => {
  it("'Fechar' fecha só a aba", () => {
    expect(tabsToClose("one", tabs, "c")).toEqual(["c"]);
  });

  it("'Fechar as outras' fecha todas menos ela, na ordem da faixa", () => {
    expect(tabsToClose("others", tabs, "c")).toEqual(["a", "b", "d", "e"]);
  });

  it("'Fechar as da direita' fecha as que vêm depois dela", () => {
    expect(tabsToClose("right", tabs, "b")).toEqual(["c", "d", "e"]);
    expect(tabsToClose("right", tabs, "e")).toEqual([]);
  });

  it("'Fechar todas' fecha todas, inclusive ela", () => {
    expect(tabsToClose("all", tabs, "c")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("uma aba que já não está na lista (fechada no meio do caminho) não fecha nada", () => {
    for (const scope of ["one", "others", "right", "all"] as const) expect(tabsToClose(scope, tabs, "x"), scope).toEqual([]);
  });

  it("com uma aba só: as outras e as da direita não têm o que fechar", () => {
    expect(tabsToClose("others", [{ id: "a" }], "a")).toEqual([]);
    expect(tabsToClose("right", [{ id: "a" }], "a")).toEqual([]);
    expect(tabsToClose("all", [{ id: "a" }], "a")).toEqual(["a"]);
  });
});

describe("tabMenu: o menu de botão direito de uma aba", () => {
  const flat = (menu: ReturnType<typeof tabMenu>) => menu.map((group) => group.map((item) => `${item.scope}:${item.label}${item.disabled ? " (apagado)" : ""}${item.shortcut ? ` [${item.shortcut}]` : ""}`));

  it("dois grupos: fechar a aba; e fechar as outras, as da direita ou todas", () => {
    expect(flat(tabMenu(tabs, "b", "a"))).toEqual([["one:Fechar"], ["others:Fechar as outras", "right:Fechar as da direita", "all:Fechar todas"]]);
  });

  it("o atalho Ctrl+W vem escrito só no 'Fechar' da aba ativa, que é a que ele fecha", () => {
    expect(flat(tabMenu(tabs, "b", "b"))[0]).toEqual(["one:Fechar [Ctrl+W]"]);
    expect(flat(tabMenu(tabs, "b", "a"))[0]).toEqual(["one:Fechar"]);
    expect(flat(tabMenu(tabs, "b", null))[0]).toEqual(["one:Fechar"]);
  });

  it("na última aba, 'as da direita' fica à vista e apagado", () => {
    expect(flat(tabMenu(tabs, "e", "e"))[1]).toEqual(["others:Fechar as outras", "right:Fechar as da direita (apagado)", "all:Fechar todas"]);
  });

  it("com uma aba só, 'as outras' e 'as da direita' ficam apagados, e 'Fechar todas' segue valendo", () => {
    expect(flat(tabMenu([{ id: "a" }], "a", "a"))[1]).toEqual(["others:Fechar as outras (apagado)", "right:Fechar as da direita (apagado)", "all:Fechar todas"]);
  });
});

describe("mergeCloseQueue e nextToClose: a fila de fechamento de várias abas", () => {
  it("juntar à fila o que um segundo fechamento pede: o que já estava lá fica na frente, e nada se repete", () => {
    expect(mergeCloseQueue([], ["a", "b"])).toEqual(["a", "b"]);
    expect(mergeCloseQueue(["a", "b"], ["c", "d"])).toEqual(["a", "b", "c", "d"]);
    expect(mergeCloseQueue(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeCloseQueue(["a"], [])).toEqual(["a"]);
  });

  it("o próximo é o primeiro da fila que ainda está aberto; o resto é o que vem depois dele", () => {
    expect(nextToClose(["a", "b", "c"], new Set(["a", "b", "c"]))).toEqual({ next: "a", rest: ["b", "c"] });
    expect(nextToClose(["a", "b", "c"], new Set(["b", "c", "z"]))).toEqual({ next: "b", rest: ["c"] });
  });

  it("um id que já saiu (fechado pela pessoa no meio do caminho) é pulado, e a fila não fica parada nele", () => {
    expect(nextToClose(["a", "b", "c"], new Set(["c"]))).toEqual({ next: "c", rest: [] });
    expect(nextToClose(["a", "b"], new Set(["z"]))).toEqual({ next: null, rest: [] });
  });

  it("fila vazia: nada a fechar", () => {
    expect(nextToClose([], new Set(["a"]))).toEqual({ next: null, rest: [] });
  });
});

describe("tabListLabels: a lista de todas as abas distingue as de mesmo título", () => {
  const names: Record<string, string> = { c1: "MES Produção", c2: "MES Qualidade" };
  const connectionName = (id: string) => names[id];
  const tab = (id: string, title: string, connectionId: string) => ({ id, title, connectionId });

  it("títulos diferentes saem como são", () => {
    expect(tabListLabels([tab("1", "consulta-1.sql", "c1"), tab("2", "producao.pedido", "c1")], connectionName)).toEqual(["consulta-1.sql", "producao.pedido"]);
  });

  it("o mesmo título em conexões diferentes mostra a conexão de cada um, e só nesses", () => {
    const labels = tabListLabels([tab("1", "producao.pedido", "c1"), tab("2", "consulta-1.sql", "c1"), tab("3", "producao.pedido", "c2")], connectionName);

    expect(labels).toEqual(["producao.pedido (MES Produção)", "consulta-1.sql", "producao.pedido (MES Qualidade)"]);
  });

  it("sem o nome da conexão (a lista de conexões ainda não chegou), o título fica como é", () => {
    expect(tabListLabels([tab("1", "t", "x"), tab("2", "t", "y")], connectionName)).toEqual(["t", "t"]);
  });
});

describe("closeShortcutLabel: o atalho de fechar segue a plataforma", () => {
  it("Cmd+W no macOS, Ctrl+W nas outras", () => {
    for (const platform of ["MacIntel", "MacARM", "Macintosh", "iPhone", "iPad"]) expect(closeShortcutLabel(platform), platform).toBe("Cmd+W");
    for (const platform of ["Win32", "Linux x86_64", "Linux armv8l", "", "FreeBSD"]) expect(closeShortcutLabel(platform), platform).toBe("Ctrl+W");
  });

  it("o menu da aba escreve o atalho que recebe, só no item da ativa", () => {
    const menu = tabMenu(tabs, "b", "b", "Cmd+W");

    expect(menu[0][0].shortcut).toBe("Cmd+W");
    expect(tabMenu(tabs, "b", "a", "Cmd+W")[0][0].shortcut).toBeUndefined();
    // Sem dizer a plataforma, o de sempre.
    expect(tabMenu(tabs, "b", "b")[0][0].shortcut).toBe("Ctrl+W");
  });
});

describe("closeConfirmation: uma pergunta só, e só quando fechar perde SQL digitado", () => {
  const query = (id: string, sql = "") => ({ id, sql });
  // A aba de uma tabela pode carregar um `sql` (o SELECT dela) que não é digitado por ninguém: não conta.
  const table = (id: string) => ({ id, sql: "select * from s.t", table: { schema: "s", name: id } });

  it("fechar uma aba só segue como hoje: nunca pergunta", () => {
    expect(closeConfirmation("one", [query("a", "select 1"), query("b")], "a")).toBeNull();
  });

  it("fechar as outras, as da direita ou todas pergunta quando alguma das que fecham é consulta com SQL digitado, e diz quantas fecham e quantas têm SQL", () => {
    const tabs = [query("a"), query("b", "select 1"), table("c"), query("d", "select 2"), table("e")];

    expect(closeConfirmation("all", tabs, "a")).toEqual({ total: 5, withSql: 2 });
    expect(closeConfirmation("others", tabs, "b")).toEqual({ total: 4, withSql: 1 });
    expect(closeConfirmation("right", tabs, "b")).toEqual({ total: 3, withSql: 1 });
  });

  // RN-SCRIPT-001: o texto de um script está salvo; o que mudou desde a gravação já foi perguntado antes (Salvar ou Descartar), na pergunta do script.
  it("a aba de um script não conta como SQL que se perde", () => {
    const script = (id: string) => ({ id, sql: "select 3", script: { id: `s-${id}`, name: id, savedSql: "select 3", dirty: false } });

    expect(closeConfirmation("all", [query("a"), script("b")], "a")).toBeNull();
    expect(closeConfirmation("all", [query("a", "select 1"), script("b")], "a")).toEqual({ total: 2, withSql: 1 });
  });

  it("sem SQL digitado nas que fecham (vazias, só espaço, ou abas de tabela), não pergunta", () => {
    const tabs = [query("a", "select 1"), query("b", "  \n\t "), query("c"), table("d")];

    expect(closeConfirmation("right", tabs, "a")).toBeNull();
    expect(closeConfirmation("others", [query("a", "select 1"), table("t")], "a")).toBeNull();
  });

  it("o SQL da aba que FICA não conta: só o das que fecham", () => {
    expect(closeConfirmation("others", [query("a", "select 1"), query("b")], "a")).toBeNull();
    expect(closeConfirmation("right", [query("a"), query("b", "select 1")], "a")).toEqual({ total: 1, withSql: 1 });
  });

  it("uma aba que já não está na lista não fecha nada: não pergunta", () => {
    expect(closeConfirmation("all", [query("a", "select 1")], "x")).toBeNull();
  });

  it("o texto da pergunta diz quantas abas fecham e quantas consultas com SQL digitado perdem o texto", () => {
    expect(closeConfirmationText(5, 2)).toEqual({ title: "Fechar 5 abas?", description: "Entre elas, 2 consultas com SQL digitado: o texto não é guardado em lugar nenhum.", confirm: "Fechar" });
    expect(closeConfirmationText(1, 1)).toEqual({ title: "Fechar 1 aba?", description: "Entre elas, 1 consulta com SQL digitado: o texto não é guardado em lugar nenhum.", confirm: "Fechar" });
  });
});

describe("moveMenu: levar a aba para outra janela (RN-ABAS-002 e 003)", () => {
  it("'Mover para nova janela' sempre; 'Mover para a janela…' apagado sem outra janela aberta", () => {
    expect(moveMenu(0, true)).toEqual([
      { action: "newWindow", label: "Mover para nova janela", disabled: false },
      { action: "toWindow", label: "Mover para a janela…", disabled: true },
    ]);
    expect(moveMenu(2, true)[1].disabled).toBe(false);
  });

  it("fora do Electron não há para onde levar: o grupo não aparece", () => {
    expect(moveMenu(3, false)).toEqual([]);
  });
});

describe("tabTitleOf: o que a aba diz de si (RN-SCRIPT-001)", () => {
  it("a aba de um script com mudança não salva diz isso no título e no nome acessível; a salva e a consulta comum, só o título", () => {
    const script = { id: "s1", name: "Fechamento", savedSql: "", dirty: true };

    expect(tabTitleOf({ title: "Fechamento", script })).toEqual({ title: "Fechamento", label: "Fechamento (alterações não salvas)", unsaved: true });
    expect(tabTitleOf({ title: "Fechamento", script: { ...script, dirty: false } })).toEqual({ title: "Fechamento", label: "Fechamento", unsaved: false });
    expect(tabTitleOf({ title: "consulta-1.sql" })).toEqual({ title: "consulta-1.sql", label: "consulta-1.sql", unsaved: false });
  });
});
