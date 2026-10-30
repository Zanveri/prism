import { formatCount } from "@/lib/utils/format";

const commands = (count: number) => formatCount(count, "comando", "comandos");
const notConfirmed = (count: number) => formatCount(count, "comando não foi confirmado", "comandos não foram confirmados");

/** O modo de transação da aba e a transação manual (seção 22 da especificação, RN-TX-001 a 014 e RN-ISOL-001 a 006). */
export const transactionCopy = {
  editor: {
    // RN-TX-001: o seletor da barra do editor, como no canvas ("Transação").
    label: "Transação",
    modeLabel: "Modo de transação",
    isolationLabel: "Isolamento",
    autoCommit: "Auto-commit",
    manual: "Commit manual",
    // RN-ISOL-001: os níveis de isolamento por banco, e "Padrão do banco" em todos.
    levels: {
      default: "Padrão do banco",
      readUncommitted: "Read Uncommitted",
      readCommitted: "Read Committed",
      committedReadLastCommitted: "Committed Read Last Committed",
      cursorStability: "Cursor Stability",
      repeatableRead: "Repeatable Read",
      readStability: "Read Stability",
      serializable: "Serializable",
    },
    // RN-TX-013: o banco sem log de transação não tem Commit manual.
    notAvailable: "Este banco não tem log de transação",
    commit: "Commit",
    rollback: "Rollback",
    // RN-TX-003: sem transação, os dois botões ficam desabilitados; com erro, só o Rollback resta.
    nothingToEnd: "Não há transação aberta",
    failedCommit: "A transação tem um erro: só resta o Rollback",
    busy: "Espere o comando terminar",
  },

  // RN-TX-003 e RN-ISOL-002: a barra de status mostra o modo, o nível de isolamento e, com transação aberta, os comandos sem commit e há quanto tempo abriu.
  status: {
    autoCommit: (level: string = "Padrão do banco") => `Auto-commit · ${level}`,
    idle: (level: string = "Padrão do banco") => `Commit manual · ${level} · sem transação aberta`,
    failed: (level: string = "Padrão do banco", mode: string = "Commit manual") => `${mode} · ${level} · transação com erro: só resta o Rollback`,
    open: (count: number, minutes: number, level: string = "Padrão do banco", mode: string = "Commit manual") =>
      `${mode} · ${level} · ${formatCount(count, "comando sem commit", "comandos sem commit")} · ${minutes < 1 ? "há menos de 1 min" : `há ${minutes} min`}`,
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

  // RN-TX-006: trocar a conexão ou o banco da aba com a transação aberta pergunta antes.
  switching: {
    title: "Há uma transação aberta",
    description: (count: number) => `A aba tem ${commands(count)} sem commit. Confirme ou desfaça a transação antes de trocar a sessão da aba.`,
    failedDescription: "A transação tem um erro e só pode ser desfeita. Desfaça-a antes de trocar a sessão da aba.",
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
