import { describe, expect, it } from "vitest";

import type { SavedWorkspace } from "../../../../electron/workspace-messages";
import { createWorkspaceReporter, workspaceReportDelayMs } from "./workspace-reporter";

const workspace = (sql: string): SavedWorkspace => ({ tabs: [{ kind: "query", connectionID: null, database: null, sql, scriptID: null, dirty: false, sqlTooLarge: false }], activeIndex: 0 });

function setup() {
  const sent: { workspace: SavedWorkspace; urgent: boolean }[] = [];
  let current = workspace("SELECT 1");
  let timers: { run: () => void }[] = [];

  const reporter = createWorkspaceReporter({
    read: () => current,
    send: (snapshot, urgent) => void sent.push({ workspace: snapshot, urgent }),
    schedule(run, ms) {
      expect(ms).toBe(workspaceReportDelayMs);
      const timer = { run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  });

  function fire() {
    const due = timers;
    timers = [];
    for (const timer of due) timer.run();
  }

  return { reporter, sent, fire, set: (sql: string) => (current = workspace(sql)), pending: () => timers.length };
}

describe("o que a janela conta das abas dela ao processo principal (RN-ABAS-006)", () => {
  it("nada sai antes de começar (a janela principal ainda reabre as abas gravadas); ao começar, conta o que tem", () => {
    const { reporter, sent, fire } = setup();

    reporter.touch();
    reporter.urgent();
    fire();
    expect(sent).toEqual([]);

    reporter.start();
    expect(sent).toEqual([{ workspace: workspace("SELECT 1"), urgent: false }]);
  });

  it("depois de uma mudança espera um pouco e conta o estado daquele instante; várias mudanças seguidas são um relato só", () => {
    const { reporter, sent, fire, set, pending } = setup();
    reporter.start();
    sent.length = 0;

    set("SELECT 12");
    reporter.touch();
    set("SELECT 123");
    reporter.touch();
    expect(pending()).toBe(1);
    expect(sent).toEqual([]);

    fire();
    expect(sent).toEqual([{ workspace: workspace("SELECT 123"), urgent: false }]);
  });

  it("o que não mudou não é contado de novo", () => {
    const { reporter, sent, fire } = setup();
    reporter.start();

    reporter.touch();
    fire();

    expect(sent).toHaveLength(1);
  });

  it("a aba que fecha é contada na hora, com urgência, e leva junto a mudança que esperava", () => {
    const { reporter, sent, set, pending } = setup();
    reporter.start();
    set("SELECT 2");
    reporter.touch();

    reporter.urgent();

    expect(sent.at(-1)).toEqual({ workspace: workspace("SELECT 2"), urgent: true });
    expect(pending()).toBe(0);
  });

  it("parado (a área de trabalho desmontou), não conta mais nada", () => {
    const { reporter, sent, fire, set } = setup();
    reporter.start();
    set("SELECT 2");
    reporter.touch();

    reporter.stop();
    fire();
    reporter.urgent();

    expect(sent).toHaveLength(1);
  });

  it("um relato que lança não para os seguintes", () => {
    let calls = 0;
    const reporter = createWorkspaceReporter({
      read: () => {
        calls++;
        if (calls === 1) throw new Error("editor sumiu");
        return workspace("SELECT 1");
      },
      send: () => {},
      schedule: () => () => {},
    });

    expect(() => reporter.start()).not.toThrow();
    expect(() => reporter.urgent()).not.toThrow();
    expect(calls).toBe(2);
  });
});
