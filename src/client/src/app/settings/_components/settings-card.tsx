import type { ReactNode } from "react";

import { StatusBadge } from "@/components/ui";

import { settingsCopy } from "../_lib/settings.copy";

type SettingsCardProps = {
  /** O `id` do elemento (`settingsSections[].anchor`). */
  anchor: string;
  title: string;
  /** A página de uma seção "em breve" leva a etiqueta ao lado do título. */
  soon?: boolean;
  children: ReactNode;
};

/**
 * A página de uma seção: o título, com um fio embaixo, e o conteúdo na largura toda da janela. Listas, grades e prévias ocupam a largura; o texto
 * corrido para em 80 caracteres por linha, para continuar legível com a janela maximizada. O título recebe o foco quando a navegação leva a ele
 * (`tabIndex={-1}`), para quem usa o teclado continuar dali.
 */
export function SettingsCard({ anchor, title, soon = false, children }: SettingsCardProps) {
  return (
    <section id={anchor} aria-labelledby={`${anchor}-title`} className="flex flex-col gap-4 [&_p]:max-w-[80ch]">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-4">
        <h2 id={`${anchor}-title`} tabIndex={-1} className="text-xl leading-7 font-semibold text-balance">
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
      <p className="text-muted">{description}</p>
    </SettingsCard>
  );
}
