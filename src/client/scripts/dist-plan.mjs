// A decisão do `pnpm dist -- <plataforma> [arquitetura]`, sem efeito ao importar: plataforma, arquitetura, alvos e argumentos do
// electron-builder. O que roda (conferir a API, o Vite, o electron-builder) está em `dist.mjs`.
import { URL } from "node:url";

import { distPlatforms } from "./api-layout.mjs";

/** As arquiteturas com pacote em cada plataforma (RN-ABERTO-006): só o macOS tem duas. */
export const archsOf = { win: ["x64"], linux: ["x64"], mac: ["arm64", "x64"] };

/**
 * Plataforma e arquitetura do pacote. Sem argumento, as da máquina (no macOS a arquitetura da máquina; no Windows e no Linux,
 * sempre `x64`). `Object.hasOwn`: `constructor` e `toString` não são plataformas.
 *
 * @param {string[]} args o que veio depois do `dist`, sem o `--` do pnpm
 * @param {string} hostPlatform o `process.platform`
 * @param {string} hostArch o `process.arch`
 * @returns {{ platform: string; arch: string; nodePlatform: string }}
 */
export function parseTarget(args, hostPlatform, hostArch) {
  const [requested, requestedArch] = args.filter((argument) => argument !== "--");
  const names = Object.keys(distPlatforms);
  const platform = requested ?? names.find((name) => distPlatforms[name] === hostPlatform);

  if (platform === undefined || !Object.hasOwn(distPlatforms, platform)) throw new Error(`Plataforma desconhecida: "${requested ?? hostPlatform}". Use ${names.join(", ")}.`);

  const arch = requestedArch ?? (platform === "mac" ? hostArch : "x64");
  if (!archsOf[platform].includes(arch)) throw new Error(`Arquitetura sem pacote para ${platform}: "${arch}". Use ${archsOf[platform].join(" ou ")}.`);

  return { platform, arch, nodePlatform: distPlatforms[platform] };
}

/**
 * `PRISM_HOMEPAGE`, a URL pública do projeto: o `.deb` e o `.rpm` a exigem, e ela não mora no repositório (a pipeline a
 * preenche). Vazia ou ausente é "não definida". Definida, tem de ser uma URL `https://` bem formada e sem usuário nem senha, ou
 * falha: o valor vai para a linha de comando do electron-builder e para os metadados de um pacote público. A mensagem não repete
 * o valor.
 *
 * @param {string | undefined} value
 * @returns {string | undefined} a URL normalizada (`URL.href`)
 */
export function parseHomepage(value) {
  if (value === undefined || value.trim() === "") return undefined;

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("PRISM_HOMEPAGE não é uma URL bem formada: use https://… (a URL pública do projeto).");
  }
  if (url.protocol !== "https:") throw new Error("PRISM_HOMEPAGE tem de ser uma URL https://… (a URL pública do projeto).");
  if (url.username !== "" || url.password !== "") throw new Error("PRISM_HOMEPAGE não pode levar usuário nem senha: ela vai para os metadados do pacote.");

  return url.href;
}

/** Vazio é "não definido": ausente, ou texto só de espaços. */
const blank = (value) => value === undefined || (typeof value === "string" && value.trim() === "");

/**
 * Um dos dois endereços da origem: `https://`, sem usuário, senha, consulta nem fragmento, e sem a barra do fim. Pode ter
 * caminho (o GitHub Enterprise Server tem a API em `https://<servidor>/api/v3`). `allowLoopbackHttp`: também
 * `http://127.0.0.1:<porta>`. A mensagem diz qual variável é, e não repete o valor.
 *
 * @param {string} name o nome da variável, para a mensagem
 * @param {string} example como é o valor certo, para a mensagem
 * @param {unknown} value
 * @param {boolean} allowLoopbackHttp
 * @returns {string}
 */
function originAddress(name, example, value, allowLoopbackHttp) {
  const malformed = `${name} não é uma URL bem formada: use ${example}.`;
  if (typeof value !== "string") throw new Error(malformed);

  const text = value.trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(malformed);
  }
  const loopback = allowLoopbackHttp && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !loopback) throw new Error(`${name} tem de ser uma URL https:// (${example}).`);
  if (url.username !== "" || url.password !== "") throw new Error(`${name} não pode levar usuário nem senha: ela vai gravada no pacote.`);
  // `URL.search` e `URL.hash` são vazios para um `?` ou um `#` sem nada depois: o texto é que diz.
  if (text.includes("?") || text.includes("#")) throw new Error(`${name} não pode levar consulta (?…) nem fragmento (#…).`);

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * O dono de um repositório no GitHub (usuário ou organização): letras, dígitos e hífen, de 1 a 39 caracteres, sem hífen nas pontas.
 * O nome do repositório: letras, dígitos, `.`, `_` e `-`, de 1 a 100 caracteres, e nunca `.` nem `..` (nem `..` no meio, que vira
 * outro caminho num endereço). É o que o GitHub aceita, e nada nele precisa de escape num endereço.
 */
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

/**
 * `dono/repositório` no formato do GitHub? Uma barra só, e nada fora do que o GitHub aceita nos dois nomes. O processo principal
 * confere de novo ao montar cada endereço (`electron/update/origin.ts`).
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isRepository(value) {
  return typeof value === "string" && repositoryPattern.test(value) && !value.includes("..") && !value.endsWith("/.");
}

/**
 * A origem das atualizações (RN-ATUALIZA-001, RN-GITHUB-005): o repositório do GitHub de onde o pacote sai, em três valores que a
 * pipeline tira do contexto do workflow — `PRISM_UPDATE_API` (o endereço da API do GitHub, `https://api.github.com`),
 * `PRISM_UPDATE_SITE` (o do site, `https://github.com`) e `PRISM_UPDATE_REPOSITORY` (`dono/repositório`). Não moram no
 * repositório: o `dist` os grava no `package.json` do pacote. Sem os três não há origem (o app não procura atualização); só um ou
 * dois, ou um inválido, falha. Os endereços são `https://`, sem usuário, senha, consulta nem fragmento, e saem sem a barra do fim;
 * o repositório tem uma barra só e só o que o GitHub aceita nos nomes (`isRepository`). A mensagem não repete o valor.
 *
 * O processo principal valida com esta mesma função o que lê do pacote (`electron/update/origin.ts`). `allowLoopbackHttp` é só
 * dele, e só em desenvolvimento: aceita também `http://127.0.0.1:<porta>`, o servidor de mentira das conferências.
 *
 * @param {unknown} api
 * @param {unknown} site
 * @param {unknown} repository
 * @param {{ allowLoopbackHttp?: boolean }} [options]
 * @returns {{ api: string; site: string; repository: string } | undefined}
 */
export function parseUpdateOrigin(api, site, repository, { allowLoopbackHttp = false } = {}) {
  const values = [api, site, repository];
  if (values.every(blank)) return undefined;
  if (values.some(blank)) throw new Error("PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY andam juntas: defina as três (a origem das atualizações) ou nenhuma.");

  const name = typeof repository === "string" ? repository.trim() : repository;
  if (!isRepository(name)) throw new Error("PRISM_UPDATE_REPOSITORY tem de ser dono/repositório no formato do GitHub (letras, dígitos e hífen no dono; letras, dígitos, ponto, sublinhado e hífen no nome, sem ..).");

  return {
    api: originAddress("PRISM_UPDATE_API", "o endereço da API do GitHub, como https://api.github.com", api, allowLoopbackHttp),
    site: originAddress("PRISM_UPDATE_SITE", "o endereço do site do GitHub, como https://github.com", site, allowLoopbackHttp),
    repository: name,
  };
}

/** No Linux, o que só sai com o `homepage` (`.deb` e `.rpm`) e o que sai sem ele. */
const needHomepage = ["deb", "rpm"];
const withoutHomepage = ["AppImage", "tar.gz"];

/**
 * O que o `dist` entrega ao electron-builder. Windows e macOS: os alvos do `electron-builder.yml`. Linux: com
 * `PRISM_HOMEPAGE`, os quatro do yml, com o `homepage` em `-c.extraMetadata.homepage`; sem ela, só o que não precisa dela, e
 * `skipped` diz o que ficou de fora. Em toda plataforma, com `PRISM_UPDATE_API`, `PRISM_UPDATE_SITE` e `PRISM_UPDATE_REPOSITORY`,
 * a origem das atualizações vai em `-c.extraMetadata.prismUpdateApi`, `-c.extraMetadata.prismUpdateSite` e
 * `-c.extraMetadata.prismUpdateRepository` (três chaves planas do `package.json` do pacote, um argumento cada); sem elas,
 * `updateOrigin` é falso e o pacote sai sem origem. Os argumentos vão numa lista, nunca por shell.
 *
 * @param {string[]} args o que veio depois do `dist`
 * @param {Record<string, string | undefined>} env o ambiente (`process.env`)
 * @param {string} hostPlatform o `process.platform`
 * @param {string} hostArch o `process.arch`
 * @returns {{ platform: string; arch: string; nodePlatform: string; builderArgs: string[]; skipped: string[]; updateOrigin: boolean }}
 */
export function planDist(args, env, hostPlatform, hostArch) {
  const { platform, arch, nodePlatform } = parseTarget(args, hostPlatform, hostArch);
  // Só o Linux usa a URL: um valor inválido não derruba o pacote de Windows nem o de macOS.
  const homepage = platform === "linux" ? parseHomepage(env.PRISM_HOMEPAGE) : undefined;
  const limited = platform === "linux" && homepage === undefined;
  const origin = parseUpdateOrigin(env.PRISM_UPDATE_API, env.PRISM_UPDATE_SITE, env.PRISM_UPDATE_REPOSITORY);

  const builderArgs = [
    "--config", "electron-builder.yml",
    `--${platform}`, ...(limited ? withoutHomepage : []),
    `--${arch}`,
    "--publish", "never",
    ...(homepage === undefined ? [] : [`-c.extraMetadata.homepage=${homepage}`]),
    ...(origin === undefined ? [] : [`-c.extraMetadata.prismUpdateApi=${origin.api}`, `-c.extraMetadata.prismUpdateSite=${origin.site}`, `-c.extraMetadata.prismUpdateRepository=${origin.repository}`]),
  ];

  return { platform, arch, nodePlatform, builderArgs, skipped: limited ? needHomepage : [], updateOrigin: origin !== undefined };
}

/**
 * O ambiente do electron-builder e dos passos que o `dist` roda. No macOS tira as `CSC_*` (`CSC_LINK`, `CSC_KEY_PASSWORD`,
 * `CSC_NAME`, `CSC_KEYCHAIN`…): o pacote de macOS leva a assinatura ad hoc (`identity: "-"` no `electron-builder.yml`), que não usa
 * certificado, e com `CSC_LINK` o electron-builder criaria uma keychain com ele e poderia escolhê-lo no lugar da identidade ad hoc.
 * Nas outras plataformas o ambiente segue como está. Devolve uma cópia; não altera `env`.
 *
 * @param {string} platform `win`, `linux` ou `mac`
 * @param {Record<string, string | undefined>} env o ambiente (`process.env`)
 * @returns {Record<string, string | undefined>}
 */
export function builderEnvironment(platform, env) {
  if (platform !== "mac") return { ...env };
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith("CSC_")));
}
