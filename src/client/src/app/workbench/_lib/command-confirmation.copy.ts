import type { Confirmation } from "@/app/connections/_lib/connections.schema";
import { formatCount } from "@/lib/utils/format";

import type { Irreversible } from "./irreversible";

/** O nome da proteção como a seção Proteções a escreve (RN-PROT-001). */
const levelName: Record<Confirmation, string> = { irreversible: "Só comandos irreversíveis", all: "Todos os comandos" };

/** "de producao.apontamento", ou "da tabela" quando a tela não achou o nome. */
const ofTarget = (target: string | null, fallback: string) => (target === null ? fallback : target);

/** Os textos do aviso de confirmação antes de executar (RN-PROT-001, o `ConfirmarComando` do canvas). */
export const commandConfirmationCopy = {
  environment: (name: string) => `Ambiente: ${name}`,
  place: (connection: string, database: string) => `${connection} / ${database}`,

  titles: {
    irreversible: "Executar comando irreversível?",
    command: "Executar comando?",
    scriptIrreversible: "Executar script com comandos irreversíveis?",
    script: "Executar script?",
    save: "Salvar as alterações?",
    autoRefresh: "Ligar a atualização automática?",
  },

  // O que o comando faz, quando a tela sabe dizer.
  does: (irreversible: Irreversible): string => {
    const target = irreversible.target;
    switch (irreversible.kind) {
      case "delete":
        return `Este DELETE não tem WHERE: ele apaga todas as linhas de ${ofTarget(target, "uma tabela")}.`;
      case "update":
        return `Este UPDATE não tem WHERE: ele altera todas as linhas de ${ofTarget(target, "uma tabela")}.`;
      case "truncate":
        return `Este TRUNCATE apaga todas as linhas de ${ofTarget(target, "uma tabela")}.`;
      case "drop":
        return `Este DROP exclui ${ofTarget(target, "um objeto do banco")}, e o que ele apaga não volta.`;
      case "alterDrop":
        return `Este ALTER tem um DROP: ele apaga uma parte de ${ofTarget(target, "um objeto do banco")} que não volta.`;
    }
  },

  script: {
    // O script de um comando só (o Alt+X com um comando no editor) não tem "todos".
    all: (total: number) =>
      total === 1
        ? "O comando do script pede confirmação. Confirmado, ele roda sem perguntar de novo."
        : `Todos os ${formatCount(total, "comando", "comandos")} do script pedem confirmação. Confirmado, o script roda até o fim sem perguntar de novo.`,
    some: (count: number, total: number) =>
      `${count === 1 ? "Um comando" : `${count.toLocaleString("pt-BR")} comandos`} de ${total.toLocaleString("pt-BR")} ${count === 1 ? "é irreversível" : "são irreversíveis"}. Confirmado, o script roda até o fim sem perguntar de novo.`,
    number: (number: number) => `Comando ${number.toLocaleString("pt-BR")}`,
  },

  filter: (filter: string) => `Com o filtro do resultado: ${filter}`,

  save: {
    description: (count: number) => `${formatCount(count, "alteração vai", "alterações vão")} ao banco, numa transação. Antes de salvar, dá para ver os comandos.`,
    viewSql: "Ver SQL",
  },

  autoRefresh: "Ligada, ela executa este comando de novo a cada intervalo, sem perguntar, até ser desligada.",

  // Por que o aviso aparece.
  why: (connection: string, level: Confirmation, folder: string | null) =>
    folder === null ? `Você vê este aviso porque a conexão ${connection} tem a proteção “${levelName[level]}”.` : `Você vê este aviso porque a conexão ${connection} herda da pasta ${folder} a proteção “${levelName[level]}”.`,

  confirm: { command: "Executar mesmo assim", script: "Executar script", save: "Salvar mesmo assim", autoRefresh: "Ligar mesmo assim" },
  cancel: "Cancelar",
} as const;
