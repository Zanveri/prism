import { useSyncExternalStore } from "react";

import { Field, FieldLabel } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { fontStack } from "../_lib/fonts";
import { navigatorDensities } from "../_lib/preferences";
import { appliedTheme, subscribeSystemScheme, systemPrefersLight } from "../_lib/theme";
import { settingsCopy } from "../_lib/settings.copy";
import { themeOptions, themePreviews, type ThemeOption } from "../_lib/themes";
import { usePreferences } from "../_lib/use-preferences";
import { AppZoomControl } from "./app-zoom-control";
import { FontPicker } from "./font-picker";
import { SettingsCard } from "./settings-card";
import { appliedPalette, fontSample, SqlSample, themeSample } from "./sql-sample";

const copy = settingsCopy.appearance;
const fontCopy = copy.fonts;
const densityCopy = copy.density;

/**
 * O cartão de um tema: uma faixa com as cores dele e o nome. As cores são as da prévia do tema, e não as do que está aplicado. A faixa é
 * só para os olhos (`aria-hidden`): o nome acessível do botão é o do tema, e não "SELECT nome 'texto' 42 Prism Claro claro".
 */
function ThemeCard({ option, selected, onPick }: { option: ThemeOption; selected: boolean; onPick: () => void }) {
  const colors = themePreviews[option.mode];

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={option.name}
      onClick={onPick}
      className={cn("flex cursor-pointer flex-col gap-2 rounded-lg border bg-raised p-2.5 text-left text-ink transition-colors", selected ? "border-accent" : "border-border hover:border-border-strong")}
    >
      <span aria-hidden="true" className="flex h-10 items-center gap-1.5 overflow-hidden rounded-[5px] border px-2.5 font-mono text-xs whitespace-nowrap" style={{ background: colors.bg, borderColor: colors.linha }}>
        <span style={{ color: colors.kw }}>SELECT</span>
        <span style={{ color: colors.fg }}>nome</span>
        <span style={{ color: colors.str }}>&apos;texto&apos;</span>
        <span style={{ color: colors.num }}>42</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="font-semibold">{option.name}</span>
        <span className="ml-auto text-xs text-muted">{option.kind}</span>
      </span>
    </button>
  );
}

/**
 * Aparência: tema (RN-CONFIG-001 e RN-CONFIG-003) e fontes (RN-CONFIG-008). Um dos seis temas do canvas, ou o do sistema: a escolha vai para as preferências do
 * usuário, e quem aplica o tema na tela é o `ThemeSync`, na hora. Com "seguir o sistema" ligado o cartão marcado é o do Prism no modo que
 * o sistema está usando agora (Escuro ou Claro); escolher um cartão desliga o "seguir", e desligá-lo fica no tema que a tela já mostrava.
 *
 * As fontes: a da interface e a do editor SQL, cada uma a do app ou uma instalada (`FontPicker`). Quem as aplica é o `FontSync`, na hora; a
 * interface inteira é a prévia da primeira, e uma linha de SQL, a da segunda.
 *
 * O zoom do programa (RN-ZOOM-001) é o único daqui que não é preferência do usuário: mora no processo principal, para a instalação (`AppZoomControl`). A
 * densidade do navegador (RN-NAV-011) é, como o tema, e a árvore e a lista de scripts a seguem na hora.
 */
export function AppearanceSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();
  const systemIsLight = useSyncExternalStore(subscribeSystemScheme, systemPrefersLight, () => false);

  const applied = appliedTheme(preferences.theme, systemIsLight);
  const colors = themePreviews[applied];
  const shown = themeOptions.find((option) => option.mode === applied) ?? themeOptions[0];

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div role="group" aria-label={copy.themeGroup} className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),232px))] gap-3">
        {themeOptions.map((option) => (
          <ThemeCard key={option.mode} option={option} selected={option.mode === applied} onPick={() => update({ theme: option.mode })} />
        ))}
      </div>

      <div className="flex flex-col overflow-hidden rounded-lg border" style={{ background: colors.bg, color: colors.fg, borderColor: colors.linha }}>
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs" style={{ background: colors.painel, borderColor: colors.linha }}>
          <span>{copy.preview}</span>
          <span className="font-semibold">{shown.name}</span>
        </div>
        <SqlSample lines={themeSample} palette={colors} className="max-h-28" />
      </div>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={preferences.theme === "system"} onChange={(event) => update({ theme: event.target.checked ? "system" : applied })} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
        <span>{copy.followSystem}</span>
      </label>
      <p className="text-xs text-muted">{copy.note}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
        <Field>
          <FieldLabel htmlFor="cfg-fonte-interface">{fontCopy.ui}</FieldLabel>
          <FontPicker id="cfg-fonte-interface" label={fontCopy.ui} role="ui" value={preferences.ui.fontFamily} onChange={(fontFamily) => update({ ui: { fontFamily } })} hintId="cfg-fonte-interface-dica" />
          <p id="cfg-fonte-interface-dica" className="text-xs text-muted">
            {fontCopy.uiHint}
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="cfg-fonte-editor">{fontCopy.editor}</FieldLabel>
          <FontPicker id="cfg-fonte-editor" label={fontCopy.editor} role="editor" value={preferences.editor.fontFamily} onChange={(fontFamily) => update({ editor: { fontFamily } })} hintId="cfg-fonte-editor-dica" />
          <p id="cfg-fonte-editor-dica" className="text-xs text-muted">
            {fontCopy.editorHint}
          </p>
          <SqlSample lines={fontSample} palette={appliedPalette} font={{ fontFamily: fontStack("editor", preferences.editor.fontFamily) }} className="rounded-md border border-border" />
        </Field>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
        <AppZoomControl />
        <fieldset aria-describedby="cfg-densidade-dica" className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-sm text-muted">{densityCopy.label}</legend>
          <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2">
            {navigatorDensities.map((density) => (
              <label key={density} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="radio"
                  name="cfg-densidade"
                  value={density}
                  checked={preferences.ui.navigatorDensity === density}
                  onChange={() => update({ ui: { navigatorDensity: density } })}
                  className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
                />
                <span>{densityCopy[density]}</span>
              </label>
            ))}
          </div>
          <p id="cfg-densidade-dica" className="text-xs text-muted">
            {densityCopy.hint}
          </p>
        </fieldset>
      </div>
    </SettingsCard>
  );
}
