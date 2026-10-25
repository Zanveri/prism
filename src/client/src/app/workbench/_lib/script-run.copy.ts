import { formatCount, formatElapsed } from "@/lib/utils/format";

/** " na aba consulta-1.sql", ou nada quando não se sabe o nome da aba. */
const inTab = (tab: string | null) => (tab === null ? "" : ` na aba ${tab}`);

/** Os textos do "Executar script" (seção 31, RN-SQL-019 a 022): o botão, as abas do resultado, as Estatísticas, a pergunta de erro e os avisos do fim. */
export const scriptRunCopy = {
  editor: {
    run: "Executar script",
    // O atalho escrito no botão e na dica (RN-SQL-019): Alt+X, como no DBeaver; no macOS, Cmd+Option+X, porque o Option+X escreve um caractere.
    shortcut: "Alt+X",
    shortcutMac: "Cmd+Option+X",
    title: (shortcut: string) => `Executa os comandos da seleção ou, sem seleção, do texto inteiro, um depois do outro (${shortcut})`,
  },

  tabs: {
    label: "Resultados do script",
    // "3 · SELECT * FROM pedido…": o número do comando no script e o começo do texto. O texto inteiro vai na dica.
    result: (number: number, head: string) => `${number} · ${head}`,
    statistics: "Estatísticas",
    // RN-VAR-024: o painel das variáveis, antes das Estatísticas.
    variables: "Variáveis",
  },

  // A barra da área de resultado, em qualquer aba e com ela recolhida.
  progress: (current: number, total: number) => `Executando ${current.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}…`,
  paused: (current: number, total: number) => `Parado no comando ${current.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`,

  statistics: {
    label: "Estatísticas do script",
    caption: "Os comandos do script, na ordem",
    number: "Nº",
    command: "Comando",
    status: "Situação",
    rows: "Linhas",
    time: "Tempo",
    statuses: { pending: "na fila", running: "executando…", ok: "ok", error: "erro", skipped: "pulado", cancelled: "cancelado", notRun: "não executado" },
    // As linhas de cada comando: as lidas do resultado (com mais a ler, as primeiras), as devolvidas pelo comando que grava (RN-SQL-013) ou as afetadas.
    read: (count: number, more: boolean) => (more ? `primeiras ${formatCount(count, "linha", "linhas")}` : formatCount(count, "linha", "linhas")),
    returned: (total: number) => formatCount(total, "linha devolvida", "linhas devolvidas"),
    affected: (count: number) => (count < 0 ? "—" : formatCount(count, "linha afetada", "linhas afetadas")),
    notKept: "resultado não guardado",
    elapsed: (elapsedMs: number) => formatElapsed(elapsedMs),
    sqlState: "SQLSTATE",
    executed: (ok: number, total: number) => `Comandos executados: ${ok.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`,
    // RN-VAR-022: as declarações e as reatribuições têm o total delas, que só aparece no script que as tem.
    declarationsEvaluated: (ok: number, total: number) => `Declarações avaliadas: ${ok.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`,
    declaration: "declaração",
    withErrors: (count: number) => `Com erro: ${count.toLocaleString("pt-BR")}`,
    // RN-SQL-013: o comando que gravou e devolveu linhas não soma (a API diz quantas ele devolveu, e não quantas alterou), e o total diz quantos ficaram de fora.
    changed: (count: number, returning = 0) =>
      `Linhas alteradas: ${count.toLocaleString("pt-BR")}${returning === 0 ? "" : ` (sem contar ${returning === 1 ? "1 comando que gravou e devolveu linhas" : `${returning.toLocaleString("pt-BR")} comandos que gravaram e devolveram linhas`})`}`,
    totalTime: (elapsedMs: number) => `Tempo total: ${formatElapsed(elapsedMs)}`,
    // RN-SQL-020: o script guarda as abas dos 20 primeiros comandos que devolvem linhas, e a do último.
    dropped: (count: number, cap: number) =>
      `${count === 1 ? "O resultado de 1 comando não foi guardado" : `Os resultados de ${count.toLocaleString("pt-BR")} comandos não foram guardados`}: o script guarda as abas dos ${cap} primeiros comandos que devolvem linhas, e a do último.`,
    // RN-SQL-020: enquanto o script roda, a tabela mostra os comandos em volta do que está em execução; no fim, todos.
    before: (count: number) => `${formatCount(count, "comando", "comandos")} antes destes, que aparecem quando o script terminar.`,
    after: (count: number) => `Mais ${formatCount(count, "comando", "comandos")} na fila.`,
  },

  // A aba de um resultado guardado (RN-SQL-020 e 023): as linhas lidas, que se editam como as do último comando, e por que o que é do cursor não vale ali.
  kept: {
    note: "O cursor deste resultado fechou quando o comando seguinte rodou. Carregar mais, Contar total, o filtro e a atualização automática valem no resultado do último comando.",
    runAlone: "Executar este comando",
    // Com um comando em andamento na aba, o botão fica à vista e não executa: diz por quê.
    runAloneBusy: "Executar este comando. Indisponível: há um comando em andamento na aba.",
  },

  // RN-SQL-021: a pergunta de erro, como a do DBeaver.
  error: {
    title: (number: number, total: number) => `O comando ${number.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} falhou`,
    description: "O script parou neste comando. Escolha como seguir.",
    command: "Comando",
    stop: "Parar",
    retry: "Tentar de novo",
    skip: "Pular",
    skipAll: "Pular todos os erros",
    // RN-SQL-021: a sessão que caiu no meio do script não é reaberta; o que os comandos de antes deixaram nela (uma tabela temporária, um SET) se perdeu.
    sessionLost: "A sessão com o banco caiu no meio do script, e o Prism não a reabre: o que os comandos anteriores deixaram nela se perdeu. Execute o script de novo.",
    // RN-SQL-021: a pergunta aparece só na aba à vista; a aba da faixa cujo script espera por ela leva esta marca (o ponto e, para o leitor de tela, o texto).
    waiting: "O script parou num erro e espera a resposta",
  },

  // Um aviso no fim, e não um por comando (RN-SQL-020), com o nome da aba: o script de uma aba que não está à vista também termina.
  toasts: {
    done: (tab: string | null, total: number, declarations = 0) =>
      `Script executado${inTab(tab)}: ${[...(total === 0 && declarations > 0 ? [] : [formatCount(total, "comando", "comandos")]), ...(declarations === 0 ? [] : [formatCount(declarations, "declaração avaliada", "declarações avaliadas")])].join(" e ")}.`,
    doneWithErrors: (tab: string | null, errors: number, ok: number, total: number) =>
      `Script executado${inTab(tab)} com ${formatCount(errors, "erro", "erros")}: ${ok.toLocaleString("pt-BR")} de ${formatCount(total, "comando executado", "comandos executados")}.`,
    stopped: (tab: string | null, ok: number, total: number) => `Script parado${inTab(tab)}: ${ok.toLocaleString("pt-BR")} de ${formatCount(total, "comando executado", "comandos executados")}.`,
    cancelled: (tab: string | null, ok: number, total: number) => `Script cancelado${inTab(tab)}: ${ok.toLocaleString("pt-BR")} de ${formatCount(total, "comando executado", "comandos executados")}.`,
  },
} as const;
