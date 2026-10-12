import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { choosePackage, isPackageFile, packageFiles, type InstallFacts } from "./packages";

const facts = (overrides: Partial<InstallFacts>): InstallFacts => ({ platform: "win32", arch: "x64", appImage: false, execPath: "C:\\Programas\\Prism\\Prism.exe", debInstalled: false, hasRpm: false, nsisInstalled: true, ...overrides });
const linux = (overrides: Partial<InstallFacts>) => facts({ platform: "linux", execPath: "/opt/Prism/prism", ...overrides });

describe("a lista de pacotes", () => {
  it("é a de scripts/ci/packages.txt, grupo por grupo e na mesma ordem: as duas não divergem em silêncio", () => {
    const pipeline = readFileSync(new URL("../../../../scripts/ci/packages.txt", import.meta.url), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => line.split(/\s+/).join(" "));

    expect(packageFiles.map(({ group, file }) => `${group} ${file}`)).toEqual(pipeline);
  });

  it("isPackageFile só reconhece o nome de um pacote daquela versão, ou o SHA256SUMS", () => {
    expect(isPackageFile("0.2.0", "Prism-0.2.0-linux-amd64.deb")).toBe(true);
    expect(isPackageFile("0.2.0", "SHA256SUMS")).toBe(true);
    for (const file of ["Prism-0.3.0-linux-amd64.deb", "Prism-@VERSION@-linux-amd64.deb", "../Prism-0.2.0-linux-amd64.deb", "prism-0.2.0-linux-amd64.deb", ""]) expect(isPackageFile("0.2.0", file), file).toBe(false);
  });
});

describe("o pacote da instalação em uso (RN-ATUALIZA-005 e 006)", () => {
  it("Windows x64 instalado pelo instalador (há o desinstalador ao lado do executável): o instalador", () => {
    expect(choosePackage("0.2.0", facts({}))).toEqual({ format: "nsis", fileName: "Prism-0.2.0-win-x64.exe" });
  });

  it("Windows x64 rodando do zip portátil (sem desinstalador): o zip, e nunca o instalador", () => {
    expect(choosePackage("0.2.0", facts({ nsisInstalled: false }))).toEqual({ format: "zip", fileName: "Prism-0.2.0-win-x64.zip" });
  });

  it("o desinstalador só conta no Windows: Linux e macOS seguem o formato deles", () => {
    expect(choosePackage("0.2.0", linux({ nsisInstalled: true, appImage: true }))?.format).toBe("AppImage");
    expect(choosePackage("0.2.0", facts({ platform: "darwin", arch: "arm64", nsisInstalled: true }))?.format).toBe("dmg");
  });

  it("Linux rodando de um AppImage: o AppImage, mesmo havendo gerenciador de pacotes", () => {
    expect(choosePackage("0.2.0", linux({ appImage: true, execPath: "/tmp/.mount_PrismAbCd/prism", debInstalled: true, hasRpm: true }))).toEqual({ format: "AppImage", fileName: "Prism-0.2.0-linux-x86_64.AppImage" });
  });

  it("Linux instalado por pacote: deb quando o dpkg tem o pacote, senão rpm quando há rpm", () => {
    expect(choosePackage("0.2.0", linux({ debInstalled: true, hasRpm: true }))).toEqual({ format: "deb", fileName: "Prism-0.2.0-linux-amd64.deb" });
    expect(choosePackage("0.2.0", linux({ hasRpm: true }))).toEqual({ format: "rpm", fileName: "Prism-0.2.0-linux-x86_64.rpm" });
  });

  it("Linux fora de /opt, ou em /opt sem gerenciador que o conheça: tar.gz", () => {
    expect(choosePackage("0.2.0", linux({ execPath: "/usr/local/prism/prism", debInstalled: true, hasRpm: true }))).toEqual({ format: "tar.gz", fileName: "Prism-0.2.0-linux-x64.tar.gz" });
    expect(choosePackage("0.2.0", linux({}))).toEqual({ format: "tar.gz", fileName: "Prism-0.2.0-linux-x64.tar.gz" });
    expect(choosePackage("0.2.0", linux({ execPath: "/optativo/Prism/prism", hasRpm: true }))?.format).toBe("tar.gz");
  });

  it("macOS: o dmg da arquitetura em uso", () => {
    expect(choosePackage("0.2.0", facts({ platform: "darwin", arch: "arm64" }))).toEqual({ format: "dmg", fileName: "Prism-0.2.0-mac-arm64.dmg" });
    expect(choosePackage("0.2.0", facts({ platform: "darwin", arch: "x64" }))).toEqual({ format: "dmg", fileName: "Prism-0.2.0-mac-x64.dmg" });
  });

  it("plataforma ou arquitetura sem pacote: nenhum, em vez do pacote de outra", () => {
    expect(choosePackage("0.2.0", facts({ arch: "arm64" }))).toBeNull();
    expect(choosePackage("0.2.0", facts({ arch: "ia32" }))).toBeNull();
    expect(choosePackage("0.2.0", linux({ arch: "arm64" }))).toBeNull();
    expect(choosePackage("0.2.0", facts({ platform: "darwin", arch: "ia32" }))).toBeNull();
    expect(choosePackage("0.2.0", facts({ platform: "freebsd" }))).toBeNull();
  });

  it("todo nome escolhido está na lista da pipeline", () => {
    const all = [facts({}), facts({ nsisInstalled: false }), linux({ appImage: true }), linux({ debInstalled: true }), linux({ hasRpm: true }), linux({}), facts({ platform: "darwin", arch: "arm64" }), facts({ platform: "darwin", arch: "x64" })];
    for (const each of all) expect(isPackageFile("1.2.3", choosePackage("1.2.3", each)!.fileName)).toBe(true);
  });
});
