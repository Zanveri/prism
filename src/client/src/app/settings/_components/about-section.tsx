import { useQuery } from "@tanstack/react-query";

import { updateCopy } from "@/components/update/update.copy";

import { dataFolderQuery } from "../_lib/data-folder";
import { settingsCopy } from "../_lib/settings.copy";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.about;

/**
 * Sobre (RN-CONFIG-001): o nome e a versão do app, que o processo principal põe na janela (RN-VERSAO-004) e a tela de login
 * também mostra. Lida direto da ponte, como a barra superior: sem a ponte, ou sem a versão, a tela não escreve versão nenhuma.
 *
 * E a pasta de dados em uso (os cofres e o log da API), que o processo principal diz por um canal só de leitura (`getDataFolder`): é só
 * para ver e copiar, e a tela não tem como abri-la nem trocá-la. Sem a pasta (fora do Electron, ou a ponte que não respondeu) a linha não aparece.
 */
export function AboutSection({ anchor }: { anchor: string }) {
  const version = typeof window === "undefined" ? "" : (window.prism?.version ?? "");
  const folder = useQuery(dataFolderQuery).data ?? null;

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-semibold">Prism</span>
        {version === "" ? null : (
          <span data-app-version className="font-mono text-xs text-muted">
            {updateCopy.version(version)}
          </span>
        )}
      </p>
      <p className="text-muted">{copy.description}</p>

      {folder === null ? null : (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-muted">{copy.dataFolder}</dt>
            <dd data-data-folder className="font-mono text-xs break-all select-all">
              {folder}
            </dd>
          </dl>
          <p className="text-xs text-muted">{copy.dataFolderHint}</p>
        </>
      )}
    </SettingsCard>
  );
}
