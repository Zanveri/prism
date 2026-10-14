import { Button, PlusIcon } from "@/components/ui";

import { navigatorCopy } from "../_lib/navigator.copy";

const copy = navigatorCopy.firstUse;

/**
 * O primeiro uso (RN-NAV-007): sem nenhuma conexão cadastrada, a área das abas mostra o estado vazio com "Nova conexão", que abre o
 * diálogo de nova conexão na raiz. A barra de ações do navegador continua lá, com o mesmo "Nova conexão" e o "Nova pasta". Fica no lugar da
 * faixa de abas: sem conexão, aba nenhuma existe.
 */
export function FirstUse({ onNewConnection }: { onNewConnection: () => void }) {
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
    </div>
  );
}
