import { Navigate } from "react-router";

import { pathsConfig } from "@/config/paths.config";

/**
 * O endereço da tela de Conexões, que deixou de existir (RN-NAV-001 e 004): as pastas e as conexões são do navegador, e o formulário de
 * conexão é um diálogo sobre a área de trabalho. Quem chega por ele vai à área de trabalho, e a entrada do histórico é trocada (voltar não
 * cai num endereço que só redireciona). Nenhuma rota mostra mais aquela tela.
 */
export function LegacyConnectionsRedirect() {
  return <Navigate to={pathsConfig.workbench} replace />;
}
