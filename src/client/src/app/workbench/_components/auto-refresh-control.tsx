import { useState, type FormEvent, type MouseEvent } from "react";

import { Button, CloseIcon, ContextMenu, Dialog, TextField, TimerIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { customSecondsLimits, intervalLabel, type AutoRefreshBlocker, type AutoRefreshState } from "../_lib/auto-refresh";
import { autoRefreshGroups, isAutoRefreshAction, type AutoRefreshAction } from "../_lib/auto-refresh-menu";
import { autoRefreshCopy } from "../_lib/auto-refresh.copy";
import { menuGroupOf } from "./result-edit-dialogs";

const copy = autoRefreshCopy;

/** O botão de ícone da barra do resultado: o mesmo do zoom e dos botões de recolher e maximizar. */
const iconButton = "flex size-7 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted";

/** A hora da última atualização, como a barra a escreve ("14:32:05"). */
export const lastTime = (at: number) => new Date(at).toLocaleTimeString("pt-BR");

/** O que a barra diz com ela ligada: o intervalo e, depois, a execução em andamento, a pausa da edição ou a hora da última atualização. */
export function onText(state: Extract<AutoRefreshState, { status: "on" }>): string {
  const every = copy.bar.every(intervalLabel(state.everyMs));
  const detail = state.running ? copy.bar.running : state.paused === "editing" ? copy.bar.paused : state.lastAt === null ? null : copy.bar.last(lastTime(state.lastAt));
  return detail === null ? every : `${every} · ${detail}`;
}

/** O botão do relógio, ao lado do X no mesmo grupo. */
const openerOf = (button: HTMLElement) => button.parentElement?.querySelector<HTMLElement>("[data-auto-refresh-opener]") ?? null;

/**
 * A ref do X: a limpeza (React 19) roda quando ele sai, com ele ainda na página. Se ele tinha o foco, o foco vai ao botão do relógio, que fica: sem isso ele
 * cairia no `body`, fora da aba, e o F5 da aba deixaria de valer. O X sai sem clique quando ela para sozinha (o erro, o cancelamento, o comando que gravou,
 * a sessão que caiu): por exemplo, a pessoa no X aperta F5, o comando dá erro, e ela para. No módulo, e não na renderização: a ref estável não roda a cada
 * renderização (com o X focado, cada uma levaria o foco embora).
 */
function keepFocusInBar(button: HTMLButtonElement | null) {
  if (button === null) return;
  return () => {
    if (button.ownerDocument.activeElement === button) openerOf(button)?.focus();
  };
}

type AutoRefreshBarProps = {
  state: AutoRefreshState;
  /** Por que não liga agora: o botão fica, desabilitado, com o motivo (sem linhas na tela, o comando que grava, a aba ocupada ou sem sessão). */
  blocker: AutoRefreshBlocker | null;
  /** Abre os intervalos no ponto dado; `keyboard` quando veio do Enter ou do Espaço (o foco vai ao primeiro item). */
  onOpenMenu: (point: { x: number; y: number }, keyboard: boolean) => void;
  onOff: () => void;
  /** O menu está aberto (o botão diz isso ao leitor de tela). */
  expanded?: boolean;
  /** O menu abre para cima do botão: no rodapé dos Registros, embaixo dele só há a barra de status. */
  opensUp?: boolean;
};

/**
 * Onde o menu abre: logo abaixo do botão, alinhado à esquerda dele (ou, com `up`, a partir de logo acima dele: sem espaço embaixo, `placeMenu` o põe para
 * cima do ponto); e se veio do teclado (o clique do Enter e do Espaço não tem `detail`).
 */
function opening(event: MouseEvent<HTMLButtonElement>, up: boolean): { point: { x: number; y: number }; keyboard: boolean } {
  const rect = event.currentTarget.getBoundingClientRect();
  return { point: { x: rect.left, y: up ? rect.top - 2 : rect.bottom + 2 }, keyboard: event.detail === 0 };
}

/**
 * A atualização automática na barra do resultado (RN-GRADE-014), sem estado: desligada, o botão de ícone do relógio, sempre à vista (desabilitado, com o
 * motivo, quando não se aplica: depois de um DDL ou de um UPDATE ele diz que o comando grava, e sem resultado, que não há linhas), e antes dele a nota de
 * quando ela parou sozinha; ligada, o mesmo botão com "Atualiza a cada 10 s · última às 14:32:05", que abre os intervalos, e o X, que desliga com um
 * clique. O botão do relógio é UM elemento só, no mesmo lugar ligada ou não: escolher um intervalo no menu devolve o foco a ele, e ele continua na página
 * (o foco não cai no `body`, fora da aba, e o F5 da aba segue valendo); o X, que sai da página ao desligar (pelo clique ou porque ela parou sozinha), passa
 * o foco a ele. Nada aqui é região viva: o texto muda a cada atualização, e o leitor de tela não precisa ouvi-lo a cada 5 s.
 */
export function AutoRefreshBar({ state, blocker, onOpenMenu, onOff, expanded = false, opensUp = false }: AutoRefreshBarProps) {
  const on = state.status === "on" ? state : null;
  const stopped = state.status === "off" ? state.stopped : null;

  const unavailable = on !== null || blocker === null ? null : copy.bar.unavailable(copy.reasons[blocker]);
  const label = on !== null ? copy.bar.change : (unavailable ?? copy.bar.button);

  return (
    <div role={on === null ? undefined : "group"} aria-label={on === null ? undefined : copy.bar.group} className={cn("flex min-w-0 items-center rounded-sm", on !== null && "bg-accent/10 pl-0.5")}>
      {stopped === null ? null : (
        <span className="flex min-w-0 items-baseline gap-2 px-2 text-xs text-ink">
          <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
          <span className="truncate">{copy.stopped[stopped]}</span>
        </span>
      )}
      <button
        type="button"
        data-auto-refresh-opener=""
        aria-haspopup="menu"
        aria-expanded={expanded}
        // Ligada, o nome é o texto à vista (o leitor de tela o lê), e a dica diz o que o clique faz.
        aria-label={on === null ? label : undefined}
        title={label}
        aria-disabled={unavailable === null ? undefined : true}
        onClick={(event) => {
          if (unavailable !== null) return;
          const { point, keyboard } = opening(event, opensUp);
          onOpenMenu(point, keyboard);
        }}
        className={on === null ? iconButton : "flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-xs text-ink transition-colors hover:bg-selected"}
      >
        <TimerIcon className={cn(on !== null && "text-accent", on?.running === true && "animate-pulse")} />
        {on === null ? null : <span className="truncate">{onText(on)}</span>}
      </button>
      {on === null ? null : (
        <button
          ref={keepFocusInBar}
          type="button"
          aria-label={copy.bar.off}
          title={copy.bar.off}
          onClick={(event) => {
            const opener = openerOf(event.currentTarget);
            onOff();
            opener?.focus();
          }}
          className={iconButton}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

type AutoRefreshControlProps = Omit<AutoRefreshBarProps, "onOpenMenu" | "onOff" | "expanded"> & { onChoose: (action: AutoRefreshAction) => void };

/** O controle com o menu dos intervalos (`autoRefreshGroups`, os mesmos do submenu da grade), que abre logo abaixo do botão (ou acima, `opensUp`). */
export function AutoRefreshControl({ state, blocker, opensUp, onChoose }: AutoRefreshControlProps) {
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; keyboard: boolean } | null>(null);
  const choose = (action: string) => {
    if (isAutoRefreshAction(action)) onChoose(action);
  };

  return (
    <>
      <AutoRefreshBar state={state} blocker={blocker} opensUp={opensUp} expanded={menu !== null} onOpenMenu={(point, keyboard) => setMenu({ point, keyboard })} onOff={() => onChoose("autoRefresh:off")} />
      {menu === null ? null : (
        <ContextMenu label={copy.menu.label} point={menu.point} initialFocus={menu.keyboard ? "first" : "menu"} groups={autoRefreshGroups(state).map((group) => menuGroupOf(group, choose))} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

const formID = "auto-refresh-form";

type AutoRefreshDialogProps = {
  /** O intervalo em uso, para o campo nascer com ele (ligada); desligada, o campo nasce vazio. */
  everyMs: number | null;
  /** A recusa do último texto enviado, no campo. */
  error: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
};

/**
 * O "Personalizado…" da atualização automática (RN-GRADE-014): os segundos, inteiros, de 1 a 3.600. Só desenha: quem chama confere o texto, liga e diz o
 * erro (`useAutoRefresh`). Montado ao abrir e desmontado ao fechar.
 */
export function AutoRefreshDialog({ everyMs, error, onSubmit, onCancel }: AutoRefreshDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("seconds");
    onSubmit(field !== null && "value" in field ? String(field.value) : "");
  }

  return (
    <Dialog
      open
      size="sm"
      title={copy.dialog.title}
      description={copy.dialog.description}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {copy.dialog.cancel}
          </Button>
          <Button type="submit" form={formID}>
            {copy.dialog.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          id="auto-refresh-seconds"
          name="seconds"
          inputMode="numeric"
          maxLength={String(customSecondsLimits.max).length}
          label={copy.dialog.seconds}
          defaultValue={everyMs === null ? "" : String(Math.round(everyMs / 1000))}
          autoComplete="off"
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          error={error ?? undefined}
        />
      </form>
    </Dialog>
  );
}
