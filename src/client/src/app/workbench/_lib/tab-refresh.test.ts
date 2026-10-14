import { describe, expect, it, vi } from "vitest";

import { createRefreshSlot, refreshFromKey } from "./tab-refresh";

// RN-GRADE-012: F5 na aba de uma tabela chama o "Atualizar" da vista à vista (os Registros, a Estrutura, o Diagrama).
const press = (key: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...over });

describe("refreshFromKey: F5 na aba", () => {
  it("F5 sozinha chama o Atualizar da vista e não segue", () => {
    const refresh = vi.fn();
    const slot = createRefreshSlot();
    slot.set(refresh);
    const event = press("F5");

    expect(refreshFromKey(event, slot)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("sem vista registrada, a tecla ainda não segue (nada recarrega a janela), e nada é chamado", () => {
    const event = press("F5");
    expect(refreshFromKey(event, createRefreshSlot())).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("a tecla já tratada por outro (o campo de edição da célula, um menu) e as outras teclas seguem", () => {
    const refresh = vi.fn();
    const slot = createRefreshSlot();
    slot.set(refresh);

    expect(refreshFromKey(press("F5", { defaultPrevented: true }), slot)).toBe(false);
    expect(refreshFromKey(press("F5", { ctrlKey: true }), slot)).toBe(false);
    expect(refreshFromKey(press("F2"), slot)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
