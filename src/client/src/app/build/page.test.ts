import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyModel } from "@/app/build/_lib/build-model";
import type { BuildModel } from "@/app/build/_lib/build-model.schema";
import { fixture } from "@/app/build/_lib/fixtures";
import {
  BuildPageView,
  exportModelSqlDdl,
  formatBuildTimestamp,
} from "@/app/build/page";
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

  it("formatBuildTimestamp formata data e hora em dd/MM/yyyy HH:mm (sem literal 'agora' ou 'hoje')", () => {
    const dt = new Date(2026, 9, 29, 14, 10);
    expect(formatBuildTimestamp(dt)).toBe("29/10/2026 14:10");
  });

  it("exportModelSqlDdl gera o DDL com cabeçalho e bloqueia quando há erro de verificação (RN-CONSTRUIR-082)", () => {
    const manutencao = fixture<BuildModel>("build/models/manutencao.json");
    const okRes = exportModelSqlDdl(manutencao, "manutencao", {
      baseLabel: "MES Produção / mes",
      generatedAt: "29/10/2026 14:32",
    });
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.sql).toContain("-- Modelo manutencao");
      expect(okRes.sql).toContain("CREATE TABLE");
    }

    const broken: BuildModel = {
      ...emptyModel("postgresql", "public"),
      tables: [
        {
          schema: "public",
          name: "sem_colunas",
          exactName: false,
          comment: null,
          columns: [],
          primaryKey: null,
          foreignKeys: [],
          uniques: [],
          checks: [],
          indexes: [],
          origin: null,
          dropInDatabase: false,
        },
      ],
    };
    const errRes = exportModelSqlDdl(broken, "quebrado");
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(errRes.error).toContain("sem_colunas");
    }
  });
});
