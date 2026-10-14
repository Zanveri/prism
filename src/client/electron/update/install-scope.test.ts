import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { installedForAllUsers, installerGuid, installLocationOf, regExecutable, type RunReg } from "./install-scope";

/** O UUID v5 (RFC 4122, SHA-1) de um nome num espaço de nomes, como o `builder-util-runtime` o calcula. */
function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(name).digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const builder = readFileSync(new URL("../../electron-builder.yml", import.meta.url), "utf8");
const valueOf = (key: string) => new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, "m").exec(builder)?.[1];

describe("as chaves do registro da instalação (RN-INSTALA-002 e 003)", () => {
  it("o GUID do app é o `nsis.guid` do electron-builder.yml", () => {
    expect(valueOf("guid")).toBe(installerGuid);
  });

  it("e é o que o electron-builder calcula do appId (o espaço de nomes de `NsisTarget.js`): as instalações das versões anteriores, geradas sem `guid`, têm as mesmas chaves", () => {
    const appId = valueOf("appId");

    expect(appId).toBe("com.zanveri.prism");
    expect(uuidV5("50e065bc-3134-11e6-9bab-38c9862bdaf3", appId ?? "")).toBe(installerGuid);
  });
});

describe("a instalação é para todos os usuários? (RN-INSTALA-003)", () => {
  const found = (location: string) => `\r\nHKEY_LOCAL_MACHINE\\Software\\${installerGuid}\r\n    InstallLocation    REG_SZ    ${location}\r\n\r\n`;

  it("lê a pasta da saída do `reg query`, e nada quando o valor está vazio ou não veio", () => {
    expect(installLocationOf(found("C:\\Program Files\\Prism"))).toBe("C:\\Program Files\\Prism");
    expect(installLocationOf(found("D:\\Apps\\Prism  "))).toBe("D:\\Apps\\Prism");
    expect(installLocationOf(`\r\nHKEY_LOCAL_MACHINE\\Software\\${installerGuid}\r\n    InstallLocation    REG_SZ    \r\n`)).toBeNull();
    expect(installLocationOf("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
    expect(installLocationOf("")).toBeNull();
  });

  it("pergunta ao reg.exe do sistema pela chave que o instalador grava em HKLM, na visão de 64 bits, sem shell", async () => {
    const run = vi.fn<RunReg>(async () => ({ status: 0, stdout: found("C:\\Program Files\\Prism") }));

    await expect(installedForAllUsers(run, "C:\\Windows")).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith("C:\\Windows\\System32\\reg.exe", ["query", `HKLM\\Software\\${installerGuid}`, "/v", "InstallLocation", "/reg:64"]);
  });

  it("sem a chave (o reg.exe sai com 1), com o valor vazio ou com o reg.exe falhando: é a instalação só do usuário", async () => {
    await expect(installedForAllUsers(async () => ({ status: 1, stdout: "" }), "C:\\Windows")).resolves.toBe(false);
    await expect(installedForAllUsers(async () => ({ status: 0, stdout: "\r\n    InstallLocation    REG_SZ    \r\n" }), "C:\\Windows")).resolves.toBe(false);
    await expect(installedForAllUsers(async () => ({ status: 1, stdout: found("C:\\Program Files\\Prism") }), "C:\\Windows")).resolves.toBe(false);
    await expect(installedForAllUsers(async () => Promise.reject(new Error("spawn ENOENT")), "C:\\Windows")).resolves.toBe(false);
  });

  it("o reg.exe é o da pasta do Windows; sem ela, ou com uma que não é um caminho absoluto, o padrão", () => {
    expect(regExecutable("D:\\WINDOWS")).toBe("D:\\WINDOWS\\System32\\reg.exe");
    expect(regExecutable(undefined)).toBe("C:\\Windows\\System32\\reg.exe");
    expect(regExecutable("")).toBe("C:\\Windows\\System32\\reg.exe");
    expect(regExecutable("Windows")).toBe("C:\\Windows\\System32\\reg.exe");
    expect(regExecutable("..\\Windows")).toBe("C:\\Windows\\System32\\reg.exe");
  });
});
