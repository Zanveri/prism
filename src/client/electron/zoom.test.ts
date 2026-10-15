import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appZoomSteps, defaultAppZoom, isAppZoom, nextAppZoom, parseAppZoom, zoomFactor, zoomShortcut, type ZoomKeyInput } from "./zoom";

describe("os passos do zoom do programa (RN-ZOOM-001)", () => {
  it("são os do zoom da grade, de 50% a 200%, e o padrão é 100%", () => {
    expect(appZoomSteps).toEqual([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200]);
    expect(defaultAppZoom).toBe(100);
  });

  it("aumentar e diminuir andam um passo; nos limites ficam onde estão", () => {
    expect(nextAppZoom(100, "in")).toBe(110);
    expect(nextAppZoom(100, "out")).toBe(90);
    expect(nextAppZoom(67, "out")).toBe(50);
    expect(nextAppZoom(175, "in")).toBe(200);
    expect(nextAppZoom(200, "in")).toBe(200);
    expect(nextAppZoom(50, "out")).toBe(50);
  });

  it("de ponta a ponta, passo a passo, passa por todos os passos", () => {
    const walked: number[] = [50];
    while (walked.at(-1) !== 200) walked.push(nextAppZoom(walked.at(-1) as (typeof appZoomSteps)[number], "in"));

    expect(walked).toEqual([...appZoomSteps]);
  });

  it("voltar (Ctrl 0, \"Restaurar 100%\") vai a 100% de qualquer passo", () => {
    for (const zoom of appZoomSteps) expect(nextAppZoom(zoom, "reset")).toBe(100);
  });

  it("o fator do Chromium é a porcentagem sobre 100", () => {
    expect(zoomFactor(100)).toBe(1);
    expect(zoomFactor(125)).toBe(1.25);
    expect(zoomFactor(50)).toBe(0.5);
  });

  it("só um dos passos é um zoom: o resto (meio-termo, texto, fator, nada) não passa", () => {
    for (const zoom of appZoomSteps) expect(isAppZoom(zoom)).toBe(true);
    for (const other of [105, 0, -100, 300, 1.1, "110", null, undefined, Number.NaN, {}, [110]]) expect(isAppZoom(other), JSON.stringify(other)).toBe(false);
  });
});

describe("parseAppZoom: o arquivo do zoom pode estar ilegível ou mexido à mão, e a leitura nunca lança", () => {
  it("lê o passo gravado", () => {
    expect(parseAppZoom('{"zoom":125}')).toBe(125);
    expect(parseAppZoom('{\n  "zoom": 67\n}')).toBe(67);
  });

  it("o que não é JSON, não é um objeto ou não traz um dos passos vale 100%", () => {
    for (const text of ["", "{", "não é json", "null", "125", "[]", '[{"zoom":125}]', '"125"', '{"zoom":"125"}', '{"zoom":105}', '{"zoom":1.25}', '{"zoom":null}', "{}", '{"outro":125}']) {
      expect(parseAppZoom(text), text).toBe(100);
    }
  });
});

describe("zoomShortcut: Ctrl +, Ctrl − e Ctrl 0 (Cmd no macOS), em qualquer tela, sem menu (RN-ZOOM-001)", () => {
  const key = (over: Partial<ZoomKeyInput> = {}): ZoomKeyInput => ({ type: "keyDown", key: "=", code: "Equal", control: true, meta: false, alt: false, ...over });

  it("Ctrl+= e Ctrl++ (o Shift+= do teclado americano) aumentam; Ctrl+- diminui; Ctrl+0 volta a 100%", () => {
    expect(zoomShortcut(key(), "win32")).toBe("in");
    expect(zoomShortcut(key({ key: "+" }), "win32")).toBe("in");
    expect(zoomShortcut(key({ key: "-", code: "Minus" }), "linux")).toBe("out");
    expect(zoomShortcut(key({ key: "0", code: "Digit0" }), "win32")).toBe("reset");
  });

  it("o teclado numérico também: o + e o -, pela posição, e o 0 com o Num Lock ligado", () => {
    expect(zoomShortcut(key({ key: "+", code: "NumpadAdd" }), "win32")).toBe("in");
    expect(zoomShortcut(key({ key: "-", code: "NumpadSubtract" }), "win32")).toBe("out");
    expect(zoomShortcut(key({ key: "0", code: "Numpad0" }), "linux")).toBe("reset");
  });

  it("Ctrl+Insert é o copiar do Windows e do Linux, também no 0 do teclado numérico com o Num Lock desligado: não é zoom, e chega à página", () => {
    expect(zoomShortcut(key({ key: "Insert", code: "Numpad0" }), "linux")).toBeNull();
    expect(zoomShortcut(key({ key: "Insert", code: "Numpad0" }), "win32")).toBeNull();
    expect(zoomShortcut(key({ key: "Insert", code: "Insert" }), "win32")).toBeNull();
  });

  it("vale o caractere, e não a posição: no teclado alemão o + tem tecla própria", () => {
    expect(zoomShortcut(key({ key: "+", code: "BracketRight" }), "linux")).toBe("in");
  });

  it("no macOS é o Cmd, e o Ctrl de lá não conta; nas outras é o Ctrl, e a tecla do Windows não conta", () => {
    expect(zoomShortcut(key({ control: false, meta: true }), "darwin")).toBe("in");
    expect(zoomShortcut(key(), "darwin")).toBeNull();
    expect(zoomShortcut(key({ control: true, meta: true }), "darwin")).toBeNull();
    expect(zoomShortcut(key({ control: false, meta: true }), "win32")).toBeNull();
    expect(zoomShortcut(key({ control: true, meta: true }), "win32")).toBeNull();
  });

  it("sem Ctrl é digitação (o +, o - e o 0 do editor, e os do diagrama), e com Alt é o AltGr do Windows, que escreve caracteres", () => {
    expect(zoomShortcut(key({ control: false }), "win32")).toBeNull();
    expect(zoomShortcut(key({ key: "0", code: "Digit0", control: false }), "win32")).toBeNull();
    expect(zoomShortcut(key({ alt: true }), "win32")).toBeNull();
  });

  it("só o aperto conta, e outra tecla com Ctrl é de outro atalho (Ctrl+9 é a conexão da aba; Ctrl+Shift+0 é o parêntese)", () => {
    expect(zoomShortcut(key({ type: "keyUp" }), "win32")).toBeNull();
    for (const [name, code] of [["9", "Digit9"], [")", "Digit0"], ["_", "Minus"], ["b", "KeyB"], ["Enter", "Enter"], ["F5", "F5"]]) expect(zoomShortcut(key({ key: name, code }), "win32"), name).toBeNull();
  });
});

describe("o zoom nas janelas do app (main.ts)", () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

  it("a janela nasce no zoom de agora e o recebe de novo a cada navegação: a recarga não a devolve ao zoom com que nasceu depois de voltar a 100%", () => {
    // O `webPreferences.zoomFactor` é reaplicado pelo Electron a cada navegação quando a origem não guarda zoom, e 100% não fica guardado: conferido
    // no Electron, a janela nascida em 125% voltava a 125% ao recarregar depois de ir a 100%, e levava as outras da mesma origem junto.
    expect(main).toMatch(/webPreferences: \{[^}]*zoomFactor: zoomFactor\(appZoom\),/);
    expect(main).toMatch(/window\.webContents\.on\("did-navigate", \(\) => window\.webContents\.setZoomFactor\(zoomFactor\(appZoom\)\)\);/);
  });
});
