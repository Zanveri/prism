import { TextField } from "@/components/ui";

import { settingsCopy } from "../_lib/settings.copy";
import { useDraft } from "../_lib/use-draft";
import { parseWholeNumber } from "../_lib/whole-number";

type NumberFieldProps = {
  id: string;
  label: string;
  /** O valor que está valendo (o das preferências). */
  value: number;
  min: number;
  max: number;
  /** Chamado a cada texto válido, já como número: a mudança vale na hora, sem botão de salvar. */
  onCommit: (value: number) => void;
};

/**
 * Um campo de número inteiro, como o canvas o desenha (texto com teclado numérico). O texto digitado é do campo (`useDraft`): um número
 * válido vale na hora; um texto que não serve mostra o erro e não muda nada, e ao sair do campo ele volta ao valor que vale.
 */
export function NumberField({ id, label, value, min, max, onCommit }: NumberFieldProps) {
  const draft = useDraft({ value, format: String, parse: (text) => parseWholeNumber(text, min, max), onCommit });

  return (
    <TextField
      id={id}
      label={label}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft.text}
      error={draft.invalid ? settingsCopy.numberError(min, max) : undefined}
      onChange={(event) => draft.change(event.target.value)}
      onBlur={draft.reset}
      onKeyDown={draft.keyDown}
    />
  );
}
