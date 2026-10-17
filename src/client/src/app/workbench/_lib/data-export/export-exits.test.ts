import { describe, expect, it, vi } from "vitest";

import { dataExportCopy } from "./data-export.copy";
import { createTransferExits, windowCloseStep } from "./export-exits";
import type { Transfer } from "./transfers.schema";

const transfer = (id: string): Transfer => ({ id }) as Transfer;

function exitsWith({ open = true, listed = [transfer("a"), transfer("b")], mine = ["a"], loads = [] as string[] }: { open?: boolean; listed?: Transfer[]; mine?: string[]; loads?: string[] } = {}) {
  const exportsHere = { has: (id: string) => mine.includes(id), cancelAll: vi.fn(async () => {}) };
  const loadsHere = { has: (id: string) => loads.includes(id), cancelAll: vi.fn(async () => {}) };
  const deps = {
    open: () => open,
    list: vi.fn(async () => listed),
    forget: vi.fn(async () => {}),
    trackers: [exportsHere, loadsHere],
  };
  return { deps, exportsHere, loadsHere, exits: createTransferExits(deps) };
}

describe("as saídas que perguntam pelas transferências (RN-EXPORT-023 e RN-IMPORT-021)", () => {
  it("a conta é a da lista da API, de todas as janelas, ou só a de uma conexão", async () => {
    const { deps, exits } = exitsWith();

    expect(await exits.ahead()).toHaveLength(2);
    expect(await exits.ahead("c1")).toHaveLength(2);
    expect(deps.list).toHaveBeenLastCalledWith("c1");
  });

  it("com o cofre fechado (a tela de entrada, o bloqueio), nenhuma, sem pedir à API: o pedido esperaria o desbloqueio", async () => {
    const { deps, exits } = exitsWith({ open: false });

    expect(await exits.ahead()).toEqual([]);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it("confirmada a saída, a lista é lida de novo; as das outras janelas vão pelo DELETE, e as desta pelos acompanhamentos (o das exportações solta os destinos)", async () => {
    const { deps, exits, exportsHere, loadsHere } = exitsWith({ listed: [transfer("a"), transfer("b"), transfer("nova"), transfer("imp")], loads: ["imp"] });

    await exits.cancelForExit();
    expect(deps.list).toHaveBeenCalledTimes(1);
    expect(deps.forget).toHaveBeenCalledWith([transfer("b"), transfer("nova")]);
    expect(exportsHere.cancelAll).toHaveBeenCalledTimes(1);
    expect(loadsHere.cancelAll).toHaveBeenCalledTimes(1);
  });
});

describe("fechar a janela (RN-ABAS-004, RN-EXPORT-023 e RN-IMPORT-021)", () => {
  it("a pergunta das transferências vem antes das abas; sem transferência e sem aba, fecha; bloqueado, fecha sem perguntar", () => {
    expect(windowCloseStep({ locked: false, transfers: 2, tabs: 3 })).toBe("askTransfers");
    expect(windowCloseStep({ locked: false, transfers: 1, tabs: 0 })).toBe("askTransfers");
    expect(windowCloseStep({ locked: false, transfers: 0, tabs: 3 })).toBe("closeTabs");
    expect(windowCloseStep({ locked: false, transfers: 0, tabs: 0 })).toBe("finish");
    expect(windowCloseStep({ locked: true, transfers: 2, tabs: 3 })).toBe("finish");
  });
});

describe("os textos das saídas são os da especificação", () => {
  const exits = dataExportCopy.exits;

  it("o \"Sair\", no plural e no singular, com \"Continuar exportando\"", () => {
    expect(exits.signOut(2)).toBe("Há 2 exportações em andamento. Sair cancela as exportações, e os arquivos delas não são gravados.");
    expect(exits.signOut(1)).toBe("Há 1 exportação em andamento. Sair cancela a exportação, e o arquivo dela não é gravado.");
    expect(exits.signOutConfirm(2)).toBe("Sair e cancelar as exportações");
    expect(exits.keepExporting).toBe("Continuar exportando");
  });

  it("fechar a janela e fechar o Prism", () => {
    expect(exits.window(2)).toBe("2 exportações começadas nesta janela ainda não terminaram. Fechar a janela cancela as exportações.");
    expect(exits.window(1)).toBe("1 exportação começada nesta janela ainda não terminou. Fechar a janela cancela a exportação.");
    expect(exits.windowConfirm(2)).toBe("Fechar e cancelar as exportações");
    expect(exits.app(2)).toBe("2 exportações começadas nesta janela ainda não terminaram. Fechar o Prism cancela as exportações.");
    expect(exits.appConfirm(2)).toBe("Fechar o Prism e cancelar as exportações");
  });

  it("o reinício, a atualização e a exclusão da conexão", () => {
    expect(exits.canceledAhead(2)).toBe("As 2 exportações em andamento serão canceladas.");
    expect(exits.canceledAhead(1)).toBe("A exportação em andamento será cancelada.");
    expect(exits.connectionDelete(2)).toBe("As 2 exportações em andamento desta conexão serão canceladas.");
    expect(exits.connectionDelete(1)).toBe("A exportação em andamento desta conexão será cancelada.");
  });
});
