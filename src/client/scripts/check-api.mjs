// Falha o `pnpm dist` e o `pnpm dist:dir` quando a API não foi publicada (`pnpm build:api`) ou foi publicada para outra
// plataforma ou arquitetura. Sem isto o electron-builder só avisa "file source doesn't exist", termina com 0 e sai um pacote
// sem API; e com a API errada o pacote instala e a API nunca sobe (um ELF dentro do `.app`, `bad CPU type`).
// Uso: `node scripts/check-api.mjs [win|linux|mac] [x64|arm64]`; sem argumento, a plataforma e a arquitetura da máquina.
import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { apiExecutable, apiMismatch } from "./api-layout.mjs";
import { parseTarget } from "./dist-plan.mjs";

let target;
try {
  target = parseTarget(process.argv.slice(2), process.platform, process.arch);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const executable = apiExecutable(target.nodePlatform);
// O nome do outro sistema: com a API de Linux em `resources/api`, o pacote de Windows não acha o `.exe` e, sem isto, o aviso diria
// só que falta um arquivo, e não o que há no lugar.
const other = apiExecutable(target.nodePlatform === "win32" ? "linux" : "win32");

/** Os primeiros 4 KiB bastam para o cabeçalho; o executável inteiro tem dezenas de KiB a MiB. Sem o arquivo, `null`. */
function readHeader(name) {
  try {
    const descriptor = openSync(join(import.meta.dirname, "..", "resources", "api", name), "r");
    const header = new Uint8Array(4096);
    const length = readSync(descriptor, header, 0, header.length, 0);
    closeSync(descriptor);
    return header.subarray(0, length);
  } catch {
    return null;
  }
}

const header = readHeader(executable);
const found = header ?? readHeader(other);
const mismatch = found === null ? null : apiMismatch(found, target.platform, target.arch);

if (found === null || (header === null && mismatch === null)) {
  console.error(`resources/api/${executable} não existe: rode \`pnpm build:api -- <identificador>\` (o desta plataforma e arquitetura) antes de empacotar.`);
  process.exit(1);
}
if (mismatch !== null) {
  console.error(mismatch);
  process.exit(1);
}
