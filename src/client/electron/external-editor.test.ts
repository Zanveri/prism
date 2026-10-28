import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanExternalEditorTempDir,
  openCellInExternalEditor,
   parseExternalEditorRequest,
} from "./external-editor";

describe("parseExternalEditorRequest: validação da chamada IPC do editor externo (RN-SHELL-002)", () => {
  it("aceita conteúdo de texto com extensão permitida (txt, json, xml, html) e higieniza o nome base", () => {
    expect(
      parseExternalEditorRequest({
        content: '{"id": 1}',
        extension: "json",
        name: "payload/cliente",
      }),
    ).toEqual({
      content: '{"id": 1}',
      extension: "json",
      baseName: "payload_cliente",
    });
  });

  it("usa txt quando a extensão não está na lista permitida (nunca aceita extensões executáveis como exe, bat, ps1, sh)", () => {
    expect(
      parseExternalEditorRequest({
        content: "echo oi",
        extension: "bat",
        name: "script",
      }),
    ).toEqual({
      content: "echo oi",
      extension: "txt",
      baseName: "script",
    });

    expect(
      parseExternalEditorRequest({
        content: "binario",
        extension: "exe",
      }),
    ).toEqual({
      content: "binario",
      extension: "txt",
      baseName: "valor",
    });
  });

  it("recusa chamadas inválidas, sem texto ou que passem do limite de 32 MiB", () => {
    expect(parseExternalEditorRequest(null)).toBeNull();
    expect(parseExternalEditorRequest({})).toBeNull();
    expect(parseExternalEditorRequest({ content: 123, extension: "txt" })).toBeNull();
    expect(
      parseExternalEditorRequest({
        content: "a".repeat(32 * 1024 * 1024 + 1),
        extension: "txt",
      }),
    ).toBeNull();
  });
});

describe("openCellInExternalEditor: gravação temporária segura e abertura no sistema", () => {
  const tempDirs: string[] = [];

  function makeTempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prism-ext-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("grava o valor em arquivo temporário com a extensão correta e chama openPath sem devolver caminho à tela", async () => {
    const root = makeTempRoot();
    let openedPath = "";
    const openPath = vi.fn(async (target: string) => {
      openedPath = target;
      return "";
    });

    const ok = await openCellInExternalEditor(
      { content: '{\n  "ok": true\n}', extension: "json", name: "content" },
      { tempRoot: root, openPath },
    );

    expect(ok).toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(path.basename(openedPath)).toMatch(/^content-[a-f0-9]+\.json$/);
    expect(fs.readFileSync(openedPath, "utf-8")).toBe('{\n  "ok": true\n}');

    cleanExternalEditorTempDir(root);
    expect(fs.existsSync(path.dirname(openedPath))).toBe(false);
  });

  it("devolve false quando o pedido é inválido ou quando o sistema falha ao abrir o arquivo", async () => {
    const root = makeTempRoot();
    const openPath = vi.fn(async () => "Falha ao abrir editor");

    expect(await openCellInExternalEditor(null, { tempRoot: root, openPath })).toBe(false);
    expect(openPath).not.toHaveBeenCalled();

    expect(
      await openCellInExternalEditor(
        { content: "texto", extension: "txt", name: "col" },
        { tempRoot: root, openPath },
      ),
    ).toBe(false);
  });
});
