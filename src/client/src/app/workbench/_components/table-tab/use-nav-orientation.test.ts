import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O gancho com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM) e com o `ResizeObserver` e o
// `getComputedStyle` de mentira: o que se confere é a ligação (lê a direção que o CSS escolheu, e de novo quando o contêiner muda de tamanho). Que o CSS escolhe
// a direção certa na largura certa é conferido na tela.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { useNavOrientation } from "./use-nav-orientation";

/** O elemento de mentira: a largura que o navegador mede e a direção que o CSS deu a ele. */
const element = { clientWidth: 704, flexDirection: "row" };
const ref = { current: element as unknown as HTMLElement };

let observers: { callback: () => void; observed: unknown[]; disconnected: boolean }[] = [];

beforeEach(() => {
  observers = [];
  element.clientWidth = 704;
  element.flexDirection = "row";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      record = { callback: () => {}, observed: [] as unknown[], disconnected: false };
      constructor(callback: () => void) {
        this.record.callback = callback;
        observers.push(this.record);
      }
      observe(target: unknown) {
        this.record.observed.push(target);
      }
      disconnect() {
        this.record.disconnected = true;
      }
    },
  );
  vi.stubGlobal("getComputedStyle", (target: typeof element) => ({ flexDirection: target.flexDirection }));
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

const orientation = () => rt.render(() => useNavOrientation(ref));

describe("useNavOrientation: a orientação da lista de seções segue a direção que o CSS deu a ela", () => {
  it("sem medida ainda (a primeira renderização) é a vertical, a da lista ao lado da seção", () => {
    element.flexDirection = "row";
    // A primeira volta devolve o que valia antes de o efeito ler o elemento.
    expect(rt.render(() => useNavOrientation(ref))).toBe("vertical");
  });

  it("uma fileira (a faixa no topo, com o painel estreito) é horizontal, e uma coluna é vertical", () => {
    element.flexDirection = "row";
    orientation();
    expect(orientation()).toBe("horizontal");

    element.flexDirection = "column";
    observers[0].callback();
    expect(orientation()).toBe("vertical");
  });

  it("observa o próprio elemento e volta a ler quando o contêiner muda de tamanho (o CSS trocou a direção)", () => {
    element.flexDirection = "column";
    orientation();
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([element]);
    expect(orientation()).toBe("vertical");

    element.flexDirection = "row";
    observers[0].callback();
    expect(orientation()).toBe("horizontal");
  });

  it("a lista escondida (a área de trabalho por baixo de outra tela mede 0) não é medida: fica como estava", () => {
    element.flexDirection = "row";
    orientation();
    expect(orientation()).toBe("horizontal");

    element.clientWidth = 0;
    element.flexDirection = "column";
    observers[0].callback();
    expect(orientation()).toBe("horizontal");

    // Ao reaparecer o observador avisa de novo, agora com medida.
    element.clientWidth = 704;
    observers[0].callback();
    expect(orientation()).toBe("vertical");
  });

  it("desmontar solta o observador", () => {
    orientation();
    expect(observers[0].disconnected).toBe(false);

    rt.unmount();
    expect(observers[0].disconnected).toBe(true);
  });

  it("sem elemento ainda (a ref vazia) não observa nada e fica na vertical", () => {
    const empty = { current: null as HTMLElement | null };

    expect(rt.render(() => useNavOrientation(empty))).toBe("vertical");
    expect(observers).toHaveLength(0);
  });
});
