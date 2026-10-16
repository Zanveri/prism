import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckState } from "../_lib/connection-checks";

// A conexão conectada da aba na barra de status, com os ganchos do React simulados (`createHookRuntime`): o estado da verificação é de mentira, e o que se
// confere é o indicador e a janela da falha que ele abre (RN-VERIF-003).
const rt = await vi.hoisted(async () => ({ ...(await import("@/lib/testing/react-hooks")).createHookRuntime(), state: null as CheckState | null }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("../_lib/use-connection-checks", () => ({ useConnectionCheck: () => rt.state }));

const { elementsOf } = await import("@/lib/testing/react-tree");
const { workbenchCopy } = await import("../_lib/workbench.copy");
const { CheckFailureDialog, CheckLabel } = await import("./connection-check");
const { StatusConnectionState } = await import("./status-bar");

const failed: CheckState = { kind: "failed", checkedAt: "2026-10-15T14:32:35Z", elapsedMs: 12, message: "FATAL: terminating connection", sqlState: null, busy: false };
const draw = () => elementsOf(rt.render(() => StatusConnectionState({ connectionId: "c1", name: "MES Produção" })));

beforeEach(() => {
  rt.unmount();
  rt.state = null;
});

describe("a conexão conectada da aba na barra de status (RN-VERIF-003)", () => {
  it("sem verificação, o ponto e “Conectada” de sempre", () => {
    const found = draw();

    expect(found.some((element) => element.props.children === workbenchCopy.status.connected)).toBe(true);
    expect(found.some((element) => element.type === CheckLabel)).toBe(false);
  });

  it("com ela, o indicador; na falha, o clique abre a mensagem do banco, e a conexão que volta a responder a fecha de vez", () => {
    rt.state = failed;
    const label = draw().find((element) => element.type === CheckLabel)!;
    (label.props.onFailure as () => void)();

    expect(draw().find((element) => element.type === CheckFailureDialog)?.props).toMatchObject({ connection: "MES Produção", state: failed });

    rt.state = { kind: "ok", checkedAt: "2026-10-15T14:33:05Z", elapsedMs: 2, busy: false };
    expect(draw().some((element) => element.type === CheckFailureDialog)).toBe(false);
    // A falha seguinte não reabre a janela sozinha: só o clique.
    rt.state = failed;
    expect(draw().some((element) => element.type === CheckFailureDialog)).toBe(false);
  });

  it("fechar a janela a fecha", () => {
    rt.state = failed;
    (draw().find((element) => element.type === CheckLabel)!.props.onFailure as () => void)();
    (draw().find((element) => element.type === CheckFailureDialog)!.props.onClose as () => void)();

    expect(draw().some((element) => element.type === CheckFailureDialog)).toBe(false);
  });
});
