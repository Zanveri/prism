import { Field, FieldLabel, Select, type SelectOption } from "@/components/ui";

import { editorFont } from "../_lib/editor-style";
import { editorFonts, preferenceLimits } from "../_lib/preferences";
import { settingsCopy } from "../_lib/settings.copy";
import { usePreferences } from "../_lib/use-preferences";
import { NumberField } from "./number-field";
import { SettingsCard } from "./settings-card";
import { editorSample, SqlSample, type SamplePalette } from "./sql-sample";

const copy = settingsCopy.editor;

const fontOptions: SelectOption[] = editorFonts.map((font) => ({ value: font, label: font }));

/** As cores do editor, que são as do tema aplicado: o mesmo que o CodeMirror usa (`sql-editor.tsx`). */
const editorPalette: SamplePalette = {
  bg: "var(--color-background)",
  fg: "var(--color-ink)",
  kw: "var(--color-syntax-keyword)",
  str: "var(--color-syntax-string)",
  num: "var(--color-syntax-number)",
  com: "var(--color-syntax-comment)",
  rolagem: "var(--color-border-strong)",
};

/**
 * Editor SQL (RN-CONFIG-001 e RN-CONFIG-004): a fonte, o tamanho dela e o da tabulação, o autocompletar e a conversão das palavras-chave
 * para maiúsculas. Valem para todas as abas de SQL, na hora: a área de trabalho fica montada por baixo desta tela (`WorkbenchSlot`), e cada
 * editor recebe o que muda aqui sem ser recriado (o texto, o cursor e o desfazer ficam).
 */
export function EditorSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        <Field>
          <FieldLabel htmlFor="cfg-fonte">{copy.fontFamily}</FieldLabel>
          <Select
            id="cfg-fonte"
            value={preferences.editor.fontFamily}
            options={fontOptions}
            onChange={(value) => {
              const font = editorFonts.find((candidate) => candidate === value);
              if (font !== undefined) update({ editor: { fontFamily: font } });
            }}
          />
        </Field>
        <NumberField id="cfg-tamanho" label={copy.fontSize} value={preferences.editor.fontSize} {...preferenceLimits.fontSize} onCommit={(fontSize) => update({ editor: { fontSize } })} />
        <NumberField id="cfg-tab" label={copy.tabSize} value={preferences.editor.tabSize} {...preferenceLimits.tabSize} onCommit={(tabSize) => update({ editor: { tabSize } })} />
      </div>
      <p className="text-xs text-muted">{copy.fontNote}</p>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-panel px-3 py-1.5 text-xs">{copy.preview}</div>
        <SqlSample lines={editorSample} palette={editorPalette} font={editorFont(preferences.editor)} />
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
    </SettingsCard>
  );
}
