import { Button, Dialog, RefreshIcon } from "@/components/ui";

import { driversCopy } from "../_lib/drivers.copy";

const copy = driversCopy.restart;

/**
 * O fim de uma instalação ou de uma remoção (item E, RN-DRIVER-005): o driver só vale quando a API reinicia, e
 * reiniciar pede a senha de novo. O diálogo não se fecha por fora (`dismissible={false}`: sem X, Esc nem clique fora):
 * a pessoa escolhe "Reiniciar agora" ou "Depois". Com "Depois" o reinício continua pendente e a tela o lembra
 * (o aviso da página e o ponto na barra superior) sem bloquear o resto do app.
 *
 * O diálogo abre sozinho, quando a instalação termina, e o reinício fecha o cofre e as abas de SQL: o foco inicial vai para
 * "Depois", a saída que não perde nada. Com o foco em "Reiniciar agora", um Enter ou Espaço que a pessoa já ia dar a outra
 * coisa reiniciaria o serviço sem ela ter escolhido.
 *
 * RN-EXPORT-023: com exportações em andamento (em qualquer janela), a frase delas entra no aviso: o reinício as cancela.
 */
export function RestartDialog({ kind, onRestart, onLater, exportsNote = null }: { kind: "installed" | "removed"; onRestart: () => void; onLater: () => void; exportsNote?: string | null }) {
  const description = kind === "installed" ? copy.description : copy.removedDescription;
  return (
    <Dialog
      open
      size="sm"
      dismissible={false}
      icon={<RefreshIcon />}
      title={copy.title}
      description={exportsNote === null ? description : `${description} ${exportsNote}`}
      onClose={onLater}
      footer={
        <>
          <Button type="button" variant="secondary" autoFocus onClick={onLater}>
            {copy.later}
          </Button>
          <Button type="button" onClick={onRestart}>
            {copy.submit}
          </Button>
        </>
      }
    />
  );
}
