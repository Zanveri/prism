import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { preferencesStore, type PreferencesPatch } from "../_lib/preferences";
import { ResultsSection } from "./results-section";

/** Cada teste usa um usuário só seu: as preferências moram num armazenamento do módulo, que sobrevive de um teste ao outro. */
let counter = 0;
function render(preferences: PreferencesPatch = {}) {
  const userName = `results.${++counter}`;
  preferencesStore.set(userName, preferences);
  const client = new QueryClient();
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName });

  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ResultsSection, { anchor: "cfg-resultados" })));
}

/** A caixa do tipo no cabeçalho e o rótulo dela. */
const typesBox = (html: string) => /<input id="cfg-tipo-cabecalho" type="checkbox"([^>]*)\/?>/.exec(html)?.[1];

describe("Resultados › o tipo de dado no cabeçalho das colunas (RN-CONFIG-006)", () => {
  it("é uma caixa com o rótulo, ligada por padrão", () => {
    const html = render();

    expect(typesBox(html)).toContain("checked");
    expect(html).toMatch(/<label for="cfg-tipo-cabecalho"[^>]*>Mostrar o tipo de dado no cabeçalho das colunas<\/label>/);
  });

  it("desligada pelo usuário, aparece desligada", () => {
    expect(typesBox(render({ results: { showColumnTypes: false } }))).not.toContain("checked");
  });

  it("a frase de baixo diz o que muda quando ela está desligada, e que vale nas duas grades", () => {
    expect(render()).toContain("Desligado, o cabeçalho mostra só o nome da coluna, na grade da consulta e na dos registros.");
  });
});
