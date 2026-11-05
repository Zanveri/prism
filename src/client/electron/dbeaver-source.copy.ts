import { dbeaverSourceCopyEn } from "./dbeaver-source.copy.en";
import { dbeaverSourceCopyEs } from "./dbeaver-source.copy.es";
import { defaultLocale, pickCopy, type Locale, type Localized } from "./locale";

/**
 * As frases da procura e da cópia do DBeaver que vão à tela (RN-DBEAVER-005 e 006): o título do diálogo de pasta e o motivo da recusa (`unreadable`),
 * inteiro e sem caminho. O processo principal não tem `window.prism`: o `main.ts` passa o idioma desta abertura ao `createDbeaverSource`; sem ele, o
 * português (os testes). O motivo de um arquivo ilegível é o da importação (`file-transfer.copy.ts`). As linhas do log continuam em português.
 */
const pt = {
  /** O título do diálogo de pasta (RN-DBEAVER-005), escrito aqui: nada da tela vai ao diálogo. */
  dialogTitle: "Escolher a pasta do DBeaver",
  /** A frase do atalho recusado (RN-DBEAVER-006), inteira. */
  symlink: "O DBeaver guarda esta pasta por um atalho (link simbólico), e o Prism não segue atalhos. Escolha a pasta de verdade.",
  /** A frase de um arquivo ilegível (RN-DBEAVER-006), com o motivo da RN-IMPORT-018. */
  unreadable: (reason: string) => `Não foi possível ler os arquivos do DBeaver: ${reason}.`,
  /** O motivo quando o arquivo aberto não é o que o `lstat` viu. */
  swapped: "o arquivo foi trocado durante a cópia",
} as const;

export type DbeaverSourceCopy = Localized<typeof pt>;

/** Os textos no idioma desta abertura do app (`main.ts`); sem idioma, os do português. */
export function dbeaverSourceCopy(locale: Locale = defaultLocale): DbeaverSourceCopy {
  return pickCopy(locale, { "pt-BR": pt, en: dbeaverSourceCopyEn, es: dbeaverSourceCopyEs });
}
