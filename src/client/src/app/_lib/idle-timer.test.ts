import { describe, expect, it } from "vitest";

import { createIdleTimer, effectiveMinutes, idleWarningSeconds } from "./idle-timer";

const second = 1000;
const minute = 60 * second;

/** Um relógio de mentira: o teste anda o tempo com `advance`. */
function setup() {
  let now = 1_000_000;
  const timer = createIdleTimer(() => now);
  return {
    timer,
    advance: (ms: number) => void (now += ms),
    check: (settings: { enabled?: boolean; minutes?: number; busy?: boolean } = {}) => timer.check({ enabled: true, minutes: 10, busy: false, ...settings }),
  };
}

describe("o aviso e o bloqueio (RN-SEG-001)", () => {
  it("conta o tempo sem uso: o aviso vem 60 segundos antes e diz quanto falta, e no fim bloqueia", () => {
    const { advance, check } = setup();

    expect(check()).toEqual({ phase: "counting" });

    advance(9 * minute - second);
    expect(check()).toEqual({ phase: "counting" });

    advance(second);
    expect(check()).toEqual({ phase: "warning", secondsLeft: idleWarningSeconds });
    expect(idleWarningSeconds).toBe(60);

    advance(30 * second);
    expect(check()).toEqual({ phase: "warning", secondsLeft: 30 });

    advance(29 * second);
    expect(check()).toEqual({ phase: "warning", secondsLeft: 1 });

    advance(second);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("o segundo que falta arredonda para cima: o aviso nunca diz 0 antes de bloquear", () => {
    const { advance, check } = setup();

    advance(10 * minute - 400);

    expect(check()).toEqual({ phase: "warning", secondsLeft: 1 });
  });

  it("mexer cancela o aviso e recomeça a contagem inteira", () => {
    const { timer, advance, check } = setup();

    advance(9 * minute + 30 * second);
    expect(check()).toMatchObject({ phase: "warning" });

    timer.activity();
    expect(check()).toEqual({ phase: "counting" });

    // O tempo todo de novo: 9 minutos depois ainda não avisa, e com 10 bloqueia.
    advance(9 * minute - second);
    expect(check()).toEqual({ phase: "counting" });
    advance(second);
    expect(check()).toMatchObject({ phase: "warning", secondsLeft: 60 });
    advance(minute);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("com comando em andamento o tempo não conta, por mais que dure, e recomeça do fim do último", () => {
    const { advance, check } = setup();

    advance(8 * minute);
    expect(check({ busy: true })).toEqual({ phase: "paused" });

    // Uma consulta de uma hora: nada de aviso nem de bloqueio durante ela.
    advance(60 * minute);
    expect(check({ busy: true })).toEqual({ phase: "paused" });

    // Terminou: a contagem começa agora, e não do último toque de teclado de uma hora e oito minutos atrás.
    expect(check()).toEqual({ phase: "counting" });
    advance(9 * minute);
    expect(check()).toMatchObject({ phase: "warning", secondsLeft: 60 });
    advance(minute);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("o último comando que termina é que conta: enquanto outra aba roda a contagem continua parada", () => {
    const { advance, check } = setup();

    advance(5 * minute);
    // O chamador soma as abas: "algum comando em andamento" é um só `busy`.
    expect(check({ busy: true })).toEqual({ phase: "paused" });
    advance(5 * minute);
    expect(check({ busy: true })).toEqual({ phase: "paused" });

    expect(check({ busy: false })).toEqual({ phase: "counting" });
  });

  it("desligado não conta nem bloqueia, e ligar de novo recomeça do zero", () => {
    const { advance, check } = setup();

    advance(3 * minute);
    expect(check({ enabled: false })).toEqual({ phase: "off" });
    advance(60 * minute);
    expect(check({ enabled: false })).toEqual({ phase: "off" });

    // Ligou agora: não pode bloquear na hora por causa de uma hora sem uso de quando estava desligado.
    expect(check()).toEqual({ phase: "counting" });
    advance(10 * minute);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("ligar de novo sem nenhuma conferência no meio também recomeça do zero", () => {
    const { advance, check } = setup();

    expect(check({ enabled: false })).toEqual({ phase: "off" });
    advance(60 * minute);

    expect(check()).toEqual({ phase: "counting" });
  });

  it("mudar os minutos vale na hora, sobre o tempo que já passou", () => {
    const { advance, check } = setup();

    advance(4 * minute);
    expect(check({ minutes: 10 })).toEqual({ phase: "counting" });
    expect(check({ minutes: 5 })).toMatchObject({ phase: "warning", secondsLeft: 60 });
    expect(check({ minutes: 4 })).toEqual({ phase: "lock" });
  });
});

describe("a janela que dormiu: os temporizadores pararam e nenhuma conferência viu o tempo acabar", () => {
  it("o toque que acorda o Prism não o salva: o tempo já tinha acabado, e a próxima conferência bloqueia", () => {
    const { timer, advance, check } = setup();
    expect(check()).toEqual({ phase: "counting" });

    // O computador dormiu por duas horas: nenhuma conferência rodou no meio, e o primeiro sinal de vida é um toque no mouse.
    advance(120 * minute);
    expect(timer.activity()).toBe(false);

    expect(check()).toEqual({ phase: "lock" });
  });

  it("o toque dentro do prazo reinicia a contagem, e diz que reiniciou", () => {
    const { timer, advance, check } = setup();
    expect(check()).toEqual({ phase: "counting" });

    advance(9 * minute + 59 * second);
    expect(timer.activity()).toBe(true);

    expect(check()).toEqual({ phase: "counting" });
  });

  it("com comando em andamento o tempo não está acabando, por mais que tenha passado: o toque reinicia", () => {
    const { timer, advance, check } = setup();
    expect(check({ busy: true })).toEqual({ phase: "paused" });

    advance(120 * minute);

    expect(timer.activity()).toBe(true);
  });

  it("com o bloqueio desligado nada acaba: o toque reinicia", () => {
    const { timer, advance, check } = setup();
    expect(check({ enabled: false })).toEqual({ phase: "off" });

    advance(120 * minute);

    expect(timer.activity()).toBe(true);
    expect(check()).toEqual({ phase: "counting" });
  });

  it("antes da primeira conferência não há prazo conhecido: o toque reinicia", () => {
    const { timer, advance } = setup();

    advance(120 * minute);

    expect(timer.activity()).toBe(true);
  });
});

describe("os minutos (de 1 a 240, padrão 10)", () => {
  it("fora da faixa, ou que não é um número inteiro, caem no padrão de 10", () => {
    for (const minutes of [0, -1, 241, 1000, 1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveMinutes(minutes)).toBe(10);
    }

    const { advance, check } = setup();
    advance(10 * minute - second);
    expect(check({ minutes: 0 })).toMatchObject({ phase: "warning" });
    advance(second);
    expect(check({ minutes: 0 })).toEqual({ phase: "lock" });
  });

  it("os limites valem: 1 e 240", () => {
    expect(effectiveMinutes(1)).toBe(1);
    expect(effectiveMinutes(240)).toBe(240);
    expect(effectiveMinutes(10)).toBe(10);
  });

  it("com 240 minutos conta tudo isso sem aviso até a última hora", () => {
    const { advance, check } = setup();

    advance(239 * minute - second);
    expect(check({ minutes: 240 })).toEqual({ phase: "counting" });
    advance(second);
    expect(check({ minutes: 240 })).toMatchObject({ phase: "warning", secondsLeft: 60 });
    advance(minute);
    expect(check({ minutes: 240 })).toEqual({ phase: "lock" });
  });

  it("com 1 minuto o aviso vem 30 segundos antes: 60 antes seria no instante do último toque, e mexer o traria de volta a cada tecla", () => {
    const { timer, advance, check } = setup();

    expect(check({ minutes: 1 })).toEqual({ phase: "counting" });

    advance(30 * second - 1);
    expect(check({ minutes: 1 })).toEqual({ phase: "counting" });
    advance(1);
    expect(check({ minutes: 1 })).toEqual({ phase: "warning", secondsLeft: 30 });

    timer.activity();
    expect(check({ minutes: 1 })).toEqual({ phase: "counting" });

    advance(minute);
    expect(check({ minutes: 1 })).toEqual({ phase: "lock" });
  });
});

describe("o relógio do sistema que volta (o horário acertado, o fuso, uma sincronização)", () => {
  it("o que já passou continua tendo passado: com o relógio voltando 1 hora aos 9 minutos, o aviso e o bloqueio vêm no tempo certo, e não 70 minutos depois", () => {
    const { advance, check } = setup();

    advance(9 * minute - second);
    expect(check()).toEqual({ phase: "counting" });

    // O relógio do sistema voltou uma hora.
    advance(-60 * minute);
    expect(check()).toEqual({ phase: "counting" });

    advance(second);
    expect(check()).toEqual({ phase: "warning", secondsLeft: 60 });
    advance(minute);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("um pequeno acerto para trás (2 segundos) não estica a contagem além do que o próprio acerto andou para trás", () => {
    const { advance, check } = setup();

    advance(5 * minute);
    expect(check()).toEqual({ phase: "counting" });
    advance(-2 * second);
    expect(check()).toEqual({ phase: "counting" });

    advance(5 * minute + 2 * second);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("o toque depois do relógio voltar reinicia a contagem como sempre (e sem confundir com a janela que dormiu)", () => {
    const { timer, advance, check } = setup();

    advance(9 * minute);
    expect(check()).toMatchObject({ phase: "warning" });
    advance(-60 * minute);

    expect(timer.activity()).toBe(true);
    expect(check()).toEqual({ phase: "counting" });
  });

  it("o relógio voltando com a contagem já vencida não a salva: quem estourou continua estourado (o toque não reinicia nada, e a conferência diz lock)", () => {
    const { timer, advance, check } = setup();

    advance(10 * minute);
    expect(check()).toEqual({ phase: "lock" });
    advance(-60 * minute);

    expect(timer.activity()).toBe(false);
    expect(check()).toEqual({ phase: "lock" });
  });

  it("o relógio voltando antes de qualquer conferência ter visto o prazo vencer: ninguém viu o tempo acabar, então o toque conta como atividade e a contagem recomeça", () => {
    const { timer, advance, check } = setup();

    advance(10 * minute);
    advance(-60 * minute);

    expect(timer.activity()).toBe(true);
    expect(check()).toEqual({ phase: "counting" });
  });
});
