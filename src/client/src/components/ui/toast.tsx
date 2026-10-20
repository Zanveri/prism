import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { vaultLock } from "@/lib/api/vault-lock";
import { hostFocus } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import { HostProvider } from "./host-context";
import { createToastApi, type ToastApi } from "./toast-api";
import { dismissToast, type ToastItem, type ToastTone } from "./toast-queue";

export type { ToastAction } from "./toast-queue";

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Os avisos do app (RN-AVISO-001): o que aconteceu e a pessoa precisa saber, mas não é o
 * conteúdo da tela. Vivem fora do fluxo da página de propósito — "Conexão criada." não é
 * conteúdo, e como cartão fixo empurraria a tela e sobreviveria à leitura.
 *
 * A fila (tempo por tom, limite, repetição) é a de `toast-queue.ts`; aqui só se desenha e se
 * agenda o fechamento. A pilha vai num portal em `document.body`, no canto inferior direito,
 * com o mais novo embaixo, acima da barra de status e do rodapé do resultado (`bottom-20`).
 *
 * RN-ABAS-015: os avisos aparecem na janela que tem o foco, entre a da aba e as do resultado dela (`ToastStack`); sem o foco em nenhuma, na da aba.
 * Na janela do resultado, que não tem barra de status, a pilha fica no canto de baixo, 12 px acima da borda.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);

  // Bloqueado por inatividade, nenhum aviso entra na fila (`createToastApi`).
  const api = useMemo<ToastApi>(() => createToastApi(setQueue, () => vaultLock.isLocked()), []);

  const dismiss = useCallback((id: string) => setQueue((current) => dismissToast(current, id)), []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack queue={queue} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * A pilha dos avisos, no portal da janela que tem o foco (`hostFocus`). Sucesso e atenção são lidos quando o leitor de tela estiver livre; o de erro tem
 * `role="alert"` e interrompe (RN-AVISO-006). `pointer-events-none`: a pilha flutua sobre a tela, e vazia não pode roubar o clique do canto.
 *
 * `bottom-20` (80 px) deixa a base da pilha acima da barra de status (28 px) e do rodapé do resultado (41 px, com o "Carregar mais 200" à direita: 69 px a
 * partir da borda da janela, com folga de 11 px). Com `bottom-5` o aviso de erro que saía de um comando caía sobre esse botão e engolia o clique do usuário
 * (Marco B, D3). A janela do resultado não tem barra de status: ali a pilha fica 12 px acima da borda (`bottom-3`).
 */
export function ToastStack({ queue, onDismiss }: { queue: ToastItem[]; onDismiss: (id: string) => void }) {
  const host = useSyncExternalStore(hostFocus.subscribe, hostFocus.getSnapshot);

  return createPortal(
    <HostProvider host={host}>
      <div aria-live="polite" className={cn("pointer-events-none fixed right-5 z-[60] flex w-[380px] max-w-[calc(100vw-2.5rem)] flex-col gap-2.5", host.resultWindow === null ? "bottom-20" : "bottom-3")}>
        {queue.map((item) => (
          <ToastCard key={item.id} toast={item} onDismiss={onDismiss} />
        ))}
      </div>
    </HostProvider>,
    host.document.body,
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast precisa de um <ToastProvider> acima na árvore.");
  return context;
}

/** Cada tom tem cor e ícone próprios: a cor sozinha não chega a quem não a distingue. */
const tones: Record<ToastTone, { text: string; rail: string; icon: ReactNode }> = {
  success: {
    text: "text-success",
    rail: "bg-success",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.4 8.3l1.8 1.8 3.4-3.9" />
      </>
    ),
  },
  warning: {
    text: "text-accent",
    rail: "bg-accent",
    icon: (
      <>
        <path d="M8 2.2l6.2 11H1.8z" />
        <path d="M8 6.6v3.1M8 11.5v.1" />
      </>
    ),
  },
  error: {
    text: "text-danger",
    rail: "bg-danger",
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
      </>
    ),
  },
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const tone = tones[toast.tone];

  // Pausar não é adiar: o que sobrou do tempo fica guardado e o relógio recomeça dali quando o
  // ponteiro sai. Sem isso, cada passada do mouse por cima daria o tempo inteiro de novo.
  useEffect(() => {
    if (paused) return;

    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);

    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [onDismiss, paused, toast.id]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto w-full animate-toast-in overflow-hidden rounded-lg border border-border-strong bg-raised shadow-2xl motion-reduce:animate-none"
    >
      <div className="flex items-start gap-2.5 py-3 pr-3 pl-4">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("mt-[3px] flex-none", tone.text)}>
          {tone.icon}
        </svg>

        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{toast.title}</p>
          {/* O detalhe pode ser a mensagem de um banco: é texto, quebra onde precisar e para em quatro linhas. */}
          {toast.description === undefined ? null : <p className="mt-0.5 line-clamp-4 text-sm break-words text-muted">{toast.description}</p>}
          {/* RN-AVISO-006: o botão de ação ("Mostrar na pasta"). Receber o foco pausa o relógio, como o hover; usado, o aviso sai. */}
          {toast.action === undefined ? null : (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                onDismiss(toast.id);
              }}
              className="mt-1.5 -ml-1 cursor-pointer rounded-md px-1 py-0.5 text-sm font-medium text-accent transition-colors hover:bg-selected hover:text-ink"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button type="button" aria-label="Fechar aviso" title="Fechar aviso" onClick={() => onDismiss(toast.id)} className="-mt-1 flex size-7 flex-none cursor-pointer items-center justify-center rounded-md text-base leading-none text-subtle transition-colors hover:bg-selected hover:text-ink">
          ×
        </button>
      </div>

      {/* Quanto falta para o aviso sair sozinho. Congela junto com o relógio: os dois leem `paused`. */}
      <div aria-hidden style={{ animationDuration: `${toast.durationMs}ms`, animationPlayState: paused ? "paused" : "running" }} className={cn("h-0.5 origin-left animate-toast-timer", tone.rail)} />
    </div>
  );
}
