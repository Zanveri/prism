import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFilterHandoff } from "./filter-handoff";

const ordem = { schema: "producao", name: "ordem_producao" };
const maquina = { schema: "producao", name: "maquina" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createFilterHandoff: o filtro que passa de uma aba para a da tabela referenciada (RN-TABELA-007)", () => {
  it("o pedido fica à espera da tabela, até a vista Registros o levar ao campo e apagá-lo", () => {
    const handoff = createFilterHandoff();

    handoff.request("c-1", ordem, '"id" = 42');
    const request = handoff.peek("c-1", ordem);

    expect(request).toMatchObject({ where: '"id" = 42' });
    handoff.clear("c-1", ordem, request!.id);
    expect(handoff.peek("c-1", ordem)).toBeNull();
  });

  it("enquanto o pedido não muda, peek devolve o mesmo objeto (é o que o React compara)", () => {
    const handoff = createFilterHandoff();
    handoff.request("c-1", ordem, '"id" = 1');

    expect(handoff.peek("c-1", ordem)).toBe(handoff.peek("c-1", ordem));
  });

  it("cada conexão e cada tabela têm o seu pedido", () => {
    const handoff = createFilterHandoff();
    handoff.request("c-1", ordem, '"id" = 1');

    expect(handoff.peek("c-2", ordem)).toBeNull();
    expect(handoff.peek("c-1", maquina)).toBeNull();
    // O mesmo nome em outro esquema é outra tabela.
    expect(handoff.peek("c-1", { schema: "cadastro", name: "ordem_producao" })).toBeNull();
  });

  it("um pedido novo para a mesma tabela troca o anterior, com outro id", () => {
    const handoff = createFilterHandoff();
    handoff.request("c-1", ordem, '"id" = 1');
    const first = handoff.peek("c-1", ordem)!;

    handoff.request("c-1", ordem, '"id" = 2');
    const second = handoff.peek("c-1", ordem)!;

    expect(second.where).toBe('"id" = 2');
    expect(second.id).not.toBe(first.id);
    // Apagar o pedido velho não apaga o novo.
    handoff.clear("c-1", ordem, first.id);
    expect(handoff.peek("c-1", ordem)).toBe(second);
  });

  it("quem assina é avisado de cada pedido e de cada remoção, e deixa de ser avisado ao sair", () => {
    const handoff = createFilterHandoff();
    const listener = vi.fn();
    const unsubscribe = handoff.subscribe(listener);

    handoff.request("c-1", ordem, '"id" = 1');
    expect(listener).toHaveBeenCalledTimes(1);

    handoff.clear("c-1", ordem, handoff.peek("c-1", ordem)!.id);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    handoff.request("c-1", ordem, '"id" = 2');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("um pedido que ninguém leva (a aba não abriu) some sozinho, e quem assina é avisado", () => {
    const handoff = createFilterHandoff(15_000);
    const listener = vi.fn();
    handoff.subscribe(listener);

    handoff.request("c-1", ordem, '"id" = 1');
    vi.advanceTimersByTime(14_999);
    expect(handoff.peek("c-1", ordem)).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(handoff.peek("c-1", ordem)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("o prazo do pedido velho não derruba o pedido novo", () => {
    const handoff = createFilterHandoff(15_000);
    handoff.request("c-1", ordem, '"id" = 1');
    vi.advanceTimersByTime(10_000);
    handoff.request("c-1", ordem, '"id" = 2');

    vi.advanceTimersByTime(6_000);

    expect(handoff.peek("c-1", ordem)?.where).toBe('"id" = 2');
  });

  it("apagar o que já foi apagado não faz nada, nem avisa", () => {
    const handoff = createFilterHandoff();
    const listener = vi.fn();
    handoff.subscribe(listener);

    handoff.clear("c-1", ordem, 99);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("o pedido que ninguém levou a tempo não some calado: quem ouve `onExpired` fica sabendo de qual tabela era", () => {
  it("o prazo acabou com o pedido ainda na passagem (a aba estava ocupada): avisa, uma vez, com a tabela", () => {
    const handoff = createFilterHandoff(15_000);
    const expired = vi.fn();
    handoff.onExpired(expired);

    handoff.request("c-1", ordem, '"id" = 1');
    vi.advanceTimersByTime(14_999);
    expect(expired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);

    expect(expired.mock.calls).toEqual([[ordem]]);
  });

  it("o pedido que a vista levou não avisa nada quando o prazo dele passa", () => {
    const handoff = createFilterHandoff(15_000);
    const expired = vi.fn();
    handoff.onExpired(expired);
    handoff.request("c-1", ordem, '"id" = 1');

    handoff.clear("c-1", ordem, handoff.peek("c-1", ordem)!.id);
    vi.advanceTimersByTime(60_000);

    expect(expired).not.toHaveBeenCalled();
  });

  it("o pedido trocado por outro não avisa: só o novo, se também não for levado", () => {
    const handoff = createFilterHandoff(15_000);
    const expired = vi.fn();
    handoff.onExpired(expired);
    handoff.request("c-1", ordem, '"id" = 1');
    vi.advanceTimersByTime(10_000);
    handoff.request("c-1", ordem, '"id" = 2');

    vi.advanceTimersByTime(6_000);
    expect(expired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("quem deixa de ouvir não é mais avisado", () => {
    const handoff = createFilterHandoff(15_000);
    const expired = vi.fn();
    const stop = handoff.onExpired(expired);
    handoff.request("c-1", ordem, '"id" = 1');

    stop();
    vi.advanceTimersByTime(60_000);

    expect(expired).not.toHaveBeenCalled();
  });
});

describe("forgetExcept: o pedido morre com a aba da tabela a que se destinava", () => {
  it("fechada a aba da tabela, o pedido que esperava por ela sai: reabrir a mesma tabela não leva o filtro velho", () => {
    const handoff = createFilterHandoff(15_000);
    const listener = vi.fn();
    handoff.subscribe(listener);
    handoff.request("c-1", ordem, '"id" = 1');
    handoff.request("c-1", maquina, "\"codigo\" = 'AB-1'");
    listener.mockClear();

    // As abas de tabela que continuam abertas: só a de `maquina`.
    handoff.forgetExcept([{ connectionId: "c-1", table: maquina }]);

    expect(handoff.peek("c-1", ordem)).toBeNull();
    expect(handoff.peek("c-1", maquina)).toMatchObject({ where: "\"codigo\" = 'AB-1'" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a mesma tabela em outra conexão é outra aba", () => {
    const handoff = createFilterHandoff(15_000);
    handoff.request("c-1", ordem, '"id" = 1');
    handoff.request("c-2", ordem, '"id" = 2');

    handoff.forgetExcept([{ connectionId: "c-2", table: ordem }]);

    expect(handoff.peek("c-1", ordem)).toBeNull();
    expect(handoff.peek("c-2", ordem)).not.toBeNull();
  });

  it("o pedido que saiu com a aba não avisa que o prazo acabou: a pessoa fechou a aba, não foi a tabela que demorou", () => {
    const handoff = createFilterHandoff(15_000);
    const expired = vi.fn();
    handoff.onExpired(expired);
    handoff.request("c-1", ordem, '"id" = 1');

    handoff.forgetExcept([]);
    vi.advanceTimersByTime(60_000);

    expect(expired).not.toHaveBeenCalled();
  });

  it("sem pedido nenhum a apagar, ninguém é avisado de mudança", () => {
    const handoff = createFilterHandoff();
    const listener = vi.fn();
    handoff.subscribe(listener);
    handoff.request("c-1", ordem, '"id" = 1');
    listener.mockClear();

    handoff.forgetExcept([{ connectionId: "c-1", table: ordem }]);

    expect(listener).not.toHaveBeenCalled();
  });
});
