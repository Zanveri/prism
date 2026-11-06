import { defaultLocale, pickCopy, type Locale, type Localized } from "../locale";
import { updateMessagesCopyEn } from "./update-messages.copy.en";
import { updateMessagesCopyEs } from "./update-messages.copy.es";

/**
 * As frases do atualizador que vão à tela (a causa da falha em "Verificar atualizações" e no diálogo, e a linha do corte das notas). O processo
 * principal não tem `window.prism`: quem escolhe o idioma é `main.ts`, que o lê de `locale.json` ao abrir e o passa ao `createUpdater`; as funções
 * puras recebem os textos já escolhidos, e sem eles valem os do português (os testes). As linhas do log continuam em português, no próprio código.
 */
const pt = {
  updater: {
    /** O arquivo baixado e conferido não é mais o mesmo no disco: alguém o trocou entre a conferência e o uso. */
    changed: "O arquivo da atualização mudou depois de conferido.",
    /**
     * O que a tela diz quando a instalação não foi adiante DEPOIS de a API ter sido parada para ela: o app está aberto sem o serviço, e a tela de
     * trás mostra o erro da API com "Reiniciar". Cada frase começa por espaço: ela vem depois de outra.
     */
    serviceIsBack: ' Use "Reiniciar" para trazer o serviço de volta.',
    serviceStoppedForInstall: " O serviço do Prism foi parado para instalar.",
    packageKept: ' O pacote baixado continua guardado: "Tentar de novo" o confere outra vez, sem baixar de novo.',
    /** A parada que falhou não prova nada, nem depois: nesta abertura o instalador não roda mais, e quem resolve é abrir o Prism de novo. */
    reopenToUpdate: " Para atualizar, feche o Prism e abra-o de novo.",
    downloadAgain: " Baixe a atualização de novo.",
    /** A causa que leva um caminho do sistema de arquivos: dele só vai o código. */
    dataFolderRefused: (code: string) => `O sistema não deixou gravar na pasta de dados do Prism (${code}).`,
    notJson: "A resposta do servidor não é a lista de versões (não é JSON).",
    notReleaseList: "A resposta do servidor não é a lista de versões.",
    /** A causa com a pasta de dados ou a de downloads, trocada antes de ir para a tela. */
    diskWriteFailed: "O Prism não conseguiu gravar a atualização no disco.",
    removed: "Ele foi apagado.",
    notRemoved: "O Prism não conseguiu apagá-lo agora: ele não será usado, e sai na próxima abertura.",
    noPackage: "Não há pacote desta versão para o sistema e a arquitetura deste computador.",
    /** `note` é `serviceStoppedForInstall` + `serviceIsBack` depois da parada da API, ou vazio. */
    verifiedFileGone: (note: string) => `O arquivo conferido não está mais onde o Prism o deixou.${note} Baixe a atualização de novo.`,
    stopTimedOut: "O serviço do Prism não encerrou a tempo, e por isso o instalador não foi iniciado.",
    stopFailed: "O serviço do Prism não encerrou, e por isso o instalador não foi iniciado.",
    installerFailed: (cause: string) => `Não foi possível iniciar o instalador (${cause}).`,
    deliverFailed: (cause: string) => `Não foi possível deixar o pacote na pasta de downloads (${cause}).`,
  },

  /** `checksums.ts`, `sumRefusal` (RN-ATUALIZA-005). */
  sums: {
    notesMissing: (fileName: string) => `As notas da versão não trazem a soma SHA-256 de ${fileName}. Sem as duas somas o Prism não instala a atualização.`,
    fileMissing: (fileName: string) => `O SHA256SUMS da versão não traz a soma de ${fileName}. Sem as duas somas o Prism não instala a atualização.`,
    mismatchBoth: (fileName: string) => `O arquivo baixado (${fileName}) não confere com a soma SHA-256 das notas da versão nem com a do SHA256SUMS.`,
    mismatchNotes: (fileName: string) => `O arquivo baixado (${fileName}) não confere com a soma SHA-256 das notas da versão.`,
    mismatchFile: (fileName: string) => `O arquivo baixado (${fileName}) não confere com a soma SHA-256 do SHA256SUMS da versão.`,
  },

  /** `download.ts`: a falha da consulta e do download, que chega à tela como causa. */
  download: {
    invalidSize: "O servidor declarou um tamanho inválido para a resposta.",
    tooLarge: (kilobytes: number) => `A resposta é grande demais: passa do teto de ${kilobytes.toLocaleString("pt-BR")} kB que o Prism aceita.`,
    redirectNotFollowed: "O servidor respondeu com um redirecionamento que o Prism não segue (só para https, e no máximo cinco seguidos).",
    redirectInQuery: "O servidor respondeu com um redirecionamento, e a consulta às versões não segue redirecionamento.",
    status: (status: number) => `O servidor respondeu ${status}.`,
    packageStatus: (status: number) => `O servidor respondeu ${status} ao pedido do pacote.`,
    canceled: "Download cancelado.",
    timedOut: (seconds: number) => `O servidor não respondeu no prazo de ${seconds} s.`,
    stalled: (seconds: number) => `O servidor parou de responder: nenhum dado chegou no prazo de ${seconds} s.`,
    moreThanDeclared: "O servidor mandou mais do que o tamanho declarado do pacote.",
    lessThanDeclared: "O download terminou antes do tamanho declarado do pacote.",
  },

  /** `install.ts`: o pacote que não acha nome livre na pasta de downloads. */
  install: {
    noFreeName: "A pasta de downloads já tem cem arquivos com o nome do pacote.",
  },

  /** `releases.ts`, `clipNotes`: a linha que fecha as notas cortadas. */
  releases: {
    notesCut: "As notas desta versão foram cortadas aqui: são mais longas do que o Prism mostra.",
  },
} as const;

export type UpdateMessagesCopy = Localized<typeof pt>;

/** Os textos no idioma desta abertura do app (`main.ts`); sem idioma, os do português. */
export function updateMessagesCopy(locale: Locale = defaultLocale): UpdateMessagesCopy {
  return pickCopy(locale, { "pt-BR": pt, en: updateMessagesCopyEn, es: updateMessagesCopyEs });
}
