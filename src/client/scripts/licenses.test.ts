import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { dotnetRootFromSdkList, missingFiles } from "./licenses.mjs";

describe("dotnetRootFromSdkList", () => {
  it("a raiz é a pasta que contém sdk, num Windows com vários SDK", () => {
    const output = "8.0.408 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.100 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.401 [C:\\Program Files\\dotnet\\sdk]\r\n";

    expect(dotnetRootFromSdkList(output)).toBe("C:\\Program Files\\dotnet");
  });

  it("e num Linux", () => {
    expect(dotnetRootFromSdkList("10.0.100 [/usr/share/dotnet/sdk]\n")).toBe("/usr/share/dotnet");
  });

  it("saída vazia ou fora do formato não tem raiz", () => {
    expect(dotnetRootFromSdkList("")).toBeUndefined();
    expect(dotnetRootFromSdkList("\n  \n")).toBeUndefined();
    expect(dotnetRootFromSdkList("Não há SDKs instalados.")).toBeUndefined();
  });
});

describe("missingFiles", () => {
  it("devolve só o que não existe", () => {
    const present = new Set([join("base", "a"), join("base", "c")]);

    expect(missingFiles("base", ["a", "b", "c", "d"], (path) => present.has(path))).toEqual(["b", "d"]);
  });

  it("tudo presente: nada falta", () => {
    expect(missingFiles("base", ["a"], () => true)).toEqual([]);
  });
});
