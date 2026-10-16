import { describe, expect, it } from "vitest";

import type { RowContext } from "./cell-editing";
import { editBar, type EditBarState } from "./edit-bar";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** `loja.pedido`, de uma tabela só: a chave em `id`, `status` se edita, `total` é gerada pelo banco. */
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "total", editable: false, reason: "gerada pelo banco", nullable: true, generated: "always" },
  ],
  rowOperations: true,
  oneAtATime: false,
};

/** `pedido p JOIN cliente c`: só se alteram células. */
const join: EditTarget = {
  tables: [
    { schema: "loja", name: "pedido", key: [0], editable: true, reason: null },
    { schema: "loja", name: "cliente", key: [2], editable: true, reason: null },
  ],
  columns: [
    { table: 0, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 1, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
  ],
  rowOperations: false,
  oneAtATime: false,
};

const readRow = (over: Partial<Extract<RowContext, { kind: "read" }>> = {}): RowContext => ({ kind: "read", truncated: undefined, deleted: false, values: ["1", "aberta", "10"], ...over });
const at = (column: number, row: RowContext = readRow()): EditBarState["active"] => ({ cell: { row: 0, column }, row });
const state = (over: Partial<EditBarState> = {}): EditBarState => ({ readOnly: null, target, busy: false, active: at(1), rows: 2, platform: "Win32", ...over });

/** O motivo de cada botão, na ordem da barra (nulo no que se aplica). */
const reasons = (over: Partial<EditBarState> = {}) => editBar(state(over)).map((button) => button.reason);

describe("a barra de edição: os botões, na ordem, com o atalho (RN-EDIT-013)", () => {
  it("Editar célula, Adicionar linha, Duplicar linha e Excluir linha, com a dica que escreve o atalho", () => {
    expect(editBar(state()).map((button) => [button.id, button.label, button.title, button.shortcut.aria])).toEqual([
      ["edit", "Editar célula", "Editar célula (F2)", "F2"],
      ["newRow", "Adicionar linha", "Adicionar linha (Alt+Insert)", "Alt+Insert"],
      ["duplicateRow", "Duplicar linha", "Duplicar linha (Ctrl+Alt+Insert)", "Control+Alt+Insert"],
      ["deleteRow", "Excluir linha", "Excluir linha (Alt+Delete)", "Alt+Delete"],
    ]);
  });

  it("no macOS a dica escreve os atalhos com o Option e o Cmd (RN-EDIT-015)", () => {
    expect(editBar(state({ platform: "MacIntel" })).map((button) => button.title)).toEqual(["Editar célula (F2)", "Adicionar linha (Option+Insert)", "Duplicar linha (Cmd+Option+Insert)", "Excluir linha (Option+Delete)"]);
  });

  it("o botão que não se aplica leva o motivo, e a dica é a do botão seguida do motivo, como o item do menu o mostra", () => {
    const [, add] = editBar(state({ target: join }));

    expect(add.reason).toBe("Somente leitura: num resultado de junção só se alteram células.");
    expect(add.title).toBe("Adicionar linha (Alt+Insert). Somente leitura: num resultado de junção só se alteram células.");
  });
});

describe("quando cada botão vale (RN-EDIT-014)", () => {
  it("sem o catálogo perguntado, os quatro ficam habilitados: a primeira tentativa pergunta (RN-EDIT-010)", () => {
    expect(reasons({ target: null })).toEqual([null, null, null, null]);
  });

  it("sem o catálogo perguntado, \"Editar célula\" já fica desabilitado no que a linha diz: a linha marcada para exclusão, a célula cortada, a que o banco preencheu", () => {
    expect(reasons({ target: null, active: at(1, readRow({ deleted: true })) })[0]).toBe(copy.readOnly(copy.reasons.deleted));
    expect(reasons({ target: null, active: at(1, readRow({ truncated: new Set([1]) })) })[0]).toBe(copy.readOnly(copy.reasons.truncated));
    expect(reasons({ target: null, active: at(1, readRow({ generated: new Set([1]) })) })[0]).toBe(copy.readOnly(copy.reasons.generated));
    // A chave cortada, a coluna e a tabela dependem do catálogo: ficam para a primeira tentativa.
    expect(reasons({ target: null, active: at(1, readRow({ truncated: new Set([0]) })) })[0]).toBeNull();
    expect(reasons({ target: null, active: at(2) })[0]).toBeNull();
    // A linha nova se edita.
    expect(reasons({ target: null, active: at(1, { kind: "new" }) })[0]).toBeNull();
  });

  it("o resultado inteiro só leitura pela página (e a conexão somente leitura) desabilita os quatro, com o motivo da barra do resultado", () => {
    const whole = copy.readOnly("DISTINCT");
    expect(reasons({ readOnly: "DISTINCT", target: null })).toEqual([whole, whole, whole, whole]);
    const connection = copy.readOnly(copy.reasons.connectionReadOnly);
    expect(reasons({ readOnly: copy.reasons.connectionReadOnly, target: null, active: null, rows: 0 })).toEqual([connection, connection, connection, connection]);
  });

  it("com o catálogo dizendo que nenhuma tabela se edita, também os quatro, com o motivo da tabela", () => {
    const view: EditTarget = { ...target, tables: [{ ...target.tables[0], editable: false, reason: "pedido é uma visão" }], rowOperations: false };
    const reason = copy.readOnly("pedido é uma visão");

    expect(reasons({ target: view, active: null })).toEqual([reason, reason, reason, reason]);
  });

  it("a aba ocupada desabilita os quatro; a atualização automática, com o motivo dela", () => {
    const busy = copy.readOnly(copy.reasons.busy);
    const refresh = copy.readOnly(copy.reasons.refreshing);

    expect(reasons({ busy: true })).toEqual([busy, busy, busy, busy]);
    expect(reasons({ busy: "refresh", target: null })).toEqual([refresh, refresh, refresh, refresh]);
    expect(refresh).toBe("Somente leitura: a atualização automática está lendo as linhas de novo; tente outra vez em um instante.");
  });

  it("o catálogo que não aceita linha nova nem exclusão desabilita os três de linha; numa junção, com o motivo de hoje", () => {
    const join_ = copy.readOnly(copy.reasons.joinRowOperations);
    expect(reasons({ target: join })).toEqual([null, join_, join_, join_]);

    const noRows: EditTarget = { ...target, rowOperations: false };
    const reason = copy.readOnly(copy.reasons.noRowOperations);
    expect(reasons({ target: noRows })).toEqual([null, reason, reason, reason]);
  });

  it("\"Editar célula\" segue a célula ativa: a coluna que não se edita, a linha marcada para exclusão, a célula cortada, a chave gerada pelo banco", () => {
    expect(reasons({ active: at(2) })[0]).toBe(copy.readOnly("gerada pelo banco"));
    expect(reasons({ active: at(1, readRow({ deleted: true })) })[0]).toBe(copy.readOnly(copy.reasons.deleted));
    expect(reasons({ active: at(1, readRow({ truncated: new Set([1]) })) })[0]).toBe(copy.readOnly(copy.reasons.truncated));
    expect(reasons({ active: at(1, readRow({ generated: new Set([0]) })) })[0]).toBe(copy.readOnly(copy.reasons.keyGenerated));
    expect(reasons({ active: at(0, { kind: "new" }) })[0]).toBeNull();
  });

  it("\"Excluir linha\" não vale na linha cuja chave não se sabe nem na que já está marcada para exclusão; os outros seguem", () => {
    expect(reasons({ active: at(1, readRow({ truncated: new Set([0]) })) })).toEqual([copy.readOnly(copy.reasons.keyTruncated), null, null, copy.readOnly(copy.reasons.keyTruncated)]);
    expect(reasons({ active: at(1, readRow({ deleted: true })) })).toEqual([copy.readOnly(copy.reasons.deleted), null, null, copy.readOnly(copy.reasons.alreadyDeleted)]);
    // Sem o alvo, a linha marcada já se sabe.
    expect(reasons({ target: null, active: at(1, readRow({ deleted: true })) })[3]).toBe(copy.readOnly(copy.reasons.alreadyDeleted));
  });

  it("sem célula ativa, \"Editar célula\" pede uma célula e os de linha pedem uma linha; sem nenhuma linha, os três dizem que não há linhas, e \"Adicionar linha\" vale", () => {
    expect(reasons({ active: null })).toEqual([copy.bar.chooseCell, null, copy.bar.chooseRow, copy.bar.chooseRow]);
    expect(reasons({ active: null, rows: 0 })).toEqual([copy.bar.noRows, null, copy.bar.noRows, copy.bar.noRows]);
    expect(editBar(state({ active: null }))[0].title).toBe("Editar célula (F2). Escolha uma célula na grade.");
  });

  it("vale só o primeiro motivo, na ordem da regra: o resultado só leitura antes da aba ocupada, a aba ocupada antes da célula, a junção antes da falta de linha", () => {
    expect(reasons({ readOnly: "DISTINCT", busy: true, active: null })).toEqual(Array(4).fill(copy.readOnly("DISTINCT")));
    expect(reasons({ busy: true, active: at(2), rows: 0 })).toEqual(Array(4).fill(copy.readOnly(copy.reasons.busy)));
    expect(reasons({ target: join, active: null, rows: 0 })).toEqual([copy.bar.noRows, copy.readOnly(copy.reasons.joinRowOperations), copy.readOnly(copy.reasons.joinRowOperations), copy.readOnly(copy.reasons.joinRowOperations)]);
  });
});
