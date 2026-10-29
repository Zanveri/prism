import { recordsCopy } from "@/app/workbench/_lib/records.copy";
import { preferencePlaces } from "@/app/workbench/_lib/result-place";
import { resultPlaceCopy } from "@/app/workbench/_lib/result-place.copy";
import { Field, StatusBadge, TextField } from "@/components/ui";

import { parseNullText, preferenceLimits } from "../_lib/preferences";
import { settingsCopy } from "../_lib/settings.copy";
import { useDraft } from "../_lib/use-draft";
import { usePreferences } from "../_lib/use-preferences";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.results;

/**
 * Resultados (RN-CONFIG-005, 006 e 010): o texto que a grade mostra no lugar do valor nulo, "buscar mais linhas ao rolar até o fim", o
 * tipo de dado no cabeçalho das colunas e onde o resultado das abas novas aparece (no mesmo controle de escolha da densidade do navegador,
 * RN-NAV-011; quem o lê é a área de trabalho, ao abrir uma aba de consulta, e as abas abertas ficam no lugar delas). Quem lê é a grade (`results.nullText`, `results.autoLoadMore` e `results.showColumnTypes`);
 * aqui só se escolhe, e vale na hora, inclusive na grade que está montada por baixo desta tela. "Linhas por busca" depende da API
 * (RN-SQL-016) e continua "em breve": o bloco existe, diz isso, e não tem campo.
 */
export function ResultsSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();
  const nullText = useDraft({ value: preferences.results.nullText, format: (text) => text, parse: parseNullText, onCommit: (text) => update({ results: { nullText: text } }) });

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        <Field>
          <p className="text-sm text-muted">{copy.rowsPerPage}</p>
          <p className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge>{settingsCopy.soonBadge}</StatusBadge>
            <span className="text-sm text-muted">{copy.rowsPerPageSoon}</span>
          </p>
        </Field>
        <TextField
          id="cfg-nulo"
          label={copy.nullText}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={preferenceLimits.nullText.max}
          value={nullText.text}
          error={nullText.invalid ? copy.nullTextError : undefined}
          onChange={(event) => nullText.change(event.target.value)}
          onBlur={nullText.reset}
          onKeyDown={nullText.keyDown}
        />
      </div>
      <p className="text-xs text-muted">{copy.nullTextHint}</p>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={preferences.results.autoLoadMore} onChange={(event) => update({ results: { autoLoadMore: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.autoLoadMore}</span>
      </label>
      <p className="-mt-2 text-xs text-muted">{copy.autoLoadMoreHint}</p>

      <div className="flex items-center gap-2.5">
        <input id="cfg-tipo-cabecalho" type="checkbox" checked={preferences.results.showColumnTypes} onChange={(event) => update({ results: { showColumnTypes: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <label htmlFor="cfg-tipo-cabecalho">{recordsCopy.settings.showColumnTypes}</label>
      </div>
      <p className="-mt-2 text-xs text-muted">{recordsCopy.settings.showColumnTypesHint}</p>

      <fieldset aria-describedby="cfg-lugar-resultado-dica" className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-sm text-muted">{resultPlaceCopy.settings.label}</legend>
        <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2">
          {preferencePlaces(preferences.results.resultPlace).map(({ place, checked }) => (
            <label key={place} className="flex cursor-pointer items-center gap-2.5">
              <input type="radio" name="cfg-lugar-resultado" value={place} checked={checked} onChange={() => update({ results: { resultPlace: place } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
              <span>{resultPlaceCopy.places[place]}</span>
            </label>
          ))}
        </div>
        <p id="cfg-lugar-resultado-dica" className="text-xs text-muted">
          {resultPlaceCopy.settings.hint}
        </p>
      </fieldset>
    </SettingsCard>
  );
}
