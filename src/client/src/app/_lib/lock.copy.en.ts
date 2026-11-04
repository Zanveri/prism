import type { LockCopy } from "./lock.copy";

export const lockCopyEn: LockCopy = {
  warning: {
    title: "Prism will lock due to inactivity.",
    countdown: (seconds: number) => `${seconds.toLocaleString("en")} s left. Move the mouse or type to continue.`,
    announcement: "Prism will lock due to inactivity in less than a minute. Move the mouse or type to continue.",
  },
  screen: {
    title: "Prism locked",
    description: {
      closing: "Due to inactivity, Prism locked this window and is closing the vault. When it finishes, enter your password to open it again.",
      retrying: "Due to inactivity, Prism locked this window but has not been able to close the vault yet. Once it does, enter your password to open it again.",
      closed: "Due to inactivity, Prism closed the vault. Enter your password to open it again.",
      gaveUp: "Due to inactivity, Prism locked this window but could not close the vault. Enter your password to continue, or sign out.",
    },
    userLabel: "Vault user",
    kept: "Your tabs and SQL text are as you left them. The results were discarded.",
    password: "Password",
    unlock: "Unlock",
    unlocking: "Unlocking…",
    signOut: "Sign out",
    signingOut: "Signing out…",
    unlockFailed: "Could not unlock. Try again.",
    signOutFailed: "Could not sign out. Try again.",
    unlockNoResponse: "The service did not respond, and it was not possible to unlock. Try again.",
    signOutNoResponse: "The service did not respond, and it was not possible to sign out. Try again.",
    closing: "Closing the vault…",
    closeRetrying: "Could not close the vault in the service; trying again.",
    closeFailed: "Could not close the vault in the service. Prism stays locked in this window, but the vault may still be open there: unlock or sign out.",
  },
};
