import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { checkView, type CheckState } from "../_lib/connection-checks";
import { connectionChecksCopy } from "../_lib/connection-checks.copy";
import { CheckDot, CheckFailureDialog, CheckLabel } from "./connection-check";

const copy = connectionChecksCopy;
const ok: CheckState = { kind: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, busy: false };
const failed = { kind: "failed", checkedAt: "2026-10-15T14:32:35Z", elapsedMs: 12, message: "FATAL: terminating connection\nDETAIL: o administrador encerrou", sqlState: "57P01", busy: false } as const;

describe("o indicador da verificação (RN-VERIF-003)", () => {
  it("o ponto tem o texto como nome acessível e a dica, no tom do estado", () => {
    const dot = CheckDot({ view: checkView(ok) });

    expect(dot.props).toMatchObject({ role: "img", "aria-label": copy.state.ok, title: copy.tip.ok(ok.checkedAt, 3), "data-check": "ok" });
    expect(String(dot.props.className)).toContain("bg-success");
    expect(String(CheckDot({ view: checkView(failed) }).props.className)).toContain("bg-danger");
  });

  it("com texto: “Respondeu na última verificação”, como no canvas", () => {
    const found = elementsOf(CheckLabel({ state: ok }));

    expect(found.some((element) => element.props.children === copy.state.ok)).toBe(true);
    expect(found.some((element) => element.type === "button")).toBe(false);
  });

  it("na falha, o texto é um botão que mostra a mensagem do banco num clique; sem quem a mostre, só o texto", () => {
    const onFailure = vi.fn();
    const button = elementsOf(CheckLabel({ state: failed, onFailure })).find((element) => element.type === "button") as Found;
    (button.props.onClick as () => void)();

    expect(button.props.children).toBe(copy.state.failed);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(elementsOf(CheckLabel({ state: failed })).some((element) => element.type === "button")).toBe(false);
  });
});

describe("a falha da verificação num clique (RN-VERIF-003, como o erro de um nó da árvore)", () => {
  it("diz a conexão, a hora e o tempo, a mensagem do banco como veio, o SQLSTATE, e que o Prism não reconecta sozinho", () => {
    const onClose = vi.fn();
    const tree = CheckFailureDialog({ connection: "MES Produção", state: failed, onClose });
    const found = elementsOf(tree);
    const dialog = found.find((element) => element.type === Dialog) as Found;

    expect(dialog.props).toMatchObject({ open: true, title: "MES Produção não respondeu à verificação", description: copy.failure.when(failed.checkedAt, 12) });
    expect(found.some((element) => element.type === "pre" && element.props.children === failed.message)).toBe(true);
    expect(found.some((element) => element.props.children === "57P01")).toBe(true);
    expect(found.some((element) => element.props.children === copy.failure.hint)).toBe(true);

    const close = elementsOf(dialog.props.footer as never).find((element) => element.props.children === copy.failure.close) as Found;
    (close.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
