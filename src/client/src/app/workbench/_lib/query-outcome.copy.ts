/**
 * Os avisos do desfecho de um comando que terminou em erro depois de um pedido de cancelamento (RN-SQL-010, Ruling 135). Quem escolhe é a
 * extensão `outcome` do corpo de erro, e nunca o texto. O "Comando cancelado." de `canceled` continua em `workbench.copy.ts`
 * (`toasts.commandCancelled`). Estes são os dos outros dois desfechos: o detalhe da API vai à área de resultado como um erro do banco, e o aviso diz o
 * que a pessoa precisa saber antes de executar de novo, porque o comando pode ter gravado.
 */
export const queryOutcomeCopy = {
  toasts: {
    // `unknown`: a API não sabe se o comando foi concluído (a sessão caiu sem resposta ao cancelamento, ou a interrupção chegou depois de ele rodar).
    unknown: "O desfecho do comando é incerto. Confira no banco antes de executá-lo de novo.",
    // `partial`: o cancelamento chegou enquanto o comando devolvia as linhas, e o que ele gravou até ali está confirmado.
    partial: "O que o comando gravou até o cancelamento ficou. Confira no banco antes de executá-lo de novo.",
  },
} as const;
