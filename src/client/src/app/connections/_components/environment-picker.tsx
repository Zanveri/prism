import { useRef, useState } from "react";

import { CheckIcon, EnvironmentPill, EyedropperIcon, FieldError, TextField, environmentTextColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import type { ShownEnvironment } from "../_lib/environment";
import { environmentKey, findEnvironment, type UserEnvironment } from "../_lib/user-environments";
import { chosenClassName, openSystemPicker, pickerStart, swatchClassName } from "./color-field";

const copy = connectionsCopy.form.environment;

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
  /** Os ambientes do usuário (RN-AMB-001), para reaproveitar: as etiquetas acima do nome e o que o campo completa ao digitar. */
  environments?: readonly UserEnvironment[];
};

/**
 * A seção "Ambiente" (RN-CONN-015, RN-CONN-017 e RN-PASTA-005), a mesma no formulário da conexão e no diálogo da pasta: o nome e a cor que os
 * identificam na árvore, na aba e na barra de status. A cor é uma fileira de bolinhas, cada uma um botão: as seis do canvas (clicar na escolhida a
 * tira) e, por último, "Outra cor", com o conta-gotas, a ÚNICA que abre o seletor do sistema. O `<input type="color">` fica ao lado dela, fora de
 * qualquer `<label>` (era o rótulo em volta dele que abria o seletor num clique em qualquer ponto da linha), fora do Tab e da leitura, e invisível;
 * o seletor abre por ele, junto da bolinha. Escolhida por ela, a bolinha fica com a cor, a marca de escolhida e o conta-gotas em contraste, e o
 * `#RRGGBB` vai na dica e no nome acessível. A cor vai ao `FormData` por um campo escondido.
 *
 * Na conexão, com o nome em branco, a seção diz o que ela herda e de qual pasta: o nome digitado é acompanhado (o campo continua do `FormData`).
 *
 * Os ambientes do usuário (RN-AMB-001) ficam acima do nome, como etiquetas coloridas, cada uma um botão (`aria-pressed` na do nome que está no
 * campo): escolher uma preenche o nome e a cor, que continuam editáveis. O campo completa com eles ao digitar (a `<datalist>` do próprio campo, com o
 * teclado e o leitor de tela do Chromium). O nome digitado que vira o de um ambiente, com qualquer caixa, traz a cor dele uma vez, ao virar; depois
 * a cor é de quem edita. Abrir o formulário não muda nada sozinho.
 */
export function EnvironmentPicker({ idPrefix, defaultName, color, onColorChange, errors, hint, inherited = null, environments = [] }: EnvironmentPickerProps) {
  const systemPicker = useRef<HTMLInputElement>(null);
  const [typedName, setTypedName] = useState(defaultName);
  const typedKey = environmentKey(typedName);
  const optionsId = `${idPrefix}-environment-options`;

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

      {environments.length === 0 ? null : (
        <div role="group" aria-labelledby={`${idPrefix}-environment-saved`} className="flex flex-col gap-2">
          <span id={`${idPrefix}-environment-saved`} className="text-sm text-muted">
            {copy.saved}
          </span>
          <div className="flex flex-wrap gap-2">
            {environments.map((environment) => {
              const selected = environment.key === typedKey;

              return (
                <button
                  key={environment.key}
                  type="button"
                  data-environment={environment.key}
                  aria-pressed={selected}
                  title={copy.useSaved(environment.name)}
                  onClick={() => {
                    setTypedName(environment.name);
                    onColorChange(environment.color);
                  }}
                  className={cn("inline-flex cursor-pointer rounded-full", selected && chosenClassName)}
                >
                  <EnvironmentPill name={environment.name} color={environment.color} className="h-[22px] px-[9px] text-xs leading-[22px]" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <TextField
        id={`${idPrefix}-environment-name`}
        name="environmentName"
        label={copy.name}
        value={typedName}
        onChange={(event) => {
          const typed = event.target.value;
          setTypedName(typed);
          // O nome que acaba de virar o de um ambiente traz a cor dele; quem segue digitando no mesmo nome (um espaço, outra caixa) não a perde.
          const found = findEnvironment(environments, typed);
          if (found !== undefined && found.key !== typedKey) onColorChange(found.color);
        }}
        list={environments.length === 0 ? undefined : optionsId}
        autoComplete="off"
        error={errors.environmentName}
      />
      {environments.length === 0 ? null : (
        <datalist id={optionsId}>
          {environments.map((environment) => (
            <option key={environment.key} value={environment.name} />
          ))}
        </datalist>
      )}

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
