import { Link, type LinkProps } from "react-router";

import { buttonVariants } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { cn } from "@/lib/utils/cn";

import { driversCopy } from "../_lib/drivers.copy";

/**
 * "Instalar driver" (item G, RN-DRIVER-006): o caminho de uma conexão cujo driver não está instalado até a
 * tela de Drivers. É um link da própria tela (rota em hash), não um endereço de fora. Serve ao nó da árvore,
 * ao resultado do "Testar conexão" e à área de resultado do editor.
 *
 * Com o `driverID` que o 422 traz (seção 16), o link leva à tela já apontando a linha do driver que falta (`?driver=`).
 * O resto das propriedades vai ao `Link`: a árvore põe nele o mesmo teclado do "Tentar de novo" ao lado.
 */
export function InstallDriverLink({ size = "sm", driverID, className, ...props }: { size?: "sm" | "compact"; driverID?: string } & Omit<LinkProps, "to">) {
  const to = driverID === undefined ? pathsConfig.drivers : { pathname: pathsConfig.drivers, search: `?${new URLSearchParams({ driver: driverID })}` };

  return (
    <Link to={to} className={cn(buttonVariants({ variant: "secondary", size }), className)} {...props}>
      {driversCopy.installDriver}
    </Link>
  );
}
