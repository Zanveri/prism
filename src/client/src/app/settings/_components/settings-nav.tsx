import { navItem } from "@/components/ui";

import type { SettingsSection } from "../_lib/sections";
import { settingsCopy } from "../_lib/settings.copy";

type SettingsNavProps = {
  sections: readonly SettingsSection[];
  activeId: string | null;
  onSelect: (section: SettingsSection) => void;
};

/**
 * A navegação entre as seções (a coluna da esquerda do canvas). São botões, e não os `<a href="#cfg-...">` do canvas: a
 * rota é em hash, e uma âncora trocaria a rota e jogaria a pessoa de volta na área de trabalho. A seção "em breve" leva a
 * marca ao lado do nome, para ninguém clicar esperando um controle.
 */
export function SettingsNav({ sections, activeId, onSelect }: SettingsNavProps) {
  return (
    <nav aria-label={settingsCopy.navLabel} className="sticky top-0 flex min-w-0 flex-[1_1_220px] flex-col gap-0.5 self-start px-3 py-5">
      {sections.map((section) => {
        const active = section.id === activeId;

        return (
          <button
            key={section.id}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(section)}
            className={navItem({ active })}
          >
            <span className="min-w-0 flex-1 truncate">{section.label}</span>
            {section.soon ? <span className="flex-none text-xs font-normal text-subtle">{settingsCopy.soonNav}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
