import type { UpdateMessagesCopy } from "./update-messages.copy";

export const updateMessagesCopyEn: UpdateMessagesCopy = {
  updater: {
    changed: "The update file changed after it was verified.",
    serviceIsBack: ' Use "Restart" to bring the service back.',
    serviceStoppedForInstall: " The Prism service was stopped for the installation.",
    packageKept: ' The downloaded package is still kept: "Try again" verifies it again, without downloading it again.',
    reopenToUpdate: " To update, close Prism and open it again.",
    downloadAgain: " Download the update again.",
    dataFolderRefused: (code: string) => `The system did not allow writing to the Prism data folder (${code}).`,
    notJson: "The server's response is not the list of versions (it is not JSON).",
    notReleaseList: "The server's response is not the list of versions.",
    diskWriteFailed: "Prism could not write the update to disk.",
    removed: "It was deleted.",
    notRemoved: "Prism could not delete it now: it will not be used, and it is removed the next time Prism opens.",
    noPackage: "There is no package of this version for this computer's system and architecture.",
    verifiedFileGone: (note: string) => `The verified file is no longer where Prism left it.${note} Download the update again.`,
    stopTimedOut: "The Prism service did not shut down in time, so the installer was not started.",
    stopFailed: "The Prism service did not shut down, so the installer was not started.",
    installerFailed: (cause: string) => `Could not start the installer (${cause}).`,
    deliverFailed: (cause: string) => `Could not place the package in the downloads folder (${cause}).`,
  },

  sums: {
    notesMissing: (fileName: string) => `The release notes do not include the SHA-256 checksum of ${fileName}. Without both checksums Prism does not install the update.`,
    fileMissing: (fileName: string) => `The release's SHA256SUMS does not include the checksum of ${fileName}. Without both checksums Prism does not install the update.`,
    mismatchBoth: (fileName: string) => `The downloaded file (${fileName}) matches neither the SHA-256 checksum in the release notes nor the one in SHA256SUMS.`,
    mismatchNotes: (fileName: string) => `The downloaded file (${fileName}) does not match the SHA-256 checksum in the release notes.`,
    mismatchFile: (fileName: string) => `The downloaded file (${fileName}) does not match the SHA-256 checksum in the release's SHA256SUMS.`,
  },

  download: {
    invalidSize: "The server declared an invalid size for the response.",
    tooLarge: (kilobytes: number) => `The response is too large: it exceeds the ${kilobytes.toLocaleString("en")} kB limit that Prism accepts.`,
    redirectNotFollowed: "The server responded with a redirect that Prism does not follow (only to https, and at most five in a row).",
    redirectInQuery: "The server responded with a redirect, and the version check does not follow redirects.",
    status: (status: number) => `The server responded ${status}.`,
    packageStatus: (status: number) => `The server responded ${status} to the package request.`,
    canceled: "Download canceled.",
    timedOut: (seconds: number) => `The server did not respond within ${seconds.toLocaleString("en")} s.`,
    stalled: (seconds: number) => `The server stopped responding: no data arrived within ${seconds.toLocaleString("en")} s.`,
    moreThanDeclared: "The server sent more than the declared size of the package.",
    lessThanDeclared: "The download ended before the declared size of the package.",
  },

  install: {
    noFreeName: "The downloads folder already has a hundred files with the package's name.",
  },

  releases: {
    notesCut: "The notes of this version were cut here: they are longer than Prism shows.",
  },
};
