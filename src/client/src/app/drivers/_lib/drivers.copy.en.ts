import type { DriversCopy } from "./drivers.copy";

export const driversCopyEn: DriversCopy = {
  title: "Drivers",
  subtitle: "Prism ships only the PostgreSQL driver. You download the drivers for the other databases when you need them, accepting the vendor's license.",
  loading: "Loading drivers…",
  loadFailed: "Could not load the drivers.",
  retry: "Try again",
  stalled: { message: "The driver list stopped updating.", action: "Refresh the list" },
  empty: { title: "No drivers in the list.", hint: "Close and reopen Prism. If it stays this way, the API did not return the driver catalog." },

  groups: {
    installed: "Installed and bundled",
    available: "Available to download",
    unavailable: "No driver for this platform",
    comingSoon: "Coming soon",
  },

  states: {
    bundled: "Bundled",
    installed: "Installed",
    available: "Available",
    installing: "Downloading…",
    installingPercent: (percent: number) => `Downloading… ${percent}%`,
    failed: "Failed",
    unavailable: "No driver for this platform",
    comingSoon: "Coming soon",
  },

  row: {
    version: (version: string) => `Version ${version}`,
    restartPending: "Restart pending",
    progress: (name: string) => `Download progress of the ${name} driver`,
    progressOf: (received: string, total: string) => `${received} of ${total}`,
    failedBecause: "Cause:",
    failedWithoutDetail: "The API did not give a cause.",
    install: "Download",
    retry: "Try again",
    cancel: "Cancel",
    cancelling: "Canceling…",
    remove: "Remove",
    installLabel: (name: string) => `Download the ${name} driver`,
    retryLabel: (name: string) => `Retry the download of the ${name} driver`,
    cancelLabel: (name: string) => `Cancel the download of the ${name} driver`,
    removeLabel: (name: string) => `Remove the ${name} driver`,
  },

  install: {
    title: (name: string) => `Download the ${name} driver`,
    description: "Prism downloads the driver from nuget.org, checks its hash and saves it on your machine. Read the vendor's license before accepting.",
    vendor: "Vendor",
    license: "License",
    licenseUrl: "Official license text",
    licenseUrlHint: "Prism does not open links. Copy the address and read the text in your browser.",
    noLicense: "The catalog did not return a license text that Prism can show (its address must start with https://), so this driver cannot be installed.",
    copyLink: "Copy link",
    size: "Download size",
    restartNotice: "After installing, Prism restarts the service and asks for your password again. Open SQL tabs will be closed.",
    accept: "I have read and accept the vendor's license",
    cancel: "Cancel",
    submit: "Download and install",
    submitting: "Starting…",
  },

  restart: {
    title: "Restart required",
    description: "Driver installed. Prism will restart the service and ask for your password again. Open SQL tabs will be closed.",
    removedDescription: "Driver removed. Prism will restart the service and ask for your password again. Open SQL tabs will be closed.",
    submit: "Restart now",
    later: "Later",
    banner: "Prism needs to restart the service to apply the driver change. It asks for your password again, and open SQL tabs will be closed.",
    bannerAction: "Restart now",
    topBarBadge: "Restart pending",
    topBarHint: "A driver is waiting for the service to restart to take effect. Opens Settings › Drivers.",
  },

  removeConfirm: {
    title: "Remove driver",
    description: (name: string) =>
      `The ${name} driver will be removed from your machine. The removal takes effect when Prism restarts the service (it asks for your password again, and open SQL tabs will be closed), and the connections that depend on it will no longer open.`,
    submit: "Remove driver",
    submitting: "Removing…",
  },

  toasts: {
    installStarted: (name: string) => `Download of the ${name} driver started.`,
    installFailed: (name: string) => `The download of the ${name} driver failed.`,
    cancelled: (name: string) => `Download of the ${name} driver canceled.`,
    removed: (name: string) => `${name} driver removed.`,
    inUse: "Close the connections to that database before removing the driver.",
    linkCopied: "Link copied.",
    linkNotCopied: "Could not copy. Select the address and copy it with Ctrl+C.",
  },

  installDriver: "Install driver",
};
