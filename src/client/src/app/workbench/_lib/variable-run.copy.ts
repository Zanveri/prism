import { formatCount } from "@/lib/utils/format";

/** Os textos da execução com variáveis (RN-VAR-012, 019, 020 e 022) que não são frases da linguagem (essas estão em `variables/variables.copy.ts`). */
export const variableRunCopy = {
  /** A área de resultado quando a conferência achou erros (RN-VAR-012): o título e a linha de cada erro. */
  errors: {
    title: "Erros nas variáveis",
    line: (line: number) => `Linha ${line.toLocaleString("pt-BR")}`,
    hint: "Enter ou o clique leva o cursor ao lugar do erro.",
    list: "Os erros encontrados nas variáveis",
  },

  /** O aviso de erro: "O script não foi executado: 2 erros nas variáveis." */
  refused: {
    script: (count: number) => `O script não foi executado: ${formatCount(count, "erro", "erros")} nas variáveis.`,
    command: (count: number) => `O comando não foi executado: ${formatCount(count, "erro", "erros")} nas variáveis.`,
    declaration: (count: number) => `A declaração não foi avaliada: ${formatCount(count, "erro", "erros")} nas variáveis.`,
  },

  /** RN-VAR-022: o erro numa declaração só deixa "Parar" e "Tentar de novo"; "Pular" fica desabilitado, com este motivo. */
  skipDisabled: (name: string) => `Sem o valor de ${name}, os comandos que a usam não têm como rodar.`,
  declarationTitle: (number: number, total: number) => `A declaração ${number.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} falhou`,
} as const;
