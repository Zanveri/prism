/** O que um formulário tem, campo a campo, como o `FormData` o entrega (só texto). */
export type FormSnapshot = Readonly<Record<string, string>>;

/** A foto dos campos: cada um pelo nome, só os de texto (um arquivo não é o que se digitou). */
export function snapshotOf(entries: Iterable<[string, FormDataEntryValue]>): FormSnapshot {
  const snapshot: Record<string, string> = {};
  for (const [name, value] of entries) if (typeof value === "string") snapshot[name] = value;
  return snapshot;
}

/**
 * Há o que perder ao fechar o diálogo de conexão (RN-NAV-004: cancelar e Esc perguntam antes, com algo digitado): algum campo está diferente
 * de como as configurações abriram. É a foto de agora contra a da abertura, e não um "alguém digitou": apagar o que se digitou volta a não
 * haver o que perder. Sem a foto da abertura (as configurações ainda não apareceram), não há.
 */
export function hasChanges(initial: FormSnapshot | null, current: FormSnapshot): boolean {
  if (initial === null) return false;

  const names = new Set([...Object.keys(initial), ...Object.keys(current)]);
  return [...names].some((name) => initial[name] !== current[name]);
}
