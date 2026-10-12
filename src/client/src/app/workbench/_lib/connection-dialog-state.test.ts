import { describe, expect, it } from "vitest";

import { keepsDialog, type ConnectionDialogOpen } from "./connection-dialog-state";

const fresh: ConnectionDialogOpen = { request: { mode: "new", folderID: null }, epoch: 3 };
const editing: ConnectionDialogOpen = { request: { mode: "edit", connectionId: "c1" }, epoch: 3 };
const context = { onScreen: true, lockEpoch: 3, connectionIds: new Set(["c1"]) };

describe("keepsDialog: o diálogo de conexão continua aberto (RN-NAV-004)", () => {
  it("com a área de trabalho na tela e o cofre como estava, fica", () => {
    expect(keepsDialog(fresh, context)).toBe(true);
    expect(keepsDialog(editing, context)).toBe(true);
  });

  it("o bloqueio por inatividade o descarta (RN-SEG-001): a época do bloqueio mudou desde que ele abriu", () => {
    expect(keepsDialog(fresh, { ...context, lockEpoch: 4 })).toBe(false);
    expect(keepsDialog(editing, { ...context, lockEpoch: 4 })).toBe(false);
  });

  it("saiu da área de trabalho (o 'Instalar driver' que leva a Configurações › Drivers): some, e não reaparece ao voltar", () => {
    expect(keepsDialog(fresh, { ...context, onScreen: false })).toBe(false);
  });

  it("a conexão em edição sumiu da lista (excluída, aqui ou de outro jeito): some", () => {
    expect(keepsDialog(editing, { ...context, connectionIds: new Set() })).toBe(false);
  });

  it("com a lista ainda por chegar, a edição espera: 'lista vazia' é outra coisa", () => {
    expect(keepsDialog(editing, { ...context, connectionIds: null })).toBe(true);
  });
});
