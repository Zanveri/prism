import { describe, expect, it } from "vitest";

import type { Connection } from "@/app/connections/_lib/connections.schema";

import { choiceKeyTarget, connectionChoices, connectionShortcut, connectionShortcutLabel, folderPathOf, withConnection } from "./tab-connection";
import type { QueryTab } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

const folders = [
  { id: "clientes", parentID: null, name: "Clientes" },
  { id: "erp", parentID: "clientes", name: "ERP" },
  { id: "qas", parentID: null, name: "QAS" },
];

function connection(id: string, name: string, over: Partial<Connection> = {}): Connection {
  return { id, folderID: null, name, engine: 3, host: `${id}.zanveri.local`, port: 9089, database: "erp", userName: "informix", hasPassword: true, environmentName: null, environmentColor: null, createdAt: "", updatedAt: "", ...over };
}

const connections = [
  connection("c1", "Produção", { folderID: "erp" }),
  connection("c2", "homologação", { folderID: "qas", host: "10.0.0.7" }),
  connection("c3", "Desenvolvimento 10"),
  connection("c4", "Desenvolvimento 9"),
];

const ids = (choices: ReturnType<typeof connectionChoices>) => choices.map((choice) => choice.connection.id);

describe("folderPathOf: o caminho de pastas da conexão, na lista da troca (RN-ARVORE-008)", () => {
  it("da raiz até a pasta dela; na raiz, vazio", () => {
    expect(folderPathOf("erp", folders)).toBe("Clientes / ERP");
    expect(folderPathOf("qas", folders)).toBe("QAS");
    expect(folderPathOf(null, folders)).toBe("");
  });

  it("a pasta que sumiu acaba a subida, e o ciclo (que a API recusa) não prende a conta", () => {
    expect(folderPathOf("sumiu", folders)).toBe("");
    expect(folderPathOf("a", [{ id: "a", parentID: "b", name: "A" }, { id: "b", parentID: "a", name: "B" }])).toBe("B / A");
  });
});

describe("connectionChoices: a lista das conexões da troca (RN-ARVORE-008) e da faixa da aba sem conexão (RN-SCRIPT-005)", () => {
  it("as conectadas primeiro; em cada grupo, por nome, sem acento nem caixa, e os números pela grandeza", () => {
    const choices = connectionChoices(connections, folders, new Set(["c4", "c1"]));

    expect(ids(choices)).toEqual(["c4", "c1", "c3", "c2"]);
    expect(choices.map((choice) => choice.connected)).toEqual([true, true, false, false]);
    expect(choices[1].path).toBe("Clientes / ERP");
  });

  it("sem nenhuma conectada, só por nome", () => {
    expect(ids(connectionChoices(connections, folders, new Set()))).toEqual(["c4", "c3", "c2", "c1"]);
  });

  it("a busca acha o pedaço no nome, no caminho de pastas e no servidor, sem acento e sem caixa", () => {
    const none = new Set<string>();

    expect(ids(connectionChoices(connections, folders, none, "producao"))).toEqual(["c1"]);
    expect(ids(connectionChoices(connections, folders, none, " clientes "))).toEqual(["c1"]);
    expect(ids(connectionChoices(connections, folders, none, "10.0.0"))).toEqual(["c2"]);
    expect(ids(connectionChoices(connections, folders, none, "desenv"))).toEqual(["c4", "c3"]);
    expect(connectionChoices(connections, folders, none, "nada disso")).toEqual([]);
  });
});

describe("connectionShortcut: Ctrl+9 abre a lista das conexões da aba, como no DBeaver (RN-ARVORE-008)", () => {
  const key = (over: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: "9", code: "Digit9", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

  it("Ctrl+9 e Cmd+9; também no teclado em que a tecla do 9 escreve outra coisa", () => {
    expect(connectionShortcut(key())).toBe(true);
    expect(connectionShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(connectionShortcut(key({ key: "ç" }))).toBe(true);
  });

  it("sem o modificador, com Alt ou com Shift, ou outra tecla, não", () => {
    expect(connectionShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(connectionShortcut(key({ altKey: true }))).toBe(false);
    expect(connectionShortcut(key({ shiftKey: true }))).toBe(false);
    expect(connectionShortcut(key({ key: "8", code: "Digit8" }))).toBe(false);
  });

  it("a dica escreve o atalho da plataforma", () => {
    expect(connectionShortcutLabel("Win32")).toEqual({ label: workbenchCopy.editor.connection.shortcut, aria: "Control+9" });
    expect(connectionShortcutLabel("MacIntel")).toEqual({ label: workbenchCopy.editor.connection.shortcutMac, aria: "Meta+9" });
  });
});

describe("choiceKeyTarget: as setas da lista, sem dar a volta", () => {
  it("andam uma posição e param nas pontas; sem nada marcado, a de baixo vai à primeira e a de cima à última", () => {
    expect(choiceKeyTarget("ArrowDown", 0, 3)).toBe(1);
    expect(choiceKeyTarget("ArrowDown", 2, 3)).toBe(2);
    expect(choiceKeyTarget("ArrowUp", 0, 3)).toBe(0);
    expect(choiceKeyTarget("ArrowDown", -1, 3)).toBe(0);
    expect(choiceKeyTarget("ArrowUp", -1, 3)).toBe(2);
  });

  it("lista vazia, ou outra tecla: nada", () => {
    expect(choiceKeyTarget("ArrowDown", -1, 0)).toBeNull();
    expect(choiceKeyTarget("Home", 1, 3)).toBeNull();
  });
});

describe("withConnection: a aba de consulta passa a outra conexão (RN-ARVORE-008)", () => {
  const tab: QueryTab = { id: "q1", title: "consulta-1.sql", connectionId: "c1", database: "vendas", sessionId: "s-velha", sql: "select 1" };

  it("vai à conexão nova, no banco padrão dela, sem a sessão de antes e com o texto do editor deste instante", () => {
    expect(withConnection(tab, "c2", "select 2")).toEqual({ id: "q1", title: "consulta-1.sql", connectionId: "c2", sessionId: null, sql: "select 2" });
  });

  it("a mesma conexão e a aba de uma tabela não trocam; a aba sem conexão recebe a escolhida", () => {
    expect(withConnection(tab, "c1")).toBeNull();
    expect(withConnection({ ...tab, table: { schema: "loja", name: "pedido", view: "data" } }, "c2")).toBeNull();
    expect(withConnection({ ...tab, connectionId: null, database: undefined }, "c2")).toMatchObject({ connectionId: "c2", sessionId: null });
  });

  it("a aba de um script fica com mudança não salva fora da conexão salva, e sem ela ao voltar; a do genérico, nunca (RN-SCRIPT-003 e 005)", () => {
    const script = { id: "s1", name: "Fechamento", savedSql: "select 1", savedConnectionId: "c1", dirty: false };
    const moved = withConnection({ ...tab, database: undefined, script }, "c2");

    expect(moved?.script?.dirty).toBe(true);
    expect(withConnection(moved!, "c1")?.script?.dirty).toBe(false);
    expect(withConnection({ ...tab, script: { id: "s1", name: "Fechamento", savedSql: "select 1", generic: true, dirty: false } }, "c2")?.script?.dirty).toBe(false);
  });
});
