import { useInternalTableDescription } from "../../_lib/use-table-structure-enrichment";

type TableDescriptionBannerProps = {
  connectionId: string;
  database?: string;
  table: string;
  visible: boolean;
};

/**
 * Faixa exibida na aba da tabela (vista Registros) com a descrição interna da tabela (`diaabr`),
 * consultada sempre no mesmo servidor e banco onde o usuário está visualizando as informações.
 */
export function TableDescriptionBanner({ connectionId, database, table, visible }: TableDescriptionBannerProps) {
  const { enabled, description } = useInternalTableDescription({
    connectionId,
    database,
    table,
    visible,
  });

  if (!enabled || !description) return null;

  return (
    <div className="flex flex-none items-center border-b border-border bg-panel px-4 py-1.5 text-xs text-body">
      <span>
        <span className="font-medium text-muted">Descrição da tabela: </span>
        <span className="font-medium text-ink">{description}</span>
      </span>
    </div>
  );
}
