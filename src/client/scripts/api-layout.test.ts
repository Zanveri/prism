import { describe, expect, it } from "vitest";

import { apiExecutable, apiMismatch, distPlatforms, executableTarget, publishArgs, resolveRuntimeId } from "./api-layout.mjs";

describe("apiExecutable", () => {
  it("é Prism.Api.exe no Windows e Prism.Api no Linux e no macOS", () => {
    expect(apiExecutable("win32")).toBe("Prism.Api.exe");
    expect(apiExecutable("linux")).toBe("Prism.Api");
    expect(apiExecutable("darwin")).toBe("Prism.Api");
  });

  it("só a plataforma win do dist tem o executável com .exe", () => {
    for (const [name, platform] of Object.entries(distPlatforms)) expect(apiExecutable(platform).endsWith(".exe")).toBe(name === "win");
  });
});

describe("resolveRuntimeId", () => {
  it("aceita os quatro identificadores do pacote (RN-ABERTO-006)", () => {
    for (const id of ["win-x64", "linux-x64", "osx-arm64", "osx-x64"]) expect(resolveRuntimeId(id, "win32", "x64")).toBe(id);
  });

  it("sem pedido, usa o da máquina", () => {
    expect(resolveRuntimeId(undefined, "win32", "x64")).toBe("win-x64");
    expect(resolveRuntimeId(undefined, "linux", "x64")).toBe("linux-x64");
    expect(resolveRuntimeId(undefined, "darwin", "arm64")).toBe("osx-arm64");
    expect(resolveRuntimeId(undefined, "darwin", "x64")).toBe("osx-x64");
  });

  it("identificador desconhecido falha dizendo quais valem", () => {
    expect(() => resolveRuntimeId("win-arm64", "win32", "x64")).toThrow(/desconhecido: "win-arm64".*win-x64, linux-x64, osx-arm64, osx-x64/);
  });

  it("máquina sem pacote e sem pedido falha, em vez de adivinhar", () => {
    expect(() => resolveRuntimeId(undefined, "linux", "arm64")).toThrow(/Não há pacote para esta máquina \(linux\/arm64\)/);
  });
});

describe("publishArgs", () => {
  const options = { project: "api/Prism.Api", version: "9.9.9", outDir: "out", artifactsPath: "art" };
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it("publica para o identificador pedido, e para nenhum outro", () => {
    for (const runtimeId of ["win-x64", "linux-x64", "osx-arm64", "osx-x64"]) expect(after(publishArgs({ ...options, runtimeId }), "-r")).toBe(runtimeId);
  });

  it("passa a versão recebida, uma vez só (RN-VERSAO-003)", () => {
    const args = publishArgs({ ...options, runtimeId: "win-x64" });

    expect(args.filter((argument) => argument.startsWith("-p:Version="))).toEqual(["-p:Version=9.9.9"]);
  });

  it("é autocontida, para o app não depender de .NET instalado", () => {
    expect(after(publishArgs({ ...options, runtimeId: "win-x64" }), "--self-contained")).toBe("true");
  });
});

// Cabeçalhos mínimos, só com os campos que a leitura usa.
function pe(machine: number) {
  const bytes = new Uint8Array(0x90);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]);
  view.setUint32(0x3c, 0x80, true);
  bytes.set([0x50, 0x45, 0, 0], 0x80);
  view.setUint16(0x84, machine, true);
  return bytes;
}
function elf(machine: number, little = true) {
  const bytes = new Uint8Array(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, little ? 1 : 2]);
  new DataView(bytes.buffer).setUint16(18, machine, little);
  return bytes;
}
function macho(cputype: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0xcf, 0xfa, 0xed, 0xfe]);
  new DataView(bytes.buffer).setUint32(4, cputype, true);
  return bytes;
}
const text = new TextEncoder().encode("#!/bin/sh\necho isto não é um executável\n");

describe("executableTarget", () => {
  it("PE: Windows, com a arquitetura de Machine", () => {
    expect(executableTarget(pe(0x8664))).toEqual({ system: "windows", arch: "x64" });
    expect(executableTarget(pe(0xaa64))).toEqual({ system: "windows", arch: "arm64" });
  });

  it("ELF: Linux, com a arquitetura de e_machine, em little e em big endian", () => {
    expect(executableTarget(elf(0x3e))).toEqual({ system: "linux", arch: "x64" });
    expect(executableTarget(elf(0xb7))).toEqual({ system: "linux", arch: "arm64" });
    expect(executableTarget(elf(0xb7, false))).toEqual({ system: "linux", arch: "arm64" });
  });

  it("Mach-O de 64 bits: macOS, com a arquitetura de cputype", () => {
    expect(executableTarget(macho(0x01000007))).toEqual({ system: "macos", arch: "x64" });
    expect(executableTarget(macho(0x0100000c))).toEqual({ system: "macos", arch: "arm64" });
  });

  it("arquitetura que o Prism não empacota é dita como desconhecida, com o código", () => {
    expect(executableTarget(pe(0x14c))).toEqual({ system: "windows", arch: "desconhecida (0x14c)" });
  });

  it("o que não é executável conhecido dá null: texto, vazio, curto demais, MZ sem cabeçalho PE", () => {
    expect(executableTarget(text)).toBeNull();
    expect(executableTarget(new Uint8Array(0))).toBeNull();
    expect(executableTarget(Uint8Array.from([0x7f, 0x45]))).toBeNull();
    expect(executableTarget(Uint8Array.from([0x4d, 0x5a, 0, 0]))).toBeNull();
  });
});

describe("apiMismatch", () => {
  it("a API certa para cada pacote passa", () => {
    expect(apiMismatch(pe(0x8664), "win", "x64")).toBeNull();
    expect(apiMismatch(elf(0x3e), "linux", "x64")).toBeNull();
    expect(apiMismatch(macho(0x0100000c), "mac", "arm64")).toBeNull();
    expect(apiMismatch(macho(0x01000007), "mac", "x64")).toBeNull();
  });

  it("a API de Linux no pacote de macOS é recusada, dizendo o que achou, o que esperava e o que rodar", () => {
    expect(apiMismatch(elf(0x3e), "mac", "arm64")).toBe("A API em resources/api é linux-x64, e o pacote pedido é macOS arm64: rode build:api -- osx-arm64.");
  });

  it("a API de outra arquitetura do mesmo sistema é recusada (bad CPU type)", () => {
    expect(apiMismatch(macho(0x0100000c), "mac", "x64")).toBe("A API em resources/api é osx-arm64, e o pacote pedido é macOS x64: rode build:api -- osx-x64.");
  });

  it("a API de Windows no pacote de Linux e a de Linux no pacote de Windows são recusadas", () => {
    expect(apiMismatch(pe(0x8664), "linux", "x64")).toMatch(/é win-x64.*Linux x64.*build:api -- linux-x64/);
    expect(apiMismatch(elf(0x3e), "win", "x64")).toMatch(/é linux-x64.*Windows x64.*build:api -- win-x64/);
  });

  it("um arquivo que não é executável é recusado com o que rodar", () => {
    expect(apiMismatch(text, "linux", "x64")).toMatch(/não é um PE, um ELF nem um Mach-O.*build:api -- linux-x64/);
  });
});
