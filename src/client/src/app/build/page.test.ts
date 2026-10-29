import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildModel } from "@/app/build/_lib/build-model.schema";
import { fixture } from "@/app/build/_lib/fixtures";
import { BuildPageView } from "@/app/build/page";
import { stripTags } from "@/lib/testing/text";

describe("BuildPage", () => {
  it("sem modelo aberto mostra a lista Modelos com 'Novo modelo' e 'Abrir arquivo .sql ou .dbml'", () => {
    const html = renderToStaticMarkup(
      createElement(BuildPageView, {
        userName: "marina.costa",
        sidebarHidden: false,
        savedModels: [
          {
            id: "0199c3a0-0000-7000-8000-000000000001",
            name: "manutencao",
            engine: "postgresql",
            model: fixture<BuildModel>("build/models/manutencao.json"),
            updatedAt: "hoje, 14:32",
          },
        ],
        openTabs: [],
        activeModelId: null,
        connectionName: () => "MES Produção",
        connectionEnvironment: () => "production",
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("Nenhum modelo aberto.");
    expect(text).toContain("Modelos");
    expect(text).toContain("Novo modelo");
    expect(text).toContain("Abrir arquivo .sql ou .dbml");
    expect(text).toContain("manutencao");
    expect(text).toContain("3 novas · 3 existentes, 1 alterada");
  });

  it("com o modelo do canvas aberto mostra os grupos na barra lateral e o resumo no rodapé", () => {
    const manutencao = fixture<BuildModel>("build/models/manutencao.json");
    const html = renderToStaticMarkup(
      createElement(BuildPageView, {
        userName: "marina.costa",
        sidebarHidden: false,
        savedModels: [
          {
            id: "0199c3a0-0000-7000-8000-000000000001",
            name: "manutencao",
            engine: "postgresql",
            model: manutencao,
            updatedAt: "hoje, 14:32",
          },
        ],
        openTabs: ["0199c3a0-0000-7000-8000-000000000001"],
        activeModelId: "0199c3a0-0000-7000-8000-000000000001",
        connectionName: () => "MES Produção",
        connectionEnvironment: () => "production",
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("manutencao");
    expect(text).toContain("novo esquema");
    expect(text).toContain("producao");
    expect(text).toContain("existente");
    expect(text).toContain("maquina");
    expect(text).toContain("alterada");
    expect(text).toContain(
      "3 novas · 3 existentes, 1 alterada · 6 relações · 2 índices",
    );
  });
});
