/*
 * O gerador do `random` (RN-VAR-010): o xoshiro128** de Blackman e Vigna, de 128 bits de estado (quatro palavras de 32 bits, nunca as quatro zero). Um só por
 * execução, com a semente do `crypto.getRandomValues` na produção; os testes dão as quatro palavras, e uma semente dá sempre a mesma sequência. Não serve de
 * segredo: o `random.uuid` serve para dados de teste, e não para senha nem chave.
 */

export type Seed = readonly [number, number, number, number];

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** 2^32 e 2^53, para a rejeição. */
const two32 = 0x1_0000_0000;
const two53 = 2 ** 53;

export class Random {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: Seed) {
    [this.s0, this.s1, this.s2, this.s3] = seed.map((word) => word >>> 0);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) throw new RangeError("A semente do gerador não pode ser quatro zeros.");
  }

  /** A próxima saída: um `uint32` do xoshiro128** de referência. */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** `Math.random`: `u / 2^32`, com `u` uma saída. */
  float(): number {
    return this.next() / two32;
  }

  /**
   * Um inteiro de `min` a `max`, os dois inclusive (RN-VAR-010): com `n = max - min + 1` até 2^32, a rejeição sobre uma saída (descarta `u` a partir de
   * `2^32 - (2^32 mod n)`, e dá `min + u mod n`); acima de 2^32, duas saídas formam 53 bits (os 21 de cima da primeira e os 32 da segunda), com a mesma rejeição.
   * Quem chama já conferiu que os dois são inteiros seguros e `min` ≤ `max`.
   */
  int(min: number, max: number): number {
    const n = max - min + 1;
    if (n <= two32) {
      const limit = two32 - (two32 % n);
      for (;;) {
        const u = this.next();
        if (u < limit) return min + (u % n);
      }
    }
    const limit = two53 - (two53 % n);
    for (;;) {
      const high = this.next() >>> 11;
      const low = this.next();
      const u = high * two32 + low;
      if (u < limit) return min + (u % n);
    }
  }

  /** `random.bool`: o bit mais alto de uma saída. */
  bool(): boolean {
    return this.next() >>> 31 === 1;
  }

  /** `random.uuid`: quatro saídas, em ordem, escritas como 16 bytes do mais alto ao mais baixo, com os bits da versão (4) e da variante (`10`). */
  uuid(): string {
    const bytes: number[] = [];
    for (let word = 0; word < 4; word++) {
      const u = this.next();
      bytes.push(u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/** A semente de produção: quatro palavras do `crypto.getRandomValues`, nunca as quatro zero. */
export function productionSeed(): Seed {
  const words = new Uint32Array(4);
  do crypto.getRandomValues(words);
  while ((words[0] | words[1] | words[2] | words[3]) === 0);
  return [words[0], words[1], words[2], words[3]];
}

/** Um gerador sem semente dada: o da produção. */
export const productionRandom = () => new Random(productionSeed());
