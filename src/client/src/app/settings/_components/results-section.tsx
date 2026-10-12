import { recordsCopy } from "@/app/workbench/_lib/records.copy";
import { Field, StatusBadge, TextField } from "@/components/ui";

import { parseNullText, preferenceLimits } from "../_lib/preferences";
import { settingsCopy } from "../_lib/settings.copy";
import { useDraft } from "../_lib/use-draft";
import { usePreferences } from "../_lib/use-preferences";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.results;

/**
 * Resultados (RN-CONFIG-005 e 006): o texto que a grade mostra no lugar do valor nulo, "buscar mais linhas ao rolar até o fim" e o
 * tipo de dado no cabeçalho das colunas. Quem lê é a grade (`results.nullText`, `results.autoLoadMore` e `results.showColumnTypes`);
 * aqui só se escolhe, e vale na hora, inclusive na grade que está montada por baixo desta tela. "Linhas por busca" depende da API
 * (RN-SQL-016) e continua "em breve": o bloco existe, diz isso, e não tem campo.
 */
export function ResultsSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();
  const nullText = useDraft({ value: preferences.results.nullText, format: (text) => text, parse: parseNullText, onCommit: (text) => update({ results: { nullText: text } }) });

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
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
          className="font-mono"
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
    </SettingsCard>
  );
}
