import { existsSync, rmSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { parseSums, sumRefusal } from "./checksums";
import { downloadFile, fetchText, sha256OfFile, type HttpGet } from "./download";
import { deliverToDownloads, runInstaller, type SpawnInstaller } from "./install";
import { attemptFileName, takeAttempt, writeAttempt } from "./install-attempt";
import { githubApiHeaders, maxReleasePages, packageUrl, releasesPerPage, releasesUrl, type UpdateOrigin } from "./origin";
import { choosePackage, isPackageFile, sumsFile, type InstallFacts, type InstallFormat } from "./packages";
import { dueForStartupCheck, readPreferences, writePreferences, type UpdatePreferences } from "./preferences";
import { clipNotes, mergeReleasePages, offerable, readReleasePage, type ReleaseInfo, type ReleasePage } from "./releases";
import type { CheckOutcome, UpdateNotice, UpdateOffer, UpdateProgress, UpdateState } from "./update-state";

export type UpdaterDeps = {
  /** `null`: pacote gerado sem origem (RN-ATUALIZA-001). */
  origin: UpdateOrigin | null;
  /** O app foi aberto com um argumento que tira a garantia do HTTPS (`updatesBlocked`): nada vai à rede nesta abertura. */
  blocked?: boolean;
  currentVersion: string;
  facts: InstallFacts;
  /**
   * Instalado pelo instalador do Windows, a instalação é para todos os usuários (RN-INSTALA-003; `install-scope.ts`)? Só é
   * perguntado nessa instalação, uma vez por abertura; sem a função, ou com ela falhando, vale "só do usuário".
   */
  installedForAllUsers?: () => Promise<boolean>;
  /** A pasta de dados do app: as preferências, `updates/` e a anotação da instalação (`install-attempt.ts`) ficam nela, fora do cofre. */
  dataDir: string;
  downloadsDir: string;
  http: HttpGet;
  now(): Date;
  log(message: string): void;
  spawn: SpawnInstaller;
  /**
   * Fecha o cofre e para a API, e só resolve quando o processo dela terminou. O instalador não pode achar a API viva: ele
   * desinstala a versão antiga antes de pôr a nova, e um arquivo em uso faz essa etapa abortar.
   */
  stopApi(): Promise<void>;
  /** Quanto esperar a API terminar antes de desistir da instalação (15 s; os testes usam menos). */
  apiStopTimeoutMs?: number;
  /** Encerra o app pelo caminho normal de saída. */
  quit(): void;
  /** Mostra um arquivo no gerenciador de arquivos do sistema. */
  reveal(path: string): void;
  onState(state: UpdateState): void;
  /** O avanço do download: só os números. O estado inteiro, com as notas, vai por `onState`, uma vez por mudança de estado. */
  onProgress(progress: UpdateProgress): void;
};

/** Uma página da lista de releases tem poucas centenas de kB; o `SHA256SUMS`, uma linha por pacote. */
const releasesMaxBytes = 4 * 1024 * 1024;
const sumsMaxBytes = 64 * 1024;
const queryTimeoutMs = 10_000;
/** O instalador do Windows tem cerca de 130 MB e o zip, 200 MB: 1 GiB é o teto do plausível. */
const packageMaxBytes = 1024 * 1024 * 1024;
const stallMs = 30_000;
/**
 * Quantas versões vão para a tela (RN-ATUALIZA-003): as mais recentes. A consulta traz até cem, e cada uma pode ter notas no
 * teto de tamanho; desenhar todas pararia a tela. As que ficam de fora são contadas, e a tela diz quantas são.
 */
const maxOfferedReleases = 20;
/** A tela não precisa de mais que cinco avisos de progresso por segundo. */
const progressIntervalMs = 200;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** O arquivo baixado e conferido não é mais o mesmo no disco: alguém o trocou entre a conferência e o uso. */
const changed = "O arquivo da atualização mudou depois de conferido.";
/**
 * O que a tela diz quando a instalação não foi adiante DEPOIS de a API ter sido parada para ela: o app está aberto sem o
 * serviço, e a tela de trás mostra o erro da API com "Reiniciar". Sem estas frases a pessoa veria só "não foi possível".
 */
const serviceIsBack = ' Use "Reiniciar" para trazer o serviço de volta.';
const serviceStopped = ` O serviço do Prism foi parado para instalar.${serviceIsBack}`;
const packageKept = ' O pacote baixado continua guardado: "Tentar de novo" o confere outra vez, sem baixar de novo.';
/** A parada que falhou não prova nada, nem depois: nesta abertura o instalador não roda mais, e quem resolve é abrir o Prism de novo. */
const reopenToUpdate = " Para atualizar, feche o Prism e abra-o de novo.";
/** O pedido da tela que não é a versão achada, ou que chega no estado errado. É a única rejeição que a tela recebe, e não leva dado nenhum. */
class InvalidRequest extends Error {}
const invalid = () => new InvalidRequest("Pedido de atualização inválido.");
/**
 * A causa que vai para a tela. A mensagem de um erro do sistema de arquivos traz o caminho do arquivo: dele só vai o código.
 * O erro pode chegar reembrulhado (o download troca a mensagem e guarda o original em `cause`), então a busca desce por `cause`.
 */
function causeOf(error: unknown): string {
  for (let each: unknown = error, depth = 0; typeof each === "object" && each !== null && depth < 5; each = (each as Error).cause, depth += 1) {
    const { code, path, syscall } = each as NodeJS.ErrnoException;
    if (typeof code === "string" && (typeof path === "string" || typeof syscall === "string")) return `O sistema não deixou gravar na pasta de dados do Prism (${code}).`;
  }
  return messageOf(error);
}

/** `true` se o trabalho terminou no prazo, `false` se o prazo passou antes. A falha do trabalho sobe como falha. */
function settledWithin(work: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Um arquivo que acabou de ser fechado pode estar sendo lido por um antivírus: a operação é tentada de novo, com uma espera curta. */
async function withRetries<T>(work: () => Promise<T>, attempts = 3, waitMs = 150): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await delay(waitMs);
    }
  }
}

/**
 * O atualizador (seção 17 da especificação), sem depender do Electron: consulta, baixa, confere e instala, e guarda as
 * preferências. O que chega da tela (`unknown`) é conferido aqui: ela só diz "baixe", "instale" ou "pule" a versão que a
 * última consulta DESTE processo achou, e nunca um endereço, um caminho ou um nome de arquivo.
 */
export function createUpdater({ origin: recordedOrigin, blocked = false, currentVersion, facts, installedForAllUsers, dataDir, downloadsDir, http, now, log, spawn, stopApi, apiStopTimeoutMs = 15_000, quit, reveal, onState, onProgress }: UpdaterDeps) {
  // Bloqueado é sem origem: nenhum caminho abaixo chega à rede sem ela.
  const origin = blocked ? null : recordedOrigin;
  const preferencesFile = join(dataDir, "update-preferences.json");
  const updatesDir = join(dataDir, "updates");
  // O que está em `updates/` só vale para o processo que o baixou e conferiu (as somas ficam na memória): o que sobrou de
  // outra abertura, ou que alguém pôs lá, é apagado antes de qualquer coisa. Se não der para apagar (logo depois de uma
  // atualização o instalador ainda pode estar rodando de lá, e o Windows não apaga um executável em uso), o app abre do mesmo
  // jeito: o que vale é o que este processo conferiu, e não o que está na pasta.
  try {
    rmSync(updatesDir, { recursive: true, force: true });
  } catch (error) {
    log(`atualização: a pasta de downloads antigos não foi apagada (${messageOf(error)})`);
  }

  // A atualização que a abertura anterior mandou o instalador fazer (RN-INSTALA-003): se o Prism abriu na versão de antes, ela
  // não foi instalada, e a tela avisa uma vez (`takeNotice`).
  const attemptFile = join(dataDir, attemptFileName);
  let notice: UpdateNotice | null = takeAttempt(attemptFile, currentVersion);
  if (notice !== null) log(`atualização: a versão ${notice.version} não foi instalada; o Prism abriu de novo na ${notice.current}`);

  let preferences = readPreferences(preferencesFile);
  let state: UpdateState = { status: "none" };
  let found: ReleaseInfo[] = [];
  let offer: UpdateOffer = { checkId: 0, current: currentVersion, format: null, forAllUsers: false, releases: [], omitted: 0 };
  /** O modo da instalação, perguntado uma vez (`installedForAllUsers`) e só na instalação feita pelo instalador do Windows. */
  let forAllUsers: Promise<boolean> | null = null;
  const isForAllUsers = () =>
    (forAllUsers ??= facts.platform === "win32" && facts.nsisInstalled && installedForAllUsers !== undefined ? installedForAllUsers().catch(() => false) : Promise.resolve(false));
  let downloading: AbortController | null = null;
  /** O arquivo baixado e conferido contra as duas somas, e a soma dele: `install` confere de novo antes de usar. */
  let verified: { version: string; path: string; sha256: string; format: InstallFormat } | null = null;

  function setState(next: UpdateState) {
    state = next;
    onState(next);
    return next;
  }

  function save(patch: Partial<UpdatePreferences>) {
    preferences = { ...preferences, ...patch };
    try {
      writePreferences(preferencesFile, preferences);
    } catch (error) {
      log(`atualização: as preferências não foram gravadas (${messageOf(error)})`);
    }
    return preferences;
  }

  /** Uma página da lista de releases, já lida: o texto da rede vira a `ReleasePage`, ou a falha com a causa. */
  async function readPage(source: UpdateOrigin, page: number): Promise<ReleasePage | { failure: string }> {
    let text: string;
    try {
      text = await fetchText(http, releasesUrl(source, page), { origin: source, maxBytes: releasesMaxBytes, timeoutMs: queryTimeoutMs, redirects: false, headers: githubApiHeaders });
    } catch (error) {
      return { failure: messageOf(error) };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { failure: "A resposta do servidor não é a lista de versões (não é JSON)." };
    }
    // O canal é o desta consulta: ligar ou desligar "Receber versões beta" vale a partir da próxima (RN-ATUALIZA-010).
    const read = readReleasePage(payload, currentVersion, preferences.receiveBeta ? "beta" : "stable");
    if (read === null) return { failure: "A resposta do servidor não é a lista de versões." };

    // O que ficou de fora vai para o log, e a tela não sabe dele: uma linha por página, com as primeiras.
    if (read.ignored.length > 0) log(`atualização: ${read.ignored.length} da página ${page} da lista de releases ignorada(s): ${read.ignored.slice(0, 10).join("; ")}${read.ignored.length > 10 ? "; …" : ""}`);
    return read;
  }

  /**
   * A consulta (RN-ATUALIZA-002). A hora anotada é a da tentativa: uma máquina sem rede não consulta a cada abertura. A lista vem
   * em páginas de cem, das mais novas para as mais antigas: a página seguinte só é pedida quando a anterior veio cheia sem chegar
   * à versão instalada (a pipeline publica um beta a cada merge, e cem betas podem esconder a estável que falta a quem está atrás),
   * e no máximo `maxReleasePages`. Uma página seguinte que falha não derruba a consulta: vale o que já veio, e a falha vai para o log.
   */
  async function query(source: UpdateOrigin): Promise<{ releases: ReleaseInfo[]; forAllUsers: boolean; withoutPackage: string[] } | { failure: string }> {
    save({ lastCheckedAt: now().toISOString() });

    const pages: ReleasePage[] = [];
    for (let page = 1; page <= maxReleasePages; page += 1) {
      const read = await readPage(source, page);
      if ("failure" in read) {
        if (page === 1) return read;
        log(`atualização: a página ${page} da lista de releases falhou (vale o que veio antes): ${read.failure}`);
        break;
      }

      pages.push(read);
      if (read.items < releasesPerPage || read.reachedInstalled) break;
    }
    // Uma release que saiu sem o pacote deste sistema não é oferecida: vale a mais nova que o tem, e as notas vão até ela.
    const { releases, withoutPackage } = offerable(mergeReleasePages(pages), facts);
    if (withoutPackage.length > 0) log(`atualização: ${withoutPackage.length} versão(ões) mais nova(s) sem o pacote deste sistema, não oferecida(s): ${withoutPackage.slice(0, 10).join(", ")}${withoutPackage.length > 10 ? ", …" : ""}`);
    return { releases, forAllUsers: await isForAllUsers(), withoutPackage };
  }

  /** Passa a valer o que a consulta achou. O que tinha sido baixado para o achado anterior deixa de valer. */
  function adopt(releases: ReleaseInfo[], forAllUsers = false) {
    found = releases;
    verified = null;
    if (releases.length === 0) {
      if (state.status !== "none") setState({ status: "none" });
      return;
    }

    offer = {
      checkId: offer.checkId + 1,
      current: currentVersion,
      format: choosePackage(releases[0].version, facts)?.format ?? null,
      forAllUsers,
      // O que vai para a tela é menos do que o processo principal guarda (`found` fica inteiro, e é dele que sai a
      // conferência): as notas com o teto de linhas, e só as somas dos pacotes conhecidos da versão. Um bloco de somas com
      // milhares de linhas de outros nomes não atravessa a ponte.
      releases: releases.slice(0, maxOfferedReleases).map(({ version, prerelease, date, notes, sums }) => ({
        version,
        prerelease,
        date,
        notes: clipNotes(notes),
        sums: [...sums].filter(([file]) => file !== sumsFile && isPackageFile(version, file)).map(([file, sha256]) => ({ file, sha256 })),
      })),
      omitted: Math.max(0, releases.length - maxOfferedReleases),
    };
    setState({ status: "available", ...offer });
  }

  /**
   * As paradas da API que este atualizador pediu e que ainda não terminaram (Ruling 89). A que estoura o prazo continua correndo,
   * e o processo principal já soltou a referência da API: o `stopApi` seguinte resolve na hora, sem provar nada. Por isso a prova de
   * que a API terminou é TODA parada pedida ter terminado: cada tentativa pede uma nova (depois de "Reiniciar" há uma API nova de
   * pé) e espera também as que ficaram. A parada que termina sai daqui; a que falha nunca vira prova, e fica até o app fechar.
   */
  const unfinishedStops = new Set<Promise<void>>();
  function stopApiAndWait(): Promise<void> {
    const stop = stopApi();
    unfinishedStops.add(stop);
    stop.then(
      () => unfinishedStops.delete(stop),
      () => undefined,
    );
    return Promise.all([...unfinishedStops]).then(() => undefined);
  }

  /** Há um download correndo, ou a instalação já começou (a API está parando, ou o instalador já roda): nada disso pode ser trocado por baixo. */
  const isBusy = () => downloading !== null || state.status === "installing";

  /**
   * A última guarda antes da tela: nenhuma causa leva a pasta de dados nem a de downloads (com a barra que for, em qualquer
   * caixa). O que tiver uma delas vai inteiro para o log, e a tela recebe uma frase sem caminho.
   */
  const flat = (text: string) => text.replaceAll("\\", "/").toLowerCase();
  const privateFolders = [dataDir, downloadsDir].map(flat);
  function screenSafe(reason: string): string {
    const text = flat(reason);
    if (!privateFolders.some((folder) => text.includes(folder))) return reason;

    log(`atualização: causa com caminho de pasta, trocada antes de ir para a tela: ${reason}`);
    return "O Prism não conseguiu gravar a atualização no disco.";
  }
  const fail = (reason: string) => setState({ status: "failed", reason: screenSafe(reason), ...offer });

  /**
   * Recusa um arquivo que não confere: a causa vai para o log ANTES de apagar, e continua sendo a causa mesmo se apagar
   * falhar (um antivírus segurando o arquivo, por exemplo). A falha de apagar nunca escapa: ela iria à tela com o caminho, e
   * deixaria o estado preso. A frase diz se o arquivo foi apagado ou não.
   */
  async function refuseAndRemove(refusal: string, path: string, { recursive = false, after = "" } = {}): Promise<UpdateState> {
    log(`atualização: ${refusal}`);
    const removed = await rm(path, { recursive, force: true }).then(
      () => true,
      (error: unknown) => {
        log(`atualização: o arquivo recusado não pôde ser apagado agora (${messageOf(error)}); ele não é usado, e sai na próxima abertura`);
        return false;
      },
    );
    return fail(`${refusal} ${removed ? "Ele foi apagado." : "O Prism não conseguiu apagá-lo agora: ele não será usado, e sai na próxima abertura."}${after}`);
  }

  /**
   * Nenhuma função que a tela chama rejeita com caminho de pasta. O pedido inválido rejeita com a frase fixa dele; qualquer
   * outra coisa que escape vira falha na tela, pela mesma guarda de `fail`, e o texto inteiro fica no log.
   */
  async function guarded(work: () => Promise<UpdateState>): Promise<UpdateState> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof InvalidRequest) throw error;

      log(`atualização: falha inesperada: ${messageOf(error)}`);
      return fail(causeOf(error));
    }
  }

  const actions = {
    state: () => state,
    preferences: () => preferences,

    /** O aviso da atualização que não foi instalada (RN-INSTALA-003), uma vez: a primeira janela que pergunta o leva. */
    takeNotice(): UpdateNotice | null {
      const taken = notice;
      notice = null;
      return taken;
    },

    /** Ao abrir: no máximo uma vez a cada 24 horas, e a falha só vai para o log (RN-ATUALIZA-002). */
    async checkOnStartup(): Promise<void> {
      if (blocked) return log("atualização: desligada nesta abertura: a linha de comando dispensa a conferência do certificado ou troca o endereço dos servidores");
      if (origin === null) return log("atualização: este Prism foi gerado sem origem de atualizações; nada é consultado");
      if (!dueForStartupCheck(preferences, now())) return log("atualização: consulta ao abrir dispensada (desligada, ou já feita nas últimas 24 horas)");

      const result = await query(origin);
      if ("failure" in result) return log(`atualização: a consulta ao abrir falhou: ${result.failure}`);

      const latest = result.releases.at(0);
      if (latest === undefined) return log(result.withoutPackage.length > 0 ? "atualização: nenhuma versão mais nova com o pacote deste sistema" : "atualização: nenhuma versão mais nova");
      if (latest.version === preferences.skippedVersion) return log(`atualização: a versão ${latest.version} foi pulada pelo usuário`);
      // Uma consulta manual pode ter chegado antes: o que ela pôs na tela fica.
      if (state.status !== "none") return;

      log(`atualização: versão ${latest.version} disponível`);
      adopt(result.releases, result.forAllUsers);
    },

    /** "Verificar atualizações": não depende das 24 horas, da opção de abrir nem da versão pulada, e o resultado sempre volta. */
    async check(): Promise<CheckOutcome> {
      if (blocked) return { outcome: "blocked" };
      if (origin === null) return { outcome: "noSource" };
      if (isBusy()) return { outcome: "busy" };

      const result = await query(origin);
      if ("failure" in result) {
        log(`atualização: a consulta falhou: ${result.failure}`);
        return { outcome: "failed", reason: screenSafe(result.failure) };
      }
      // O download ou a instalação podem ter começado enquanto a consulta esperava a rede: o que eles puseram na tela fica.
      if (isBusy()) return { outcome: "busy" };

      adopt(result.releases, result.forAllUsers);
      if (result.releases.length > 0) return { outcome: "available" };
      return result.withoutPackage.length > 0 ? { outcome: "upToDate", withoutPackage: result.withoutPackage[0] } : { outcome: "upToDate" };
    },

    /**
     * "Atualizar agora" (RN-ATUALIZA-005): baixa o pacote da instalação em uso e o confere. As duas somas têm de existir
     * antes de o pacote ser pedido; baixado, a soma dele tem de bater com as duas, senão é apagado e a causa vai para a tela.
     */
    async download(version: unknown): Promise<UpdateState> {
      const latest = found.at(0);
      if (origin === null || latest === undefined || version !== latest.version || (state.status !== "available" && state.status !== "failed")) throw invalid();

      const choice = choosePackage(latest.version, facts);
      if (choice === null) return fail("Não há pacote desta versão para o sistema e a arquitetura deste computador.");
      if (!latest.sums.has(choice.fileName)) return fail(sumRefusal(choice.fileName, latest.sums, new Map()) ?? "");

      const controller = new AbortController();
      downloading = controller;
      verified = null;
      const directory = join(updatesDir, latest.version);
      const target = join(directory, choice.fileName);
      setState({ status: "downloading", receivedBytes: 0, totalBytes: null, ...offer });

      try {
        const published = parseSums(await fetchText(http, packageUrl(origin, latest.version, sumsFile), { origin, maxBytes: sumsMaxBytes, timeoutMs: queryTimeoutMs, redirects: true, signal: controller.signal }));

        const missing = sumRefusal(choice.fileName, latest.sums, published);
        if (missing !== null) return fail(missing);

        // O pacote pode já estar aqui: é o que fica quando o instalador não iniciou (a API já tinha parado, e a pessoa pede
        // "Tentar de novo"). Em vez de baixar tudo outra vez, a soma dele é refeita, do disco, contra as duas fontes: as notas
        // e o SHA256SUMS que acabou de chegar. Se não confere, segue o caminho normal, que apaga a pasta e baixa.
        if (existsSync(target)) {
          const kept = await sha256OfFile(target).catch(() => null);
          if (kept !== null && sumRefusal(choice.fileName, latest.sums, published, kept) === null) {
            log("atualização: o pacote já baixado confere de novo com as duas somas; não foi baixado outra vez");
            verified = { version: latest.version, path: target, sha256: kept, format: choice.format };
            return setState({ status: "ready", ...offer });
          }
        }

        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { recursive: true });

        let lastPush = 0;
        const { sha256 } = await downloadFile(http, packageUrl(origin, latest.version, choice.fileName), `${target}.part`, {
          origin,
          maxBytes: packageMaxBytes,
          stallMs,
          signal: controller.signal,
          onProgress(receivedBytes, totalBytes) {
            if (state.status !== "downloading" || (Date.now() - lastPush < progressIntervalMs && receivedBytes !== totalBytes)) return;
            lastPush = Date.now();
            // O avanço NÃO passa por `setState`: ele mandaria a oferta inteira (as notas de até 20 versões) cinco vezes por
            // segundo, e a tela redesenharia tudo. O estado daqui fica em dia, para quem perguntar (`state()`), e a tela
            // recebe só os três números, num aviso à parte.
            state = { ...state, receivedBytes, totalBytes };
            onProgress({ checkId: offer.checkId, receivedBytes, totalBytes });
          },
        });

        const refusal = sumRefusal(choice.fileName, latest.sums, published, sha256);
        if (refusal !== null) return await refuseAndRemove(refusal, directory, { recursive: true });

        // Só depois de conferido o arquivo ganha o nome dele.
        await withRetries(() => rename(`${target}.part`, target));
        verified = { version: latest.version, path: target, sha256, format: choice.format };
        return setState({ status: "ready", ...offer });
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        if (controller.signal.aborted) return setState({ status: "available", ...offer });

        log(`atualização: o download falhou: ${messageOf(error)}`);
        return fail(causeOf(error));
      } finally {
        downloading = null;
      }
    },

    cancel(): void {
      downloading?.abort();
    },

    /**
     * Instalar o que foi conferido (RN-ATUALIZA-006). A soma do arquivo é conferida de novo, do disco, imediatamente antes
     * de usá-lo: se mudou, é apagado e nada roda. O instalador do Windows: o cofre é fechado e a API parada, e só com o
     * processo dela terminado o instalador roda e o app sai (se a API não terminar no prazo, nada roda; e uma tentativa seguinte
     * espera também a parada que tinha estourado o prazo, `stopApiAndWait`). Como essa parada
     * leva tempo, a soma é conferida DUAS vezes: antes dela (um arquivo ruim não custa a API) e depois dela, colada ao
     * `runInstaller`. Os outros formatos: o pacote vai para a pasta de downloads e é mostrado ao usuário, e o app continua aberto.
     */
    async install(version: unknown): Promise<UpdateState> {
      if (state.status !== "ready" || verified === null || version !== verified.version) throw invalid();
      const { version: target, path, sha256, format } = verified;
      // Uma instalação de cada vez: tirado daqui, o arquivo conferido não serve a um segundo pedido que chegue junto.
      verified = null;

      /** A soma do arquivo, do disco, agora. Devolve a falha (já na tela) se ele não é mais o que foi conferido; senão, nada. */
      const refusedIfChanged = async (note = ""): Promise<UpdateState | null> => {
        let actual: string;
        try {
          actual = await sha256OfFile(path);
        } catch (error) {
          log(`atualização: o arquivo conferido não pôde ser lido: ${messageOf(error)}`);
          return fail(`O arquivo conferido não está mais onde o Prism o deixou.${note} Baixe a atualização de novo.`);
        }
        return actual === sha256 ? null : refuseAndRemove(changed, path, { after: `${note} Baixe a atualização de novo.` });
      };

      const refusedBefore = await refusedIfChanged();
      if (refusedBefore !== null) return refusedBefore;

      if (format === "nsis") {
        // Daqui em diante a tela não oferece mais nada: o app está saindo (ou a falha abaixo diz por que não saiu).
        setState({ status: "installing", ...offer });
        try {
          if (!(await settledWithin(stopApiAndWait(), apiStopTimeoutMs))) {
            log(`atualização: a API não terminou em ${apiStopTimeoutMs / 1000} s; o instalador não foi iniciado (a parada continua, e a próxima tentativa espera por ela)`);
            return fail(`O serviço do Prism não encerrou a tempo, e por isso o instalador não foi iniciado.${serviceIsBack}${packageKept}`);
          }
        } catch (error) {
          log(`atualização: a API não pôde ser parada: ${messageOf(error)}; o instalador não roda mais nesta abertura`);
          return fail(`O serviço do Prism não encerrou, e por isso o instalador não foi iniciado.${serviceIsBack}${reopenToUpdate}`);
        }

        // A parada levou tempo (fechar o cofre, esperar o processo), e nesse tempo o arquivo pode ter sido trocado. A soma é
        // refeita aqui, e nada pode entrar entre esta conferência e o `runInstaller` logo abaixo.
        const refusedAfter = await refusedIfChanged(serviceStopped);
        if (refusedAfter !== null) return refusedAfter;
      }

      try {
        if (format === "nsis") {
          // A anotação que a próxima abertura lê para saber se a versão entrou (RN-INSTALA-003). Gravar é síncrono: nada roda
          // entre a conferência do arquivo, acima, e o instalador. Sem ela a atualização segue; só o aviso, se nada entrar, falta.
          try {
            writeAttempt(attemptFile, { from: currentVersion, to: target, forAllUsers: offer.forAllUsers });
          } catch (error) {
            log(`atualização: a anotação da instalação não foi gravada (${messageOf(error)})`);
          }
          try {
            await runInstaller(spawn, path);
          } catch (error) {
            // O instalador não iniciou: a anotação sai, para a próxima abertura não avisar de uma instalação que nem começou.
            try {
              rmSync(attemptFile, { force: true });
            } catch (removal) {
              log(`atualização: a anotação da instalação não foi apagada (${messageOf(removal)})`);
            }
            throw error;
          }
          log("atualização: a API terminou e o instalador iniciou; o Prism vai encerrar");
          quit();
          return state;
        }

        const delivered = await deliverToDownloads(path, downloadsDir);
        reveal(delivered);
        return setState({ status: "delivered", fileName: basename(delivered), ...offer });
      } catch (error) {
        // O código do erro basta: a mensagem do sistema traz o caminho do arquivo.
        const cause = (error as NodeJS.ErrnoException).code ?? messageOf(error);
        log(`atualização: a instalação falhou: ${messageOf(error)}`);
        // O instalador não iniciou, mas a API já parou para ele: a tela diz isso e como voltar. O pacote conferido NÃO é
        // apagado: "Tentar de novo" (o `download`) refaz a conferência do arquivo que ficou, em vez de baixar tudo outra vez.
        return fail(format === "nsis" ? `Não foi possível iniciar o instalador (${cause}).${serviceStopped}${packageKept}` : `Não foi possível deixar o pacote na pasta de downloads (${cause}).`);
      }
    },

    /** "Não verificar ao abrir" (RN-ATUALIZA-007). */
    setCheckOnStartup(value: unknown): UpdatePreferences {
      if (typeof value !== "boolean") throw invalid();
      return save({ checkOnStartup: value });
    },

    /**
     * "Receber versões beta" (RN-ATUALIZA-010): só grava a escolha. Não consulta, não baixa e não instala nada, e não muda o que
     * a última consulta achou: vale a partir da próxima consulta.
     */
    setReceiveBeta(value: unknown): UpdatePreferences {
      if (typeof value !== "boolean") throw invalid();
      return save({ receiveBeta: value });
    },

    /**
     * "Pular esta versão" (RN-ATUALIZA-003): não avisa de novo ao abrir até sair outra. Só a versão que a última consulta achou,
     * estável ou beta (vale igual nos dois canais).
     */
    skipVersion(version: unknown): UpdatePreferences {
      const latest = found.at(0);
      if (latest === undefined || version !== latest.version || isBusy()) throw invalid();

      const saved = save({ skippedVersion: latest.version });
      adopt([]);
      return saved;
    },
  };

  // O que a tela chama: as duas ações que mexem no disco passam pela guarda das rejeições.
  return { ...actions, download: (version: unknown) => guarded(() => actions.download(version)), install: (version: unknown) => guarded(() => actions.install(version)) };
}

export type Updater = ReturnType<typeof createUpdater>;
