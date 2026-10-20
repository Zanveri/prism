import { Button, CodeIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { iconControlSize, type ControlSize } from "../_lib/result-bar";
import { sentSqlCopy as copy } from "../_lib/sent-sql.copy";

/**
 * O botão de ícone "SQL enviado" (RN-VAR-018), na barra da área de resultado e na linha do comando nas Estatísticas: só no resultado de um comando que levou
 * variáveis. Abre o diálogo de leitura com o comando e os valores.
 */
export function SentSqlButton({ onClick, size = "bar", className }: { onClick: () => void; size?: ControlSize; className?: string }) {
  return (
    <Button type="button" variant="secondary" size="compact" aria-label={copy.hint} title={copy.hint} onClick={onClick} className={cn(iconControlSize[size], "flex-none px-0", className)}>
      <CodeIcon />
    </Button>
  );
}
