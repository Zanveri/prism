import { z } from "zod";

/** A mensagem de cada campo recusado, pelo `name` do campo. */
export type FieldErrors = Record<string, string | undefined>;

export type ParsedForm<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** A primeira mensagem de cada campo recusado, que é a que o formulário mostra. */
export function firstFieldErrors(error: z.ZodError<Record<string, unknown>>): FieldErrors {
  return Object.fromEntries(Object.entries(z.flattenError(error).fieldErrors).map(([field, messages]) => [field, messages?.[0]]));
}

/** O mesmo para o `errors` de uma recusa 422 da API (chaves já na caixa que o formulário usa). */
export function apiFieldErrors(errors: Record<string, string[]> | null): FieldErrors {
  return Object.fromEntries(Object.entries(errors ?? {}).map(([field, messages]) => [field, messages[0]]));
}

/**
 * Se algum erro que a API devolveu é de um campo que este formulário não tem (ou não mostra neste
 * modo): a mensagem não aparece em lugar nenhum, e quem chama avisa com o `title` do erro.
 * `fields` são os nomes dos campos do formulário, que saem do schema (`Object.keys(schema.shape)`).
 */
export function hasUnshownFieldErrors(errors: FieldErrors, fields: readonly string[]): boolean {
  return Object.keys(errors).some((field) => !fields.includes(field));
}

/** Põe o foco no primeiro campo com erro, na ordem em que os erros vieram. */
export function focusFirstField(form: HTMLFormElement, errors: FieldErrors): void {
  const [first] = Object.keys(errors);
  const field = first === undefined ? null : form.elements.namedItem(first);
  if (field instanceof HTMLElement) field.focus();
}

/**
 * A submissão de um formulário, igual em todos: lê os campos do `FormData`, passa pelo schema e,
 * se algum campo for recusado, leva o foco ao primeiro. Quem chama guarda `errors` em estado e
 * só envia à API quando `ok`.
 */
export function parseForm<T extends Record<string, unknown>>(form: HTMLFormElement, schema: z.ZodType<T>): ParsedForm<T> {
  const parsed = schema.safeParse(Object.fromEntries(new FormData(form)));
  if (parsed.success) return { ok: true, data: parsed.data };

  const errors = firstFieldErrors(parsed.error);
  focusFirstField(form, errors);
  return { ok: false, errors };
}

/**
 * A fiação de acessibilidade de um campo com erro: marcado como inválido e ligado à mensagem,
 * que tem o `id` `<id>-error` (`FieldError`). Sem erro, nenhum atributo.
 */
export function fieldAria(id: string, error: string | undefined) {
  return { "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined };
}

/**
 * O Enter num `<input>` de um formulário: o navegador o transforma em envio do formulário (a submissão implícita), inclusive numa caixa de marcar, num rádio
 * e numa busca, e também quando o botão de enviar está fora dele, ligado pelo atributo `form`. Devolve o `id` do campo, para quem chama decidir se ali o
 * Enter envia; `null` para outra tecla, e para o Enter num botão ou numa lista, que fazem o que é deles (o clique, a escolha).
 */
export function enterInputID(event: { key: string; target: unknown }): string | null {
  if (event.key !== "Enter") return null;
  const target = event.target as { tagName?: unknown; id?: unknown } | null;
  return target !== null && typeof target === "object" && target.tagName === "INPUT" ? String(target.id ?? "") : null;
}
