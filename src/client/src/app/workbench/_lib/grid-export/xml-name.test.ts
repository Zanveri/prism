import { describe, expect, it } from "vitest";

import { chars } from "./test-fixtures";
import { isXmlNameChar, isXmlNameStart, upperInvariant, xmlName, xmlNameRanges } from "./xml-name";

describe("o nome do XML, pela regra do .NET (RN-EXPORT-012)", () => {
  it("as faixas estão em ordem, não se cruzam, nunca têm o par substituto, e o que começa um nome também pode segui-lo", () => {
    for (const ranges of [xmlNameRanges.start, xmlNameRanges.name]) {
      expect(ranges.length % 2).toBe(0);
      for (let index = 0; index < ranges.length; index += 2) {
        expect(ranges[index]).toBeLessThanOrEqual(ranges[index + 1]);
        if (index > 0) expect(ranges[index]).toBeGreaterThan(ranges[index - 1] + 1);
        expect(ranges[index + 1] < 0xd800 || ranges[index] > 0xdfff).toBe(true);
      }
    }
    for (let code = 0; code < 0x10000; code++) if (isXmlNameStart(code)) expect(isXmlNameChar(code), code.toString(16)).toBe(true);
  });

  it("o que fica e o que vira escape: o dígito, o ponto e o hífen só no meio; o espaço e os dois-pontos sempre", () => {
    expect(xmlName("pedido")).toBe("pedido");
    expect(xmlName("1x")).toBe("_x0031_x");
    expect(xmlName("x1-a.b")).toBe("x1-a.b");
    expect(xmlName("-a")).toBe("_x002D_a");
    expect(xmlName("nota fiscal")).toBe("nota_x0020_fiscal");
    expect(xmlName("a:b")).toBe("a_x003A_b");
    expect(xmlName("")).toBe("");
  });

  it("é o XML da 4ª edição: as letras do Unicode 2.0 ficam, e as mais novas viram escape também no meio do nome", () => {
    expect(xmlName("ação Жук 一龥 가")).toBe("ação_x0020_Жук_x0020_一龥_x0020_가");
    expect(xmlName(`a${chars(0x221)}`)).toBe("a_x0221_");
    expect(xmlName(`a${chars(0x9fa6)}`)).toBe("a_x9FA6_");
    // A marca que se combina e o extensor podem seguir, e não começar.
    expect(xmlName(`${chars(0x300)}a${chars(0x300)}`)).toBe("_x0300_a\u0300");
    expect(xmlName(`${chars(0xb7)}a${chars(0xb7)}`)).toBe("_x00B7_a·");
  });

  it("fora do plano básico, oito dígitos; o par solto, quatro", () => {
    expect(xmlName("emoji😀")).toBe("emoji_x0001F600_");
    expect(xmlName("😀")).toBe("_x0001F600_");
    expect(xmlName(`x${chars(0xd800)}y`)).toBe("x_xD800_y");
  });

  it("o escape já escrito no nome ganha o dele, para a volta ser exata", () => {
    expect(xmlName("_x0041_")).toBe("_x005F_x0041_");
    expect(xmlName("a_X00e9_b")).toBe("a_x005F_X00e9_b");
    expect(xmlName("_x0001F600_")).toBe("_x005F_x0001F600_");
    expect(xmlName("_x0041")).toBe("_x0041");
    expect(xmlName("_x005F_x0041_")).toBe("_x005F_x005F_x005F_x0041_");
  });
});

describe("upperInvariant, o ToUpperInvariant do .NET", () => {
  it("a maiúscula simples de cada ponto de código", () => {
    expect(upperInvariant("ação")).toBe("AÇÃO");
    expect(upperInvariant("straße")).toBe("STRAßE");
    expect(upperInvariant("ﬁm")).toBe("ﬁM");
    expect(upperInvariant("ǅ")).toBe("Ǆ");
    expect(upperInvariant("ᾳ ᾀ")).toBe("ᾼ ᾈ");
    expect(upperInvariant("𐐨")).toBe("𐐀");
  });

  it("o ı sem ponto fica, como no .NET, e o par solto também", () => {
    expect(upperInvariant("ı")).toBe("ı");
    expect(upperInvariant(chars(0xd800))).toBe(chars(0xd800));
  });
});
