import { useState, type KeyboardEvent, type ReactNode } from "react";

import { FolderPlusIcon, PlugIcon, PlusIcon, PowerIcon, RefreshIcon, WorkbenchIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { ToolbarActionId, ToolbarButton } from "../_lib/navigator-toolbar";
import { navigatorCopy } from "../_lib/navigator.copy";
import { stripKeyTarget } from "../_lib/tab-strip";

/** "Recolher tudo": duas setas que se encontram, no traço dos outros ícones (`components/ui/icons.tsx`: 16×16, traço de 1,5, pontas redondas). */
function CollapseAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M4.5 2.5L8 6l3.5-3.5M4.5 13.5L8 10l3.5 3.5" />
    </svg>
  );
}

/** Os desenhos são os que o app já usa para a mesma ação: o do menu de contexto (conectar, desconectar, atualizar) e o do canvas (o "+" e o painel lateral). */
const icons: Record<ToolbarActionId, ReactNode> = {
  newConnection: <PlusIcon />,
  newFolder: <FolderPlusIcon />,
  connect: <PlugIcon />,
  disconnect: <PowerIcon />,
  refresh: <RefreshIcon />,
  collapseAll: <CollapseAllIcon />,
  hide: <WorkbenchIcon />,
};

type NavigatorToolbarProps = {
  /** Os botões, como `toolbarFor` os descreve: sempre os mesmos, e o que não se aplica vem desabilitado. */
  buttons: readonly ToolbarButton[];
  onAction: (id: ToolbarActionId) => void;
};

/**
 * A barra de ações do navegador (RN-NAV-002), acima da busca: botões só de ícone, numa linha que cabe na largura mínima do navegador
 * (sete botões de 24 px). É uma barra de ferramentas: uma parada de tabulação só (o botão que teve o foco por último), e as setas, Home e
 * End andam entre os botões.
 *
 * O botão que não se aplica usa `aria-disabled`, e não `disabled`: continua no caminho das setas, para quem usa leitor de tela saber que
 * ele existe, e o botão que se desabilita ao ser usado ("Conectar", assim que a conexão começa) não perde o foco para o corpo da página.
 */
export function NavigatorToolbar({ buttons, onAction }: NavigatorToolbarProps) {
  const [focused, setFocused] = useState(0);
  // A barra pode ter menos botões do que tinha: a parada de tabulação nunca fica num que não existe.
  const tabStop = Math.min(focused, buttons.length - 1);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
    const target = stripKeyTarget(event.key, items.indexOf(event.target as HTMLElement), items.length);
    if (target === null) return;

    event.preventDefault();
    items[target].focus();
  }

  return (
    <div role="toolbar" aria-label={navigatorCopy.toolbar.label} onKeyDown={handleKeyDown} className="mx-2 mb-1.5 flex flex-none items-center gap-0.5">
      {buttons.map((button, index) => (
        <button
          key={button.id}
          type="button"
          aria-label={button.label}
          title={button.title}
          aria-disabled={button.disabled ? true : undefined}
          tabIndex={index === tabStop ? 0 : -1}
          onFocus={() => setFocused(index)}
          onClick={() => {
            if (!button.disabled) onAction(button.id);
          }}
          className={cn(
            "flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted",
            // O de esconder fica na ponta direita, longe dos que agem sobre a árvore.
            button.id === "hide" && "ml-auto",
          )}
        >
          {icons[button.id]}
        </button>
      ))}
    </div>
  );
}
