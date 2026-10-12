const locale = "pt-BR";

/**
 * `1 linha afetada`, `3 linhas afetadas`. A tela escreve a concordância certa em vez de
 * "linha(s)": ela sabe o número, a pessoa não deveria ter de fazer a conta de cabeça.
 */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString(locale)} ${count === 1 ? singular : plural}`;
}

/**
 * O tempo que a API mediu para o comando, na unidade que se lê de relance: `42 ms` abaixo de um segundo; `1,3 s`, com um décimo, até um minuto; `1 min 10 s` até
 * uma hora; e `2 h 5 min` daí em diante. Um comando de 70 s aparecia como `70.066 ms`. A unidade é a do valor JÁ arredondado: 999,6 ms é `1,0 s`, 59,96 s é
 * `1 min 0 s` e 59 min 59,6 s é `1 h 0 min`, nunca `1.000 ms`, `60,0 s` nem `60 min 0 s`. O que não é um tempo (não finito, ou negativo: uma resposta
 * estranha da API) sai como um traço, e não como `NaN min NaN s`.
 */
export function formatElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "—";

  // `abs` só tira o sinal do zero negativo (`-0`), que sairia escrito `-0 ms`.
  const milliseconds = Math.abs(Math.round(elapsedMs));
  if (milliseconds < 1000) return `${milliseconds.toLocaleString(locale)} ms`;

  const tenths = Math.round(elapsedMs / 100);
  if (tenths < 600) return `${(tenths / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;

  const minutes = Math.round(elapsedMs / 60_000);
  return `${Math.floor(minutes / 60).toLocaleString(locale)} h ${minutes % 60} min`;
}
