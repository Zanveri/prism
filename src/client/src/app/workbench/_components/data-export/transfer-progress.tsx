import type { ReactNode } from "react";

/**
 * As peças de uma entrada de transferência na barra de status (RN-EXPORT-021 e RN-IMPORT-019), as mesmas para a exportação, a importação e a cópia: os
 * nomes isolados do texto em volta e a barra de progresso pequena.
 */

/**
 * O texto com os nomes (o da origem, o do arquivo, o da tabela) isolados do texto em volta (`<bdi>`): um nome do banco ou de um arquivo pode ter marca de
 * direção. Os nomes são procurados na ordem dada, cada um depois do anterior; o que não está no texto fica de fora.
 */
export function isolatedNames(text: string, names: readonly (string | null)[]): ReactNode {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const name of names) {
    if (name === null || name === "") continue;
    const at = text.indexOf(name, from);
    if (at < 0) continue;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<bdi key={parts.length}>{name}</bdi>);
    from = at + name.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/** A barra de progresso pequena: com a medida, a porcentagem (`aria-valuenow`); sem ela, a barra sem medida. O texto inteiro vai em `aria-valuetext`. */
export function TransferProgress({ label, percent, hint }: { label: string; percent: number | null; hint: string }) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={percent === null ? undefined : 0}
      aria-valuemax={percent === null ? undefined : 100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={hint}
      className="relative h-1.5 w-16 flex-none overflow-hidden rounded-full bg-border-strong"
    >
      {percent === null ? (
        <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      ) : (
        <span style={{ width: `${percent}%` }} className="absolute inset-y-0 left-0 rounded-full bg-accent" />
      )}
    </span>
  );
}

/** O botão pequeno das entradas ("Cancelar", "Salvar como…", "Ver o erro", "Descartar"): desabilitado sem sair do Tab (`aria-disabled`). */
export const smallButton = "h-5 px-1.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
