import { describe, expect, it } from "vitest";

import {
  AUDIT_NO_ENVIRONMENT,
  defaultAuditFilters,
  isHighAndCriticalSelected,
  toggleHighAndCritical,
  toAuditQuery,
  toUtcRange,
} from "./audit-filters";

describe("filtros da Auditoria (RN-AUDIT-011)", () => {
  it("começa com 7 dias e todos os demais filtros vazios", () => {
    const filters = defaultAuditFilters();

    expect(filters).toEqual({
      period: "7d",
      customRange: { from: "", to: "" },
      connectionIds: [],
      environments: [],
      levels: [],
      kinds: [],
      outcomes: [],
      q: "",
      scriptRunId: null,
    });
  });

  it("toUtcRange_convertsLocalBoundsAcrossDst: converte limites locais para UTC respeitando o fuso de cada ponta", () => {
    const now = new Date("2026-10-30T15:00:00.000Z");
    const fromLocal = "2026-03-08T01:00";
    const toLocal = "2026-11-01T23:30";

    const range = toUtcRange("custom", { from: fromLocal, to: toLocal }, now);

    expect(range.from).toBe(new Date(fromLocal).toISOString());
    expect(range.to).toBe(new Date(toLocal).toISOString());
    expect(range.from).toMatch(/Z$/);
    expect(range.to).toMatch(/Z$/);

    const sevenDays = toUtcRange("7d", { from: "", to: "" }, now);
    expect(sevenDays.from).toBe("2026-10-23T15:00:00.000Z");
    expect(sevenDays.to).toBeUndefined();

    const all = toUtcRange("all", { from: "", to: "" }, now);
    expect(all).toEqual({});
  });

  it("toAuditQuery serializa cada filtro repetindo as chaves de escolha múltipla e mapeando 'Sem ambiente'", () => {
    const now = new Date("2026-10-30T15:00:00.000Z");
    const params = toAuditQuery(
      {
        period: "7d",
        customRange: { from: "", to: "" },
        connectionIds: ["conn-1", "conn-2"],
        environments: ["Produção", AUDIT_NO_ENVIRONMENT],
        levels: ["high", "critical"],
        kinds: ["sql", "security"],
        outcomes: ["ok", "refused"],
        q: "  apontamento  ",
        scriptRunId: "99999999-9999-4999-8999-999999999999",
      },
      { now, before: 48000, limit: 200 },
    );

    expect(params.get("from")).toBe("2026-10-23T15:00:00.000Z");
    expect(params.getAll("connectionId")).toEqual(["conn-1", "conn-2"]);
    expect(params.getAll("environment")).toEqual(["Produção", "__none__"]);
    expect(params.getAll("level")).toEqual(["high", "critical"]);
    expect(params.getAll("kind")).toEqual(["sql", "security"]);
    expect(params.getAll("outcome")).toEqual(["ok", "refused"]);
    expect(params.get("q")).toBe("apontamento");
    expect(params.get("scriptRunId")).toBe("99999999-9999-4999-8999-999999999999");
    expect(params.get("before")).toBe("48000");
    expect(params.get("limit")).toBe("200");
  });

  it("o atalho 'Alto e Crítico' liga os dois níveis e desliga quando ambos já estão ativos", () => {
    expect(isHighAndCriticalSelected([])).toBe(false);
    expect(isHighAndCriticalSelected(["high"])).toBe(false);

    const enabled = toggleHighAndCritical([]);
    expect(enabled).toEqual(["high", "critical"]);
    expect(isHighAndCriticalSelected(enabled)).toBe(true);

    const toggledFromPartial = toggleHighAndCritical(["info", "high"]);
    expect(toggledFromPartial).toEqual(["high", "critical"]);

    const disabled = toggleHighAndCritical(["high", "critical"]);
    expect(disabled).toEqual([]);
  });
});
