// Publica a API junto do app (`pnpm build:api -- <identificador>`): autocontida, para o identificador de runtime pedido
// (`win-x64`, `linux-x64`, `osx-arm64` ou `osx-x64`; sem pedido, o da máquina), em `resources/api/`, de onde o
// `electron-builder` a copia para `resources/api` do pacote (`extraResources`). Sem .NET instalado na máquina do usuário.
// A API recebe a versão do `package.json` (`-p:Version=`, RN-VERSAO-003): é o único lugar onde a versão mora.
//
// `--artifacts-path` leva `bin` e `obj` desta publicação para `.api-publish/` (fora do git), pelo mesmo motivo
// do `.api-dev` do `pnpm dev`: não dividir `src/api/**/bin` com um `dotnet build` ou `dotnet test` da solução, que
// falharia com MSB3021 por DLL preso.
//
// Efeito conhecido, provisório: o restore com `-r` acrescenta o alvo vazio `net10.0/<identificador>` ao
// `packages.lock.json` de cada projeto da API (arquivo versionado). Não há como evitar daqui:
// `-p:RestorePackagesWithLockFile=false` é recusado com NU1005 enquanto o arquivo existe. A correção é da
// API (declarar os identificadores nos projetos e publicar com `RestoreLockedMode`).
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { publishArgs, resolveRuntimeId } from "./api-layout.mjs";
import { dotnetStaging, stageDotnetNotices } from "./licenses.mjs";

const clientDir = join(import.meta.dirname, "..");
const outDir = join(clientDir, "resources", "api");

// O `--` que o pnpm deixa antes dos argumentos não é argumento.
const requested = process.argv.slice(2).find((argument) => argument !== "--");

let runtimeId;
try {
  runtimeId = resolveRuntimeId(requested, process.platform, process.arch);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(clientDir, "package.json"), "utf8"));

// Uma publicação antiga deixaria DLL que a nova não tem.
rmSync(outDir, { recursive: true, force: true });

console.log(`Publicando a API ${version} para ${runtimeId}.`);
const result = spawnSync("dotnet", publishArgs({ project: join(clientDir, "..", "api", "Prism.Api"), runtimeId, version, outDir, artifactsPath: join(clientDir, ".api-publish") }), { stdio: "inherit" });

if (result.error !== undefined) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// O runtime do .NET vai dentro da API autocontida, e o aviso dele (RN-ABERTO-001) vai junto do pacote: copiado aqui, onde o
// `dotnet` existe, e levado a `resources/licenses/dotnet` pelo `electron-builder.yml`. Sem ele a publicação vale, e o `dist` avisa.
const notices = stageDotnetNotices(join(clientDir, dotnetStaging));
if (notices.problem !== undefined) console.warn(`Os avisos de licença do .NET não foram copiados: ${notices.problem}. O pacote sairá sem eles.`);
else console.log(`Avisos do .NET copiados para ${dotnetStaging}: ${notices.copied.join(", ")}.`);
