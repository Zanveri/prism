import { describe, expect, it } from "vitest";

import {
  afterPlaceChange,
  dropMarks,
  f6Action,
  isF6,
  newTabPlace,
  placeAnnouncement,
  placeButtonLabel,
  placeMenu,
  placeOf,
  preferencePlaces,
  resultMarkOf,
  resultMarkText,
  resultOnView,
  resultTabTitle,
  resultWindowAvailable,
  windowKeyAction,
  stripEntries,
  trackUnseen,
  unitRects,
  withResultPlace,
} from "./result-place";
import { dropIndex } from "./tab-order";
import type { QueryTab } from "./workbench-model";

const query = (id: string, resultPlace?: QueryTab["resultPlace"]): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c1", sessionId: null, sql: "", ...(resultPlace === undefined ? {} : { resultPlace }) });
const table = (id: string): QueryTab => ({ id, title: id, connectionId: "c1", sessionId: null, sql: "", table: { schema: "loja", name: id, view: "data" } });
const keys = (entries: { key: string }[]) => entries.map((entry) => entry.key);

describe("placeOf: o lugar que vale para a aba (RN-ABAS-011)", () => {
  it("a aba de consulta sem o campo está no painel, e a de tabela não tem lugar", () => {
    expect(placeOf(query("a"))).toBe("panel");
    expect(placeOf(query("a", "tab"))).toBe("tab");
    expect(placeOf(table("t"))).toBeNull();
    expect(placeOf({ ...table("t"), resultPlace: "tab" })).toBeNull();
  });

  it("'Numa janela' sem a janela do resultado vale o painel, sem deixar de ser o gravado; com ela, vale a janela", () => {
    expect(resultWindowAvailable()).toBe(false);
    const tab = query("a", "window");
    expect(placeOf(tab)).toBe("panel");
    expect(tab.resultPlace).toBe("window");
    expect(placeOf(tab, true)).toBe("window");
  });

  it("a aba nova nasce no lugar da preferência (RN-CONFIG-010), e 'Numa janela' sem a janela é o painel", () => {
    expect(newTabPlace("tab")).toBe("tab");
    expect(newTabPlace("panel")).toBe("panel");
    expect(newTabPlace("window")).toBe("panel");
    expect(newTabPlace("window", true)).toBe("window");
  });
});

describe("stripEntries: a aba do resultado logo depois da dela (RN-ABAS-012)", () => {
  it("só a aba de consulta com o resultado numa aba ganha a entrada do resultado, logo depois dela", () => {
    const entries = stripEntries([query("a", "tab"), table("t"), query("b"), query("c", "tab")]);
    expect(keys(entries)).toEqual(["a", "result:a", "t", "b", "c", "result:c"]);
    expect(entries.map((entry) => entry.result)).toEqual([false, true, false, false, false, true]);
    expect(entries[1].tab.id).toBe("a");
  });

  it("'Numa janela' e o painel não têm aba do resultado na faixa", () => {
    expect(keys(stripEntries([query("a", "window"), query("b", "panel")], true))).toEqual(["a", "b"]);
  });
});

describe("unitRects e dropMarks: o marcador nunca fica entre a aba da consulta e a do resultado dela (RN-ABAS-012)", () => {
  const entries = stripEntries([query("a", "tab"), query("b"), query("c", "tab")]);
  // a: 0-100, resultado de a: 100-160, b: 160-260, c: 260-360, resultado de c: 360-420.
  const rects = [
    { left: 0, width: 100 },
    { left: 100, width: 60 },
    { left: 160, width: 100 },
    { left: 260, width: 100 },
    { left: 360, width: 60 },
  ];

  it("a aba e a do resultado dela são uma caixa só, e a posição é a da lista de abas", () => {
    expect(unitRects(entries, rects)).toEqual([
      { left: 0, width: 160 },
      { left: 160, width: 100 },
      { left: 260, width: 160 },
    ]);
    // Sobre a aba do resultado de "a", antes da metade do par: antes de "a"; depois dela: antes de "b". Nunca entre "a" e o resultado dela.
    expect(dropIndex(unitRects(entries, rects), 70)).toBe(0);
    expect(dropIndex(unitRects(entries, rects), 120)).toBe(1);
    expect(dropIndex(unitRects(entries, rects), 415)).toBe(3);
  });

  it("o marcador cai antes da aba ou, no fim, depois da aba do resultado da última", () => {
    expect(dropMarks(entries, 0)).toEqual(["before", undefined, undefined, undefined, undefined]);
    expect(dropMarks(entries, 1)).toEqual([undefined, undefined, "before", undefined, undefined]);
    expect(dropMarks(entries, 2)).toEqual([undefined, undefined, undefined, "before", undefined]);
    expect(dropMarks(entries, 3)).toEqual([undefined, undefined, undefined, undefined, "after"]);
    expect(dropMarks(entries, null)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("os textos da aba do resultado (RN-ABAS-008, 012 e 014)", () => {
  it("o título, o botão e o anúncio", () => {
    expect(resultTabTitle("consulta-2.sql")).toBe("Resultado · consulta-2.sql");
    expect(placeButtonLabel("panel")).toBe("Onde mostrar o resultado: no painel");
    expect(placeButtonLabel("tab")).toBe("Onde mostrar o resultado: numa aba");
    expect(placeButtonLabel("window")).toBe("Onde mostrar o resultado: numa janela");
    expect(placeAnnouncement("panel")).toBe("Resultado agora no painel.");
    expect(placeAnnouncement("tab")).toBe("Resultado agora numa aba.");
    expect(placeAnnouncement("window")).toBe("Resultado agora numa janela.");
  });

  it("o ponto: o vermelho do script parado ganha dos outros, e o de execução, do resultado novo; e o que entra no nome", () => {
    expect(resultMarkOf({ waiting: true, running: true, unseen: true })).toBe("waiting");
    expect(resultMarkOf({ waiting: false, running: true, unseen: true })).toBe("running");
    expect(resultMarkOf({ waiting: false, running: false, unseen: true })).toBe("unseen");
    expect(resultMarkOf({ waiting: false, running: false, unseen: false })).toBeNull();
    expect(resultMarkText("running")).toBe(", executando");
    expect(resultMarkText("unseen")).toBe(", resultado novo");
    expect(resultMarkText("waiting")).toBe("");
    expect(resultMarkText(null)).toBe("");
  });
});

describe("trackUnseen: o resultado novo que a pessoa ainda não viu (RN-ABAS-012)", () => {
  it("acende quando o comando termina com a aba do resultado não ativa, fica aceso, e apaga quando ela fica ativa", () => {
    let mark = { busy: false, unseen: false };
    mark = trackUnseen(mark, { busy: true, active: false });
    expect(mark.unseen).toBe(false);
    mark = trackUnseen(mark, { busy: false, active: false });
    expect(mark.unseen).toBe(true);
    mark = trackUnseen(mark, { busy: false, active: false });
    expect(mark.unseen).toBe(true);
    mark = trackUnseen(mark, { busy: false, active: true });
    expect(mark.unseen).toBe(false);
  });

  it("o comando que termina com ela ativa não acende nada", () => {
    expect(trackUnseen({ busy: true, unseen: false }, { busy: false, active: true }).unseen).toBe(false);
  });
});

describe("placeMenu: os itens de 'Onde mostrar o resultado' (RN-ABAS-014)", () => {
  it("de escolha única, com o lugar de agora marcado; sem a janela do resultado, 'Numa janela' não aparece", () => {
    expect(placeMenu("tab")).toEqual([
      { place: "panel", label: "No painel", checked: false, disabled: false },
      { place: "tab", label: "Numa aba", checked: true, disabled: false },
    ]);
  });

  it("com a janela, os três; enquanto a aba vai para outra janela, 'Numa janela' fica desabilitado com o motivo", () => {
    expect(placeMenu("panel", { windowAvailable: true }).map((item) => item.label)).toEqual(["No painel", "Numa aba", "Numa janela"]);
    expect(placeMenu("panel", { windowAvailable: true, moving: true })[2]).toEqual({ place: "window", label: "Numa janela", checked: false, disabled: true, hint: "A aba está indo para outra janela." });
  });
});

describe("afterPlaceChange: o foco depois de trocar (RN-ABAS-012 e 014)", () => {
  it("pelo botão da barra, o foco vai com o resultado, no botão", () => {
    expect(afterPlaceChange({ to: "tab", via: "bar", resultWasActive: false })).toEqual({ show: "result", focus: "placeButton" });
    expect(afterPlaceChange({ to: "panel", via: "bar", resultWasActive: true })).toEqual({ show: "query", focus: "placeButton" });
    // Numa janela, ela vem à frente com o foco no botão dela, e a aba da consulta fica ativa na janela da aba.
    expect(afterPlaceChange({ to: "window", via: "bar", resultWasActive: true })).toEqual({ show: "query", focus: "placeButton" });
    expect(afterPlaceChange({ to: "window", via: "bar", resultWasActive: false })).toEqual({ show: "query", focus: "placeButton" });
  });

  it("pelo menu, a ativa não muda; a aba do resultado ativa que some deixa a da consulta ativa, com o foco no botão", () => {
    expect(afterPlaceChange({ to: "tab", via: "menu", resultWasActive: false })).toEqual({ show: "keep", focus: null });
    expect(afterPlaceChange({ to: "panel", via: "menu", resultWasActive: false })).toEqual({ show: "keep", focus: null });
    expect(afterPlaceChange({ to: "panel", via: "menu", resultWasActive: true })).toEqual({ show: "query", focus: "placeButton" });
    expect(afterPlaceChange({ to: "window", via: "menu", resultWasActive: true })).toEqual({ show: "query", focus: "placeButton" });
  });

  it("'Voltar para o painel' da janela do resultado deixa a aba da consulta ativa, com o foco no resultado; fechar a janela pelo sistema não mexe em nada (RN-ABAS-013)", () => {
    expect(afterPlaceChange({ to: "panel", via: "back", resultWasActive: false })).toEqual({ show: "query", focus: "result" });
    expect(afterPlaceChange({ to: "panel", via: "back", resultWasActive: true })).toEqual({ show: "query", focus: "result" });
    expect(afterPlaceChange({ to: "panel", via: "windowClosed", resultWasActive: false })).toEqual({ show: "keep", focus: null });
    expect(afterPlaceChange({ to: "panel", via: "windowClosed", resultWasActive: true })).toEqual({ show: "keep", focus: null });
  });

  it("fechar a aba do resultado ativa deixa a da consulta ativa, com o foco no resultado; a não ativa não mexe em nada", () => {
    expect(afterPlaceChange({ to: "panel", via: "close", resultWasActive: true })).toEqual({ show: "query", focus: "result" });
    expect(afterPlaceChange({ to: "panel", via: "close", resultWasActive: false })).toEqual({ show: "keep", focus: null });
  });
});

describe("f6Action: o F6 alterna entre o editor e o resultado (RN-ABAS-014)", () => {
  it("no painel, do editor ao resultado e de volta; maximizado, no resultado não faz nada", () => {
    expect(f6Action({ place: "panel", from: "editor", mode: "split", resultActive: false })).toBe("focusResult");
    expect(f6Action({ place: "panel", from: "editor", mode: "collapsed", resultActive: false })).toBe("focusResult");
    expect(f6Action({ place: "panel", from: "result", mode: "split", resultActive: false })).toBe("focusEditor");
    expect(f6Action({ place: "panel", from: "result", mode: "maximized", resultActive: false })).toBeNull();
  });

  it("numa aba, troca a aba ativa; da faixa, vale o lado da entrada ativa", () => {
    expect(f6Action({ place: "tab", from: "editor", mode: "split", resultActive: false })).toBe("showResult");
    expect(f6Action({ place: "tab", from: "result", mode: "split", resultActive: true })).toBe("showQuery");
    expect(f6Action({ place: "tab", from: "strip", mode: "split", resultActive: true })).toBe("showQuery");
    expect(f6Action({ place: "tab", from: "strip", mode: "split", resultActive: false })).toBe("showResult");
    expect(f6Action({ place: "panel", from: "strip", mode: "split", resultActive: false })).toBe("focusResult");
  });

  it("numa janela, do editor traz a janela do resultado à frente e, dela, traz a janela da aba", () => {
    expect(f6Action({ place: "window", from: "editor", mode: "split", resultActive: false })).toBe("focusWindow");
    expect(f6Action({ place: "window", from: "result", mode: "split", resultActive: false })).toBe("focusOpener");
    expect(f6Action({ place: "window", from: "strip", mode: "split", resultActive: false })).toBe("focusWindow");
  });

  it("é o F6 sem modificador", () => {
    const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "F6", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
    expect(isF6(key({}))).toBe(true);
    expect(isF6(key({ shiftKey: true }))).toBe(false);
    expect(isF6(key({ ctrlKey: true }))).toBe(false);
    expect(isF6(key({ key: "F5" }))).toBe(false);
  });
});

describe("resultOnView: o resultado à vista, para a atualização automática (RN-ABAS-015)", () => {
  it("no painel, a aba da consulta ativa; numa aba, a aba do resultado ativa; numa janela, a janela não minimizada", () => {
    expect(resultOnView({ place: "panel", selected: true, resultActive: false })).toBe(true);
    expect(resultOnView({ place: "panel", selected: false, resultActive: false })).toBe(false);
    expect(resultOnView({ place: "tab", selected: true, resultActive: false })).toBe(false);
    expect(resultOnView({ place: "tab", selected: true, resultActive: true })).toBe(true);
    expect(resultOnView({ place: "tab", selected: false, resultActive: false })).toBe(false);
    expect(resultOnView({ place: "window", selected: false, resultActive: false, windowShown: true })).toBe(true);
    expect(resultOnView({ place: "window", selected: true, resultActive: false, windowShown: false })).toBe(false);
  });
});

describe("withResultPlace", () => {
  it("troca o lugar só da aba de consulta pedida, e devolve a mesma lista quando nada muda", () => {
    const tabs = [query("a"), table("t")];
    const next = withResultPlace(tabs, "a", "tab");
    expect(next[0].resultPlace).toBe("tab");
    expect(next[1]).toBe(tabs[1]);
    expect(withResultPlace(tabs, "a", "panel")).toBe(tabs);
    expect(withResultPlace(tabs, "t", "tab")).toBe(tabs);
    expect(withResultPlace(tabs, "z", "tab")).toBe(tabs);
  });
});

describe("preferencePlaces: as escolhas de Configurações › Resultados (RN-CONFIG-010)", () => {
  it("sem a janela do resultado, duas, e a preferência 'Numa janela' aparece como o painel; com ela, as três", () => {
    expect(preferencePlaces("tab")).toEqual([
      { place: "panel", checked: false },
      { place: "tab", checked: true },
    ]);
    expect(preferencePlaces("window").find((choice) => choice.checked)?.place).toBe("panel");
    expect(preferencePlaces("window", true).map((choice) => [choice.place, choice.checked])).toEqual([
      ["panel", false],
      ["tab", false],
      ["window", true],
    ]);
  });
});

describe("windowKeyAction: o que a raiz da janela do resultado faz com as teclas (RN-ABAS-015 e 017)", () => {
  const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

  it("o Ctrl+W (Cmd+W no macOS) volta o resultado ao painel", () => {
    expect(windowKeyAction(key({ key: "w" }))).toBe("back");
    expect(windowKeyAction(key({ key: "W" }))).toBe("back");
    expect(windowKeyAction(key({ key: "w", ctrlKey: false, metaKey: true }))).toBe("back");
  });

  it("as teclas do que a janela não tem (a faixa, a conexão, o navegador, Configurações) não passam à aba", () => {
    for (const stopped of [key({ key: "PageUp", shiftKey: true }), key({ key: "PageDown", shiftKey: true }), key({ key: "9" }), key({ key: "b" }), key({ key: "E", shiftKey: true }), key({ key: "," })]) {
      expect(windowKeyAction(stopped)).toBe("stop");
    }
  });

  it("as demais seguem: F5, Alt+X, Ctrl+S, Ctrl+C, as setas, e as mesmas teclas com outro modificador", () => {
    for (const passing of [key({ key: "F5", ctrlKey: false }), key({ key: "x", ctrlKey: false, altKey: true }), key({ key: "s" }), key({ key: "c" }), key({ key: "ArrowDown", ctrlKey: false }), key({ key: "PageUp" }), key({ key: "w", shiftKey: true }), key({ key: "w", altKey: true }), key({ key: "e" }), key({ key: "b", shiftKey: true }), key({ key: "w", ctrlKey: false })]) {
      expect(windowKeyAction(passing)).toBeNull();
    }
  });
});
