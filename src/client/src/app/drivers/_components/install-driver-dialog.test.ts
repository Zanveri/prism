import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Driver } from "../_lib/drivers.schema";
import { InstallDriverDialogView } from "./install-driver-dialog";

// O `Dialog` de verdade desenha num portal em `document.body`, que o renderizador de servidor não tem: aqui ele
// só devolve o que receberia (título, descrição, corpo e rodapé), para o teste ler o conteúdo.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, description, footer, children }: { open: boolean; title: string; description?: unknown; footer?: unknown; children?: unknown }) =>
    open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("div", null, description as never), createElement("div", null, children as never), createElement("footer", null, footer as never)) : null,
}));

const licenseUrl = "https://exemplo.local/licenca-ibm";

const ibm: Driver = {
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state: "available",
  version: "12.1.3",
  sizeBytes: 115343360,
  license: { name: "IBM International Program License Agreement", url: licenseUrl },
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
};

const noop = () => {};
type Props = Parameters<typeof InstallDriverDialogView>[0];
const props: Props = { driver: ibm, accepted: false, pending: false, refusal: null, onAcceptedChange: noop, onConfirm: noop, onCopyLink: noop, onClose: noop };
const render = (overrides: Partial<Props> = {}) => renderToStaticMarkup(createElement(InstallDriverDialogView, { ...props, ...overrides }));

/** O botão "Baixar e instalar" inteiro. */
const submitButton = (markup: string) => /<button[^>]*>Baixar e instalar<\/button>/.exec(markup)?.[0] ?? "";

/** Tem o atributo `disabled` (e não só a classe `disabled:opacity-50`, que todo botão leva). */
const isDisabled = (tag: string) => / disabled(?:=""|[\s>])/.test(tag);

/** Alguma tag com `href`: o texto escapado de uma resposta hostil (`&lt;a href=…`) não conta. */
const hasHref = (markup: string) => /<[a-z][^>]*\shref=/i.test(markup);

describe("o diálogo de instalação (item C)", () => {
  it("mostra o fabricante, o nome da licença, o tamanho do download e o aviso do reinício", () => {
    const markup = render();

    expect(markup).toContain("Baixar o driver IBM Data Server");
    expect(markup).toContain("Fabricante");
    expect(markup).toContain(">IBM<");
    expect(markup).toContain("IBM International Program License Agreement");
    expect(markup).toContain("110 MB");
    expect(markup).toContain("Depois de instalar, o Prism reinicia o serviço e pede a sua senha de novo.");
    // RN-DRIVER-005: o reinício fecha o cofre, e as abas de SQL abertas se perdem.
    expect(markup).toContain("As abas de SQL abertas serão fechadas.");
  });

  it("o botão 'Baixar e instalar' só é liberado com o aceite marcado", () => {
    expect(isDisabled(submitButton(render({ accepted: false })))).toBe(true);
    expect(isDisabled(submitButton(render({ accepted: true })))).toBe(false);
    expect(render({ accepted: false })).not.toContain("checked");
    expect(render({ accepted: true })).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(render()).toContain("Li e aceito a licença do fabricante");
  });

  it("enquanto o pedido roda, o botão fica desligado mesmo com o aceite", () => {
    const pendingButton = /<button[^>]*>Iniciando…<\/button>/.exec(render({ accepted: true, pending: true }))?.[0] ?? "";

    expect(isDisabled(pendingButton)).toBe(true);
  });

  it("o endereço da licença é só texto selecionável: sem link, sem href, sem abrir janela", () => {
    const markup = render({ accepted: true });

    expect(markup).toContain(licenseUrl);
    expect(markup).toMatch(/<[a-z]+[^>]*select-text[^>]*>https:\/\/exemplo\.local\/licenca-ibm</);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<a>");
    expect(hasHref(markup)).toBe(false);
    expect(markup).not.toContain(`src="${licenseUrl}`);
    expect(markup).not.toContain("window.open");
    expect(markup).not.toContain("target=");
  });

  it("tem o botão 'Copiar link'", () => {
    expect(render()).toMatch(/<button[^>]*>Copiar link<\/button>/);
  });

  it("depois de uma recusa o botão fica desligado, mesmo com o aceite: não se repete o envio com o estado velho", () => {
    const markup = render({ accepted: true, refusal: "Este driver já está instalado." });

    expect(isDisabled(submitButton(markup))).toBe(true);
  });

  it("a recusa da API aparece no diálogo, como alerta, com a mensagem dela", () => {
    const markup = render({ accepted: true, refusal: "Este driver já está instalado." });

    expect(markup).toMatch(/role="alert"[^>]*>Este driver já está instalado\./);
  });

  it("o endereço que vem da API é texto, nunca HTML", () => {
    const markup = render({ driver: { ...ibm, license: { name: "<b>x</b>", url: '"><a href="https://mal.local">x</a>' } } });

    expect(markup).not.toContain('<a href="https://mal.local"');
    expect(markup).not.toContain("<b>x");
    expect(hasHref(markup)).toBe(false);
    expect(markup).not.toContain("<a ");
  });

  it("sem licença no catálogo o driver não pode ser instalado, nem com o aceite", () => {
    const markup = render({ driver: { ...ibm, license: null }, accepted: true });

    expect(markup).toContain("O catálogo não trouxe um texto de licença que o Prism possa mostrar");
    expect(isDisabled(submitButton(markup))).toBe(true);
    expect(markup).not.toContain("Copiar link");
  });
});
