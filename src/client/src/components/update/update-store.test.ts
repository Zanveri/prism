import { describe, expect, it } from "vitest";

import type { UpdateOffer, UpdateState } from "../../../electron/update/update-state";
import { withProgress } from "./update-store";

const offer: UpdateOffer = { checkId: 7, current: "0.1.0", format: "nsis", omitted: 0, releases: [{ version: "0.3.0", prerelease: false, date: "2026-10-10", notes: "- Coisa nova.", sums: [] }] };
const downloading: UpdateState = { status: "downloading", receivedBytes: 0, totalBytes: null, ...offer };

describe("withProgress: o avanço do download entra no estado sem trocar as notas", () => {
  it("põe os números no estado 'baixando' da mesma consulta", () => {
    expect(withProgress(downloading, { checkId: 7, receivedBytes: 1024, totalBytes: 4096 })).toEqual({ ...downloading, receivedBytes: 1024, totalBytes: 4096 });
  });

  it("a lista de versões continua sendo a MESMA (a tela não redesenha as notas a cada avanço)", () => {
    const next = withProgress(downloading, { checkId: 7, receivedBytes: 1024, totalBytes: 4096 });

    expect(next).not.toBe(downloading);
    expect(next.status === "downloading" && next.releases).toBe(offer.releases);
    expect(next.status === "downloading" && next.releases[0]).toBe(offer.releases[0]);
  });

  it("avanço de outra consulta, ou fora do estado 'baixando', não muda nada", () => {
    expect(withProgress(downloading, { checkId: 8, receivedBytes: 1, totalBytes: 2 })).toBe(downloading);
    for (const state of [{ status: "none" }, { status: "available", ...offer }, { status: "ready", ...offer }, { status: "installing", ...offer }, { status: "failed", reason: "x", ...offer }] satisfies UpdateState[]) {
      expect(withProgress(state, { checkId: 7, receivedBytes: 1, totalBytes: 2 })).toBe(state);
    }
  });
});
