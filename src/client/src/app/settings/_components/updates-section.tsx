import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, FormMessage } from "@/components/ui";
import { isMacPlatform } from "@/lib/utils/platform";
import { CheckUpdatesButton } from "@/components/update/check-updates-button";
import { useUpdateSnapshot } from "@/components/update/update-store";
import { updateCopy } from "@/components/update/update.copy";

import { settingsCopy } from "../_lib/settings.copy";
import { formatCheckedAt, refreshUpdatePreferences, saveCheckOnStartup, saveReceiveBeta, updatePreferencesQuery } from "../_lib/update-preferences";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.updates;
const currentPlatform = typeof navigator === "undefined" ? "" : navigator.platform;

/**
 * Atualizações (RN-ATUALIZA-007, RN-ATUALIZA-010 e RN-CONFIG-001): "verificar ao abrir", "Receber versões beta", a versão pulada e
 * a hora da última verificação, como o processo principal os guarda, e o botão que já existe na barra superior. As duas caixas
 * valem na hora (a ponte grava e devolve o que ficou); "Receber versões beta" só muda o que a PRÓXIMA verificação considera, e
 * não consulta nem instala nada. A versão pulada é só informação: a ponte tem como pular, e não como desfazer. No macOS, os betas
 * não têm pacote (o macOS só é empacotado nas estáveis): a caixa continua, com a dica de que ela não muda o que é oferecido ali.
 */
export function UpdatesSection({ anchor, platform = currentPlatform }: { anchor: string; platform?: string }) {
  const queryClient = useQueryClient();
  const preferences = useQuery(updatePreferencesQuery);

  // O processo principal muda estas preferências por conta própria. Um achado novo, o "pular" e o fim do diálogo (onde também se
  // desliga "verificar ao abrir") chegam como mudança do estado ou como "Depois"; o fim de uma consulta manual chega por `onChecked`.
  const snapshot = useUpdateSnapshot();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refreshUpdatePreferences(queryClient);
  }, [queryClient, snapshot.state, snapshot.dismissed]);

  const change = useMutation({
    mutationFn: saveCheckOnStartup,
    onSuccess: (saved) => queryClient.setQueryData(updatePreferencesQuery.queryKey, saved),
  });
  const changeBeta = useMutation({
    mutationFn: saveReceiveBeta,
    onSuccess: (saved) => queryClient.setQueryData(updatePreferencesQuery.queryKey, saved),
  });

  const saved = preferences.data;
  // Enquanto a ponte grava, a caixa já mostra o que a pessoa pediu.
  const checkOnStartup = change.isPending ? change.variables : saved?.checkOnStartup;
  const receiveBeta = changeBeta.isPending ? changeBeta.variables : saved?.receiveBeta === true;
  const lastChecked = formatCheckedAt(saved?.lastCheckedAt ?? null);
  const startupHint = `${anchor}-startup-hint`;
  const betaHint = `${anchor}-beta-hint`;
  const betaMacHint = `${anchor}-beta-mac-hint`;
  const onMac = isMacPlatform(platform);

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      {saved === undefined ? (
        preferences.isError ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage tone="error">{copy.loadFailed}</FormMessage>
            <Button type="button" variant="secondary" size="sm" onClick={() => void preferences.refetch()}>
              {copy.retry}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-muted">
            {copy.loading}
          </p>
        )
      ) : (
        <>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={checkOnStartup ?? saved.checkOnStartup} onChange={(event) => change.mutate(event.target.checked)} aria-describedby={startupHint} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
            <span>{copy.checkOnStartup}</span>
          </label>
          <p id={startupHint} className="text-xs text-muted">
            {copy.checkOnStartupHint}
          </p>

          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={receiveBeta ?? false} onChange={(event) => changeBeta.mutate(event.target.checked)} aria-describedby={onMac ? `${betaHint} ${betaMacHint}` : betaHint} className="m-0 size-[18px] flex-none cursor-pointer accent-accent" />
            <span>{updateCopy.beta.label}</span>
          </label>
          <p id={betaHint} className="text-xs text-muted">
            {updateCopy.beta.hint}
          </p>
          {onMac ? (
            <p id={betaMacHint} className="text-xs text-muted">
              {updateCopy.beta.macHint}
            </p>
          ) : null}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-muted">{copy.lastChecked}</dt>
            <dd>{lastChecked ?? copy.neverChecked}</dd>
            <dt className="text-muted">{copy.skipped}</dt>
            <dd>{saved.skippedVersion === null ? copy.noneSkipped : <span className="font-mono">{saved.skippedVersion}</span>}</dd>
          </dl>
          {saved.skippedVersion === null ? null : <p className="text-xs text-muted">{copy.skippedHint}</p>}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* O mesmo botão da barra superior e da tela de login, com o desenho de um botão: o resultado também é o mesmo. */}
        <CheckUpdatesButton className="h-9 border border-border-strong px-3 text-sm text-ink" onChecked={() => void refreshUpdatePreferences(queryClient)} />
      </div>
      <p className="text-xs text-muted">{updateCopy.dialog.trust}</p>
    </SettingsCard>
  );
}
