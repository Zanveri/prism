import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui";

import { settingsCopy } from "../_lib/settings.copy";

type SettingsCardProps = {
  /** O `id` do elemento, que a navegação rola até (`settingsSections[].anchor`). */
  anchor: string;
  title: string;
  /** O cartão de uma seção "em breve" leva a etiqueta ao lado do título. */
  soon?: boolean;
  children: ReactNode;
};

/**
 * Um cartão do canvas: painel com borda, título e o conteúdo da seção. O título recebe o foco quando a navegação leva a ele
 * (`tabIndex={-1}`), para quem usa o teclado continuar dali.
 */
export function SettingsCard({ anchor, title, soon = false, children }: SettingsCardProps) {
  return (
    <section id={anchor} aria-labelledby={`${anchor}-title`} className="flex scroll-mt-5 flex-col gap-4 rounded-lg border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={`${anchor}-title`} tabIndex={-1} className="text-[16px] leading-6 font-semibold">
          {title}
        </h2>
        {soon ? <StatusBadge>{settingsCopy.soonBadge}</StatusBadge> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Uma seção que depende de uma parte da API que ainda não existe (RN-CONFIG-001): o cartão aparece e diz o que virá. Não tem
 * campo nem botão, nem desabilitado: um controle que não faz nada finge funcionar.
 */
export function ComingSoonCard({ anchor, title, description }: { anchor: string; title: string; description: string }) {
  return (
    <SettingsCard anchor={anchor} title={title} soon>
      <p className="max-w-[68ch] text-muted">{description}</p>
    </SettingsCard>
  );
}
