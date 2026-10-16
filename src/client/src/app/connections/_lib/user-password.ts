import type { ApiResult } from "@/lib/api/prism-api";

import { connectionsCopy } from "./connections.copy";

const copy = connectionsCopy.userPassword;

/**
 * RN-PROT-003: as recusas que o diálogo da senha mostra no próprio campo (a senha errada e a que faltou) e o quinto erro seguido, que fecha o cofre e leva
 * ao login com o aviso de atenção. Voltam como valor (`allowRefusal`), e não vão ao aviso central.
 */
export const userPasswordRefusals = ["INVALID_PASSWORD", "USER_PASSWORD_REQUIRED", "VAULT_LOCKED"] as const;

/**
 * O que a gravação de uma conexão ou de uma pasta que já existe muda no somente leitura PRÓPRIO, numa frase para o diálogo da senha ("Desmarcar “Somente
 * leitura” de MES Produção"), ou nulo quando ele não muda e a senha não é pedida por isso (RN-PROT-003). Criar já marcada não pede: nada do que existe muda.
 */
export function readOnlyChange(name: string, before: boolean, after: boolean): string | null {
  if (before === after) return null;
  return after ? copy.markReadOnly(name) : copy.unmarkReadOnly(name);
}

/**
 * A API pediu a senha sem a tela prever (RN-PROT-003: mover a conexão, ou uma pasta acima dela, para fora de uma pasta somente leitura, que tira o somente
 * leitura herdado): quem gravou abre o diálogo da senha e grava de novo com ela. A frase diz o que muda.
 */
export function passwordAsked<T>(result: ApiResult<T>, name: string): string | null {
  return !result.ok && result.error.code === "USER_PASSWORD_REQUIRED" ? copy.leaveReadOnly(name) : null;
}
