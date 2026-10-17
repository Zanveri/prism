import { Button, FormMessage } from "@/components/ui";

import { driversCopy } from "../_lib/drivers.copy";

const copy = driversCopy.restart;

/**
 * O lembrete que fica na tela de Drivers enquanto algum driver espera o reinício (item E): a pessoa pode ter fechado o
 * diálogo com "Depois", ou ter voltado à tela depois de sair. O estado vem da lista (`restartRequired`), então sobrevive a
 * recarregar a tela. É faixa, e não diálogo: não bloqueia nada. Com exportações em andamento (em qualquer janela), a frase delas entra no aviso: o reinício
 * as cancela (RN-EXPORT-023).
 */
export function RestartBanner({ onRestart, exportsNote = null }: { onRestart: () => void; exportsNote?: string | null }) {
  return (
    <FormMessage tone="warning" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="mr-auto">{exportsNote === null ? copy.banner : `${copy.banner} ${exportsNote}`}</span>
      <Button type="button" variant="secondary" size="compact" onClick={onRestart}>
        {copy.bannerAction}
      </Button>
    </FormMessage>
  );
}
