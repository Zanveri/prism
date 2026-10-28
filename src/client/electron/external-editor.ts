import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { safeFileBase } from "./file-name";

/** As extensões de arquivo de texto permitidas ao abrir um valor de célula no editor externo. */
export const allowedExternalExtensions = ["txt", "json", "xml", "html"] as const;

export type ExternalEditorExtension = (typeof allowedExternalExtensions)[number];

/** O teto de tamanho (32 MiB) para abrir um valor no editor externo. */
export const maxExternalEditorBytes = 32 * 1024 * 1024;

const tempSubfolder = "prism-cell-viewer";

export type ExternalEditorRequest = {
  content: string;
  extension: ExternalEditorExtension;
  baseName: string;
};

function isAllowedExtension(value: string): value is ExternalEditorExtension {
  return (allowedExternalExtensions as readonly string[]).includes(value);
}

/**
 * Confere o pedido que veio pelo IPC (`prism:open-external-editor`): o conteúdo deve ser texto dentro do limite de 32 MiB,
 * a extensão cai em `txt` se não estiver entre as permitidas (`txt`, `json`, `xml`, `html`), e o nome passa por `safeFileBase`.
 */
export function parseExternalEditorRequest(input: unknown): ExternalEditorRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.content !== "string") return null;
  if (record.content.length > maxExternalEditorBytes || Buffer.byteLength(record.content, "utf-8") > maxExternalEditorBytes) {
    return null;
  }

  const rawExt = typeof record.extension === "string" ? record.extension.trim().toLowerCase().replace(/^\./, "") : "txt";
  const extension: ExternalEditorExtension = isAllowedExtension(rawExt) ? rawExt : "txt";
  const rawName = typeof record.name === "string" && record.name.trim().length > 0 ? record.name : "valor";
  const baseName = safeFileBase(rawName);

  return {
    content: record.content,
    extension,
    baseName,
  };
}

/**
 * Grava o valor da célula num arquivo temporário seguro (`0o600`) dentro de `prism-cell-viewer` e pede ao sistema que o abra
 * no aplicativo associado (`openPath`), sem nunca devolver caminhos do sistema de arquivos para a tela (RN-SHELL-002) nem
 * escrever caminhos ou conteúdo no log (RN-LOG-001).
 */
export async function openCellInExternalEditor(
  input: unknown,
  deps: { tempRoot: string; openPath: (filePath: string) => Promise<string> },
): Promise<boolean> {
  const parsed = parseExternalEditorRequest(input);
  if (parsed === null) return false;

  try {
    const dir = path.join(deps.tempRoot, tempSubfolder);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const suffix = crypto.randomBytes(4).toString("hex");
    const fileName = `${parsed.baseName}-${suffix}.${parsed.extension}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, parsed.content, { encoding: "utf-8", mode: 0o600 });

    const errorMessage = await deps.openPath(filePath);
    return errorMessage === "";
  } catch {
    return false;
  }
}

/** Remove a pasta temporária do visualizador de células ao encerrar o aplicativo. */
export function cleanExternalEditorTempDir(tempRoot: string): void {
  try {
    const dir = path.join(tempRoot, tempSubfolder);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Falha ao limpar arquivo temporário no encerramento não impede a saída.
  }
}
