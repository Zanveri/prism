type Effect = () => void | (() => void);
type Deps = readonly unknown[] | undefined;

/**
 * Os ganchos do React simulados, para chamar um componente COM estado como função e conferir o que ele entrega (o vitest deste projeto não tem DOM, e
 * `renderToStaticMarkup` não roda efeito nem deixa trocar o estado). O teste cria a runtime em `vi.hoisted`, troca os ganchos do `react` por `hooks`
 * (`vi.mock("react", …)`) e renderiza por `render(() => Componente(props))`:
 *
 * - `useState`, `useReducer`, `useRef`, `useId`, `useMemo` e `useCallback` guardam por posição, como o React. Um `setState` durante a renderização pede outra, e os efeitos da
 *   que foi descartada não rodam. `useEffectEvent` devolve uma função que chama a versão mais recente do que recebeu.
 * - `useEffect` roda depois da renderização que valeu, só com as dependências trocadas e com a limpeza do anterior antes. `useLayoutEffect` é o mesmo:
 *   sem DOM, não há o que medir entre um e outro, e a ordem entre os dois não é simulada.
 * - `useSyncExternalStore` lê a foto na hora e NÃO assina: a troca de uma loja não redesenha sozinha, e quem redesenha é o teste, chamando `render` de
 *   novo. É o que deixa conferir o que faz o `onClick` de uma renderização antiga depois de a loja ter mudado.
 *
 * Não desce aos filhos: o que `render` devolve é a árvore de elementos do componente, e as propriedades de cada filho são o que ele receberia (`elementsOf`,
 * em `react-tree.ts`, os acha). Só para testes; este arquivo não importa `react`, que é quem o teste está trocando.
 */
export function createHookRuntime() {
  let slots: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  let pending: { slot: number; effect: Effect; deps: Deps }[] = [];
  let effectCursor = 0;
  let effectSlots: ({ deps: Deps; cleanup: void | (() => void) } | undefined)[] = [];

  const sameDeps = (a: Deps, b: Deps) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  function useState<T>(initial: T | (() => T)): [T, (update: T | ((current: T) => T)) => void] {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
    const set = (update: T | ((current: T) => T)) => {
      const current = slots[slot] as T;
      const next = typeof update === "function" ? (update as (current: T) => T)(current) : update;
      if (Object.is(next, current)) return;
      slots[slot] = next;
      dirty = true;
    };
    return [slots[slot] as T, set];
  }

  function useRef<T>(initial: T): { current: T } {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = { current: initial };
    return slots[slot] as { current: T };
  }

  function memoize<T>(factory: () => T, deps: Deps): T {
    const slot = cursor++;
    const held = slots[slot] as { deps: Deps; value: T } | undefined;
    if (held !== undefined && sameDeps(held.deps, deps)) return held.value;

    const value = factory();
    slots[slot] = { deps, value };
    return value;
  }

  /** Como `useState`, com o estado que o redutor calcula a cada ação. */
  function useReducer<S, A, I>(reducer: (state: S, action: A) => S, initialArg: I, init?: (arg: I) => S): [S, (action: A) => void] {
    const [state, setState] = useState<S>(() => (init === undefined ? (initialArg as unknown as S) : init(initialArg)));
    return [state, (action: A) => setState((current) => reducer(current, action))];
  }

  /** Um id por posição, o mesmo a cada renderização. */
  let ids = 0;
  const useId = (): string => useRef(`:t${++ids}:`).current;

  /** A função de efeito: a mesma a cada renderização, e chama o que a renderização mais recente lhe deu. */
  function useEffectEvent<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
    const latest = useRef(callback);
    latest.current = callback;
    return useRef((...args: A) => latest.current(...args)).current;
  }

  const useMemo = memoize;
  const useCallback = <T>(callback: T, deps: Deps): T => memoize(() => callback, deps);
  const useEffect = (effect: Effect, deps?: Deps) => void pending.push({ slot: effectCursor++, effect, deps });
  const useSyncExternalStore = <T>(_subscribe: unknown, getSnapshot: () => T): T => getSnapshot();

  /** Os efeitos da renderização que valeu (a que não pediu outra) rodam, os que têm as dependências trocadas, com a limpeza do anterior antes. */
  function flush() {
    for (const { slot, effect, deps } of pending) {
      const held = effectSlots[slot];
      if (held !== undefined && sameDeps(held.deps, deps)) continue;
      if (typeof held?.cleanup === "function") held.cleanup();
      effectSlots[slot] = { deps, cleanup: effect() };
    }
    pending = [];
  }

  /** Renderiza até estabilizar (um `setState` durante a renderização pede outra), roda os efeitos e devolve o que o componente devolveu. */
  function render<T>(component: () => T): T {
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0;
      effectCursor = 0;
      dirty = false;
      pending = [];

      const rendered = component();
      if (dirty) continue;

      flush();
      return rendered;
    }
    throw new Error("o componente não estabilizou em 20 renderizações");
  }

  /** Desmontar: a limpeza de cada efeito, e o estado some (o `render` seguinte monta do zero). */
  function unmount() {
    for (const held of effectSlots) if (typeof held?.cleanup === "function") held.cleanup();
    slots = [];
    pending = [];
    effectSlots = [];
  }

  return { hooks: { useState, useReducer, useRef, useId, useMemo, useCallback, useEffect, useLayoutEffect: useEffect, useEffectEvent, useSyncExternalStore }, render, unmount };
}
