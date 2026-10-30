import { Button } from "@/components/ui";

import { objectNamesLimit } from "../_lib/database-sessions.service";
import { searchIndexCap } from "../_lib/navigator-index";
import type { SearchTarget } from "../_lib/navigator-search-scope";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.navigator.search;

/** O banco cuja busca falhou: a mensagem do banco, como veio (RN-SQL-009), e o gesto de pedir de novo. */
export type SearchFailure = SearchTarget & { message: string; onRetry: () => void };

type NavigatorSearchStatusProps = {
  /** Quantos bancos ainda esperam o índice de nomes. */
  loading: number;
  /** O corte deixou achados de fora em algum banco (`IndexLevels.cuts`). */
  cut: boolean;
  /** Os bancos cujo índice a API cortou (`ObjectNames.truncated`). */
  truncated: readonly SearchTarget[];
  /** Os bancos cuja busca falhou. */
  failures: readonly SearchFailure[];
  /** Quantas conexões a busca deixou de fora por não estarem conectadas, e, dentre elas, quantas não têm usuário ou senha gravada: o "Buscar nelas também" não as abre. */
  leftOut: number;
  withoutCredentials: number;
  /** O "Buscar nelas também": abre a sessão da árvore de cada conexão de fora, sem abrir o nó. */
  onSearchThem: () => void;
};

/**
 * A linha de estado da busca (RN-BUSCA-002), logo abaixo dos dois filtros do navegador, nunca ao lado do campo. Sem estado: quem a monta diz o que há a dizer. Cada texto
 * fica na própria região `role="status"` (o leitor de tela o lê quando muda), e os botões ficam FORA dela: um botão dentro da região viva seria lido junto a cada mudança.
 * Nada a dizer, nada desenhado. Os casos, nesta ordem: o índice a caminho, o corte de 200 por banco, o índice cortado na API, a falha de um banco (com o "Tentar de novo"
 * dele) e as conexões de fora (com o "Buscar nelas também", que só existe se alguma delas pode ser aberta).
 */
export function NavigatorSearchStatus({ loading, cut, truncated, failures, leftOut, withoutCredentials, onSearchThem }: NavigatorSearchStatusProps) {
  if (loading <= 0 && !cut && truncated.length === 0 && failures.length === 0 && leftOut <= 0) return null;

  return (
    <div className="mx-2 mb-2 flex flex-none flex-col gap-1.5 text-xs leading-[18px] text-muted">
      {loading > 0 ? <p role="status">{copy.loading(loading)}</p> : null}
      {cut ? <p role="status">{copy.cut(searchIndexCap)}</p> : null}
      {truncated.map((target) => (
        <p key={target.key} role="status">
          {copy.truncated(target.name, objectNamesLimit)}
        </p>
      ))}
      {failures.map((failure) => (
        <div key={failure.key} className="flex flex-col items-start gap-1.5">
          <p role="status" className="break-words text-danger">
            {copy.failed(failure.name, failure.message)}
          </p>
          <Button type="button" variant="secondary" size="compact" aria-label={copy.retryIn(failure.name)} onClick={failure.onRetry} className="h-7 px-2.5 text-xs">
            {copy.retry}
          </Button>
        </div>
      ))}
      {leftOut > 0 ? (
        <div className="flex flex-col items-start gap-1.5">
          <p role="status">{[copy.leftOut(leftOut), withoutCredentials > 0 ? copy.leftOutWithoutCredentials(withoutCredentials) : null].filter((sentence) => sentence !== null).join(" ")}</p>
          {leftOut > withoutCredentials ? (
            <Button type="button" variant="secondary" size="compact" onClick={onSearchThem} className="h-7 px-2.5 text-xs">
              {copy.searchThemToo}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
