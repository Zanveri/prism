import { DriverManager } from "@/app/drivers/_components/driver-manager";
import { driversCopy } from "@/app/drivers/_lib/drivers.copy";

import { settingsCopy } from "../_lib/settings.copy";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.drivers;

/**
 * Drivers (RN-NAV-006): a lista de verdade, com tudo o que a tela de Drivers tinha (instalar, cancelar, remover, o estado, o erro com a causa,
 * o lembrete e o diálogo de reinício). A explicação é a que a tela de Drivers usava. `highlightedId` é o driver que o "Instalar driver" de uma
 * conexão sem driver apontou (`?driver=<id>`), lido pela página ao chegar.
 */
export function DriversSection({ anchor, highlightedId = null }: { anchor: string; highlightedId?: string | null }) {
  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <p className="text-muted">{driversCopy.subtitle}</p>
      <DriverManager highlightedId={highlightedId} />
    </SettingsCard>
  );
}
