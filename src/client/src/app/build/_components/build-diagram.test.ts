import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { emptyModel } from "../_lib/build-model";
import type { BuildModel } from "../_lib/build-model.schema";
import { fixture } from "../_lib/fixtures";
import { applyFix, checkModel } from "../_lib/model-check";
import { BuildDiagram, resolveDiagramConnect } from "./build-diagram";

describe("BuildDiagram: cartões HTML, ligação de colunas e correção de problemas no diagrama", () => {
  it("renderiza as tabelas do modelo em cartões HTML com botão '+ Coluna', '+ Tabela', 'Ligar colunas', 'Organizar' e problema W3", () => {
    const model = fixture<BuildModel>("build/models/manutencao.json");
    const problems = checkModel(model, {
      scope: "changes",
      baseLabel: "MES Produção / mes",
      baseEnvironment: null,
      notes: [],
    });

    const markup = renderToStaticMarkup(
      createElement(BuildDiagram, {
        model,
        problems,
        selectedTableKey: "producao.maquina",
        onSelectTable: vi.fn(),
        onChange: vi.fn(),
      }),
    );

    expect(markup).toContain(">producao.maquina<");
    expect(markup).toContain(">+ Adicionar coluna<");
    expect(markup).toContain("Tabela");
    expect(markup).toContain("Ligar colunas");
    expect(markup).toContain("Organizar");
    // O aviso/problema não é exibido dentro do cartão da tabela no diagrama quando outra tabela sem problemas está selecionada
    expect(markup).not.toContain(">W3<");

    // Ao clicar em "Ver problemas" (problemsOpen: true) ou selecionar a tabela com problema, abre o card no canto superior direito
    const markupWithProblemsCard = renderToStaticMarkup(
      createElement(BuildDiagram, {
        model,
        problems,
        selectedTableKey: "manutencao.ordem_manutencao",
        problemsOpen: true,
        onSelectTable: vi.fn(),
        onChange: vi.fn(),
      }),
    );
    expect(markupWithProblemsCard).toContain('aria-label="Problemas no diagrama"');
    expect(markupWithProblemsCard).toContain(">W3<");
    expect(markupWithProblemsCard).toContain("Criar os 5 índices");

    // Aplicar o fix de W3 (Criar os 5 índices) resolve o problema no modelo
    const w3 = problems.find((p) => p.code === "W3");
    expect(w3?.fix).toBeDefined();
    if (w3?.fix) {
      const fixedModel = applyFix(model, w3.fix);
      const ordem = fixedModel.tables.find((t) => t.name === "ordem_manutencao");
      expect(ordem?.indexes.length).toBeGreaterThan(model.tables.find((t) => t.name === "ordem_manutencao")!.indexes.length);
    }
  });

  it("resolveDiagramConnect cria FK direta para tabela com PK única e exige escolha explícita quando não há PK única", () => {
    const model: BuildModel = {
      ...emptyModel("postgresql", "public"),
      tables: [
        {
          schema: "public",
          name: "pedido",
          exactName: false,
          comment: null,
          columns: [
            { name: "id", exactName: false, type: "bigint", nullable: false, default: null, identity: null, comment: null, originName: null },
            { name: "cliente_codigo", exactName: false, type: "varchar(20)", nullable: false, default: null, identity: null, comment: null, originName: null },
          ],
          primaryKey: { name: null, columns: ["id"] },
          foreignKeys: [],
          uniques: [],
          checks: [],
          indexes: [],
          origin: null,
          dropInDatabase: false,
        },
        {
          schema: "public",
          name: "cliente_sem_pk",
          exactName: false,
          comment: null,
          columns: [
            { name: "codigo", exactName: false, type: "varchar(20)", nullable: false, default: null, identity: null, comment: null, originName: null },
            { name: "nome", exactName: false, type: "varchar(80)", nullable: false, default: null, identity: null, comment: null, originName: null },
          ],
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

    // Destino sem PK única: devolve kind="dialog" com a primeira coluna da tabela de destino pré-selecionada, sem gravar "id" às cegas
    const ambiguous = resolveDiagramConnect(model, "public.pedido", "cliente_codigo", "public.cliente_sem_pk");
    expect(ambiguous.kind).toBe("dialog");
    if (ambiguous.kind === "dialog") {
      expect(ambiguous.pending.fromKey).toBe("public.pedido");
      expect(ambiguous.pending.fk.target.table).toBe("cliente_sem_pk");
      expect(ambiguous.pending.selectedTargetCol).toBe("codigo");
    }

    // Destino com PK única (public.pedido tem PK ["id"]): cria a FK diretamente
    const direct = resolveDiagramConnect(model, "public.cliente_sem_pk", "codigo", "public.pedido");
    expect(direct.kind).toBe("model");
    if (direct.kind === "model") {
      const cliente = direct.model.tables.find((t) => t.name === "cliente_sem_pk")!;
      expect(cliente.foreignKeys).toHaveLength(1);
      expect(cliente.foreignKeys[0]!.target.columns).toEqual(["id"]);
    }
  });
});
