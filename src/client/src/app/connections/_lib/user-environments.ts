import type { Connection, Folder } from "./connections.schema";

/** Um ambiente do usuário (RN-AMB-001): o nome e a cor que a etiqueta mostra, e a chave que diz quando dois nomes são o mesmo ambiente. */
export type UserEnvironment = { key: string; name: string; color: string | null };

type EnvironmentSource = Pick<Folder, "environmentName" | "environmentColor" | "updatedAt">;

/** Dois nomes são o mesmo ambiente sem diferenciar maiúsculas e sem os espaços das pontas; o acento conta ("Producao" não é "Produção"). */
export function environmentKey(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR");
}

/** O ambiente com este nome, com qualquer caixa; o nome em branco não é ambiente nenhum. */
export function findEnvironment(environments: readonly UserEnvironment[], name: string): UserEnvironment | undefined {
  const key = environmentKey(name);
  return key === "" ? undefined : environments.find((environment) => environment.key === key);
}

/** A data de alteração, para comparar; a que não se lê perde para qualquer outra. */
function changedAt(source: EnvironmentSource): number {
  const time = Date.parse(source.updatedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Os ambientes do usuário (RN-AMB-001): os que as pastas e as conexões dele já usam, um por nome (sem diferenciar maiúsculas), com o nome e a cor da
 * pasta ou conexão alterada por último (o `updatedAt` que a API devolve nas duas). No empate fica a primeira encontrada: as pastas antes das conexões,
 * na ordem da lista. Só o nome faz um ambiente (RN-PASTA-005): a cor sem nome não conta. Nada é gravado à parte: o ambiente que ninguém mais usa some.
 * Em ordem alfabética, para a seção Ambiente e o seletor do navegador mostrarem sempre na mesma ordem.
 */
export function userEnvironments(folders: readonly Folder[], connections: readonly Connection[]): UserEnvironment[] {
  const latest = new Map<string, { environment: UserEnvironment; at: number }>();

  for (const source of [...folders, ...connections] as EnvironmentSource[]) {
    const name = source.environmentName?.trim() ?? "";
    if (name === "") continue;

    const key = environmentKey(name);
    const at = changedAt(source);
    const held = latest.get(key);
    if (held === undefined || at > held.at) latest.set(key, { environment: { key, name, color: source.environmentColor }, at });
  }

  return [...latest.values()].map((entry) => entry.environment).sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}
