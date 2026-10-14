import { EnvironmentPill } from "@/components/ui";

import { connectionsCopy } from "../_lib/connections.copy";
import type { ShownEnvironment } from "../_lib/environment";

/**
 * A etiqueta do ambiente que uma conexão ou uma pasta mostra (RN-CONN-015 e RN-PASTA-005), o resultado do `environmentLookup`: a do ambiente
 * próprio, ou a do herdado da pasta, igual a ela e com a dica de qual pasta. Sem ambiente, nada.
 */
export function ShownEnvironmentPill({ environment, className }: { environment: ShownEnvironment | null | undefined; className?: string }) {
  if (!environment) return null;

  return <EnvironmentPill name={environment.name} color={environment.color} title={environment.folder ? connectionsCopy.form.environment.inheritedFrom(environment.folder.name) : undefined} className={className} />;
}
