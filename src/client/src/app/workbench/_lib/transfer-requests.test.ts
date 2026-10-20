import { describe, expect, it } from "vitest";

import { keepsTransfer, type TransferDialogOpen } from "./transfer-requests";

const open = (epoch: number): TransferDialogOpen => ({ type: "dbeaver", targetFolderID: null, start: { type: "find" }, epoch });

describe("o diálogo de passar conexões continua aberto? (RN-DBEAVER-003)", () => {
  it("continua com a área de trabalho na tela e a mesma época do bloqueio", () => {
    expect(keepsTransfer(open(2), { onScreen: true, lockEpoch: 2 })).toBe(true);
  });

  it("some — com o que tinha — quando o bloqueio por inatividade acontece (a época mudou)", () => {
    expect(keepsTransfer(open(2), { onScreen: true, lockEpoch: 3 })).toBe(false);
  });

  it("some quando a área de trabalho sai da tela (Configurações); voltar não o reabre", () => {
    expect(keepsTransfer(open(2), { onScreen: false, lockEpoch: 2 })).toBe(false);
  });
});
