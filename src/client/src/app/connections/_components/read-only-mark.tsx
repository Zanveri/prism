import { LockIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/**
 * O cadeado da conexão somente leitura (RN-PROT-002), o do canvas, ao lado do nome dela: na árvore, no botão da conexão da aba e na lista dele, e na barra de
 * status. A dica diz de onde vem ("Somente leitura, herdado da pasta Fábrica"), e é também o nome que o leitor de tela lê. Sem dica, nada.
 */
export function ReadOnlyMark({ hint, className }: { hint: string | null | undefined; className?: string }) {
  if (!hint) return null;

  return (
    <span role="img" aria-label={hint} title={hint} className={cn("inline-flex flex-none text-muted", className)}>
      <LockIcon className="size-3.5" />
    </span>
  );
}
