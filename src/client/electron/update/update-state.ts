import type { InstallFormat } from "./packages";

/**
 * O que a tela recebe das atualizações: só tipos, sem nada que rode. É o contrato da ponte (`preload.ts`); a tela importa
 * daqui, e não do atualizador, que traz consigo o que é só do processo principal.
 */

/**
 * Uma versão mais nova, como a tela a recebe: as notas já sem o bloco das somas e com no máximo 400 linhas (`clipNotes`), e,
 * à parte, as somas que as notas trazem para os pacotes conhecidos daquela versão (as outras linhas do bloco não vêm).
 * `prerelease`: é um beta, que só vem com "Receber versões beta" ligado (RN-ATUALIZA-010); a tela diz isso.
 */
export type UpdateRelease = { version: string; prerelease: boolean; date: string | null; notes: string; sums: { file: string; sha256: string }[] };

/**
 * O que a última consulta achou: a versão instalada e TODAS as mais novas, da mais recente para a mais antiga
 * (RN-ATUALIZA-003). `checkId` sobe a cada consulta que acha algo: é como a tela sabe que há um achado novo para mostrar.
 * `format` é o pacote da mais recente para a instalação em uso (o instalador no Windows; no Linux e no macOS, o que vai para a
 * pasta de downloads), ou `null` se não há pacote para este sistema: a tela diz o que "Atualizar agora" vai fazer antes de baixar.
 * `releases` leva no máximo as 20 mais recentes: `omitted` é quantas mais antigas (ainda acima da instalada) ficaram de fora.
 */
export type UpdateOffer = { checkId: number; current: string; format: InstallFormat | null; releases: UpdateRelease[]; omitted: number };

/**
 * O estado da atualização, que mora no processo principal e que a tela só espelha. Nenhum estado leva endereço nem caminho
 * de arquivo: `fileName`, em `delivered`, é só o nome do que foi deixado na pasta de downloads, para a tela dizê-lo.
 * `installing` é o Windows entre o pedido de instalar e a saída do app: a API está sendo parada ou o instalador já roda, e a
 * tela não oferece mais nada.
 */
export type UpdateState =
  | { status: "none" }
  | ({ status: "available" } & UpdateOffer)
  | ({ status: "downloading"; receivedBytes: number; totalBytes: number | null } & UpdateOffer)
  | ({ status: "ready" } & UpdateOffer)
  | ({ status: "installing" } & UpdateOffer)
  | ({ status: "delivered"; fileName: string } & UpdateOffer)
  | ({ status: "failed"; reason: string } & UpdateOffer);

/**
 * O avanço do download, que vai à tela num aviso só dele, até cinco vezes por segundo. São três números: as notas e as somas
 * NÃO vão junto (o estado `downloading` inteiro vai uma vez, quando o download começa). `checkId` é o da oferta que está
 * sendo baixada: a tela ignora o avanço de outra.
 */
export type UpdateProgress = { checkId: number; receivedBytes: number; totalBytes: number | null };

/**
 * O resultado de uma consulta manual, que sempre aparece na tela (RN-ATUALIZA-002). `busy`: há um download ou uma instalação
 * em andamento, e a consulta não é feita.
 * `blocked`: o app foi aberto com um argumento de linha de comando que desliga a conferência do certificado ou troca o
 * endereço dos servidores, e por isso não atualiza nesta abertura (RN-ATUALIZA-008).
 */
export type CheckOutcome = { outcome: "available" | "upToDate" | "noSource" | "busy" | "blocked" } | { outcome: "failed"; reason: string };
