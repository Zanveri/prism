import type { Engine } from "@/components/ui/engine-tag";

import { VariableError } from "./errors";
import { Random } from "./random";
import { noOffset } from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * O que o avaliador carrega: o relógio, o gerador do `random`, o banco da aba e os medidores dos limites (RN-VAR-013 e 014). O avaliador é puro e síncrono; tudo o
 * que muda com a hora ou com a sorte entra por aqui, e os testes passam um relógio e uma semente fixos.
 */

/** Os milissegundos de um relógio que só anda para a frente (`performance.now`). */
export type Clock = () => number;

/** O instante de agora para `date.today()`, `new Date()` e `Date.now()`: milissegundos desde 1970. */
export type Now = () => number;

/** Os passos e o tempo de uma execução inteira (RN-VAR-013): 1.000.000 de passos e 5 s por execução. */
export class RunMeter {
  steps = 0;
  readonly startedAt: number;
  readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
    this.startedAt = clock();
  }
}

/**
 * O medidor de uma declaração (RN-VAR-013): cada nó visitado conta um passo; uma operação que percorre um texto ou uma lista conta mais um por 1.000 unidades. O
 * tempo se confere a cada 100 passos e depois de cada operação que percorre mais de 10.000 unidades. As frases levam o nome da declaração; a posição é a do nó, que
 * o avaliador põe.
 */
export class Meter {
  steps = 0;
  private readonly startedAt: number;
  private readonly run: RunMeter;
  private readonly name: string;

  constructor(run: RunMeter, name: string) {
    this.run = run;
    this.name = name;
    this.startedAt = run.clock();
  }

  /**
   * O começo de uma declaração confere o tempo da execução com a leitura do relógio que o construtor já fez: o script de muitas declarações pequenas nunca chega a 100
   * passos numa só, e sem isto os 5 s por execução (e o orçamento do editor) não seriam conferidos (RN-VAR-013).
   */
  checkStart(): void {
    if (this.startedAt - this.run.startedAt > limits.millisecondsPerRun) throw new VariableError(phrase.runTooSlow(), noOffset);
  }

  tick(count = 1): void {
    this.steps += count;
    this.run.steps += count;
    if (this.steps > limits.stepsPerDeclaration) throw new VariableError(phrase.tooManySteps(this.name), noOffset);
    if (this.run.steps > limits.stepsPerRun) throw new VariableError(phrase.tooManyStepsInRun(), noOffset);
    if (this.steps % 100 < count) this.checkTime();
  }

  /** Uma operação que percorre `units` unidades (um texto, uma lista). */
  weigh(units: number): void {
    if (units >= 1000) this.tick(Math.floor(units / 1000));
    if (units > 10_000) this.checkTime();
  }

  checkTime(): void {
    const now = this.run.clock();
    if (now - this.startedAt > limits.millisecondsPerDeclaration) throw new VariableError(phrase.tooSlow(this.name), noOffset);
    if (now - this.run.startedAt > limits.millisecondsPerRun) throw new VariableError(phrase.runTooSlow(), noOffset);
  }
}

/** Tudo o que uma avaliação precisa de fora: o gerador, o relógio, o instante de agora e o banco (para ler o texto de um valor `sql`). */
export type Environment = {
  random: Random;
  clock: Clock;
  now: Now;
  engine: Engine | undefined;
};
