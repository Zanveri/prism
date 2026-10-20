import type { ResultWindowFocus, ResultWindowRequest } from "../../../../electron/result-window-messages";
import { resultWindowNameOf } from "../../../../electron/result-window-messages";
import { closeResultWindow, focusResultWindow, onResultWindowClosed, onResultWindowState, requestResultWindow, setResultWindowTitle, tellResultWindowReady } from "@/lib/api/bridge";
import { vaultLock } from "@/lib/api/vault-lock";
import { hostOfDocument, resultHostRegistry, type Host } from "@/lib/host/host";

import { observePage, prepareResultPage, type ResultPage } from "./result-window-page";
import { resultPlaceCopy } from "./result-place.copy";
import { resultSlots } from "./result-slots";

/**
 * As janelas do resultado do lado da tela (seção 39: RN-ABAS-013 a 017), sem React. A área de resultado de uma aba é UMA só, desenhada por esta tela; a janela
 * do resultado é só uma página em branco, aberta pelo Chromium a pedido da tela e aprovada pelo processo principal, onde a área se põe (`resultSlots`). Aqui
 * está o ciclo da janela: pedir a concessão, abrir, montar a página (a política de conteúdo, os estilos, a raiz), avisar que está pronta, acompanhar o fechamento
 * e quem fechou, e fechar.
 *
 * - **Só a ação da pessoa ou a volta das abas abre a janela**, e nunca um efeito do React, que o modo estrito executa duas vezes. Mesmo assim `open` é
 *   idempotente: a aba que tem a janela (ou está abrindo uma) não pede outra, e o nome que já está aberto nunca é pedido de novo ao Chromium, que daria a janela
 *   que existe, navegada para a página em branco, e o que ela mostra se apagaria.
 * - **Quem fechou**: o processo principal conta à tela (`prism:result-window-closed`), com o motivo. `user` (o X da barra, Alt+F4, Cmd+W) volta o resultado ao
 *   painel; `host` (o Prism: o bloqueio, o "Sair", levar a aba, a janela da aba que fecha ou recarrega) não toca no lugar guardado da aba. Antes de pedir um
 *   fechamento a tela marca a aba como fechando pelo Prism.
 * - **A página é montada quando o documento está completo** e conferida no `load`: o documento em branco do começo pode ser trocado depois de o `window.open`
 *   voltar, e então a raiz é feita de novo no documento novo.
 */

/** O que a tela usa de uma janela aberta por `window.open`. */
export type ChildWindow = {
  readonly document: Document;
  readonly closed: boolean;
  addEventListener(type: "load", listener: () => void): void;
  removeEventListener(type: "load", listener: () => void): void;
};

/** Quanto a tela espera o processo principal confirmar que a janela fechou (RN-ABAS-016): sem a confirmação, a aba vai assim mesmo. */
export const closeWaitMs = 3_000;

export type ResultWindowsDeps = {
  request(request: ResultWindowRequest): Promise<boolean>;
  /** `window.open("about:blank", name, "popup")`, e nada mais: o processo principal só aprova essa abertura (RN-ABAS-017). */
  openWindow(name: string): ChildWindow | null;
  prepare(child: ChildWindow, label: string): ResultPage;
  /** A página nova é de uma janela do resultado: as permissões, a atividade e o foco passam a contá-la. */
  registerPage(page: Document, name: string): Host;
  unregisterPage(host: Host): void;
  /** Espera a área de resultado chegar à raiz, para a janela aparecer já com ela. */
  settled(root: HTMLElement): Promise<void>;
  tellReady(name: string): void;
  requestClose(name: string): Promise<boolean>;
  requestFocus(request: ResultWindowFocus): Promise<boolean>;
  setTitle(name: string, title: string): void;
  setSlot(tabId: string, element: HTMLElement | null): void;
  schedule(run: () => void, ms: number): () => void;
  /** O cofre está bloqueado? Com o bloqueio, nenhuma janela do resultado abre (RN-SEG-001): o processo principal não sabe do bloqueio, e a janela da aba continua pronta. */
  locked(): boolean;
  /** Liga o que o processo principal conta (o fechamento e o estado); devolve como soltar. */
  connectBridge(handlers: { closed: (closed: { name: string; reason: "user" | "host" }) => void; state: (state: { name: string; minimized: boolean }) => void }): () => void;
};

type Mounted = { page: Document; root: HTMLElement; prepared: ResultPage; host: Host };

type Entry = {
  tabId: string;
  name: string;
  child: ChildWindow;
  title: string;
  mounted: Mounted | null;
  minimized: boolean;
  /** O Prism pediu o fechamento: o aviso de que fechou não muda o lugar da aba. */
  hostClosing: boolean;
  waiters: ((confirmed: boolean) => void)[];
  /** O `load` da janela, para conferir se o documento foi trocado; e como largar a espera pelo primeiro documento completo. */
  onLoad: (() => void) | null;
  cancelMount: (() => void) | null;
};

export type OpenOptions = {
  /** `focus`: a pessoa pediu agora (o botão, o menu, o arraste), e a janela vem à frente com o foco; `background`: não pediu (a volta das abas), e ela aparece sem tomar o foco. */
  mode: "focus" | "background";
  /** O ponto do `dragend` da aba do resultado arrastada para fora, onde o processo principal não lê o ponteiro. */
  at?: { x: number; y: number } | null;
  /** O título curto da aba (RN-ABAS-008), de que saem o título da janela e o nome do ponto de referência principal. */
  title: string;
};

export function createResultWindows(deps: ResultWindowsDeps) {
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Promise<boolean>>();
  /** As abas cuja janela o processo principal recusou ou que não abriu: a volta das abas não tenta de novo, até o lugar mudar. */
  const failed = new Set<string>();
  const listeners = new Set<() => void>();
  const userClosed = new Set<(tabId: string) => void>();
  let shown: ReadonlySet<string> = new Set();
  let queue: Promise<unknown> = Promise.resolve();
  /** Sobe a cada `closeAll` (o bloqueio, o "Sair"): a abertura enfileirada antes dele não vale mais, e a fila segue sem ela. */
  let generation = 0;

  function publish(): void {
    const next = new Set([...entries.values()].filter((entry) => entry.mounted !== null && !entry.minimized).map((entry) => entry.tabId));
    const same = next.size === shown.size && [...next].every((tabId) => shown.has(tabId));
    if (!same) shown = next;
    for (const listener of [...listeners]) listener();
  }

  /** Solta o que a janela montou: a raiz sai de `resultSlots`, a página sai da lista e os observadores param. */
  function unmount(entry: Entry): void {
    const { mounted } = entry;
    if (mounted === null) return;

    entry.mounted = null;
    deps.setSlot(entry.tabId, null);
    deps.unregisterPage(mounted.host);
    mounted.prepared.stop();
  }

  function forget(entry: Entry): void {
    if (entry.onLoad !== null) entry.child.removeEventListener("load", entry.onLoad);
    entry.onLoad = null;
    entry.cancelMount?.();
    unmount(entry);
    if (entries.get(entry.tabId) === entry) entries.delete(entry.tabId);
    const waiters = entry.waiters.splice(0);
    for (const resolve of waiters) resolve(true);
    publish();
  }

  /** Monta a página da janela: ela é montada quando o documento está completo, e de novo se o documento for trocado (conferido no `load`). */
  async function mount(entry: Entry): Promise<void> {
    const mountPage = () => {
      const page = entry.child.document;
      if (entry.mounted?.page === page || entry.child.closed) return;

      unmount(entry);
      const prepared = deps.prepare(entry.child, resultPlaceCopy.window.mainLabel(entry.title));
      const host = deps.registerPage(page, entry.name);
      entry.mounted = { page, root: prepared.root, prepared, host };
      deps.setSlot(entry.tabId, prepared.root);
      publish();
    };

    entry.onLoad = mountPage;
    entry.child.addEventListener("load", mountPage);
    if (entry.child.document.readyState === "complete") return mountPage();

    // O documento ainda não está completo: a montagem espera o `load` (o `mountPage` acima, registrado antes, roda primeiro) ou o fim da janela.
    await new Promise<void>((resolve) => {
      const onComplete = () => {
        entry.child.removeEventListener("load", onComplete);
        resolve();
      };
      entry.cancelMount = onComplete;
      entry.child.addEventListener("load", onComplete);
    });
  }

  async function openNow(tabId: string, { mode, at = null, title }: OpenOptions): Promise<boolean> {
    const name = resultWindowNameOf(tabId);
    if (!(await deps.request({ name, mode, at }))) return false;

    // A concessão vale 2 segundos e uma abertura: o `window.open` é a próxima coisa.
    const child = deps.openWindow(name);
    if (child === null) return false;

    const entry: Entry = { tabId, name, child, title, mounted: null, minimized: false, hostClosing: false, waiters: [], onLoad: null, cancelMount: null };
    entries.set(tabId, entry);
    await mount(entry);
    if (entries.get(tabId) !== entry || entry.mounted === null) return entries.get(tabId) === entry;

    // Aparece pronta: com os estilos, o tema e o resultado, sem um quadro em branco antes.
    await deps.settled(entry.mounted.root);
    if (entries.get(tabId) !== entry) return true;
    deps.setTitle(name, resultPlaceCopy.window.title(entry.title));
    deps.tellReady(name);
    return true;
  }

  function open(tabId: string, options: OpenOptions): Promise<boolean> {
    if (entries.has(tabId)) return Promise.resolve(true);
    // Bloqueado, nada abre (RN-SEG-001), e a recusa não marca a aba como falha: o desbloqueio pede de novo.
    if (deps.locked()) return Promise.resolve(false);
    const pending = opening.get(tabId);
    if (pending !== undefined) return pending;

    failed.delete(tabId);
    const started = openNow(tabId, options)
      .catch(() => false)
      .then((ok) => {
        if (!ok) failed.add(tabId);
        return ok;
      })
      .finally(() => void opening.delete(tabId));
    opening.set(tabId, started);
    return started;
  }

  /** O Prism fecha a janela da aba (o bloqueio, o "Sair", "Voltar para o painel", levar a aba): marca antes, pede, e espera o aviso de que fechou. Devolve se confirmou. */
  async function close(tabId: string): Promise<boolean> {
    const pending = opening.get(tabId);
    if (pending !== undefined) await pending.catch(() => false);

    const entry = entries.get(tabId);
    if (entry === undefined) return true;

    entry.hostClosing = true;
    const confirmed = new Promise<boolean>((resolve) => entry.waiters.push(resolve));
    void deps.requestClose(entry.name).then((existed) => {
      // O processo principal não tem essa janela (já fechou): não haverá aviso.
      if (!existed && entries.get(tabId) === entry) forget(entry);
    });
    const stopWaiting = deps.schedule(() => {
      // Sem a confirmação, a tela esquece a janela assim mesmo.
      for (const resolve of entry.waiters.splice(0)) resolve(false);
      forget(entry);
    }, closeWaitMs);
    const result = await confirmed;
    stopWaiting();
    return result;
  }

  function handleClosed({ name, reason }: { name: string; reason: "user" | "host" }): void {
    const entry = [...entries.values()].find((candidate) => candidate.name === name);
    if (entry === undefined) return;

    const byHost = entry.hostClosing || reason === "host";
    forget(entry);
    if (!byHost) for (const listener of [...userClosed]) listener(entry.tabId);
  }

  function handleState({ name, minimized }: { name: string; minimized: boolean }): void {
    const entry = [...entries.values()].find((candidate) => candidate.name === name);
    if (entry === undefined || entry.minimized === minimized) return;

    entry.minimized = minimized;
    publish();
  }

  return {
    open,
    close,

    /** Fecha todas, pelo Prism (o bloqueio, o "Sair"). */
    async closeAll(): Promise<void> {
      // As aberturas que esperam na fila deixam de valer, antes de fechar o que já abriu.
      generation += 1;
      await Promise.all([...entries.keys(), ...opening.keys()].map((tabId) => close(tabId)));
    },

    /**
     * As janelas que as abas pedem (a volta das abas na entrada e no desbloqueio, a aba que chegou de outra janela): abre as que faltam, uma a uma e na ordem
     * dada (a da aba ativa por último), sem tomar o foco, e fecha, pelo Prism, as que já não são pedidas (a aba fechou, saiu da janela, voltou ao painel). A que
     * não abriu fica fora até o lugar mudar, e `onFailed` diz qual.
     */
    reconcile(wanted: readonly { tabId: string; title: string }[], onFailed: (tabId: string) => void): void {
      const ids = new Set(wanted.map((item) => item.tabId));
      for (const tabId of [...entries.keys()]) if (!ids.has(tabId)) void close(tabId);
      for (const tabId of [...failed]) if (!ids.has(tabId)) failed.delete(tabId);

      const queuedIn = generation;
      for (const { tabId, title } of wanted) {
        if (entries.has(tabId) || opening.has(tabId) || failed.has(tabId)) continue;
        queue = queue.then(async () => {
          if (queuedIn !== generation || deps.locked() || entries.has(tabId) || failed.has(tabId)) return;
          if (!(await open(tabId, { mode: "background", title }))) onFailed(tabId);
        });
      }
    },

    /** A aba voltou ao painel ou mudou de lugar: ela pode ser pedida de novo. */
    forgetFailure(tabId: string): void {
      failed.delete(tabId);
    },

    /** O título da janela e o nome do ponto de referência principal dela, quando o título da aba muda (RN-ABAS-013). */
    setTitle(tabId: string, title: string): void {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.title === title) return;

      entry.title = title;
      deps.setTitle(entry.name, resultPlaceCopy.window.title(title));
      entry.mounted?.root.setAttribute("aria-label", resultPlaceCopy.window.mainLabel(title));
    },

    /** Traz à frente a janela do resultado, ou a da aba que a abriu (o F6 e o "Voltar para o painel"). */
    focus(tabId: string, target: "result" | "opener"): Promise<boolean> {
      return deps.requestFocus({ name: resultWindowNameOf(tabId), target });
    },

    isOpen: (tabId: string) => entries.has(tabId),

    /** As abas cuja janela do resultado está aberta e não minimizada: o resultado à vista (RN-ABAS-015). */
    shownTabs: (): ReadonlySet<string> => shown,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** A pessoa fechou a janela pelo sistema: o resultado volta ao painel. */
    onUserClosed(listener: (tabId: string) => void): () => void {
      userClosed.add(listener);
      return () => void userClosed.delete(listener);
    },

    /** Liga o que o processo principal conta; solta, e fecha as janelas pelo Prism, ao desmontar a área de trabalho. */
    connect(): () => void {
      const disconnect = deps.connectBridge({ closed: handleClosed, state: handleState });
      return () => {
        disconnect();
        for (const tabId of [...entries.keys()]) void close(tabId);
      };
    },
  };
}

export type ResultWindows = ReturnType<typeof createResultWindows>;

/** Espera a área de resultado chegar à raiz da janela (até meio segundo): a janela aparece com o resultado, e não vazia. */
function settledRoot(root: HTMLElement): Promise<void> {
  if (root.firstElementChild !== null) return Promise.resolve();

  return new Promise((resolve) => {
    let stop: () => void = () => {};
    const done = () => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 500);
    stop = observePage(root, { childList: true }, () => {
      if (root.firstElementChild !== null) done();
    });
  });
}

/** As peças de verdade: a ponte, o `window.open` e a página desta tela. */
export const resultWindows = createResultWindows({
  request: (request) => requestResultWindow(request),
  openWindow: (name) => window.open("about:blank", name, "popup") as ChildWindow | null,
  prepare: (child, label) => prepareResultPage({ page: child.document, source: document, label, observe: observePage }),
  registerPage(page, name) {
    const host = hostOfDocument(page, name);
    resultHostRegistry.add(host);
    return host;
  },
  unregisterPage: (host) => resultHostRegistry.remove(host),
  settled: settledRoot,
  tellReady: (name) => tellResultWindowReady(name),
  requestClose: (name) => closeResultWindow(name),
  requestFocus: (request) => focusResultWindow(request),
  setTitle: (name, title) => setResultWindowTitle(name, title),
  setSlot: (tabId, element) => resultSlots.set(tabId, "window", element),
  locked: () => vaultLock.isLocked(),
  schedule(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  connectBridge({ closed, state }) {
    const stops = [onResultWindowClosed(closed), onResultWindowState(state)];
    return () => {
      for (const stop of stops) stop();
    };
  },
});
