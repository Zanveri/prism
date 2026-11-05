import type { AutoRefreshCopy } from "./auto-refresh.copy";

export const autoRefreshCopyEn: AutoRefreshCopy = {
  menu: {
    label: "Refresh automatically",
    every: (interval: string) => `Every ${interval}`,
    custom: "Custom…",
    customChosen: (interval: string) => `Custom (${interval})…`,
    off: "Turn off",
    notApplicable: (reason: string) => `Not applicable: ${reason}.`,
  },

  reasons: {
    busy: "a statement is running in the tab",
    writes: "the statement writes to the database, and only a read refreshes itself",
    noRows: "there are no rows from a read on screen",
    disconnected: "the tab is not connected; use Refresh (F5) to connect",
  },

  bar: {
    button: "Refresh automatically",
    unavailable: (reason: string) => `Refresh automatically. Not applicable: ${reason}.`,
    group: "Automatic refresh",
    every: (interval: string) => `Refreshes every ${interval}`,
    last: (time: string) => `last at ${time}`,
    running: "refreshing…",
    paused: "paused while the grid is in use",
    change: "Change the automatic refresh interval",
    off: "Turn off automatic refresh",
  },

  stopped: {
    failed: "Automatic refresh stopped: the statement failed.",
    cancelled: "Automatic refresh stopped: the statement was cancelled.",
    notRun: "Automatic refresh stopped: the statement could not be run.",
    writes: "Automatic refresh stopped: the statement wrote to the database.",
    disconnected: "Automatic refresh stopped: the database session dropped.",
  },

  dialog: {
    title: "Refresh automatically",
    description: "The result’s statement is run again at each interval, while the result is in view. The interval ranges from 1 to 3,600 seconds (1 hour).",
    seconds: "Interval in seconds",
    invalid: "Use a whole number of seconds, from 1 to 3,600.",
    submit: "Turn on",
    cancel: "Cancel",
  },
};
