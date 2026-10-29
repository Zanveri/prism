import { formatCount } from "@/lib/utils/format";

const commands = (count: number) => formatCount(count, "comando", "comandos");
const notConfirmed = (count: number) => formatCount(count, "comando não foi confirmado", "comandos não foram confirmados");

/** O modo de transação da aba e a transação manual (seção 22 da especificação, RN-TX-001 a 014). */
export const transactionCopy = {
  editor: {
    // RN-TX-001: o seletor da barra do editor, como no canvas ("Transação").
    label: "Transação",
    modeLabel: "Modo de transação",
    autoCommit: "Auto-commit",
    manual: "Commit manual",
    // RN-TX-013: o banco sem log de transação não tem Commit manual.
    notAvailable: "Este banco não tem log de transação",
    commit: "Commit",
    rollback: "Rollback",
    // RN-TX-003: sem transação, os dois botões ficam desabilitados; com erro, só o Rollback resta.
    nothingToEnd: "Não há transação aberta",
    failedCommit: "A transação tem um erro: só resta o Rollback",
    busy: "Espere o comando terminar",
  },

  // RN-TX-003: a barra de status. "Padrão do banco" é o nível de isolamento enquanto o seletor de nível não existe (RN-ISOL-001).
  status: {
    autoCommit: "Auto-commit · Padrão do banco",
    idle: "Commit manual · Padrão do banco · sem transação aberta",
    failed: "Commit manual · Padrão do banco · transação com erro: só resta o Rollback",
    open: (count: number, minutes: number) => `Commit manual · Padrão do banco · ${formatCount(count, "comando sem commit", "comandos sem commit")} · ${minutes < 1 ? "há menos de 1 min" : `há ${minutes} min`}`,
  },

  // RN-TX-005: sair do Commit manual com a transação aberta pergunta antes.
  question: {
    title: "Há uma transação aberta",
    description: (count: number) => `A aba tem ${commands(count)} sem commit. Confirme ou desfaça a transação antes de passar para Auto-commit.`,
    failedDescription: "A transação tem um erro e só pode ser desfeita. Desfaça-a antes de passar para Auto-commit.",
    commit: "Commit",
    rollback: "Rollback",
    cancel: "Cancelar",
  },

  // RN-TX-006: fechar abas com a transação aberta pergunta antes, e a escolha vale para todas as listadas.
  closing: {
    title: (tabs: number) => (tabs === 1 ? "A aba tem uma transação aberta" : `${formatCount(tabs, "aba tem", "abas têm")} transação aberta`),
    description: (count: number, failed: boolean) =>
      failed ? `Há ${commands(count)} sem commit, e uma das transações tem um erro: elas só podem ser desfeitas.` : `Há ${commands(count)} sem commit. Confirme ou desfaça antes de fechar; fechar sem escolher desfaz.`,
    commit: "Commit e fechar",
    rollback: "Rollback e fechar",
    cancel: "Cancelar",
  },

  toasts: {
    // RN-TX-014.
    committed: (count: number) => `Transação confirmada: ${commands(count)}.`,
    rolledBack: (count: number) => `Transação desfeita: ${commands(count)}.`,
    // RN-TX-008 e 009: a transação acabou sem a pessoa pedir.
    undone: (count: number) => `O banco desfez a transação: ${notConfirmed(count)}.`,
    lost: (count: number) => `A sessão com o banco caiu, e a transação foi desfeita: ${notConfirmed(count)}. Execute de novo, numa transação nova.`,
    // RN-TX-014: o sucesso de um comando no Commit manual diz que ficou sem commit.
    uncommitted: "sem commit",
  },
} as const;
