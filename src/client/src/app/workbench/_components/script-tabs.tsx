import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { Button, useHost } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { environmentAccent } from "../_lib/environment-accent";
import { commandHead, commandHint, entryAt, scriptTabKeyTarget, scriptTabsOf, type ScriptRun, type ScriptTab } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import { revealOffset } from "../_lib/tab-strip";
import { variablesPanelCopy } from "../_lib/variables-panel.copy";
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
  /** RN-VAR-024: a aba tem variáveis avaliadas, e "Variáveis" entra logo antes de "Estatísticas". */
  variables?: boolean;
  /**
   * Escolhe a aba; `false` quando a troca espera uma resposta (as alterações não salvas, RN-SQL-023), e o foco fica onde está até ela: trocada a aba depois
   * ("Salvar" ou "Descartar"), o foco vai à escolhida pelo teclado.
   */
  onChoose: (tab: ScriptTab) => boolean | void;
};

/**
 * As abas da área de resultado depois de um script (RN-SQL-020), no lugar do título "Resultado" e no desenho das abas do canvas: uma por resultado guardado
 * ("3 · SELECT * FROM pedido…", com o texto inteiro na dica) e, por último, "Estatísticas". É uma lista de abas: só a escolhida entra no Tab, e as setas,
 * Home e End escolhem outra e levam o foco a ela.
 *
 * As abas dos resultados rolam na horizontal quando não cabem, e a escolhida é sempre trazida à vista: a do último comando, que vem à frente sozinha no fim,
 * ficava fora da faixa com umas oito abas. "Estatísticas" fica fixa na ponta direita, fora da rolagem, sempre ao alcance.
 */
export function ScriptTabs({ run, shown, idPrefix, panelId, variables = false, onChoose }: ScriptTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // RN-ABAS-017: a faixa pode estar na página da janela do resultado, e o `ResizeObserver` é o da janela dela (e recriado quando a página muda).
  const page = useHost().document;
  const tabs = scriptTabsOf(run, variables);
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

    const observer = new (element.ownerDocument.defaultView ?? window).ResizeObserver(() => {
      if (revealPending.current) reveal();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [reveal, page]);

  // A aba escolhida pelo teclado cuja troca esperou a pergunta das alterações não salvas (RN-SQL-023). Quando a pergunta troca de aba ("Salvar" ou
  // "Descartar"), o foco vai a ela: o diálogo, ao fechar, o devolve à aba de antes, que já saiu da ordem do Tab, e as setas seguintes contariam a partir da
  // escolhida. Este efeito roda depois da limpeza do diálogo, na mesma troca. "Cancelar" não troca a aba, e outra escolha, ou outra troca, a esquece.
  const awaiting = useRef<ScriptTab | null>(null);
  useEffect(() => {
    const wanted = awaiting.current;
    awaiting.current = null;
    if (wanted === shown) list.current?.querySelector<HTMLElement>(`[data-script-tab="${shown}"]`)?.focus();
  }, [shown]);

  const choose = (next: ScriptTab) => {
    awaiting.current = null;
    return onChoose(next);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = scriptTabKeyTarget(event.key, tabs, shown);
    if (next === null) return;
    event.preventDefault();
    // As abas estão todas na página: o foco vai já à escolhida, quando a troca não espera a pergunta das alterações não salvas.
    if (choose(next) !== false) list.current?.querySelector<HTMLElement>(`[data-script-tab="${next}"]`)?.focus();
    else awaiting.current = next;
  }

  const tab = (item: ScriptTab) => {
    const selected = item === shown;
    const fixed = item === "statistics" || item === "variables";
    const label = item === "statistics" ? copy.statistics : item === "variables" ? copy.variables : copy.result(item + 1, commandHead(entryAt(run, item).target));
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
        title={fixed ? undefined : commandHint(entryAt(run, item).target.sql)}
        onClick={() => choose(item)}
        className={cn("flex h-7 max-w-64 flex-none cursor-pointer items-center border-b-2 px-2 whitespace-nowrap", selected ? `${environmentAccent.border} font-semibold text-ink` : "border-transparent text-muted hover:text-ink")}
      >
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <div ref={list} role="tablist" aria-label={copy.label} onKeyDown={onKeyDown} className="mr-auto flex min-w-0 flex-1">
      {/* `relative`: a posição de cada aba (`offsetLeft`) é contada a partir daqui, como a rolagem. */}
      <div ref={scroller} className="relative flex min-w-0 overflow-x-auto [scrollbar-width:thin]">
        {tabs.filter((item) => item !== "statistics" && item !== "variables").map(tab)}
      </div>
      {variables ? (
        <>
          {tab("variables")}
          {tab("statistics")}
        </>
      ) : (
        tab("statistics")
      )}
    </div>
  );
}

type ResultTabsProps = {
  /** A aba à frente. */
  shown: "result" | "variables";
  idPrefix: string;
  panelId: string;
  onChoose: (tab: "result" | "variables") => void;
};

/**
 * RN-VAR-024: sem script, mas com variáveis avaliadas (depois de um Ctrl+Enter numa declaração), a área ganha as abas "Resultado" e "Variáveis", no lugar do
 * título "Resultado". É uma lista de abas, como a do script: só a escolhida entra no Tab, e as setas, Home e End escolhem a outra.
 */
export function ResultTabs({ shown, idPrefix, panelId, onChoose }: ResultTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const items = ["result", "variables"] as const;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = scriptTabKeyTarget(event.key, items, shown);
    if (next === null) return;
    event.preventDefault();
    onChoose(next);
    list.current?.querySelector<HTMLElement>(`[data-result-tab="${next}"]`)?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={variablesPanelCopy.tabsLabel} onKeyDown={onKeyDown} className="mr-auto flex min-w-0 flex-1">
      {items.map((item) => {
        const selected = item === shown;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            id={`${idPrefix}-${item}`}
            data-result-tab={item}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(item)}
            className={cn("flex h-7 flex-none cursor-pointer items-center border-b-2 px-2 whitespace-nowrap", selected ? `${environmentAccent.border} font-semibold text-ink` : "border-transparent text-muted hover:text-ink")}
          >
            {item === "result" ? variablesPanelCopy.result : variablesPanelCopy.tab}
          </button>
        );
      })}
    </div>
  );
}

type KeptResultNoteProps = {
  /** Há comando da pessoa em andamento na aba: o botão fica, com o porquê, e não executa (o executor recusaria calado). */
  busy: boolean;
  onRunAlone: () => void;
  /**
   * RN-EDIT-022: depois de salvar a coluna inteira nesta aba (que não lê de novo), o que mudou e que ela mostra só as linhas que leu ("Coluna preco atualizada
   * em 1.234 linhas; esta aba mostra só as que leu. …"), depois da nota de sempre; nula sem isso.
   */
  note?: string | null;
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
export function KeptResultNote({ busy, onRunAlone, onFocusLost, note = null }: KeptResultNoteProps) {
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
      <span className="min-w-0 flex-1 text-ink">{note === null ? scriptRunCopy.kept.note : `${scriptRunCopy.kept.note} ${note}`}</span>
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
      <span aria-hidden data-script-waiting title={scriptRunCopy.error.waiting} className="size-1.5 flex-none rounded-full bg-danger" />
      <span className="sr-only">{scriptRunCopy.error.waiting}</span>
    </>
  );
}
