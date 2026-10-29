import type { ComponentProps, ComponentType } from "react";
import { NavLink } from "react-router";

import { CodeIcon, InfoIcon, LockIcon, navItem, PackageIcon, PaletteIcon, PuzzleIcon, RefreshIcon, TableIcon, TransactionIcon, UploadIcon, UserIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { SettingsSection, SettingsSectionId } from "../_lib/sections";
import { settingsTo } from "../_lib/settings-route";
import { settingsCopy } from "../_lib/settings.copy";

/**
 * O ícone de cada seção, ao lado do nome. Onde a tela já tinha um ícone para a mesma coisa, é ele: o de "Importar conexões…" (Importar), o do editor
 * de código (Editor SQL), o da tabela (Resultados), o cadeado (Segurança, o bloqueio), o de atualizar (Atualizações) e o pacote dos drivers.
 */
const sectionIcons: Record<SettingsSectionId, ComponentType<ComponentProps<"svg">>> = {
  account: UserIcon,
  import: UploadIcon,
  appearance: PaletteIcon,
  editor: CodeIcon,
  results: TableIcon,
  security: LockIcon,
  updates: RefreshIcon,
  drivers: PackageIcon,
  about: InfoIcon,
  plugins: PuzzleIcon,
  transactions: TransactionIcon,
};

/**
 * A navegação entre as páginas das seções (a coluna da esquerda do canvas), fixa enquanto a página rola. Cada entrada é o endereço da página
 * (`/settings/<seção>`), com o ícone e o nome, e a da página aberta leva `aria-current="page"`. Trocar de seção troca a entrada do histórico em vez de
 * empilhar: nenhum botão nem tecla anda pelo histórico das rotas (RN-ABAS-018), e fechar volta à área de trabalho de uma vez. A seção "em breve" leva
 * a marca ao lado do nome, para ninguém abrir esperando um controle.
 */
export function SettingsNav({ sections }: { sections: readonly SettingsSection[] }) {
  return (
    <nav aria-label={settingsCopy.navLabel} className="flex w-60 flex-none flex-col gap-0.5 overflow-y-auto border-r border-border bg-panel px-3 py-4">
      {sections.map((section) => {
        const Icon = sectionIcons[section.id];

        return (
          <NavLink key={section.id} to={settingsTo(section.id)} replace className={({ isActive }) => cn(navItem({ active: isActive }), "no-underline")}>
            <Icon />
            <span className="min-w-0 flex-1 truncate">{section.label}</span>
            {section.soon ? <span className="flex-none text-xs font-normal text-subtle">{settingsCopy.soonNav}</span> : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
