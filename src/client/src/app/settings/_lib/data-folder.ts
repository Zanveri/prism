import { queryOptions } from "@tanstack/react-query";

import { readDataFolder } from "@/lib/api/bridge";

/**
 * A pasta de dados em uso (os cofres e o log da API), que o processo principal diz pela ponte: só para Configurações > Sobre mostrar. Não muda
 * com o app aberto, então é lida uma vez. Sem pasta (fora do Electron, ou a ponte que não respondeu) a resposta é `null`, e a tela passa sem ela:
 * por isso a consulta é calada, sem aviso.
 */
export const dataFolderQuery = queryOptions({
  queryKey: ["data-folder"],
  queryFn: readDataFolder,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  meta: { silent: true },
});
