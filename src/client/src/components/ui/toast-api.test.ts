import { describe, expect, it, vi } from "vitest";

import { createToastApi } from "./toast-api";
import { pushToast, type ToastItem } from "./toast-queue";

/** Uma fila de mentira: aplica as atualizações que o provedor manda, como o `setState` do React faria. */
function queueOf() {
  let queue: ToastItem[] = [];
  const setQueue = vi.fn((update: (current: ToastItem[]) => ToastItem[]) => {
    queue = update(queue);
  });
  return { setQueue, items: () => queue };
}

describe("createToastApi: os avisos do app (RN-AVISO-001)", () => {
  it("empurra o aviso na fila, com o tom da função que a tela chamou", () => {
    const { setQueue, items } = queueOf();
    const api = createToastApi(setQueue, () => false, () => "id-1");

    api.success("Feito.");
    api.error("Falhou.", "Detalhe.");

    expect(items().map((item) => [item.tone, item.title, item.description])).toEqual([
      ["success", "Feito.", undefined],
      ["error", "Falhou.", "Detalhe."],
    ]);
  });

  it("o id do aviso vem de quem fabrica ids, e a fila é a de pushToast", () => {
    const { setQueue, items } = queueOf();
    createToastApi(setQueue, () => false, () => "id-9").warning("Atenção.");

    expect(items()).toEqual(pushToast([], { tone: "warning", title: "Atenção.", description: undefined }, "id-9"));
  });

  it("com o Prism bloqueado por inatividade nenhum aviso entra na fila: ninguém o vê (fica por baixo da tela de bloqueio), e ele apareceria já velho depois do desbloqueio (a mutação em voo que termina, o 'cinco tentativas' da revelação de senha)", () => {
    const { setQueue, items } = queueOf();
    const api = createToastApi(setQueue, () => true, () => "id");

    api.success("a");
    api.warning("b");
    api.error("c");

    expect(setQueue).not.toHaveBeenCalled();
    expect(items()).toEqual([]);
  });

  it("a pergunta é feita a cada aviso: desbloqueado de novo, eles voltam a entrar", () => {
    const { setQueue, items } = queueOf();
    let locked = true;
    const api = createToastApi(setQueue, () => locked, () => "id");

    api.warning("durante o bloqueio");
    locked = false;
    api.warning("depois do desbloqueio");

    expect(items().map((item) => item.title)).toEqual(["depois do desbloqueio"]);
  });
});
