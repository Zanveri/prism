import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readAppZoom, writeAppZoom, zoomFileName } from "./zoom-file";

describe("o arquivo do zoom do programa (RN-ZOOM-001): desta instalação, na pasta de dados, fora do cofre", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-zoom-"));
  const file = join(dir, "dados", zoomFileName);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("grava e lê de volta; a pasta é criada se não existe, e nada fica pela metade ao lado", () => {
    writeAppZoom(file, 125);

    expect(readAppZoom(file)).toBe(125);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ zoom: 125 });

    writeAppZoom(file, 90);
    expect(readAppZoom(file)).toBe(90);
  });

  it("arquivo que não existe, ilegível ou que é uma pasta: 100%, sem derrubar nada", () => {
    expect(readAppZoom(file)).toBe(100);

    mkdirSync(file, { recursive: true });
    expect(readAppZoom(file)).toBe(100);
  });

  it("arquivo adulterado ou cortado: 100%", () => {
    mkdirSync(join(dir, "dados"), { recursive: true });
    writeFileSync(file, '{"zoom": 12');
    expect(readAppZoom(file)).toBe(100);

    writeFileSync(file, '{"zoom": 400}');
    expect(readAppZoom(file)).toBe(100);
  });
});
