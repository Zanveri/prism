import { isTableTab, type QueryTab } from "./workbench-model";

/**
 * O nome de cada aba na barra (RN-ABAS-008): a aba de tabela mostra só o nome da tabela enquanto as tabelas abertas na janela são todas
 * de um esquema só; com tabelas de mais de um esquema (contando a conexão e o banco), todas mostram `esquema.tabela`; e com tabelas de
 * mais de um banco, a de um banco que não é o da conexão mostra também o banco. A aba de consulta mostra o título dela. O nome inteiro
 * continua no `title` da aba (a dica, o leitor de tela, a lista de abas e o menu de janelas).
 */
export function stripTitles(tabs: readonly QueryTab[]): Map<string, string> {
  const tables = tabs.filter(isTableTab);
  const schemas = new Set(tables.map((tab) => JSON.stringify([tab.connectionId, tab.database ?? null, tab.table.schema])));
  const databases = new Set(tables.map((tab) => JSON.stringify([tab.connectionId, tab.database ?? null])));

  return new Map(
    tabs.map((tab) => {
      if (!isTableTab(tab)) return [tab.id, tab.title];
      if (schemas.size <= 1) return [tab.id, tab.table.name];

      const qualified = `${tab.table.schema}.${tab.table.name}`;
      return [tab.id, databases.size > 1 && tab.database !== undefined ? `${tab.database}.${qualified}` : qualified];
    }),
  );
}
