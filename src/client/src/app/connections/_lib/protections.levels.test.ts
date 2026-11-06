import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { isIrreversible } from "./protections";

type LevelCase = {
  name: string;
  sql: string;
  engine: "postgresql" | "db2" | "informix";
  level: "info" | "warning" | "high" | "critical";
  reason: string;
  action: string;
  clientSkip?: boolean;
};

type LevelsFixture = {
  rule: string;
  cases: LevelCase[];
};

const engineOf: Record<LevelCase["engine"], Engine> = {
  postgresql: 1,
  db2: 2,
  informix: 3,
};

const fixturePath = new URL("../../../../../../src/test-fixtures/audit/levels.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as LevelsFixture;

describe("o leitor de irreversível concorda com a fixture no nível crítico (RN-AUDIT-008)", () => {
  it.each(fixture.cases.filter((item) => !item.clientSkip))("$name", (item) => {
    expect(isIrreversible(item.sql, engineOf[item.engine])).toBe(item.level === "critical");
  });
});
