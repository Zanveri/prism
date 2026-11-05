import { defaultLocale, pickCopy, type Locale, type Localized } from "./locale";
import { fileTransferCopyEn } from "./file-transfer.copy.en";
import { fileTransferCopyEs } from "./file-transfer.copy.es";

/**
 * As frases da cópia e da entrega de arquivos que vão à tela: o diálogo de abrir da importação e o de salvar da exportação (RN-IMPORT-018 e
 * RN-EXPORT-019), o motivo de não ler o arquivo e a falha da cópia ou da entrega. Nenhuma leva caminho: são escolhidas pelo código do sistema. O
 * processo principal não tem `window.prism`: o `main.ts` passa o idioma desta abertura ao `createTransferSource` e ao `createTransferDesk`; sem ele,
 * o português (os testes). As linhas do log continuam em português, no próprio código.
 */
const pt = {
  /** O último filtro dos dois diálogos, o de abrir e o de salvar. */
  allFiles: "Todos os arquivos",

  source: {
    dialogTitle: "Importar dados",
    filters: {
      data: "Arquivos de dados (*.csv, *.tsv, *.tab, *.txt, *.json, *.xlsx, *.xlsm)",
      delimited: "CSV e TSV (*.csv, *.tsv, *.tab, *.txt)",
      json: "JSON (*.json)",
      excel: "Excel (*.xlsx, *.xlsm)",
    },
    /** O motivo de não ler o arquivo, pelo código do sistema: a tela o põe em "Não foi possível ler o arquivo: …". */
    unreadable: {
      permission: "o sistema não dá permissão para ler o arquivo",
      busy: "o arquivo está em uso por outro programa",
      missing: "o arquivo não existe mais",
      io: "o disco deu erro de leitura",
      other: (code: string | undefined) => `erro ${code ?? "sem código"}`,
    },
    /** As frases da cópia que falhou, inteiras: a tela as mostra no campo do arquivo. */
    failure: {
      diskFull: "Não há espaço na pasta de dados do Prism para copiar o arquivo.",
      tooLarge: "O arquivo passou de 2 GB durante a cópia.",
      unreadable: (reason: string) => `Não foi possível ler o arquivo: ${reason}.`,
      other: (code: string | undefined) => `Não foi possível copiar o arquivo (${code ?? "sem código"}).`,
    },
  },

  desk: {
    /** O nome de cada formato no filtro do diálogo de salvar: "<nome> (*.<extensão>)". */
    formats: { csv: "CSV", tsv: "TSV", php: "PHP", xml: "XML", html: "HTML", json: "JSON", md: "Markdown", sql: "SQL", txt: "Texto", xlsx: "Excel", zip: "ZIP" },
    /** Por que a entrega falhou (RN-EXPORT-020). A tela escreve as quatro conhecidas com as frases dela; a de `other` é esta. */
    delivery: {
      diskFull: "não há espaço no disco de destino",
      notWritable: "sem permissão para gravar na pasta escolhida",
      folderMissing: "a pasta escolhida não existe mais",
      inUse: "o arquivo está aberto em outro programa",
      other: (code: string | undefined) => `o sistema recusou a gravação (${code ?? "sem código"})`,
    },
    /** "Copiar" da exportação (RN-EXPORT-014): o arquivo pronto que não se deixa ler. */
    clipboardReadFailed: (code: string | undefined) => `Não foi possível ler o texto exportado (${code ?? "sem código"}).`,
  },
} as const;

export type FileTransferCopy = Localized<typeof pt>;

/** Os textos no idioma desta abertura do app (`main.ts`); sem idioma, os do português. */
export function fileTransferCopy(locale: Locale = defaultLocale): FileTransferCopy {
  return pickCopy(locale, { "pt-BR": pt, en: fileTransferCopyEn, es: fileTransferCopyEs });
}
