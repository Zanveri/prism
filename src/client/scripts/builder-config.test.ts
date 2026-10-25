import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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

describe("o instalador do Windows (seção 25, RN-INSTALA-001 a 004)", () => {
  const nsis = builder.slice(builder.indexOf("\nnsis:\n"), builder.indexOf("\n\n", builder.indexOf("\nnsis:\n") + 1));

  it("é o assistido, sem perMachine: o manifesto não exige administrador, e o app o abre com spawn para atualizar", () => {
    expect(nsis).toMatch(/^ {2}oneClick: false$/m);
    expect(nsis).not.toMatch(/perMachine|allowElevation: false|selectPerMachineByDefault/);
  });

  it("quem pede a permissão e decide o modo é o include do projeto, que existe", () => {
    expect(nsis).toMatch(/^ {2}include: build\/installer\.nsh$/m);
    const include = read("build/installer.nsh");
    expect(include).toMatch(/^!macro customInit$/m);
    expect(include).toMatch(/^!macro customInstallMode$/m);
    expect(include).toContain("!insertmacro UAC_RunElevated");
  });

  it("o include só existe na compilação do instalador: no desinstalador, nenhuma macro nem variável dele (o electron-builder compila com -WX)", () => {
    const include = read("build/installer.nsh");
    const body = include.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));

    expect(body[0]).toBe("!ifndef BUILD_UNINSTALLER");
    expect(body.at(-1)).toBe("!endif");
    expect(include).not.toMatch(/^\s*Function\b/m);
  });
});

describe("o pacote de macOS leva assinatura ad hoc (issue #33)", () => {
  const start = builder.indexOf("\nmac:\n");
  const mac = builder.slice(start, builder.indexOf("\n\n", start + 1) === -1 ? undefined : builder.indexOf("\n\n", start + 1));

  it("assina com a identidade ad hoc (`-`), sem Hardened Runtime e sem notarização: nada disso pede certificado", () => {
    expect(mac).toMatch(/^ {2}identity: "-"$/m);
    expect(mac).toMatch(/^ {2}hardenedRuntime: false$/m);
    expect(mac).toMatch(/^ {2}notarize: false$/m);
  });

  it("sem entitlements próprios, vale o modelo do electron-builder, que já desliga a validação de bibliotecas (a assinatura ad hoc precisa disso)", () => {
    const keys = lines.filter((line) => !line.trimStart().startsWith("#")).join("\n");
    const require = createRequire(import.meta.url);
    const builderLib = createRequire(require.resolve("electron-builder/package.json"));
    const template = readFileSync(join(dirname(builderLib.resolve("app-builder-lib/package.json")), "templates", "entitlements.mac.plist"), "utf8");

    expect(keys).not.toMatch(/^\s*entitlements(Inherit)?:/m);
    expect(template).toMatch(/<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/);
  });

  it("nenhum certificado nem segredo nas chaves do arquivo (os comentários podem citá-los)", () => {
    const keys = lines.filter((line) => !line.trimStart().startsWith("#")).join("\n");

    expect(keys).not.toMatch(/identity: null|cscLink|cscKeyPassword|cscInstaller|provisioningProfile|CSC_|APPLE_/);
  });
});
