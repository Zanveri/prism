import { describe, expect, it } from "vitest";

import { peerAction, shouldShareActivity, type PeerWhere } from "./peer-session";

describe("peerAction: o que esta janela faz com o que outra janela contou (RN-ABAS-004)", () => {
  const where: PeerWhere[] = ["outside", "open", "locked"];
  const table = (kind: Parameters<typeof peerAction>[0]) => Object.fromEntries(where.map((place) => [place, peerAction(kind, place)]));

  it("a atividade de outra janela recomeça a contagem desta, só com o cofre aberto e desbloqueado", () => {
    expect(table("activity")).toEqual({ outside: "none", open: "touch", locked: "none" });
  });

  it("outra janela bloqueou: esta bloqueia junto, sem fechar o cofre de novo; bloqueada ou fora do cofre, nada", () => {
    expect(table("lock")).toEqual({ outside: "none", open: "lock", locked: "none" });
  });

  it("outra janela desbloqueou (ela conferiu a senha e o usuário): esta, se está bloqueada, desbloqueia", () => {
    expect(table("unlock")).toEqual({ outside: "none", open: "none", locked: "unlock" });
  });

  it("'Sair' em outra janela vale para esta: dentro do cofre, aberta ou bloqueada, ela vai ao login", () => {
    expect(table("signOut")).toEqual({ outside: "none", open: "leave", locked: "leave" });
  });

  it("o login em outra janela libera esta: no login, ela entra; dentro de um cofre, confere se é o mesmo usuário antes de seguir", () => {
    expect(table("signIn")).toEqual({ outside: "enter", open: "checkUser", locked: "checkUser" });
  });
});

describe("shouldShareActivity: a atividade sai desta janela no máximo uma vez por segundo", () => {
  it("a primeira sai na hora, e as seguintes só depois do intervalo", () => {
    expect(shouldShareActivity(null, 5_000)).toBe(true);
    expect(shouldShareActivity(5_000, 5_400)).toBe(false);
    expect(shouldShareActivity(5_000, 6_000)).toBe(true);
  });

  it("o relógio que voltou não prende a atividade: sai de novo", () => {
    expect(shouldShareActivity(9_000, 3_000)).toBe(true);
  });
});
