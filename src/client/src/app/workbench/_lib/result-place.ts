import { resultWindowsAvailable } from "@/lib/api/bridge";

import { resultPlaceCopy } from "./result-place.copy";
import type { QueryTab, ResultPlace } from "./workbench-model";
import type { PaneMode } from "./result-layout";

const copy = resultPlaceCopy;

/**
 * O lugar do resultado da aba de consulta (seção 39: RN-ABAS-011 a 016), sem tocar a página: qual vale, o que a faixa mostra (a aba do resultado logo depois
 * da dela), onde a aba arrastada entra, os itens dos menus, para onde vai o foco depois de trocar, o que o F6 faz e quando o resultado está à vista. Quem
 * desenha é `WorkbenchTabs`, `TabStrip`, `QueryTabPanel` e `ResultHost`.
 */

/**
 * A janela do resultado (RN-ABAS-013 e 017) só existe no app, onde há processo principal para aprová-la (a ponte diz). Fora dele (no navegador do
 * desenvolvimento, RN-ABAS-014 e RN-CONFIG-010) "Numa janela" não aparece, e o lugar gravado como "Numa janela" vale "No painel", sem deixar de ser o gravado.
 */
export function resultWindowAvailable(): boolean {
  return resultWindowsAvailable();
}

/** O lugar que vale para a aba: nulo na aba de tabela (o resultado dela fica dentro dela); "Numa janela" sem a janela do resultado vale o painel. */
export function placeOf(tab: Pick<QueryTab, "table" | "resultPlace">, windowAvailable = resultWindowAvailable()): ResultPlace | null {
  if (tab.table !== undefined) return null;
  const place = tab.resultPlace ?? "panel";
  return place === "window" && !windowAvailable ? "panel" : place;
}

/** RN-ABAS-016 e RN-CONFIG-010: a aba de consulta nova nasce no lugar da preferência; sem a janela do resultado, "Numa janela" é o painel. */
export function newTabPlace(preference: ResultPlace, windowAvailable = resultWindowAvailable()): ResultPlace {
  return preference === "window" && !windowAvailable ? "panel" : preference;
}

/**
 * RN-CONFIG-010: as escolhas de "Onde o resultado das abas novas aparece", com a gravada marcada. Sem a janela do resultado (fora do app, ou enquanto ela não
 * existe), "Numa janela" não aparece, e a preferência gravada assim vale, e aparece, como "No painel".
 */
export function preferencePlaces(preference: ResultPlace, windowAvailable = resultWindowAvailable()): { place: ResultPlace; checked: boolean }[] {
  const shown = newTabPlace(preference, windowAvailable);
  return (windowAvailable ? (["panel", "tab", "window"] as const) : (["panel", "tab"] as const)).map((place) => ({ place, checked: place === shown }));
}

/** Uma entrada da faixa: a aba, ou a aba do resultado dela (`result`), que não é uma aba da lista e sim uma vista da aba de consulta. */
export type StripEntry<T extends Pick<QueryTab, "id"> = QueryTab> = { key: string; tab: T; result: boolean };

/** As entradas da faixa, na ordem: cada aba, e logo depois dela a aba do resultado, quando o resultado dela está numa aba (RN-ABAS-012). */
export function stripEntries<T extends Pick<QueryTab, "id" | "table" | "resultPlace">>(tabs: readonly T[], windowAvailable = resultWindowAvailable()): StripEntry<T>[] {
  return tabs.flatMap((tab) => {
    const entry = { key: tab.id, tab, result: false };
    return placeOf(tab, windowAvailable) === "tab" ? [entry, { key: resultEntryKey(tab.id), tab, result: true }] : [entry];
  });
}

export const resultEntryKey = (tabId: string) => `result:${tabId}`;
/** Os ids da página da aba do resultado e do painel dela (`aria-controls`). */
export const resultTabElementId = (tabId: string) => `workbench-result-tab-${tabId}`;
export const resultPanelElementId = (tabId: string) => `workbench-result-panel-${tabId}`;

/**
 * As caixas da faixa por aba (RN-ABAS-012): a aba e a do resultado dela contam como uma, e é por essas caixas que a aba solta entra (`dropIndex`), na posição
 * da lista de abas. Assim o marcador do lugar nunca fica entre a aba da consulta e a do resultado dela.
 */
export function unitRects(entries: readonly Pick<StripEntry<Pick<QueryTab, "id">>, "tab">[], rects: readonly { left: number; width: number }[]): { left: number; width: number }[] {
  const units: { id: string; left: number; right: number }[] = [];
  entries.forEach((entry, index) => {
    const rect = rects[index];
    if (rect === undefined) return;
    const last = units.at(-1);
    if (last !== undefined && last.id === entry.tab.id) last.right = Math.max(last.right, rect.left + rect.width);
    else units.push({ id: entry.tab.id, left: rect.left, right: rect.left + rect.width });
  });
  return units.map((unit) => ({ left: unit.left, width: unit.right - unit.left }));
}

/** O marcador de cada entrada para a posição `at` da lista de abas: antes da aba (a primeira entrada dela) ou, no fim, depois da última entrada. */
export function dropMarks(entries: readonly Pick<StripEntry<Pick<QueryTab, "id">>, "tab" | "result">[], at: number | null): ("before" | "after" | undefined)[] {
  let unit = -1;
  const unitOf = entries.map((entry) => (entry.result ? unit : ++unit));
  const units = unit + 1;
  return entries.map((entry, index) => {
    if (at === null) return undefined;
    if (!entry.result && unitOf[index] === at) return "before";
    return at === units && index === entries.length - 1 ? "after" : undefined;
  });
}

/** O título da aba do resultado: "Resultado · " e o título da aba dela na faixa (RN-ABAS-008 e 012). */
export function resultTabTitle(stripTitle: string): string {
  return copy.tab.title(stripTitle);
}

/** O ponto da aba do resultado (RN-ABAS-012 e RN-SQL-021): o vermelho do script parado na pergunta de erro, o de execução e o de resultado novo. */
export type ResultMark = "waiting" | "running" | "unseen" | null;

export function resultMarkOf({ waiting, running, unseen }: { waiting: boolean; running: boolean; unseen: boolean }): ResultMark {
  if (waiting) return "waiting";
  if (running) return "running";
  return unseen ? "unseen" : null;
}

/**
 * RN-ABAS-012: o resultado novo que a pessoa ainda não viu. Acende quando um comando termina (de um comando, de um script, do F5, do "Carregar mais", do
 * filtro, um erro também) com a aba do resultado não ativa, e apaga quando ela fica ativa. A execução automática não conta: ela só roda com o resultado à
 * vista (RN-GRADE-014), e não toma a aba.
 */
export function trackUnseen(previous: { busy: boolean; unseen: boolean }, now: { busy: boolean; active: boolean }): { busy: boolean; unseen: boolean } {
  if (now.active) return { busy: now.busy, unseen: false };
  return { busy: now.busy, unseen: previous.unseen || (previous.busy && !now.busy) };
}

/** O que a aba do resultado diz no nome acessível: o título e o ponto ("Resultado · consulta-2.sql, executando"). */
export function resultMarkText(mark: ResultMark): string {
  return mark === "running" ? copy.tab.running : mark === "unseen" ? copy.tab.unseen : "";
}

export type PlaceMenuItem = { place: ResultPlace; label: string; checked: boolean; disabled: boolean; hint?: string };

/**
 * Os itens de "Onde mostrar o resultado" (RN-ABAS-014), de escolha única, com o lugar de agora marcado: "No painel", "Numa aba" e "Numa janela". Sem a
 * janela do resultado (fora do app, ou enquanto ela não existe) o terceiro não aparece; enquanto a aba vai para outra janela, ele fica desabilitado, com o motivo.
 */
export function placeMenu(current: ResultPlace, { windowAvailable = resultWindowAvailable(), moving = false }: { windowAvailable?: boolean; moving?: boolean } = {}): PlaceMenuItem[] {
  const places: ResultPlace[] = windowAvailable ? ["panel", "tab", "window"] : ["panel", "tab"];
  return places.map((place) => ({ place, label: copy.places[place], checked: place === current, disabled: place === "window" && moving, ...(place === "window" && moving ? { hint: copy.moving } : {}) }));
}

/** O nome e a dica do botão "Onde mostrar o resultado", com o lugar de agora. */
export function placeButtonLabel(place: ResultPlace): string {
  return copy.button.named(copy.placeLower[place]);
}

export function placeAnnouncement(place: ResultPlace): string {
  return copy.announcement[place];
}

/**
 * De onde veio a troca: o botão da barra do resultado, o menu de uma das abas, o fechar da aba do resultado (o X, o clique do meio, o Ctrl+W, "Voltar para o
 * painel" do menu dela), o "Voltar para o painel" da janela do resultado (e o Ctrl+W nela), a pessoa fechar a janela do resultado pelo sistema, ou soltar a
 * aba do resultado fora da faixa (`drag`, RN-ABAS-010: a aba some e o resultado vai para a janela, como pelo menu).
 */
export type PlaceVia = "bar" | "menu" | "close" | "back" | "windowClosed" | "drag";

/** O que fica ativo depois da troca (`result`: a aba do resultado; `query`: a da consulta; `keep`: como está) e onde fica o foco. */
export type AfterPlace = { show: "result" | "query" | "keep"; focus: "placeButton" | "result" | null };

/**
 * RN-ABAS-012 e 014: o foco depois de trocar o lugar.
 * - Pelo botão da barra, o foco vai com o resultado: numa aba, ela fica ativa; de volta ao painel, a da consulta; e o foco no botão, no lugar novo. Numa
 *   janela, a janela vem à frente com o foco no botão dela, e a aba da consulta fica ativa na janela da aba.
 * - Pelo menu da aba, a ativa não muda e o foco volta à aba na faixa, que o menu devolve; mas se a aba que some era a ativa (a do resultado, com "No painel"
 *   ou "Numa janela"), a da consulta fica ativa, com o foco no botão dela.
 * - Fechar a aba do resultado a ativa deixa a da consulta ativa, com o foco no resultado (a grade, ou o botão sem grade).
 * - "Voltar para o painel" da janela do resultado (RN-ABAS-013) deixa a aba da consulta ativa, com o foco no resultado, no painel. A pessoa que fecha a janela
 *   pelo sistema não muda o que está ativo nem o foco: quem decide o foco é o sistema.
 */
export function afterPlaceChange({ to, via, resultWasActive }: { to: ResultPlace; via: PlaceVia; resultWasActive: boolean }): AfterPlace {
  if (via === "back") return { show: "query", focus: "result" };
  if (via === "windowClosed") return { show: "keep", focus: null };
  if (via === "bar") return { show: to === "tab" ? "result" : "query", focus: "placeButton" };
  if (to === "tab" || !resultWasActive) return { show: "keep", focus: null };
  return { show: "query", focus: via === "close" ? "result" : "placeButton" };
}

/** De onde vem o F6: o editor (ou a barra dele), o resultado, ou a faixa de abas. */
export type F6From = "editor" | "result" | "strip";

/** O que o F6 faz (RN-ABAS-014): leva o foco ao resultado ou ao editor, troca a aba ativa entre a da consulta e a do resultado, ou traz a janela à frente. */
export type F6Action = "focusResult" | "focusEditor" | "showResult" | "showQuery" | "focusWindow" | "focusOpener" | null;

/**
 * RN-ABAS-014: o F6 alterna entre o editor e o resultado da aba, onde quer que ele esteja. No painel, do editor ao resultado (também recolhido: o botão) e de
 * volta; com o resultado maximizado o editor está escondido, e o F6 no resultado não faz nada. Numa aba, troca a aba ativa. Numa janela, do editor traz a
 * janela do resultado à frente, e do resultado traz à frente a janela da aba, com a consulta ativa e o foco no editor. Da faixa, vale o lado da entrada ativa: a aba do resultado volta à consulta, e a da consulta vai ao resultado.
 */
export function f6Action({ place, from, mode, resultActive }: { place: ResultPlace; from: F6From; mode: PaneMode; resultActive: boolean }): F6Action {
  const side = from === "strip" ? (resultActive ? "result" : "editor") : from;
  if (place === "tab") return side === "editor" ? "showResult" : "showQuery";
  if (place === "window") return side === "editor" ? "focusWindow" : "focusOpener";
  if (side === "editor") return "focusResult";
  return mode === "maximized" ? null : "focusEditor";
}

/** F6 sem modificador (RN-ABAS-014). */
export function isF6(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

/**
 * RN-ABAS-015 e RN-GRADE-014: o resultado está à vista, que é o que deixa a atualização automática executar. No painel, a aba da consulta ativa; numa aba, a
 * aba do resultado ativa; numa janela, a janela aberta e não minimizada (`windowShown`, que o processo principal informa), qualquer que seja a aba ativa.
 * A área de trabalho na tela é a outra metade da conta, e é de quem chama.
 */
export function resultOnView({ place, selected, resultActive, windowShown = false }: { place: ResultPlace; selected: boolean; resultActive: boolean; windowShown?: boolean }): boolean {
  if (place === "window") return windowShown;
  return place === "tab" ? selected && resultActive : selected && !resultActive;
}

/** A aba de consulta com o lugar trocado; as outras, e a aba de tabela, como estão. Devolve a mesma lista quando nada muda. */
export function withResultPlace(tabs: readonly QueryTab[], tabId: string, place: ResultPlace): QueryTab[] {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined || tab.table !== undefined || (tab.resultPlace ?? "panel") === place) return tabs as QueryTab[];
  return tabs.map((candidate) => (candidate === tab ? { ...candidate, resultPlace: place } : candidate));
}

/** O que a raiz da janela do resultado faz com uma tecla (RN-ABAS-017): `back` é o Ctrl+W ("Voltar para o painel"); `stop` são as que ela não tem e não passam à aba e à faixa. */
export type WindowKey = "back" | "stop";

/**
 * As teclas da janela do resultado que não sobem pela árvore do React até a janela da aba (RN-ABAS-015 e 017). O Ctrl+W (Cmd+W no macOS) volta o resultado ao
 * painel. O Ctrl+Shift+PageUp e PageDown da faixa, o Ctrl+9 da conexão, o Ctrl+B e o Ctrl+Shift+E do navegador e o Ctrl+, de Configurações são do que a janela do
 * resultado não tem: não fazem nada. As demais (F5, F6, Alt+X, Ctrl+S, as da grade) seguem.
 */
export function windowKeyAction(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): WindowKey | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "w" && !event.shiftKey) return "back";
  if ((key === "PageUp" || key === "PageDown") && event.shiftKey) return "stop";
  if (key === "9" && !event.shiftKey) return "stop";
  if (key === "b" && !event.shiftKey) return "stop";
  if (key === "e" && event.shiftKey) return "stop";
  if (key === "," && !event.shiftKey) return "stop";
  return null;
}
