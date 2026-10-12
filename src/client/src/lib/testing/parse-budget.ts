import { afterAll, beforeAll, vi } from "vitest";

/**
 * Para o arquivo de teste que lê a árvore sintática do CodeMirror (`syntaxTree`, o autocompletar do `lang-sql`): chamar no topo do arquivo.
 *
 * O CodeMirror dá ao parser um orçamento de 20 ms de RELÓGIO a cada estado novo (`Work.Apply`) e, estourado o orçamento, guarda a árvore pela
 * metade e termina o resto quando o navegador está ocioso. Numa máquina carregada (vários testes rodando juntos) o orçamento estoura até num
 * texto de uma linha, e a palavra-chave não é achada: o teste falha por acaso, em lugares diferentes a cada rodada. Com a data parada o orçamento
 * nunca acaba, e a árvore sai inteira, sempre. Só a `Date` é parada: os temporizadores seguem reais.
 */
export function freezeParseBudget(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}
