import { describe, expect, it } from "vitest";

import { versionArgument, versionFromArgv } from "./app-version";

describe("a versão do app na ponte (RN-VERSAO-004)", () => {
  it("a versão que o processo principal põe na janela é a que o preload lê", () => {
    const argv = ["electron.exe", "--allow-file-access-from-files", versionArgument("0.1.0"), "--outra=1"];

    expect(versionFromArgv(argv)).toBe("0.1.0");
  });

  it("guarda a versão inteira, com pré-lançamento e metadados", () => {
    expect(versionFromArgv([versionArgument("0.2.0-beta.1+build=7")])).toBe("0.2.0-beta.1+build=7");
  });

  it("sem o argumento a versão é vazia, e a tela não escreve um número inventado", () => {
    expect(versionFromArgv(["electron.exe", "--outra=1"])).toBe("");
  });
});
