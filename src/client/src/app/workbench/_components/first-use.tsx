import { dbeaverCopy } from "@/app/connections/_lib/dbeaver.copy";
import { Button, PlusIcon } from "@/components/ui";
import { dbeaverAvailable } from "@/lib/api/bridge";

import { navigatorCopy } from "../_lib/navigator.copy";

const copy = navigatorCopy.firstUse;

type FirstUseProps = {
  onNewConnection: () => void;
  /** "Importar conexões…" (RN-NAV-007): o "Importar conexões" da seção 34, na raiz. */
  onImportPrism: () => void;
  /** "Importar do DBeaver…" (RN-NAV-007, RN-DBEAVER-003): o diálogo do DBeaver, na raiz. */
  onImportDbeaver: () => void;
};

/**
 * O estado vazio (RN-NAV-007): sem nenhuma conexão cadastrada, a área das abas mostra "Nova conexão", que abre o diálogo de nova conexão na raiz, e os atalhos
 * para trazer as conexões de outro lugar, "Importar conexões…" e "Importar do DBeaver…" (este desabilitado, com o motivo, fora do app). É o que fica quando o
 * "Comece por aqui" não vale (o convite do DBeaver já foi feito, RN-DBEAVER-001). A barra de ações do navegador continua lá, com o mesmo "Nova conexão" e o
 * "Nova pasta". Fica no lugar da faixa de abas: sem conexão, aba nenhuma existe.
 */
export function FirstUse({ onNewConnection, onImportPrism, onImportDbeaver }: FirstUseProps) {
  const dbeaver = dbeaverAvailable();
  return (
    // A raiz do app não rola: numa janela baixa, o estado vazio rola por dentro (o centro "seguro" não esconde o topo do que passa da altura).
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-start justify-center-safe gap-4 overflow-y-auto px-10 py-6">
      <div className="flex max-w-[460px] flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-muted">{copy.hint}</p>
      </div>
      <Button type="button" onClick={onNewConnection}>
        <PlusIcon />
        {copy.action}
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onImportPrism}>
          {dbeaverCopy.empty.importPrism}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onImportDbeaver} disabled={!dbeaver} title={dbeaver ? undefined : dbeaverCopy.outside}>
          {dbeaverCopy.empty.importDbeaver}
        </Button>
      </div>
    </div>
  );
}
