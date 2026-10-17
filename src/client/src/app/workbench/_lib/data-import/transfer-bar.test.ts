import { describe, expect, it } from "vitest";

import type { TrackedExport } from "../data-export/transfer-tracker";
import type { TrackedLoad } from "./load-tracker";
import { barEntries, featuredBarEntry, othersKind } from "./transfer-bar";

const exported = (id: string, seq: number, stage: TrackedExport["stage"] = "running") => ({ id, seq, stage }) as TrackedExport;
const loaded = (id: string, seq: number, kind: TrackedLoad["kind"] = "import", stage: TrackedLoad["stage"] = "running") => ({ id, seq, kind, stage }) as TrackedLoad;

describe("as transferências da janela na barra de status (RN-EXPORT-021 e RN-IMPORT-019)", () => {
  it("juntas, na ordem em que começaram; a barra mostra a mais antiga", () => {
    const entries = barEntries([exported("e2", 2)], [loaded("i3", 3), loaded("c1", 1, "copy")]);
    expect(entries.map((bar) => bar.entry.id)).toEqual(["c1", "e2", "i3"]);
    expect(featuredBarEntry(entries)?.entry.id).toBe("c1");
    expect(featuredBarEntry([])).toBeNull();
  });

  it("a que pede ação vem antes: a entrega que falhou e a importação que parou, a mais antiga delas", () => {
    expect(featuredBarEntry(barEntries([exported("e1", 1), exported("e4", 4, "deliveryFailed")], [loaded("i2", 2), loaded("i3", 3, "import", "failed")]))?.entry.id).toBe("i3");
    expect(featuredBarEntry(barEntries([exported("e2", 2, "deliveryFailed")], [loaded("i1", 1), loaded("i3", 3, "import", "failed")]))?.entry.id).toBe("e2");
  });

  it("o botão diz o tipo das outras: o único, ou transferências misturadas", () => {
    const [first, ...rest] = barEntries([exported("e1", 1), exported("e2", 2)], [loaded("i3", 3), loaded("c4", 4, "copy")]);
    expect(first.entry.id).toBe("e1");
    expect(othersKind(rest)).toBe("mixed");
    expect(othersKind(rest.filter((bar) => bar.kind === "export"))).toBe("export");
    expect(othersKind(rest.filter((bar) => bar.kind === "import"))).toBe("import");
    expect(othersKind(rest.filter((bar) => bar.kind === "copy"))).toBe("copy");
  });
});
