import { isRepository, parseUpdateOrigin } from "../../scripts/dist-plan.mjs";
import { isPackageFile } from "./packages";
import { isReleaseVersion } from "./version";

/**
 * O repositório do GitHub de onde o pacote saiu (RN-ATUALIZA-001): o endereço da API (`https://api.github.com`), o do site
 * (`https://github.com`), os dois sem a barra do fim, e o `dono/repositório`.
 */
export type UpdateOrigin = { api: string; site: string; repository: string };

/**
 * De onde vêm as atualizações (RN-ATUALIZA-001).
 *
 * - App empacotado: SÓ do `package.json` do pacote, onde o `dist` gravou `prismUpdateApi`, `prismUpdateSite` e
 *   `prismUpdateRepository` (`scripts/dist-plan.mjs`), e só `https://`. Variável de ambiente em tempo de execução nunca muda a
 *   origem: quem a definisse faria o app baixar e executar um instalador de outro servidor (a mesma regra do
 *   `ELECTRON_RENDERER_URL`).
 * - Desenvolvimento (app não empacotado), e só nele: das variáveis `PRISM_UPDATE_API`, `PRISM_UPDATE_SITE` e
 *   `PRISM_UPDATE_REPOSITORY`, e os endereços podem ser `http://127.0.0.1:<porta>`. É como se confere o caminho inteiro contra um
 *   servidor de mentira.
 *
 * Valor ausente ou inválido é "sem origem": o app não procura atualização, e diz isso quando o usuário pede para verificar.
 * `problem` é o motivo, para o log, sem o valor.
 */
export function resolveOrigin({ isPackaged, metadata, env }: { isPackaged: boolean; metadata: Record<string, unknown>; env: Record<string, string | undefined> }): { origin: UpdateOrigin | null; problem?: string } {
  try {
    const origin = isPackaged ? parseUpdateOrigin(metadata.prismUpdateApi, metadata.prismUpdateSite, metadata.prismUpdateRepository) : parseUpdateOrigin(env.PRISM_UPDATE_API, env.PRISM_UPDATE_SITE, env.PRISM_UPDATE_REPOSITORY, { allowLoopbackHttp: true });
    return { origin: origin ?? null };
  } catch (error) {
    return { origin: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Os argumentos de linha de comando do Chromium que tiram a garantia do HTTPS (RN-ATUALIZA-008): os dois primeiros fazem o
 * transporte aceitar um certificado que não confere; os dois últimos mandam o pedido ao servidor da origem para outro
 * endereço. Juntos, entregam a consulta, as somas e o pacote a quem estiver no caminho.
 */
const unsafeSwitches = ["ignore-certificate-errors", "ignore-certificate-errors-spki-list", "host-resolver-rules", "host-rules"];

/**
 * O app empacotado aberto com um desses argumentos não procura nem baixa atualização nesta abertura: a conferência do
 * certificado nunca é desligada, então quem a desligou fica sem atualizador, e "Verificar atualizações" diz por quê. Em
 * desenvolvimento a regra não se aplica: lá a origem já é a que quem abriu o app escolheu.
 */
export function updatesBlocked({ isPackaged, hasSwitch }: { isPackaged: boolean; hasSwitch(name: string): boolean }): boolean {
  return isPackaged && unsafeSwitches.some((name) => hasSwitch(name));
}

/** A origem só nasce validada (`parseUpdateOrigin`); o endereço confere de novo o repositório, porque é dele que sai o caminho. */
function repositoryOf({ repository }: UpdateOrigin): string {
  if (!isRepository(repository)) throw new Error("Repositório fora do formato dono/repositório: não vira endereço.");
  return repository;
}

/** Quantas releases a API do GitHub devolve por página, no máximo, e quantas páginas o app pede, no máximo (RN-ATUALIZA-002). */
export const releasesPerPage = 100;
export const maxReleasePages = 5;

/**
 * Uma página da lista de releases do repositório (RN-ATUALIZA-002), na API do GitHub. Repositório público: a consulta não leva
 * credencial. Cem por página, o máximo da API (os betas contam: a pipeline publica um a cada merge na `develop`). A primeira
 * página é a de sempre; as seguintes, só quando a primeira veio cheia sem chegar à versão instalada, e o endereço delas é montado
 * aqui, com o número da página (o cabeçalho `Link` da resposta não é seguido), até `maxReleasePages`.
 */
export function releasesUrl(origin: UpdateOrigin, page = 1): string {
  if (!Number.isInteger(page) || page < 1 || page > maxReleasePages) throw new Error("Página da lista de releases fora do teto: não vira endereço.");

  return `${origin.api}/repos/${repositoryOf(origin)}/releases?per_page=${releasesPerPage}${page === 1 ? "" : `&page=${page}`}`;
}

/**
 * Os cabeçalhos que a API do GitHub pede: o tipo da resposta e a versão da API. Nenhum identifica quem pergunta; o agente
 * (`Prism/<versão>`) é posto pelo transporte em todo pedido.
 */
export const githubApiHeaders: Readonly<Record<string, string>> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/**
 * O endereço de um arquivo da versão (RN-ATUALIZA-005): o de download de um arquivo de release do GitHub,
 * `{site}/{dono}/{repositório}/releases/download/v{versão}/{arquivo}`. É o único jeito de o app chegar a um endereço de download:
 * a origem gravada, a versão validada (`X.Y.Z` ou `X.Y.Z-beta.N`: a tag é `v` mais ela, e o nome dos arquivos de um beta leva a
 * versão inteira) e um nome da lista de pacotes. Qualquer outra coisa é erro de quem chamou, e não vira
 * endereço: nada que venha do JSON da release (`browser_download_url`, `assets[].url`, `zipball_url`…) passa por aqui.
 */
export function packageUrl(origin: UpdateOrigin, version: string, fileName: string): string {
  if (!isReleaseVersion(version)) throw new Error("Versão fora do formato X.Y.Z ou X.Y.Z-beta.N: não vira endereço de download.");
  if (!isPackageFile(version, fileName)) throw new Error("Nome de arquivo que não é o de um pacote da versão: não vira endereço de download.");

  return `${origin.site}/${repositoryOf(origin)}/releases/download/v${version}/${fileName}`;
}

/**
 * Para onde o download pode ser redirecionado (RN-ATUALIZA-008): só `https://`, sem usuário nem senha. O GitHub responde o
 * download de um arquivo de release com um redirecionamento para outro domínio, onde o arquivo está, então o servidor pode ser
 * outro; o que garante o arquivo são as duas somas. Só com o site de desenvolvimento em `http://127.0.0.1` vale também o
 * redirecionamento para `http://127.0.0.1`. A consulta à lista não segue redirecionamento nenhum (quem decide é `fetchText`).
 */
export function redirectAllowed(target: string, origin: UpdateOrigin): boolean {
  if (!URL.canParse(target)) return false;

  const url = new URL(target);
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && url.hostname === "127.0.0.1" && origin.site.startsWith("http://127.0.0.1");
}
