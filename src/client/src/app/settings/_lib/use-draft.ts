import { useEffect, useState, type KeyboardEvent } from "react";

type DraftOptions<T> = {
  /** O valor que está valendo (o das preferências). */
  value: T;
  format: (value: T) => string;
  /** O valor que o texto representa, ou `null` se o texto não serve. */
  parse: (text: string) => T | null;
  /** Chamado a cada texto válido, já como valor: a mudança vale na hora, sem botão de salvar. */
  onCommit: (value: T) => void;
};

/** Quanto um texto inválido fica parado até o erro aparecer: o "1" de "13" é inválido por um instante, e não pode piscar um erro. */
export const draftErrorDelayMs = 600;

/** O erro aparece quando o texto é inválido E ficou parado pelo atraso (`settledFor` é o texto para o qual o atraso já passou). */
export function draftErrorVisible({ invalid, text, settledFor }: { invalid: boolean; text: string; settledFor: string | null }): boolean {
  return invalid && settledFor === text;
}

/**
 * O primeiro Esc, num campo com texto inválido, só descarta o rascunho: quem o digitou já desistiu dele, e fechar a tela junto
 * levaria mais do que ele quis. Com texto válido (que já vale) o Esc segue para a tela, que fecha.
 */
export function escapeDiscardsDraft({ key, invalid }: { key: string; invalid: boolean }): boolean {
  return key === "Escape" && invalid;
}

/**
 * O texto de um campo de Configurações enquanto a pessoa digita. Um texto válido vale na hora (`onCommit`); um texto que não
 * serve não muda nada, mostra o erro depois de um instante (`draftErrorDelayMs`) e, ao sair do campo (`reset`) ou no primeiro Esc
 * (`keyDown`), volta ao valor que vale. O que se digita é do campo: as preferências só recebem valores já conferidos.
 */
export function useDraft<T>({ value, format, parse, onCommit }: DraftOptions<T>) {
  const [text, setText] = useState(() => format(value));
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const invalid = parse(text) === null;

  useEffect(() => {
    if (!invalid) return;

    const timer = setTimeout(() => setSettledFor(text), draftErrorDelayMs);
    return () => clearTimeout(timer);
  }, [invalid, text]);

  return {
    text,
    /** O erro deve aparecer agora? (Diferente de o texto ser inválido: ele só aparece depois de parado.) */
    invalid: draftErrorVisible({ invalid, text, settledFor }),
    change(next: string) {
      setText(next);

      const parsed = parse(next);
      if (parsed !== null) onCommit(parsed);
    },
    reset() {
      setText(format(value));
    },
    keyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (!escapeDiscardsDraft({ key: event.key, invalid })) return;

      // A tela fecha com o Esc que ninguém tratou (`defaultPrevented`): este foi tratado aqui.
      event.preventDefault();
      setText(format(value));
    },
  };
}
