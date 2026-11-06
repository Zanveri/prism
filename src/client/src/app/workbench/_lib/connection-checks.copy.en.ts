import { formatElapsed } from "@/lib/utils/format";

import { clockOf } from "./connection-checks.clock";
import type { ConnectionChecksCopy } from "./connection-checks.copy";

export const connectionChecksCopyEn: ConnectionChecksCopy = {
  state: {
    waiting: "Connected, not yet checked",
    ok: "Responded on the last check",
    failed: "Did not respond",
    notConnected: "No open session",
  },
  tip: {
    waiting: "Connected. The first check comes after its interval.",
    ok: (checkedAt: string, elapsedMs: number) => `Responded at ${clockOf(checkedAt)}, in ${formatElapsed(elapsedMs)}`,
    failed: (checkedAt: string, message: string, sqlState: string | null) => `Did not respond at ${clockOf(checkedAt)}${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}:\n${message}`,
    notConnected: "No open session: the next action in the tree or in the tab opens the session again.",
    busy: "Busy: checked on the next one",
  },
  failure: {
    open: (connection: string) => `See why ${connection} did not respond`,
    title: (connection: string) => `${connection} did not respond to the check`,
    when: (checkedAt: string, elapsedMs: number | null) => `At ${clockOf(checkedAt)}${elapsedMs === null ? "" : `, after ${formatElapsed(elapsedMs)}`}. The message is the database’s, as it came.`,
    sqlState: "SQLSTATE",
    hint: "Prism does not reconnect on its own: the next check tries again at its interval, and “Disconnect” and “Connect” open another session.",
    close: "Close",
  },
  toasts: {
    failed: (connection: string) => `${connection} did not respond to the check`,
    recovered: (connection: string) => `${connection} is responding to the check again`,
  },
};
