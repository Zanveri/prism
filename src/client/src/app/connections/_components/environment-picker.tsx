import { useRef, useState } from "react";

import { CheckIcon, EyedropperIcon, FieldError, TextField, environmentTextColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import type { ShownEnvironment } from "../_lib/environment";

const copy = connectionsCopy.form.environment;

const swatchClassName = "inline-flex size-8 cursor-pointer items-center justify-center rounded-full";
const chosenClassName = "ring-2 ring-ink ring-offset-2 ring-offset-panel";

/** A cor que o seletor do sistema mostra ao abrir quando não há nenhuma: o Cinza do canvas. */
const pickerStart = "#AEB7C4";

export type EnvironmentPickerProps = {
  /** O começo dos ids ("cx" na conexão, "folder" na pasta): cada formulário tem os seus. */
  idPrefix: string;
  /** O nome do ambiente ao abrir o formulário; o campo é do `FormData`, como os outros. */
  defaultName: string;
  /** A cor escolhida (`#RRGGBB`), ou `null` para nenhuma. É estado do formulário porque as bolinhas são botões. */
  color: string | null;
  onColorChange: (color: string | null) => void;
  errors: FieldErrors;
  /** O que a seção explica embaixo: na conexão e na pasta o ambiente serve a coisas diferentes. */
  hint: string;
  /** Só na conexão: o que ela herda da pasta em que está, se ficar sem ambiente próprio (RN-PASTA-005). */
  inherited?: ShownEnvironment | null;
};

/** O seletor de cor do sistema: o `showPicker`, onde houver; senão o clique, que é como ele abria antes. */
function openSystemPicker(input: HTMLInputElement | null) {
  if (input === null) return;
  if (typeof input.showPicker === "function") input.showPicker();
  else input.click();
}

/**
 * A seção "Ambiente" (RN-CONN-015, RN-CONN-017 e RN-PASTA-005), a mesma no formulário da conexão e no diálogo da pasta: o nome e a cor que os
 * identificam na árvore, na aba e na barra de status. A cor é uma fileira de bolinhas, cada uma um botão: as seis do canvas (clicar na escolhida a
 * tira) e, por último, "Outra cor", com o conta-gotas, a ÚNICA que abre o seletor do sistema. O `<input type="color">` fica ao lado dela, fora de
 * qualquer `<label>` (era o rótulo em volta dele que abria o seletor num clique em qualquer ponto da linha), fora do Tab e da leitura, e invisível;
 * o seletor abre por ele, junto da bolinha. Escolhida por ela, a bolinha fica com a cor, a marca de escolhida e o conta-gotas em contraste, e o
 * `#RRGGBB` vai na dica e no nome acessível. A cor vai ao `FormData` por um campo escondido.
 *
 * Na conexão, com o nome em branco, a seção diz o que ela herda e de qual pasta: o nome digitado é acompanhado (o campo continua do `FormData`).
 */
export function EnvironmentPicker({ idPrefix, defaultName, color, onColorChange, errors, hint, inherited = null }: EnvironmentPickerProps) {
  const systemPicker = useRef<HTMLInputElement>(null);
  const [typedName, setTypedName] = useState(defaultName);

  const chosen = color === null ? null : color.toUpperCase();
  const otherChosen = chosen !== null && !connectionsCopy.colors.some((swatch) => swatch.hex === chosen);
  const otherName = otherChosen ? copy.otherColorChosen(chosen) : copy.otherColor;
  const inheritedFolder = typedName.trim() === "" ? inherited?.folder : undefined;

  return (
    <section aria-labelledby={`${idPrefix}-environment-title`} className="flex flex-col gap-3.5 rounded-lg border border-border bg-panel p-4">
      {/* h3: o título do diálogo é o h2 (RN-NAV-004). */}
      <h3 id={`${idPrefix}-environment-title`} className="text-base leading-5 font-semibold">
        {copy.title}
      </h3>

      <TextField id={`${idPrefix}-environment-name`} name="environmentName" label={copy.name} defaultValue={defaultName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" error={errors.environmentName} />

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 p-0 text-sm text-muted">{copy.color}</legend>
        <input type="hidden" name="environmentColor" value={color ?? ""} />

        <div className="flex flex-wrap gap-3">
          {connectionsCopy.colors.map((swatch) => {
            const selected = swatch.hex === chosen;

            return (
              <button
                key={swatch.hex}
                type="button"
                aria-label={swatch.name}
                aria-pressed={selected}
                title={swatch.name}
                onClick={() => onColorChange(selected ? null : swatch.hex)}
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
              onChange={(event) => onColorChange(event.target.value.toUpperCase())}
              className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
            />
          </span>
        </div>
        <FieldError id={`${idPrefix}-environment-color-error`}>{errors.environmentColor}</FieldError>
      </fieldset>

      {inherited !== null && inheritedFolder ? <p className="text-xs text-body">{copy.inherits(inherited.name, inheritedFolder.name)}</p> : null}
      <p className="text-xs text-muted">{hint}</p>
    </section>
  );
}
