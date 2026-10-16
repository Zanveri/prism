import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import { buttonLabeled, clickLabeled, elementsOf } from "@/lib/testing/react-tree";

import { RestartDialog } from "./restart-dialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, description, footer }: { open: boolean; title: string; description?: unknown; footer?: unknown }) =>
    open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("div", null, description as never), createElement("footer", null, footer as never)) : null,
}));

const noop = () => {};

describe("o diálogo de reinício (item E, RN-DRIVER-005)", () => {
  it("diz o que vai acontecer: reinicia o serviço, pede a senha de novo e fecha as abas de SQL abertas", () => {
    const markup = renderToStaticMarkup(createElement(RestartDialog, { kind: "installed", onRestart: noop, onLater: noop }));

    expect(markup).toContain("Driver instalado. O Prism vai reiniciar o serviço e pedir a sua senha de novo.");
    expect(markup).toContain("As abas de SQL abertas serão fechadas.");
    expect(markup).toMatch(/<button[^>]*>Reiniciar agora<\/button>/);
  });

  it("depois de uma remoção o texto é o da remoção, e também diz das abas", () => {
    const markup = renderToStaticMarkup(createElement(RestartDialog, { kind: "removed", onRestart: noop, onLater: noop }));

    expect(markup).toContain("Driver removido. O Prism vai reiniciar o serviço e pedir a sua senha de novo.");
    expect(markup).toContain("As abas de SQL abertas serão fechadas.");
  });

  it("com exportações em andamento, a frase delas entra no aviso (RN-EXPORT-023); sem nenhuma, nada", () => {
    const markup = renderToStaticMarkup(createElement(RestartDialog, { kind: "installed", onRestart: noop, onLater: noop, exportsNote: "As 2 exportações em andamento serão canceladas." }));

    expect(markup).toContain("As abas de SQL abertas serão fechadas. As 2 exportações em andamento serão canceladas.");
    expect(renderToStaticMarkup(createElement(RestartDialog, { kind: "installed", onRestart: noop, onLater: noop }))).not.toContain("exportaç");
  });

  it("'Reiniciar agora' chama o reinício da API e 'Depois' só o fecha", () => {
    const onRestart = vi.fn();
    const onLater = vi.fn();
    const tree = RestartDialog({ kind: "installed", onRestart, onLater });

    clickLabeled(tree, "Reiniciar agora");
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onLater).not.toHaveBeenCalled();

    clickLabeled(tree, "Depois");
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("o foco inicial é de 'Depois', e não de 'Reiniciar agora': o diálogo abre sozinho, e um Enter ou Espaço que a pessoa já ia dar a outra coisa não reinicia", () => {
    const tree = RestartDialog({ kind: "installed", onRestart: noop, onLater: noop });

    expect(buttonLabeled(tree, "Depois")?.props.autoFocus).toBe(true);
    expect(buttonLabeled(tree, "Reiniciar agora")?.props.autoFocus).toBeFalsy();
  });

  it("não se fecha por fora: nem Esc, nem clique fora, nem o X (o Dialog sem 'dismissible')", () => {
    const tree = RestartDialog({ kind: "installed", onRestart: noop, onLater: noop });
    const dialog = elementsOf(tree).find((element) => element.type === Dialog);

    expect(dialog?.props.dismissible).toBe(false);
    expect(dialog?.props.open).toBe(true);
  });
});
