import { Navigate, useSearchParams } from "react-router";

import { driverParam, settingsTo } from "@/app/settings/_lib/settings-route";

/**
 * O endereço dos drivers (`pathsConfig.drivers`). A tela de Drivers deixou de existir: a lista, com tudo o que ela tinha, mora em
 * Configurações › Drivers (RN-NAV-006). O endereço continua valendo, porque é o destino do "Instalar driver" (o 422
 * `DRIVER_NOT_INSTALLED` na árvore, numa aba e ao testar a conexão) e do lembrete de reinício da barra superior: ele leva para lá, com o
 * `?driver=<id>` que aponta a linha do driver que falta, e troca a entrada do histórico (voltar não cai num endereço que só redireciona).
 */
export function DriversRedirect() {
  const [searchParams] = useSearchParams();

  return <Navigate to={settingsTo("drivers", searchParams.get(driverParam))} replace />;
}
