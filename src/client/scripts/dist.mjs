// Gera os pacotes de uma plataforma (`pnpm dist -- <plataforma> [arquitetura]`): `win`, `linux` ou `mac`; sem argumento, a
// da máquina. Os alvos de cada uma estão em `electron-builder.yml` (RN-ABERTO-006). Sem assinatura e sem publicação: nada de
// token ou certificado.
//
// No Linux, o `.deb` e o `.rpm` pedem a URL pública do projeto, que não está no repositório: a variável de ambiente
// `PRISM_HOMEPAGE` (https://…) a traz. Sem ela, saem o AppImage e o `tar.gz`, o `dist` diz o que ficou de fora e termina com 0.
//
// A origem das atualizações (RN-ATUALIZA-001, RN-GITHUB-005) também não está no repositório: `PRISM_UPDATE_API` (o endereço da
// API do GitHub, https://api.github.com), `PRISM_UPDATE_SITE` (o do site, https://github.com) e `PRISM_UPDATE_REPOSITORY`
// (dono/repositório) vão para o `package.json` do pacote. Sem as três, o pacote sai sem origem e o app não procura versão nova;
// só uma ou duas, ou uma inválida, falha.
//
// A API tem de estar publicada para a mesma plataforma e arquitetura (`pnpm build:api -- <identificador>`), e há uma só em
// `resources/api`. Por isso o macOS, que tem dois pacotes, é gerado uma arquitetura por vez: `build:api -- osx-arm64` e
// `dist -- mac arm64`, depois `build:api -- osx-x64` e `dist -- mac x64`. Sem arquitetura, vale a da máquina.
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

import { apiExecutable, distPlatforms } from "./api-layout.mjs";
import { planDist } from "./dist-plan.mjs";
import { dotnetNotices, dotnetStaging, fontLicenses, missingFiles, projectNotices, stageDotnetNotices } from "./licenses.mjs";

const clientDir = join(import.meta.dirname, "..");

let plan;
try {
  plan = planDist(process.argv.slice(2), process.env, process.platform, process.arch);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const { platform, arch, builderArgs, skipped, updateOrigin } = plan;

if (skipped.length > 0) console.warn(`${skipped.join(" e ")} precisam da URL do projeto: defina PRISM_HOMEPAGE (https://…). Sem ela, ficam de fora.`);
// RN-ATUALIZA-001: a origem é gravada no pacote aqui, e só aqui. Um pacote gerado à mão não procura atualização.
if (!updateOrigin) console.warn("Pacote sem origem de atualizações: defina PRISM_UPDATE_API (https://api.github.com), PRISM_UPDATE_SITE (https://github.com) e PRISM_UPDATE_REPOSITORY (dono/repositório). Sem elas, o app não procura versão nova.");

const require = createRequire(import.meta.url);

/** O arquivo que o `bin` do pacote aponta: rodá-lo com o próprio Node evita shell, `.cmd` e aspas no Windows. */
function binOf(name) {
  const manifest = require.resolve(`${name}/package.json`);
  const { bin } = require(manifest);
  return join(dirname(manifest), typeof bin === "string" ? bin : bin[name]);
}

function run(script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: clientDir, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("scripts/check-api.mjs", platform, arch);

// Os avisos de licença que o `electron-builder.yml` procura (RN-ABERTO-001). Se faltarem, o electron-builder só avisa e gera um
// pacote sem licença: aqui isso é erro.
const missingLicenses = missingFiles(clientDir, [...projectNotices, ...fontLicenses]);
if (missingLicenses.length > 0) {
  console.error(`Faltam arquivos de licença que o pacote leva: ${missingLicenses.join(", ")}.`);
  process.exit(1);
}

// Os do .NET vêm do `build:api` (resources/licenses/dotnet). Se não vieram (a API chegou de outro lugar), tenta pegá-los agora;
// sem o `dotnet` aqui, avisa e segue: o pacote sai sem eles.
if (missingFiles(clientDir, dotnetNotices.map((notice) => join(dotnetStaging, notice))).length > 0) {
  const notices = stageDotnetNotices(join(clientDir, dotnetStaging));
  if (notices.problem !== undefined) console.warn(`Os avisos de licença do .NET (${dotnetNotices.join(", ")}) não estão em ${dotnetStaging}: ${notices.problem}. Rode build:api onde o dotnet existe; o pacote sairá sem eles.`);
}

// A API publicada num Windows chega aqui sem o bit de execução (o `dotnet publish` o grava só no Linux e no macOS), e o
// pacote leva o arquivo como ele está: o app não abriria. No Windows o chmod não faz nada.
if (platform !== "win") chmodSync(join(clientDir, "resources", "api", apiExecutable(distPlatforms[platform])), 0o755);

run(binOf("electron-vite"), "build");
run(binOf("electron-builder"), ...builderArgs);

// De novo no fim, onde quem lê o log da pipeline olha.
if (skipped.length > 0) console.warn(`Pacotes gerados sem ${skipped.join(" e ")}: faltou PRISM_HOMEPAGE.`);
