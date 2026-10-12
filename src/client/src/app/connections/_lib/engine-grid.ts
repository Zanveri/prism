/**
 * Para onde a tecla leva o foco na grade de bancos do diálogo de nova conexão (RN-NAV-005: um grupo de escolha única com teclado completo,
 * setas nas duas direções). Esquerda e direita andam um e dão a volta; para cima e para baixo andam uma linha na mesma coluna e, fora da
 * grade, ficam onde estão (para baixo de uma coluna que a última linha não tem, vai ao último banco); Home e End vão às pontas. `columns` é
 * quantas colunas a grade tem agora (ela se ajusta à largura). Outra tecla não é da grade (`null`).
 */
export function gridKeyTarget(key: string, current: number, count: number, columns: number): number | null {
  if (count === 0) return null;

  const width = Math.max(1, columns);
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "ArrowDown":
      if (current + width < count) return current + width;
      // Na penúltima linha, numa coluna que a última não tem: o último banco, que está na linha de baixo.
      return Math.floor(current / width) < Math.floor((count - 1) / width) ? count - 1 : current;
    case "ArrowUp":
      return current - width >= 0 ? current - width : current;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * A única parada de tabulação da grade: o banco escolhido (mesmo desabilitado: é o da conexão gravada), ou, sem escolha, o primeiro que se
 * pode escolher, ou o primeiro de todos, para a pessoa ler o motivo.
 */
export function gridTabStop(choices: readonly { disabled: boolean }[], selected: number): number {
  if (selected >= 0) return selected;

  const first = choices.findIndex((choice) => !choice.disabled);
  return first >= 0 ? first : 0;
}
