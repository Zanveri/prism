import { describe, expect, it } from "vitest";

import { dismissToast, maxVisibleToasts, pushToast, type ToastItem } from "./toast-queue";

/** Uma fila com `count` avisos de sucesso diferentes, de ids `1` a `count`. */
function queueOf(count: number) {
  let queue: ToastItem[] = [];
  for (let index = 1; index <= count; index++) queue = pushToast(queue, { tone: "success", title: `Aviso ${index}` }, String(index));
  return queue;
}

describe("toast-queue (RN-AVISO-006)", () => {
  it("pushToast dá 4000 ms ao sucesso e 8000 ms a atenção e a erro", () => {
    let queue = pushToast([], { tone: "success", title: "Conexão criada." }, "a");
    queue = pushToast(queue, { tone: "warning", title: "Cofre fechado. Entre de novo." }, "b");
    queue = pushToast(queue, { tone: "error", title: "Sem resposta da API." }, "c");

    expect(queue.map((item) => [item.id, item.durationMs])).toEqual([["a", 4000], ["b", 8000], ["c", 8000]]);
  });

  it("pushToast com 4 visíveis descarta o mais antigo", () => {
    expect(maxVisibleToasts).toBe(4);

    const queue = pushToast(queueOf(4), { tone: "error", title: "Aviso 5" }, "5");

    expect(queue.map((item) => item.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("pushToast igual ao último visível (mesmo tom, título e descrição) não empilha", () => {
    const queue = pushToast([], { tone: "error", title: "Sem resposta da API.", description: "Tente de novo." }, "a");

    expect(pushToast(queue, { tone: "error", title: "Sem resposta da API.", description: "Tente de novo." }, "b")).toEqual(queue);

    // Basta um dos três mudar para ser outro aviso.
    expect(pushToast(queue, { tone: "warning", title: "Sem resposta da API.", description: "Tente de novo." }, "b")).toHaveLength(2);
    expect(pushToast(queue, { tone: "error", title: "Sem resposta da API." }, "b")).toHaveLength(2);
  });

  it("pushToast igual a um aviso que não é o último empilha", () => {
    let queue = pushToast([], { tone: "success", title: "Pasta criada." }, "a");
    queue = pushToast(queue, { tone: "success", title: "Conexão criada." }, "b");

    queue = pushToast(queue, { tone: "success", title: "Pasta criada." }, "c");

    expect(queue.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("dismissToast remove só o id pedido", () => {
    expect(dismissToast(queueOf(3), "2").map((item) => item.id)).toEqual(["1", "3"]);
  });
});
