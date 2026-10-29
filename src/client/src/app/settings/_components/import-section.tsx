import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { lastImportSentence } from "@/app/connections/_lib/dbeaver-model";
import { dbeaverCopy } from "@/app/connections/_lib/dbeaver.copy";
import { dbeaverStateQuery } from "@/app/connections/_lib/dbeaver.service";
import { transferRequests, type TransferRequest } from "@/app/workbench/_lib/transfer-requests";
import { Button } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { dbeaverAvailable } from "@/lib/api/bridge";

import { SettingsCard } from "./settings-card";

const copy = dbeaverCopy.settings;

/**
 * Importar (RN-CONFIG-011), depois de Conta: "Importar do DBeaver…" leva à área de trabalho e abre o "Importar do DBeaver" ali, quantas vezes a pessoa quiser;
 * embaixo, a data da última importação do DBeaver deste usuário (a do cofre, que segue o usuário, e não a das preferências), ou a frase de quem nunca importou.
 * "Importar conexões do Prism…" abre o "Importar conexões" na raiz. Fora do app, o do DBeaver fica desabilitado, com o motivo.
 */
export function ImportSection({ anchor }: { anchor: string }) {
  const navigate = useNavigate();
  const state = useQuery(dbeaverStateQuery);
  const available = dbeaverAvailable();

  /** O diálogo é da área de trabalho (RN-DBEAVER-014): o pedido viaja por `transferRequests`, e a página o atende quando está na tela. */
  function open(request: TransferRequest) {
    transferRequests.request(request);
    void navigate(pathsConfig.workbench);
  }

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <p className="text-muted">{copy.description}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => open({ type: "dbeaver", targetFolderID: null, start: { type: "find" } })} disabled={!available} aria-describedby={available ? undefined : `${anchor}-outside`}>
          {copy.dbeaver}
        </Button>
        <Button type="button" variant="secondary" onClick={() => open({ type: "import", targetFolderID: null })}>
          {copy.prism}
        </Button>
      </div>
      {available ? null : (
        <p id={`${anchor}-outside`} className="text-sm text-muted">
          {dbeaverCopy.outside}
        </p>
      )}
      {/* A data só vale com a resposta do cofre; antes dela (ou sem ela), a frase de quem nunca importou seria uma afirmação sem base. */}
      {state.data === undefined ? null : <p className="text-sm text-body">{lastImportSentence(state.data.lastImportAt)}</p>}
    </SettingsCard>
  );
}
