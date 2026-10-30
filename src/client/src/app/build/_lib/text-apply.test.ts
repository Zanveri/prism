import { describe, expect, it } from "vitest";

import { addTable } from "./build-model";
import { readCanvasModel } from "./fixtures";
import {
  applyText,
  createTextSyncController,
  printText,
  textApplyDelayMs,
} from "./text-apply";

describe("text-apply", () => {
  it("expõe textApplyDelayMs = 400 e aplica texto válido mantendo as posições do layout para as mesmas chaves", () => {
    expect(textApplyDelayMs).toBe(400);

    const model = readCanvasModel();
    const sqlText = printText(model, "sql");
    expect(sqlText).toContain("CREATE TABLE");

    const applied = applyText(model, "sql", sqlText);
    expect(applied.status.kind).toBe("applied");
    expect(applied.model).not.toBeNull();
    expect(applied.model?.layout["manutencao.ordem_manutencao"]).toEqual(
      model.layout["manutencao.ordem_manutencao"],
    );
  });

  it("devolve model: null e erro com a linha quando o texto tem erro de sintaxe", () => {
    const model = readCanvasModel();
    const res = applyText(
      model,
      "dbml",
      "Table manutencao.ordem_manutencao {\n  id bigint [pk]\n}\nRef: manutencao.ordem_manutencao.id <> producao.maquina.id\n",
    );

    expect(res.model).toBeNull();
    expect(res.status.kind).toBe("error");
    if (res.status.kind === "error") {
      expect(res.status.error.line).toBe(4);
      expect(res.status.error.message).toContain("muitos-para-muitos");
    }
  });

  it("propaga avisos W8 em status.warnings quando há construções ignoradas", () => {
    const model = readCanvasModel();
    const dbmlText = `Enum status_ordem {\n  aberta\n}\n\n${printText(model, "dbml")}`;
    const res = applyText(model, "dbml", dbmlText);

    expect(res.model).not.toBeNull();
    expect(res.status.kind).toBe("applied");
    if (res.status.kind === "applied") {
      expect(res.status.warnings.length).toBeGreaterThan(0);
      expect(res.status.warnings[0]?.line).toBe(1);
    }
  });

  it("sincroniza o documento quando o modelo muda por fora (diagrama ou desfazer) ou muda de formato, sem sobrescrever quando a mudança veio do próprio editor", () => {
    const m0 = readCanvasModel();
    const sync = createTextSyncController(m0, "dbml");
    expect(sync.initialDoc()).toContain("Table manutencao.ordem_manutencao");

    // Mudança vinda de fora (ex.: desfazer ou adicionar tabela no diagrama)
    const { model: m1 } = addTable(m0, "manutencao");
    const extUpdate = sync.receiveProps(m1, "dbml");
    expect(extUpdate.shouldReplaceDoc).toBe(true);
    expect(extUpdate.nextDoc).toContain("Table manutencao.tabela_7");

    // Edição feita dentro do próprio painel de texto não deve substituir o documento ao voltar via prop
    const editedDoc = `${extUpdate.nextDoc}\nTable manutencao.peca {\n  id bigint [pk, not null]\n}\n`;
    const applied = sync.applyEditorText(editedDoc);
    expect(applied.status.kind).toBe("applied");
    expect(applied.model).not.toBeNull();

    const selfEcho = sync.receiveProps(applied.model!, "dbml");
    expect(selfEcho.shouldReplaceDoc).toBe(false);

    // Trocar de DBML para SQL substitui o documento pelo SQL do modelo atual (preservando manutencao.peca)
    const formatSwitch = sync.receiveProps(applied.model!, "sql");
    expect(formatSwitch.shouldReplaceDoc).toBe(true);
    expect(formatSwitch.nextDoc).toContain("CREATE TABLE manutencao.peca");
  });
});
