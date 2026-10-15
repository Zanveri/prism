import type { QueryRunner, RunnerState } from "./use-query-runner";

/** O que a passagem lê do executor da aba: o estado, a atualização automática e a espera da execução automática em andamento. */
export type HandOffRunner = Pick<QueryRunner, "getState" | "autoRunSettled"> & { autoRefresh: Pick<QueryRunner["autoRefresh"], "pause"> };

/**
 * As peças da passagem, que a faixa de abas entrega: `alive` diz se a aba e o executor ainda são os de quando a pessoa pediu; `prepare` monta o que vai (nulo
 * com um comando em andamento: a resposta chegaria aqui, à aba que já saiu); `send` a manda e, se ela foi, a solta daqui.
 */
export type HandOffDeps<T> = {
  alive: () => boolean;
  prepare: (state: RunnerState) => T | null;
  send: (transfer: T) => Promise<boolean>;
};

/** Como a passagem terminou: a aba foi; ficou, porque algo roda nela; ficou, porque a outra janela não a levou; ou ela já não existe. */
export type HandOffOutcome = "sent" | "busy" | "refused" | "gone";

/**
 * Leva a aba para outra janela (RN-ABAS-002 e 003), com a atualização automática do resultado (RN-GRADE-014) suspensa desde o começo: nenhuma execução
 * automática sai enquanto a aba é lida, mandada e solta, e a que estava em andamento termina antes de a aba ser lida. Sem isso, uma execução que saísse
 * durante a ida mandaria um comando na sessão que acabou de ir para a outra janela, e trocaria o cursor que ela recebeu. A aba que foi é solta (`send`), e a
 * solta desliga a atualização automática de vez; a que ficou continua com ela.
 */
export async function handOffTab<T>(runner: HandOffRunner, { alive, prepare, send }: HandOffDeps<T>): Promise<HandOffOutcome> {
  runner.autoRefresh.pause("moving", true);
  try {
    await runner.autoRunSettled();
    if (!alive()) return "gone";

    const transfer = prepare(runner.getState());
    if (transfer === null) return "busy";
    return (await send(transfer)) ? "sent" : "refused";
  } finally {
    runner.autoRefresh.pause("moving", false);
  }
}
