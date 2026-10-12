import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { driversCopy } from "@/app/drivers/_lib/drivers.copy";
import { driverNotInstalledCode } from "@/app/drivers/_lib/drivers.model";
import { Button, FormMessage } from "@/components/ui";

/** Por que "Testar conexão" não conectou: a mensagem (a do banco, ou a frase da API) e o código que a API deu. */
export type TestFailureState = { message: string; code: string; /** O driver que falta, quando a API o diz (seção 16). */ driverID?: string };

/**
 * O resultado de "Testar conexão" que não conectou: a mensagem fica na tela, abaixo dos botões, até a próxima
 * tentativa. Se o motivo é o driver do banco não estar instalado (RN-DRIVER-006), há o caminho até a instalação, e não só o erro: no
 * formulário de conexão (`onInstall`) é o MESMO diálogo de instalação, ali mesmo, como o aviso do driver do banco escolhido (RN-NAV-005), em
 * vez de um link que levaria a pessoa para fora do que ela está preenchendo; sem ele, o link para Configurações › Drivers. O caminho vai
 * **abaixo e à esquerda** da mensagem: o aviso de erro que acompanha o teste fica no canto inferior direito da janela e, numa janela baixa,
 * cobriria um botão posto à direita.
 */
export function TestFailure({ failure, onInstall }: { failure: TestFailureState; onInstall?: () => void }) {
  const missingDriver = failure.code === driverNotInstalledCode;

  return (
    <div className="flex flex-col items-start gap-3">
      <FormMessage tone="error" className="self-stretch">
        {failure.message}
      </FormMessage>
      {!missingDriver ? null : onInstall === undefined ? (
        <InstallDriverLink driverID={failure.driverID} />
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={onInstall}>
          {driversCopy.installDriver}
        </Button>
      )}
    </div>
  );
}
