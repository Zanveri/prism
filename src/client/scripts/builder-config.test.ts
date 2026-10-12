import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dotnetStaging, fontLicenses, projectNotices } from "./licenses.mjs";

// O `electron-builder.yml` e o `package.json` são lidos como texto: não há analisador de YAML no projeto, e o que se confere
// aqui são linhas que têm de bater entre os arquivos.
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const builder = read("electron-builder.yml");
const pkg = JSON.parse(read("package.json")) as { desktopName?: string };
const lines = builder.split("\n");
const valuesOf = (key: string) => lines.map((line) => new RegExp(`^\\s+(?:- )?${key}:\\s*(\\S+)\\s*$`).exec(line)?.[1]).filter((value) => value !== undefined);

describe("o app no Linux (RN-MARCA-001)", () => {
  it("o desktopName é o executável mais .desktop, e o electron-builder faz o .desktop do pacote ter esse nome", () => {
    const [executable] = valuesOf("executableName");

    expect(executable).toBeDefined();
    expect(pkg.desktopName).toBe(`${executable}.desktop`);
    expect(valuesOf("syncDesktopName")).toEqual(["true"]);
  });
});

describe("avisos de licença no pacote (RN-ABERTO-001)", () => {
  it("o electron-builder.yml leva todo arquivo que o dist confere antes de empacotar, com os mesmos caminhos", () => {
    for (const path of [...projectNotices, ...fontLicenses, dotnetStaging]) expect(valuesOf("from")).toContain(path);
  });

  it("cada um vai para resources/ (o LICENSE e o NOTICE) ou para resources/licenses/", () => {
    expect(valuesOf("to")).toEqual(expect.arrayContaining(["LICENSE", "NOTICE", "licenses/ibm-plex-sans/LICENSE", "licenses/ibm-plex-mono/LICENSE", "licenses/dotnet"]));
  });
});
