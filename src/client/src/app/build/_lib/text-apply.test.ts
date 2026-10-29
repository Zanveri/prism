import { describe, expect, it } from "vitest";

import { readCanvasModel } from "./fixtures";
import { applyText, printText, textApplyDelayMs } from "./text-apply";

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
});
