import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { BuildIcon, ChevronIcon, ContextMenu, WorkbenchIcon, type ContextMenuItem } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { cn } from "@/lib/utils/cn";

import { modeMenuCopy } from "./mode-menu.copy";

export type AppMode = "workbench" | "build";

const copy = modeMenuCopy;

/** O estilo de item da barra superior: 36 px de altura, mais compacto abaixo de 1100 px (RN-CONFIG-002). */
const itemClassName = "flex h-9 flex-none cursor-pointer items-center gap-2 rounded-md px-3 no-underline transition-colors max-[1100px]:px-2";

/** RN-CONSTRUIR-001: o modo vem da rota (`/workbench` ou `/build`); fora das duas (por exemplo, em Configurações), mostra o último visitado. */
export function modeOf(pathname: string, last: AppMode): AppMode {
  if (pathname === pathsConfig.workbench || pathname.startsWith(`${pathsConfig.workbench}/`)) return "workbench";
  if (pathname === pathsConfig.build || pathname.startsWith(`${pathsConfig.build}/`)) return "build";
  return last;
}

/** Os itens do menu de modo (RN-CONSTRUIR-001): escolha única (`menuitemradio`) com o ícone à esquerda, a dica abaixo do nome e o visto no modo ativo. */
export function modeMenuGroups(current: AppMode, onSelect?: (mode: AppMode) => void): Array<{ label: string; items: ContextMenuItem[] }> {
  return [
    {
      label: copy.label,
      items: [
        {
          id: "workbench",
          label: copy.workbench.label,
          hint: copy.workbench.hint,
          icon: <WorkbenchIcon />,
          checked: current === "workbench",
          onSelect: () => onSelect?.("workbench"),
        },
        {
          id: "build",
          label: copy.build.label,
          hint: copy.build.hint,
          icon: <BuildIcon />,
          checked: current === "build",
          onSelect: () => onSelect?.("build"),
        },
      ],
    },
  ];
}

/**
 * O seletor de modo na barra superior (RN-CONSTRUIR-001): mostra o ícone e o nome do modo ativo (ou do último visitado, fora das duas telas) com a seta
 * e abre o menu com "Área de trabalho" e "Construir".
 */
export function ModeMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastMode = useRef<AppMode>("workbench");
  const [menu, setMenu] = useState<{ point: { x: number; y: number }; keyboard: boolean } | null>(null);

  const mode = modeOf(location.pathname, lastMode.current);
  lastMode.current = mode;

  const isModeRoute =
    location.pathname === pathsConfig.workbench ||
    location.pathname.startsWith(`${pathsConfig.workbench}/`) ||
    location.pathname === pathsConfig.build ||
    location.pathname.startsWith(`${pathsConfig.build}/`);

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ point: { x: rect.left, y: rect.bottom + 2 }, keyboard: event.detail === 0 });
        }}
        className={cn(itemClassName, isModeRoute ? "bg-selected text-ink" : "text-muted hover:bg-selected hover:text-ink")}
      >
        {mode === "build" ? <BuildIcon /> : <WorkbenchIcon />}
        <span>{copy[mode].label}</span>
        <ChevronIcon width="12" height="12" className="text-subtle" />
      </button>
      {menu === null ? null : (
        <ContextMenu
          label={copy.label}
          point={menu.point}
          initialFocus={menu.keyboard ? "first" : "menu"}
          groups={modeMenuGroups(mode, (next) => void navigate(next === "build" ? pathsConfig.build : pathsConfig.workbench))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
