import { describe, expect, it } from "vitest";

import { createDbeaverEntry, inviteStep, startHerePhaseOf } from "./dbeaver-entry";

describe("a entrada desta janela (RN-DBEAVER-002)", () => {
  it("começa desarmada; \"Entrar\" e \"Criar usuário\" a armam, e atender a entrada a gasta", () => {
    const entry = createDbeaverEntry();
    expect([entry.armed(), entry.created()]).toEqual([false, false]);

    entry.arm({ created: true });
    expect([entry.armed(), entry.created()]).toEqual([true, true]);
    entry.done();
    expect(entry.armed()).toBe(false);

    entry.arm({ created: false });
    expect([entry.armed(), entry.created()]).toEqual([true, false]);
  });
});

describe("o \"Comece por aqui\" (RN-DBEAVER-001)", () => {
  it("espera as duas respostas: a lista de conexões e o convite", () => {
    expect(startHerePhaseOf({ connections: undefined, invitedAt: null, failed: false })).toBe("pending");
    expect(startHerePhaseOf({ connections: 0, invitedAt: undefined, failed: false })).toBe("pending");
  });

  it("aparece com o cofre sem conexão e o convite por fazer", () => {
    expect(startHerePhaseOf({ connections: 0, invitedAt: null, failed: false })).toBe("show");
  });

  it("não aparece com alguma conexão, nem com o convite feito, nem sem saber o convite (a consulta falhou)", () => {
    expect(startHerePhaseOf({ connections: 1, invitedAt: null, failed: false })).toBe("hide");
    expect(startHerePhaseOf({ connections: 0, invitedAt: "2026-10-20T12:00:00Z", failed: false })).toBe("hide");
    expect(startHerePhaseOf({ connections: 0, invitedAt: undefined, failed: true })).toBe("hide");
  });
});

describe("o convite em forma de diálogo (RN-DBEAVER-002)", () => {
  const ready = { armed: true, onScreen: true, connections: 3, invitedAt: null, failed: false };

  it("procura o DBeaver quando é a janela de entrada, com a área de trabalho na tela e o convite por fazer, para quem já tem conexão", () => {
    expect(inviteStep(ready)).toBe("run");
  });

  it("espera: outra janela que não a de entrada, a área de trabalho fora da tela, ou as respostas por chegar", () => {
    expect(inviteStep({ ...ready, armed: false })).toBe("wait");
    expect(inviteStep({ ...ready, onScreen: false })).toBe("wait");
    expect(inviteStep({ ...ready, connections: undefined })).toBe("wait");
    expect(inviteStep({ ...ready, invitedAt: undefined })).toBe("wait");
  });

  it("não convida: o convite já foi feito, o cofre está vazio (o convite é o \"Comece por aqui\") ou a consulta do convite falhou", () => {
    expect(inviteStep({ ...ready, invitedAt: "2026-10-20T12:00:00Z" })).toBe("skip");
    expect(inviteStep({ ...ready, connections: 0 })).toBe("skip");
    expect(inviteStep({ ...ready, invitedAt: undefined, failed: true })).toBe("skip");
  });
});
