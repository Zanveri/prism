import { describe, expect, it } from "vitest";

import type { ShownProtections } from "@/app/connections/_lib/protections";

import { autoRefreshQuestion, commandQuestion, saveQuestion, scriptQuestion } from "./command-confirmation";

const none: ShownProtections = { readOnly: null, confirm: null };
const irreversible: ShownProtections = { readOnly: null, confirm: { level: "irreversible", from: null } };
const all: ShownProtections = { readOnly: null, confirm: { level: "all", from: null } };
const readOnly = (level: "irreversible" | "all"): ShownProtections => ({ readOnly: { from: null }, confirm: { level, from: null } });

const deleteAll = { sql: "DELETE FROM producao.apontamento", engine: 1 as const };
const read = { sql: "SELECT * FROM producao.apontamento", engine: 1 as const };

describe("commandQuestion: o aviso de um comando (RN-PROT-001)", () => {
  it("“Não” nunca pergunta", () => {
    expect(commandQuestion(none, deleteAll)).toBeNull();
  });

  it("“Só comandos irreversíveis” pergunta o irreversível, com o que ele faz, e deixa a leitura passar", () => {
    expect(commandQuestion(irreversible, deleteAll)).toEqual({ kind: "command", command: { number: null, sql: deleteAll.sql, irreversible: { kind: "delete", target: "producao.apontamento" } } });
    expect(commandQuestion(irreversible, read)).toBeNull();
  });

  it("“Todos os comandos” pergunta tudo, e diz também quando o comando é irreversível", () => {
    expect(commandQuestion(all, read)).toEqual({ kind: "command", command: { number: null, sql: read.sql, irreversible: null } });
    expect(commandQuestion(all, deleteAll)).toMatchObject({ command: { irreversible: { kind: "delete" } } });
  });

  it("na conexão somente leitura “Só comandos irreversíveis” não pergunta (a API recusa antes do banco), e “Todos os comandos” continua", () => {
    expect(commandQuestion(readOnly("irreversible"), deleteAll)).toBeNull();
    expect(commandQuestion(readOnly("all"), read)).toMatchObject({ kind: "command" });
  });

  it("com o filtro do resultado, o aviso leva o filtro que vai junto", () => {
    expect(commandQuestion(all, { ...read, filter: "turno = 2" })).toEqual({ kind: "command", command: { number: null, sql: read.sql, filter: "turno = 2", irreversible: null } });
  });
});

describe("scriptQuestion: o aviso do script, uma vez, antes do primeiro comando (RN-PROT-001 e RN-SQL-019)", () => {
  const script = [read, deleteAll, { sql: "TRUNCATE producao.turno", engine: 1 as const }];

  it("“Só comandos irreversíveis”: a lista dos irreversíveis, com o número de cada um no script e o total", () => {
    expect(scriptQuestion(irreversible, script)).toEqual({
      kind: "script",
      total: 3,
      commands: [
        { number: 2, sql: deleteAll.sql, irreversible: { kind: "delete", target: "producao.apontamento" } },
        { number: 3, sql: "TRUNCATE producao.turno", irreversible: { kind: "truncate", target: "producao.turno" } },
      ],
    });
  });

  it("“Todos os comandos”: todos, na ordem", () => {
    expect(scriptQuestion(all, script)?.kind === "script" && scriptQuestion(all, script)).toMatchObject({ commands: [{ number: 1 }, { number: 2 }, { number: 3 }] });
  });

  it("sem irreversível, com “Não”, sem comando, e na conexão somente leitura com “Só comandos irreversíveis”, roda sem perguntar", () => {
    expect(scriptQuestion(irreversible, [read])).toBeNull();
    expect(scriptQuestion(none, script)).toBeNull();
    expect(scriptQuestion(all, [])).toBeNull();
    expect(scriptQuestion(readOnly("irreversible"), script)).toBeNull();
  });
});

describe("o Salvar e a atualização automática perguntam só em “Todos os comandos” (RN-PROT-001)", () => {
  it("o Salvar pergunta com quantas alterações vão; em “Só comandos irreversíveis”, não (cada comando é pela chave, com WHERE)", () => {
    expect(saveQuestion(all, 3)).toEqual({ kind: "save", count: 3 });
    expect(saveQuestion(irreversible, 3)).toBeNull();
    expect(saveQuestion(all, 0)).toBeNull();
  });

  it("ligar a atualização automática pergunta pelo comando que ela vai repetir", () => {
    expect(autoRefreshQuestion(all, read)).toEqual({ kind: "autoRefresh", command: { number: null, sql: read.sql, irreversible: null } });
    expect(autoRefreshQuestion(irreversible, read)).toBeNull();
    expect(autoRefreshQuestion(none, read)).toBeNull();
  });
});
