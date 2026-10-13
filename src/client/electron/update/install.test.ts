import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverToDownloads, installerArguments, runInstaller, type SpawnInstaller } from "./install";

describe("o instalador do Windows (RN-ATUALIZA-006)", () => {
  it("os argumentos são os três que o instalador NSIS deste projeto entende, e só eles", () => {
    expect(installerArguments).toEqual(["--updated", "/S", "--force-run"]);
  });

  it("nenhum escolhe o modo: o instalador atualiza a instalação que existe, no modo dela (RN-INSTALA-002); um /currentuser recusaria a de todos", () => {
    for (const mode of ["/allusers", "/currentuser"]) expect(installerArguments).not.toContain(mode);
  });

  function fakeSpawn() {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn<SpawnInstaller>(() => child);
    return { child, spawn };
  }

  it("roda o arquivo conferido com os três argumentos, desanexado e sem shell, e solta o processo", async () => {
    const { child, spawn } = fakeSpawn();
    const pending = runInstaller(spawn, "C:\\dados\\updates\\0.2.0\\Prism-0.2.0-win-x64.exe");
    child.emit("spawn");
    await pending;

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("C:\\dados\\updates\\0.2.0\\Prism-0.2.0-win-x64.exe", ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", shell: false });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("se o processo não chega a iniciar, falha com a causa (e o app não encerra)", async () => {
    const { child, spawn } = fakeSpawn();
    const pending = runInstaller(spawn, "C:\\x.exe");
    child.emit("error", new Error("spawn EACCES"));

    await expect(pending).rejects.toThrow(/EACCES/);
  });
});

describe("Linux e macOS: o pacote conferido vai para a pasta de downloads (RN-ATUALIZA-006)", () => {
  let dir: string;
  let source: string;
  let downloads: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prism-deliver-"));
    downloads = join(dir, "Downloads");
    mkdirSync(join(dir, "updates"));
    source = join(dir, "updates", "Prism-0.2.0-linux-amd64.deb");
    writeFileSync(source, "pacote conferido");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("move o arquivo, com o nome dele, e devolve onde ficou; a pasta é criada se não existe", async () => {
    const delivered = await deliverToDownloads(source, downloads);

    expect(delivered).toBe(join(downloads, "Prism-0.2.0-linux-amd64.deb"));
    expect(readFileSync(delivered, "utf8")).toBe("pacote conferido");
    expect(existsSync(source)).toBe(false);
  });

  it("não grava por cima do que a pessoa já tem lá: escolhe um nome livre", async () => {
    mkdirSync(downloads);
    writeFileSync(join(downloads, "Prism-0.2.0-linux-amd64.deb"), "arquivo da pessoa");
    writeFileSync(join(downloads, "Prism-0.2.0-linux-amd64 (1).deb"), "outro da pessoa");

    const delivered = await deliverToDownloads(source, downloads);

    expect(basename(delivered)).toBe("Prism-0.2.0-linux-amd64 (2).deb");
    expect(readFileSync(join(downloads, "Prism-0.2.0-linux-amd64.deb"), "utf8")).toBe("arquivo da pessoa");
    expect(readdirSync(downloads).length).toBe(3);
  });

  it("extensão dupla fica inteira no nome livre", async () => {
    const tar = join(dir, "updates", "Prism-0.2.0-linux-x64.tar.gz");
    writeFileSync(tar, "pacote");
    mkdirSync(downloads);
    writeFileSync(join(downloads, "Prism-0.2.0-linux-x64.tar.gz"), "arquivo da pessoa");

    expect(basename(await deliverToDownloads(tar, downloads))).toBe("Prism-0.2.0-linux-x64 (1).tar.gz");
  });
});
