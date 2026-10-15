import { useRef } from "react";

import { CheckIcon, EyedropperIcon, FieldError, NoColorIcon, environmentTextColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { connectionsCopy } from "../_lib/connections.copy";

const copy = connectionsCopy.iconColor;

/** A bolinha: um botão redondo, de 32 px. É a mesma do ambiente (RN-CONN-017). */
export const swatchClassName = "inline-flex size-8 cursor-pointer items-center justify-center rounded-full";
/** A marca da escolhida. */
export const chosenClassName = "ring-2 ring-ink ring-offset-2 ring-offset-panel";

/** A cor que o seletor do sistema mostra ao abrir quando não há nenhuma: o Cinza do canvas. */
export const pickerStart = "#AEB7C4";

/** O seletor de cor do sistema: o `showPicker`, onde houver; senão o clique, que é como ele abria antes. */
export function openSystemPicker(input: HTMLInputElement | null) {
  if (input === null) return;
  if (typeof input.showPicker === "function") input.showPicker();
  else input.click();
}

export type ColorFieldProps = {
  /** O começo dos ids (`folder` na pasta, `script` no script): cada formulário tem os seus. */
  idPrefix: string;
  /** O título da fileira ("Cor da pasta", "Cor do ícone"). */
  legend: string;
  /** O nome do campo escondido que leva a cor ao `FormData` (vazio é "sem cor"). Sem ele, a cor fica só no estado de quem usa. */
  name?: string;
  /** A cor escolhida (`#RRGGBB`), ou `null` para nenhuma. */
  color: string | null;
  onChange: (color: string | null) => void;
  error?: string;
  /** O que a fileira explica embaixo. */
  hint?: string;
};

/**
 * A cor de um ícone (RN-PASTA-007, a da pasta; RN-SCRIPT-006, a do script): a fileira de bolinhas do ambiente (RN-CONN-017), com "Sem cor" na frente.
 * "Sem cor" (o traço na diagonal) é a escolhida quando não há cor, e é como se tira a cor; as seis do canvas, uma a uma (clicar na escolhida também a
 * tira); e "Outra cor", com o conta-gotas, a ÚNICA que abre o seletor do sistema, pelo `<input type="color">` ao lado dela, fora de qualquer `<label>`, do
 * Tab e da leitura, como no ambiente. Cada bolinha é um `<button>` com `aria-pressed`, e o `#RRGGBB` da outra cor vai no nome acessível e na dica.
 *
 * As bolinhas mostram a cor como a pessoa a escolheu; quem pinta o ícone com ela passa pelo `iconColorStyle`, que a ajusta ao contraste do tema.
 */
export function ColorField({ idPrefix, legend, name, color, onChange, error, hint }: ColorFieldProps) {
  const systemPicker = useRef<HTMLInputElement>(null);
  const chosen = color === null ? null : color.toUpperCase();
  const otherChosen = chosen !== null && !connectionsCopy.colors.some((swatch) => swatch.hex === chosen);
  const otherName = otherChosen ? copy.otherChosen(chosen) : copy.other;

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0 text-sm text-muted">{legend}</legend>
      {name === undefined ? null : <input type="hidden" name={name} value={color ?? ""} />}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          aria-label={copy.none}
          aria-pressed={chosen === null}
          title={copy.none}
          onClick={() => onChange(null)}
          className={cn(swatchClassName, "border border-border-strong bg-raised text-muted transition-colors hover:text-ink", chosen === null && chosenClassName)}
        >
          <NoColorIcon />
        </button>

        {connectionsCopy.colors.map((swatch) => {
          const selected = swatch.hex === chosen;

          return (
            <button
              key={swatch.hex}
              type="button"
              aria-label={swatch.name}
              aria-pressed={selected}
              title={swatch.name}
              onClick={() => onChange(selected ? null : swatch.hex)}
              style={{ backgroundColor: swatch.hex, color: environmentTextColor(swatch.hex) }}
              className={cn(swatchClassName, selected && chosenClassName)}
            >
              {selected ? <CheckIcon /> : null}
            </button>
          );
        })}

        <span className="relative inline-flex">
          <button
            type="button"
            aria-label={otherName}
            aria-pressed={otherChosen}
            title={otherName}
            onClick={() => openSystemPicker(systemPicker.current)}
            style={otherChosen ? { backgroundColor: chosen, color: environmentTextColor(chosen) } : undefined}
            className={cn(swatchClassName, otherChosen ? chosenClassName : "border border-dashed border-border-strong bg-raised text-muted transition-colors hover:text-ink")}
          >
            <EyedropperIcon />
          </button>
          <input
            ref={systemPicker}
            type="color"
            tabIndex={-1}
            aria-hidden
            value={(color ?? pickerStart).toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
          />
        </span>
      </div>
      <FieldError id={`${idPrefix}-color-error`}>{error}</FieldError>
      {hint === undefined ? null : <p className="mt-2 text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
