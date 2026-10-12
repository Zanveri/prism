import { useSyncExternalStore } from "react";

import { getBridge } from "@/lib/api/bridge";

import type { UpdateProgress, UpdateState } from "../../../electron/update/update-state";

/**
 * O espelho, na tela, do estado da atualização, que mora no processo principal. Fica fora do React e de qualquer rota: o
 * diálogo é montado uma vez, acima do `ApiGate` (`app.tsx`), e nem trocar de tela nem a API reiniciar podem perder o que a
 * consulta achou ou o "Depois" que a pessoa já respondeu.
 *
 * `dismissed` é o número da consulta (`checkId`) cujo diálogo a pessoa fechou com "Depois". Uma consulta nova que acha
 * versão tem outro número, e o diálogo abre de novo.
 */
type Snapshot = { state: UpdateState; dismissed: number };

let snapshot: Snapshot = { state: { status: "none" }, dismissed: 0 };
const listeners = new Set<() => void>();
let connected = false;

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

/**
 * O avanço do download entra no estado `downloading` da mesma consulta. A lista de versões continua sendo o MESMO objeto:
 * é por isso que as notas (`ReleaseNotes`, com `memo`) não são redesenhadas a cada aviso. Fora disso, o estado não muda.
 */
export function withProgress(state: UpdateState, { checkId, receivedBytes, totalBytes }: UpdateProgress): UpdateState {
  return state.status === "downloading" && state.checkId === checkId ? { ...state, receivedBytes, totalBytes } : state;
}

/** Na primeira assinatura: ouve as mudanças e pega o estado de agora (a consulta do início costuma terminar antes de a tela existir). */
function connect() {
  if (connected) return;
  connected = true;

  // Sem a ponte (a tela aberta fora do Electron, sem a configuração de desenvolvimento) não há atualizador, e quem diz o que
  // falta é o `ApiGate`, logo abaixo: o diálogo, que agora fica acima dele, não pode derrubar a tela por isso.
  let updates;
  try {
    ({ updates } = getBridge());
  } catch {
    return;
  }
  updates.onState((state) => set({ state }));
  updates.onProgress((progress) => {
    const state = withProgress(snapshot.state, progress);
    if (state !== snapshot.state) set({ state });
  });
  updates.getState().then(
    (state) => set({ state }),
    () => undefined,
  );
}

function subscribe(listener: () => void) {
  connect();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const read = () => snapshot;

export function useUpdateSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, read, read);
}

/** O estado que uma chamada à ponte devolveu: chega também pelo aviso do processo principal, e gravar duas vezes não muda nada. */
export function adoptUpdateState(state: UpdateState) {
  set({ state });
}

/** "Depois": fecha o diálogo desta consulta. O estado continua no processo principal. */
export function dismissUpdate() {
  if (snapshot.state.status !== "none") set({ dismissed: snapshot.state.checkId });
}
