import { phrase } from "./variables.copy";

/**
 * A fronteira dos defeitos (RN-VAR-014 e 036): qualquer exceção do JavaScript que escape do leitor, do conferidor ou do avaliador é um defeito, e vira "Erro interno do
 * Prism ao avaliar <nome>." na tela. Ao console de desenvolvimento vai só o nome do tipo do erro: nem a mensagem nem o valor, que podem trazer o texto de uma variável
 * (RN-LOG-001 e RN-VAR-036). É o único lugar da linguagem que escreve no console.
 */
export function reportInternalError(name: string, error: unknown): string {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`${phrase.internal(name)} (${kind})`);
  return phrase.internal(name);
}
