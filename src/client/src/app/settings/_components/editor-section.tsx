import { editorFont } from "../_lib/editor-style";
import { preferenceLimits, sqlFormatStyles } from "../_lib/preferences";
import { settingsCopy } from "../_lib/settings.copy";
import { usePreferences } from "../_lib/use-preferences";
import { NumberField } from "./number-field";
import { SettingsCard } from "./settings-card";
import { appliedPalette, editorSampleOf, SqlSample } from "./sql-sample";

const copy = settingsCopy.editor;
const formatCopy = copy.formatStyle;

/**
 * Editor SQL (RN-CONFIG-001 e RN-CONFIG-004): o tamanho da fonte e o da tabulação, o estilo de formatação (`Ctrl+Shift+F`), o autocompletar, a conversão das palavras-chave
 * para maiúsculas, a linha em branco que separa os comandos (RN-SQL-018) e o valor das variáveis no fim da linha (RN-CONFIG-004 e RN-VAR-025). Valem para todas as abas de SQL, na hora: a área de trabalho fica montada por baixo desta tela (`WorkbenchSlot`), e cada
 * editor recebe o que muda aqui sem ser recriado (o texto, o cursor e o desfazer ficam). A fonte do editor fica em Aparência (RN-CONFIG-008), ao lado da
 * fonte da interface; a prévia daqui a desenha também.
 */
export function EditorSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        <NumberField id="cfg-tamanho" label={copy.fontSize} value={preferences.editor.fontSize} {...preferenceLimits.fontSize} onCommit={(fontSize) => update({ editor: { fontSize } })} />
        <NumberField id="cfg-tab" label={copy.tabSize} value={preferences.editor.tabSize} {...preferenceLimits.tabSize} onCommit={(tabSize) => update({ editor: { tabSize } })} />
      </div>
      <p className="text-xs text-muted">{copy.fontNote}</p>

      <fieldset aria-describedby="cfg-formatacao-dica" className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-sm text-muted">{formatCopy.label}</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-x-5 gap-y-2">
          {sqlFormatStyles.map((style) => (
            <label key={style} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="cfg-formatacao"
                value={style}
                checked={preferences.editor.formatStyle === style}
                onChange={() => update({ editor: { formatStyle: style } })}
                className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
              />
              <span>{formatCopy[style]}</span>
            </label>
          ))}
        </div>
        <p id="cfg-formatacao-dica" className="text-xs text-muted">
          {formatCopy.hint}
        </p>
      </fieldset>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-panel px-3 py-1.5 text-xs">{copy.preview}</div>
        <SqlSample lines={editorSampleOf(preferences.editor.formatStyle, preferences.editor.uppercaseKeywords)} palette={appliedPalette} font={editorFont(preferences.editor)} />
      </div>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" id="cfg-autocompletar" checked={preferences.editor.autocomplete} onChange={(event) => update({ editor: { autocomplete: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.autocomplete}</span>
      </label>
      <p className="-mt-2 text-xs text-muted">{copy.autocompleteHint}</p>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" id="cfg-maiusculas" checked={preferences.editor.uppercaseKeywords} onChange={(event) => update({ editor: { uppercaseKeywords: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.uppercaseKeywords}</span>
      </label>
      <p className="-mt-2 text-xs text-muted">{copy.uppercaseKeywordsHint}</p>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" id="cfg-linha-em-branco" checked={preferences.editor.blankLineSeparates} onChange={(event) => update({ editor: { blankLineSeparates: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.blankLineSeparates}</span>
      </label>
      <p className="-mt-2 text-xs text-muted">{copy.blankLineSeparatesHint}</p>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" id="cfg-valor-variaveis" checked={preferences.editor.showVariableValues} onChange={(event) => update({ editor: { showVariableValues: event.target.checked } })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.showVariableValues}</span>
      </label>
      <p className="-mt-2 text-xs text-muted">{copy.showVariableValuesHint}</p>
    </SettingsCard>
  );
}
