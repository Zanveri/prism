import { useEffect } from "react";
import { useSearchParams } from "react-router";

/**
 * Os parâmetros de busca da rota sem `name`, depois de a tela tê-lo usado; `null` se não há o que limpar: o parâmetro não está lá, ou a tela
 * ainda não pôde usá-lo (`ready` falso: a lista a que ele aponta ainda não chegou). Todas as ocorrências saem, os outros parâmetros ficam, e
 * o objeto recebido não é alterado (o roteador o guarda). Um valor que a tela decidiu ignorar também é gasto: ela já o leu.
 */
export function spendParam(params: URLSearchParams, name: string, ready = true): URLSearchParams | null {
  if (!ready || !params.has(name)) return null;

  const rest = new URLSearchParams(params);
  rest.delete(name);
  return rest;
}

/**
 * A tela que lê um parâmetro da rota ao chegar (`?connection=` abre a conexão no formulário, `?driver=` destaca e rola até a linha) o gasta:
 * ele sai da URL, com `replace` (a entrada do histórico é trocada, e não acrescentada), e o que a tela já leu fica no estado dela. Sem isso,
 * remontar a tela com a URL suja (o bloqueio por inatividade remonta as telas de dentro do cofre) reabriria o formulário, ou rolaria de novo.
 * `ready` é "a tela já pôde usar o parâmetro": enquanto falso, ele fica na URL.
 */
export function useSpendParam(name: string, ready = true): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const spendable = spendParam(searchParams, name, ready) !== null;

  useEffect(() => {
    if (spendable) setSearchParams((current) => spendParam(current, name) ?? current, { replace: true });
  }, [spendable, name, setSearchParams]);
}
