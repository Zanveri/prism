import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { buttonLabeled } from "@/lib/testing/react-tree";

import { TestFailure } from "./test-failure";

const render = (code: string, message: string, driverID?: string, onInstall?: () => void) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TestFailure, { failure: { code, message, driverID }, onInstall })));

describe("o resultado de 'Testar conexão' que não conectou (item G, RN-DRIVER-006)", () => {
  it("falha do banco: só a mensagem do banco, como veio", () => {
    const markup = render("DATABASE_CONNECTION_FAILED", 'FATAL: password authentication failed for user "mes"');

    expect(markup).toContain('FATAL: password authentication failed for user &quot;mes&quot;');
    expect(markup).not.toContain("Instalar driver");
  });

  it("driver não instalado: a frase da API e 'Instalar driver', que leva à tela de Drivers", () => {
    const markup = render("DRIVER_NOT_INSTALLED", "O driver do IBM Data Server não está instalado.");

    expect(markup).toContain("O driver do IBM Data Server não está instalado.");
    expect(markup).toMatch(/<a [^>]*href="\/drivers"[^>]*>Instalar driver<\/a>/);
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/<a [^>]*href="\/drivers"[^>]*>/);
  });

  it("com o driverID do 422 (seção 16), o link aponta a linha do driver na tela de Drivers", () => {
    expect(render("DRIVER_NOT_INSTALLED", "falta", "ibm-data-server")).toMatch(/<a [^>]*href="\/drivers\?driver=ibm-data-server"[^>]*>Instalar driver<\/a>/);
  });

  it("o link vai abaixo da mensagem, e não ao lado: à direita o aviso de erro do canto da janela o cobriria", () => {
    const markup = render("DRIVER_NOT_INSTALLED", "falta");

    expect(markup.indexOf("falta")).toBeLessThan(markup.indexOf("Instalar driver"));
    expect(markup).toContain("flex-col");
  });

  it("no formulário, que sabe instalar o driver ali mesmo (RN-NAV-005), 'Instalar driver' é um botão que abre o diálogo de instalação, e não um link que leva para fora do formulário", () => {
    const onInstall = vi.fn();
    const markup = render("DRIVER_NOT_INSTALLED", "falta", "ibm-data-server", onInstall);

    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Instalar driver<\/button>/);
    expect(markup).not.toContain("<a ");

    (buttonLabeled(TestFailure({ failure: { code: "DRIVER_NOT_INSTALLED", message: "falta" }, onInstall }), "Instalar driver")?.props.onClick as () => void)();
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("a falha do banco continua sem botão nenhum, mesmo no formulário", () => {
    expect(render("DATABASE_CONNECTION_FAILED", "recusou", undefined, () => {})).not.toContain("Instalar driver");
  });
});
