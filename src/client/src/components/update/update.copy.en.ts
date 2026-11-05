import type { UpdateCopy } from "./update.copy";

export const updateCopyEn: UpdateCopy = {
  check: "Check for updates",
  checking: "Checking…",
  version: (version: string) => `version ${version}`,

  toasts: {
    upToDate: "Prism is up to date.",
    upToDateDetail: (version: string) => `The installed version, ${version}, is the latest.`,
    upToDateWithoutPackage: (version: string, newer: string) => `The installed version, ${version}, is the latest that has a package for this system. Version ${newer} was released without one; Prism will offer the next one that has it.`,
    noSource: "This Prism does not look for updates.",
    noSourceDetail: "It was built without an update source (development package or hand-built).",
    checkFailed: "Could not check for updates.",
    busy: "An update is in progress.",
    blocked: "Updates are turned off in this session.",
    blockedDetail: "Prism was opened with a command-line argument that skips the certificate check or changes the server addresses. Open Prism without that argument to update.",
    requestFailed: "The update could not continue.",
  },

  dialog: {
    title: "New version of Prism",
    installed: "Installed version",
    latest: "New version",
    releasedOn: (date: string) => `from ${date}`,
    notesOf: (version: string) => `Version ${version}`,
    noNotes: "This version has no notes.",
    omitted: (count: number) => (count === 1 ? "1 more earlier version is not shown in this list." : `${count} more earlier versions are not shown in this list.`),
    sums: "Checksums",
    noSums: "The notes for this version have no SHA-256 checksums: Prism does not install an update without them.",
    trust: "The update is downloaded from the project's GitHub releases and verified by two SHA-256 checksums, and a published release cannot be replaced. The packages are not yet signed by an identified developer.",
    noStartupCheck: "Do not check on startup",

    update: "Update now",
    later: "Later",
    skip: "Skip this version",
    cancel: "Cancel",
    retry: "Try again",
    close: "Close",
    install: "Install now",
    reveal: "Show in downloads folder",

    next: {
      nsis: "After downloading and verifying, Prism closes, installs the new version and opens again. The text of open SQL tabs is not saved.",
      nsisForAll: "Prism is installed for all users: after downloading and verifying, it closes and Windows asks for administrator permission. With it, the new version is installed and Prism opens again. Without it, nothing changes, and it opens on the current version. The text of open SQL tabs is not saved.",
      manual: "Prism downloads and verifies the package and, when you say so, places it in your downloads folder and shows it. You do the installation.",
      unavailable: "There is no package of this version for this computer's system and architecture.",
    },

    downloading: "Downloading the update…",
    downloadProgress: "Update download progress",
    received: (received: string) => `${received} received`,
    receivedOf: (received: string, total: string) => `${received} of ${total}`,

    ready: "Update downloaded and verified.",
    readyNsis: "Prism will close to install the new version and open again.",
    readyManual: "The package still has to be placed in your downloads folder: use the button below.",

    installing: "Installing the new version.",
    installingDetail: "Prism will close and open again by itself. There is nothing to do.",
    installingDetailForAll: "Prism will close, and Windows will ask for administrator permission. With it, the new version is installed and Prism opens again.",

    failed: "The update was not completed.",

    delivered: (fileName: string) => `The verified package is in your downloads folder: ${fileName}`,
  },

  notice: {
    title: (version: string) => `Version ${version} was not installed.`,
    forAll: (current: string) => `Prism is still on version ${current}. It is installed for all users, and the update needs Windows administrator permission. To try again, use “Check for updates”.`,
    forMe: (current: string) => `Prism is still on version ${current}. The installer finished without updating it. To try again, use “Check for updates”.`,
  },

  beta: {
    label: "Receive beta versions",
    hint: "A beta version is released with every change accepted in the project, before the stable one, and may have defects. When off, Prism offers only stable versions. Turning it on or off applies from the next check and installs nothing.",
    badge: "beta",
    offered: "(beta)",
    warning: "Beta version: it arrives before the stable one and may have defects.",
    warningDetail: "To receive only stable versions, turn off “Receive beta versions” in Settings › Updates.",
    macHint: "On macOS betas have no package: updates arrive through stable versions, and turning this option on does not change what Prism offers here.",
  },

  instructions: {
    AppImage: "Close Prism, make the file executable and open it in place of the old AppImage.",
    deb: "Close Prism and install the package with the system package manager (for example, sudo apt install ./ followed by the file name).",
    rpm: "Close Prism and install the package with the system package manager (for example, sudo dnf install ./ followed by the file name).",
    "tar.gz": "Close Prism and extract the file over the folder where Prism is.",
    dmg: "Close Prism, open the file and drag Prism to the Applications folder, replacing the current one.",
    zip: "Close Prism and extract the file over the folder where Prism is.",
    nsis: "Close Prism and open the installer.",
  },
};
