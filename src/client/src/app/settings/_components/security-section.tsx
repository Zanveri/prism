import { FieldError, Input } from "@/components/ui";
import { fieldAria } from "@/lib/utils/form";

import { preferenceLimits } from "../_lib/preferences";
import { settingsCopy } from "../_lib/settings.copy";
import { useDraft } from "../_lib/use-draft";
import { usePreferences } from "../_lib/use-preferences";
import { parseWholeNumber } from "../_lib/whole-number";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.security;
const { min, max } = preferenceLimits.lockMinutes;

/**
 * Segurança (RN-SEG-001): ligar e desligar o bloqueio por inatividade e os minutos até ele. Quem conta o tempo e bloqueia é o
 * bloqueio da janela (`security.lockEnabled` e `security.lockAfterMinutes`); aqui só se escolhe, e vale na hora. Com o bloqueio
 * desligado os minutos ficam à vista e desabilitados.
 */
export function SecuritySection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();
  const { lockEnabled, lockAfterMinutes } = preferences.security;
  const minutes = useDraft({ value: lockAfterMinutes, format: String, parse: (text) => parseWholeNumber(text, min, max), onCommit: (value) => update({ security: { lockAfterMinutes: value } }) });
  const inputId = "cfg-bloquear-minutos";

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <input id="cfg-bloquear" type="checkbox" checked={lockEnabled} onChange={(event) => update({ security: { lockEnabled: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <label htmlFor="cfg-bloquear">{copy.lockEnabled}</label>
        <Input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={copy.minutesLabel}
          disabled={!lockEnabled}
          className="h-9 w-[72px] px-2.5"
          value={minutes.text}
          onChange={(event) => minutes.change(event.target.value)}
          onBlur={minutes.reset}
          onKeyDown={minutes.keyDown}
          {...fieldAria(inputId, minutes.invalid ? settingsCopy.numberError(min, max) : undefined)}
        />
        <span>{copy.minutesSuffix}</span>
      </div>
      <FieldError id={`${inputId}-error`}>{minutes.invalid ? settingsCopy.numberError(min, max) : undefined}</FieldError>
      <p className="text-xs text-muted">{copy.note}</p>
    </SettingsCard>
  );
}
