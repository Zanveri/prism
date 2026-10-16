import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { commandHead, commandHint, entryAt, scriptTabKeyTarget, scriptTabsOf, type ScriptRun, type ScriptTab } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import { revealOffset } from "../_lib/tab-strip";
import { useScriptRun, type QueryRunner } from "../_lib/use-query-runner";

const copy = scriptRunCopy.tabs;

/** O id da aba, para o corpo da área (`role="tabpanel"`) dizer qual aba o rotula. */
export const scriptTabId = (prefix: string, tab: ScriptTab) => `${prefix}-${tab}`;

type ScriptTabsProps = {
  run: ScriptRun;
  /** A aba à frente (`shownScriptTab`). */
  shown: ScriptTab;
  /** O começo dos ids das abas (`scriptTabId`). */
  idPrefix: string;
  /** O id do corpo da área, que as abas controlam. */
  panelId: string;
  onChoose: (tab: ScriptTab) => void;
};

/**
 * As abas da área de resultado depois de um script (RN-SQL-020), no lugar do título "Resultado" e no desenho das abas do canvas: uma por resultado guardado
 * ("3 · SELECT * FROM pedido…", com o texto inteiro na dica) e, por último, "Estatísticas". É uma lista de abas: só a escolhida entra no Tab, e as setas,
 * Home e End escolhem outra e levam o foco a ela.
 *
 * As abas dos resultados rolam na horizontal quando não cabem, e a escolhida é sempre trazida à vista: a do último comando, que vem à frente sozinha no fim,
 * ficava fora da faixa com umas oito abas. "Estatísticas" fica fixa na ponta direita, fora da rolagem, sempre ao alcance.
 */
export function ScriptTabs({ run, shown, idPrefix, panelId, onChoose }: ScriptTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = scriptTabsOf(run);
  // A faixa estava sem largura (a aba de consulta escondida, ou a área de trabalho por baixo de outra tela) quando a escolhida pediu para aparecer.
  const revealPending = useRef(false);

  const reveal = useCallback(() => {
    const element = scroller.current;
    const selected = element?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (element == null) return;
    revealPending.current = element.clientWidth <= 0;
    if (selected == null) return;
    const offset = revealOffset(element, { left: selected.offsetLeft, width: selected.offsetWidth });
    if (offset !== null) element.scrollLeft = offset;
  }, []);

  useLayoutEffect(reveal, [reveal, shown, tabs.length]);

  // A faixa volta a ter largura (a aba de consulta volta à frente) ou muda de largura: mostra a escolhida que esperava.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;

    const observer = new ResizeObserver(() => {
      if (revealPending.current) reveal();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reveal]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = scriptTabKeyTarget(event.key, tabs, shown);
    if (next === null) return;
    event.preventDefault();
    onChoose(next);
    // As abas estão todas na página: o foco vai já à escolhida.
    list.current?.querySelector<HTMLElement>(`[data-script-tab="${next}"]`)?.focus();
  }

  const tab = (item: ScriptTab) => {
    const selected = item === shown;
    const label = item === "statistics" ? copy.statistics : copy.result(item + 1, commandHead(entryAt(run, item).target));
    return (
      <button
        key={item}
        type="button"
        role="tab"
        id={scriptTabId(idPrefix, item)}
        data-script-tab={item}
        aria-selected={selected}
        aria-controls={panelId}
        tabIndex={selected ? 0 : -1}
        title={item === "statistics" ? undefined : commandHint(entryAt(run, item).target.sql)}
        onClick={() => onChoose(item)}
        className={cn("flex h-9 max-w-64 flex-none cursor-pointer items-center border-b-2 px-2.5 whitespace-nowrap", selected ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
      >
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <div ref={list} role="tablist" aria-label={copy.label} onKeyDown={onKeyDown} className="mr-auto flex min-w-0 flex-1">
      {/* `relative`: a posição de cada aba (`offsetLeft`) é contada a partir daqui, como a rolagem. */}
      <div ref={scroller} className="relative flex min-w-0 overflow-x-auto [scrollbar-width:thin]">
        {tabs.filter((item) => item !== "statistics").map(tab)}
      </div>
      {tab("statistics")}
    </div>
  );
}

type KeptResultNoteProps = {
  /** Há comando da pessoa em andamento na aba: o botão fica, com o porquê, e não executa (o executor recusaria calado). */
  busy: boolean;
  onRunAlone: () => void;
  /**
   * O botão sai da página com o foco: o comando executado troca os resultados do script, e a aba guardada sai com eles. Quem desenha a área leva o foco à
   * grade nova (`rescueFocus`, RN-SQL-006), em vez de deixá-lo cair no `body`.
   */
  onFocusLost?: () => void;
};

/**
 * O rodapé de uma aba guardada do script (RN-SQL-020), no lugar do de cursor fechado e do "Carregar mais": por que o resto não vale ali, e "Executar este
 * comando", que executa só ele, como o Ctrl+Enter nele. Com outro comando em andamento na aba, o botão fica à vista, sem executar, e diz por quê; não se
 * desabilita de verdade, para não perder o foco (como o de contar, RN-SQL-006).
 */
export function KeptResultNote({ busy, onRunAlone, onFocusLost }: KeptResultNoteProps) {
  const lost = useRef(onFocusLost);
  useLayoutEffect(() => {
    lost.current = onFocusLost;
  });
  // A limpeza da ref (React 19) roda quando o botão sai, com ele ainda na página: é aí que se sabe se ele tinha o foco.
  const watchFocus = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return;
    return () => {
      if (button.ownerDocument.activeElement === button) lost.current?.();
    };
  }, []);

  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-raised px-3 py-1.5 text-xs">
      <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
      <span className="min-w-0 flex-1 text-ink">{scriptRunCopy.kept.note}</span>
      <Button
        ref={watchFocus}
        type="button"
        variant="secondary"
        size="compact"
        aria-disabled={busy || undefined}
        title={busy ? scriptRunCopy.kept.runAloneBusy : undefined}
        onClick={() => {
          if (!busy) onRunAlone();
        }}
        className="h-7 px-2.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {scriptRunCopy.kept.runAlone}
      </Button>
    </div>
  );
}

/**
 * RN-SQL-021: a marca, na faixa das abas, da aba cujo script parou num erro e espera a resposta. A pergunta só aparece na aba à vista (a ativa, com a área
 * de trabalho na tela); a de outra aba espera, e esta marca diz onde. Um ponto, e o texto para o leitor de tela.
 */
export function ScriptWaitingMark({ runner }: { runner: QueryRunner }) {
  const script = useScriptRun(runner);
  if (script?.phase !== "paused") return null;

  return (
    <>
      <span aria-hidden data-script-waiting title={scriptRunCopy.error.waiting} className="size-2 flex-none rounded-full bg-danger" />
      <span className="sr-only">{scriptRunCopy.error.waiting}</span>
    </>
  );
}
