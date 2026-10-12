import { CheckIcon, FieldError, TextField, environmentTextColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";

const copy = connectionsCopy.form.environment;

type EnvironmentPickerProps = {
  /** O nome do ambiente ao abrir o formulário; o campo é do `FormData`, como os outros. */
  defaultName: string;
  /** A cor escolhida (`#RRGGBB`), ou `null` para nenhuma. É estado do formulário porque as seis cores são botões. */
  color: string | null;
  onColorChange: (color: string | null) => void;
  errors: FieldErrors;
};

/**
 * O painel "Ambiente" (RN-CONN-015): o nome e a cor que identificam uma conexão na lista e na
 * árvore. A cor é uma das seis do canvas ou qualquer outra, pelo seletor nativo; clicar na cor já
 * escolhida a tira. A cor vai ao `FormData` por um campo escondido.
 */
export function EnvironmentPicker({ defaultName, color, onColorChange, errors }: EnvironmentPickerProps) {
  return (
    <section aria-labelledby="cx-environment-title" className="flex flex-col gap-3.5 rounded-lg border border-border bg-panel p-4">
      {/* h3: o título do diálogo de conexão é o h2 (RN-NAV-004). */}
      <h3 id="cx-environment-title" className="text-base leading-5 font-semibold">
        {copy.title}
      </h3>

      <TextField id="cx-environment-name" name="environmentName" label={copy.name} defaultValue={defaultName} autoComplete="off" error={errors.environmentName} />

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 p-0 text-sm text-muted">{copy.color}</legend>
        <input type="hidden" name="environmentColor" value={color ?? ""} />

        <div className="flex flex-wrap gap-3">
          {connectionsCopy.colors.map((swatch) => {
            const selected = swatch.hex === color;

            return (
              <button
                key={swatch.hex}
                type="button"
                aria-label={swatch.name}
                aria-pressed={selected}
                title={swatch.name}
                onClick={() => onColorChange(selected ? null : swatch.hex)}
                style={{ backgroundColor: swatch.hex, color: environmentTextColor(swatch.hex) }}
                className={cn("inline-flex size-8 cursor-pointer items-center justify-center rounded-full", selected && "ring-2 ring-ink ring-offset-2 ring-offset-panel")}
              >
                {selected ? <CheckIcon /> : null}
              </button>
            );
          })}
        </div>

        <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <input
            type="color"
            value={(color ?? "#AEB7C4").toLowerCase()}
            onChange={(event) => onColorChange(event.target.value.toUpperCase())}
            className="h-8 w-11 flex-none cursor-pointer rounded-md border border-border-strong bg-raised p-0.5"
          />
          <span>{copy.otherColor}</span>
          <span className="font-mono text-ink">{color ?? copy.noColor}</span>
        </label>
        <FieldError id="cx-environment-color-error">{errors.environmentColor}</FieldError>
      </fieldset>

      <p className="text-xs text-muted">{copy.hint}</p>
    </section>
  );
}
