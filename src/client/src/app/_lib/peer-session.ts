import type { PeerEvent } from "../../../electron/window-messages";

/**
 * O cofre é um só para todas as janelas (RN-ABAS-004): o bloqueio por inatividade conta a atividade de qualquer uma e bloqueia todas, o login libera
 * todas e o "Sair" vale para todas. Cada janela conta às outras o que aconteceu nela (pelo processo principal, que só repassa), e esta é a decisão do
 * que fazer com o que chegou, sem React.
 */

export type PeerKind = PeerEvent["kind"];

/** Onde esta janela está: fora do cofre (o login), dentro dele e desbloqueada, ou dentro e bloqueada. */
export type PeerWhere = "outside" | "open" | "locked";

/**
 * - `touch`: a pessoa mexeu em outra janela, ou há comando em andamento lá: a contagem desta recomeça (o comando parado em outra janela também segura
 *   esta, como aqui: o tempo recomeça do fim dele);
 * - `lock`: outra janela bloqueou e já fecha o cofre na API: esta bloqueia a tela e descarta o que dependia do cofre, sem pedir o fechamento de novo
 *   (um pedido repetido depois do desbloqueio fecharia o cofre que a pessoa acabou de abrir);
 * - `unlock`: outra janela conferiu a senha e o usuário e abriu o cofre: esta solta a barreira;
 * - `leave`: o "Sair" de outra janela fechou o cofre: esta vai ao login e esquece o que tinha;
 * - `enter`: outra janela entrou: esta, que está no login, entra também;
 * - `checkUser`: outra janela entrou, e esta está dentro de um cofre: se não é o mesmo usuário (entrar fecha o cofre de quem estava antes,
 *   RN-COFRE-007), ela sai.
 */
export type PeerAction = "touch" | "lock" | "unlock" | "leave" | "enter" | "checkUser" | "none";

export function peerAction(kind: PeerKind, where: PeerWhere): PeerAction {
  switch (kind) {
    case "activity":
      return where === "open" ? "touch" : "none";
    case "lock":
      return where === "open" ? "lock" : "none";
    case "unlock":
      return where === "locked" ? "unlock" : "none";
    case "signOut":
      return where === "outside" ? "none" : "leave";
    case "signIn":
      return where === "outside" ? "enter" : "checkUser";
  }
}

/** De quanto em quanto tempo, no máximo, a atividade desta janela vai às outras: o temporizador confere a cada segundo. */
export const shareActivityEveryMs = 1000;

/** A atividade (ou o comando em andamento) vai às outras janelas agora? A primeira vai na hora; o relógio que voltou não a prende. */
export function shouldShareActivity(lastSharedAt: number | null, now: number, everyMs = shareActivityEveryMs): boolean {
  return lastSharedAt === null || now < lastSharedAt || now - lastSharedAt >= everyMs;
}
