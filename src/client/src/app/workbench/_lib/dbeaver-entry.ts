/**
 * A entrada desta janela (RN-DBEAVER-002): "Entrar" e "Criar usuário" a armam, e a página da área de trabalho a gasta uma vez, quando já sabe se o cofre tem
 * conexões e se o convite do DBeaver foi feito. O desbloqueio depois de um bloqueio por inatividade não passa por aqui (a área de trabalho nem é montada de novo),
 * e uma janela aberta depois (uma aba que sai para outra janela) também não: o convite é de quem entrou, na janela em que entrou.
 */
export type DbeaverEntry = {
  /** `created`: o usuário acabou de ser criado, e o "Comece por aqui" leva o foco ao primeiro botão (RN-DBEAVER-001). */
  arm: (options: { created: boolean }) => void;
  armed: () => boolean;
  created: () => boolean;
  /** A entrada foi atendida (o convite foi decidido); não vale mais. */
  done: () => void;
};

export function createDbeaverEntry(): DbeaverEntry {
  let armed = false;
  let created = false;
  return {
    arm(options) {
      armed = true;
      created = options.created;
    },
    armed: () => armed,
    created: () => created,
    done() {
      armed = false;
    },
  };
}

export const dbeaverEntry = createDbeaverEntry();

/** O "Comece por aqui" aparece, não aparece, ou ainda não se sabe (as duas listas ainda não chegaram). */
export type StartHerePhase = "pending" | "show" | "hide";

/**
 * O "Comece por aqui" é decidido uma vez por entrada (RN-DBEAVER-001): o cofre sem nenhuma conexão (as pastas não contam) e o convite do DBeaver por fazer.
 * `connections` é quantas há (`undefined` enquanto a lista não chegou); `invitedAt`, o convite do cofre (`undefined` enquanto a consulta não respondeu, `null`
 * por fazer). A consulta que falhou (`failed`) não deixa saber o convite, e o painel não aparece.
 */
export function startHerePhaseOf({ connections, invitedAt, failed }: { connections: number | undefined; invitedAt: string | null | undefined; failed: boolean }): StartHerePhase {
  if (connections === undefined || (invitedAt === undefined && !failed)) return "pending";
  return connections === 0 && invitedAt === null ? "show" : "hide";
}

/**
 * O que a entrada pede do convite em forma de diálogo (RN-DBEAVER-002), quando a área de trabalho já sabe o que precisa: `wait` (falta a janela ser a de
 * entrada e estar na tela, ou as duas respostas), `skip` (não é o caso: o convite já foi feito, o cofre está vazio, e é o "Comece por aqui" que convida; a entrada
 * se gasta mesmo assim) ou `run` (procurar o DBeaver e, achando o que importar, abrir o diálogo).
 */
export function inviteStep({ armed, onScreen, connections, invitedAt, failed }: { armed: boolean; onScreen: boolean; connections: number | undefined; invitedAt: string | null | undefined; failed: boolean }): "wait" | "skip" | "run" {
  if (!armed || !onScreen || connections === undefined || (invitedAt === undefined && !failed)) return "wait";
  return invitedAt === null && connections > 0 ? "run" : "skip";
}
