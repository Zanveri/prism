import { z } from "zod";

import { splitNotes } from "./checksums";
import { compareVersions, isNewerThan, releaseOfTag } from "./version";

/**
 * O que o app guarda de uma release: nada além disto sai do JSON, e nenhum endereço dele é lido (RN-ATUALIZA-005). `prerelease`:
 * é um beta (a tag `vX.Y.Z-beta.N` e a marca de pré-lançamento), que só entra com o canal beta ligado (RN-ATUALIZA-010).
 */
export type ReleaseInfo = { version: string; prerelease: boolean; date: string | null; notes: string; sums: Map<string, string> };

/** O canal da consulta (RN-ATUALIZA-010): só as estáveis, ou também os betas ("Receber versões beta"). */
export type Channel = "stable" | "beta";

/** As notas de uma versão têm poucos kB; o que passar disso é cortado antes de chegar à tela. */
export const maxNotesLength = 100_000;

/**
 * Quantas linhas das notas de UMA versão vão para a tela. O teto de tamanho acima ainda deixa passar 25 mil itens de lista
 * numa versão (cada linha vira um elemento na tela), e são até 20 versões: sem este teto, notas hostis fariam a tela
 * desenhar centenas de milhares de elementos. Notas de verdade têm poucas dezenas de linhas.
 */
export const maxNotesLines = 400;
const notesCut = "As notas desta versão foram cortadas aqui: são mais longas do que o Prism mostra.";
const fence = "```";

/**
 * As notas como vão para a tela: no máximo `maxNotesLines` linhas, e uma linha final dizendo que foram cortadas. Se o corte
 * cai dentro de um bloco de código, a cerca é fechada antes, para a linha final não ser desenhada como código.
 */
export function clipNotes(notes: string): string {
  const lines = notes.split(/\r?\n/);
  if (lines.length <= maxNotesLines) return notes;

  const kept = lines.slice(0, maxNotesLines);
  const insideCode = kept.filter((line) => line.trim().startsWith(fence)).length % 2 === 1;
  return [...kept, ...(insideCode ? [fence] : []), "", notesCut].join("\n");
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** O dia (`AAAA-MM-DD`) de `published_at`, ou nada se o campo não é um instante ISO de verdade. */
function dateOf(value: string | null): string | null {
  return value !== null && isoInstant.test(value) && !Number.isNaN(Date.parse(value)) ? value.slice(0, 10) : null;
}

/**
 * Os campos de uma release da API do GitHub (`GET /repos/{dono}/{repositório}/releases`) que o app usa, e só eles: o Zod deixa
 * o resto de fora (`url`, `html_url`, `assets[].browser_download_url`, `zipball_url`… nunca são lidos). A tag e as duas marcas
 * (rascunho e pré-lançamento) decidem o que a release é: sem elas no formato, a release não é classificada e fica de fora. O
 * corpo (as notas) e a data podem faltar ou vir fora do formato: viram vazios, e a release sem as somas nas notas é recusada
 * na hora de baixar.
 */
const githubRelease = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullable().catch(null),
  published_at: z.string().nullable().catch(null),
});

/** A tag vinda da rede, como vai para o log: entre aspas (uma quebra de linha não abre outra linha) e com teto de tamanho. */
const quoted = (tag: string) => {
  const text = JSON.stringify(tag);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

/**
 * O que uma página da lista diz. `releases`: as versões mais novas que a instalada que entram na oferta. `ignored`: uma frase
 * para o log por release que ficou de fora por estar fora do formato (a tela não sabe delas). `items`: quantos itens a página
 * trouxe, contando os de fora. `reachedInstalled`: a página chegou a uma versão igual ou mais antiga que a instalada, então as
 * páginas seguintes (mais antigas) não têm nada mais novo.
 */
export type ReleasePage = { releases: ReleaseInfo[]; ignored: string[]; items: number; reachedInstalled: boolean };

/**
 * Lê uma página da resposta de `GET …/releases` (RN-ATUALIZA-002, 003 e 010): as versões mais novas que a instalada no canal
 * pedido (só as estáveis, ou também os betas), da mais recente para a mais antiga pela ordem do SemVer, cada uma com a data, as
 * notas e as somas que as notas trazem. `null` quando a resposta não é uma lista. O JSON vem da rede e é conferido item a item:
 * rascunho nunca conta; estável é a tag `vX.Y.Z` E a marca de pré-lançamento desligada; beta é a tag `vX.Y.Z-beta.N` (ou
 * `-rc.N`) E a marca ligada; o que não casa dos dois jeitos, a tag fora do formato e o item fora do formato ficam de fora, com
 * uma linha para o log. Um beta fora do canal não é "de fora": ele só não entra na oferta.
 */
export function readReleasePage(payload: unknown, installed: string, channel: Channel = "stable"): ReleasePage | null {
  if (!Array.isArray(payload)) return null;

  const found = new Map<string, ReleaseInfo>();
  const ignored: string[] = [];
  let reachedInstalled = false;
  for (const item of payload as unknown[]) {
    const parsed = githubRelease.safeParse(item);
    if (!parsed.success) {
      ignored.push("um item fora do formato de uma release (sem a tag, ou sem as marcas de rascunho e de pré-lançamento)");
      continue;
    }

    const { tag_name: tag, draft, prerelease, body, published_at: publishedAt } = parsed.data;
    const kind = releaseOfTag(tag);
    if (kind !== null && !isNewerThan(kind.version, installed)) reachedInstalled = true;

    if (draft) {
      ignored.push(`${quoted(tag)} (rascunho)`);
      continue;
    }
    if (kind === null) {
      ignored.push(`${quoted(tag)} (a tag não é de uma versão que o Prism entende)`);
      continue;
    }
    // A tag e a marca têm de dizer a mesma coisa: estável é `vX.Y.Z` sem a marca, beta é `vX.Y.Z-beta.N` com ela.
    if (kind.prerelease !== prerelease) {
      ignored.push(`${quoted(tag)} (${prerelease ? "a tag é de uma versão estável, mas a release está marcada como pré-lançamento" : "a tag é de um pré-lançamento, mas a release não está marcada como pré-lançamento"})`);
      continue;
    }
    const { version } = kind;
    if ((kind.prerelease && channel !== "beta") || !isNewerThan(version, installed) || found.has(version)) continue;

    // As somas são lidas do texto inteiro; o corte é só no que vai para a tela.
    const { notes, sums } = splitNotes(body);
    found.set(version, { version, prerelease: kind.prerelease, date: dateOf(publishedAt), notes: notes.length > maxNotesLength ? `${notes.slice(0, maxNotesLength)}…` : notes, sums });
  }

  return { releases: [...found.values()].sort((a, b) => compareVersions(b.version, a.version)), ignored, items: payload.length, reachedInstalled };
}

/** As páginas lidas, juntas: da versão mais nova para a mais antiga, e a versão repetida vale a da página que veio antes. */
export function mergeReleasePages(pages: ReleasePage[]): ReleaseInfo[] {
  const found = new Map<string, ReleaseInfo>();
  for (const release of pages.flatMap((page) => page.releases)) if (!found.has(release.version)) found.set(release.version, release);

  return [...found.values()].sort((a, b) => compareVersions(b.version, a.version));
}
