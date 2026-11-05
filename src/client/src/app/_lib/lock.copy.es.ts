import type { LockCopy } from "./lock.copy";

export const lockCopyEs: LockCopy = {
  warning: {
    title: "Prism se bloqueará por inactividad.",
    countdown: (seconds: number) => `Faltan ${seconds.toLocaleString("es")} s. Mueve el ratón o escribe para continuar.`,
    announcement: "Prism se bloqueará por inactividad en menos de un minuto. Mueve el ratón o escribe para continuar.",
  },
  screen: {
    title: "Prism bloqueado",
    description: {
      closing: "Por inactividad, Prism bloqueó esta ventana y está cerrando la caja fuerte. Cuando termine, escribe tu contraseña para abrirla de nuevo.",
      retrying: "Por inactividad, Prism bloqueó esta ventana, pero aún no ha podido cerrar la caja fuerte. Cuando lo consiga, escribe tu contraseña para abrirla de nuevo.",
      closed: "Por inactividad, Prism cerró la caja fuerte. Escribe tu contraseña para abrirla de nuevo.",
      gaveUp: "Por inactividad, Prism bloqueó esta ventana, pero no pudo cerrar la caja fuerte. Escribe tu contraseña para continuar, o cierra sesión.",
    },
    userLabel: "Usuario de la caja fuerte",
    kept: "Tus pestañas y el texto SQL siguen como estaban. Los resultados se descartaron.",
    password: "Contraseña",
    unlock: "Desbloquear",
    unlocking: "Desbloqueando…",
    signOut: "Cerrar sesión",
    signingOut: "Cerrando sesión…",
    unlockFailed: "No se pudo desbloquear. Inténtalo de nuevo.",
    signOutFailed: "No se pudo cerrar la sesión. Inténtalo de nuevo.",
    unlockNoResponse: "El servicio no respondió y no se pudo desbloquear. Inténtalo de nuevo.",
    signOutNoResponse: "El servicio no respondió y no se pudo cerrar la sesión. Inténtalo de nuevo.",
    closing: "Cerrando la caja fuerte…",
    closeRetrying: "No se pudo cerrar la caja fuerte en el servicio; intentándolo de nuevo.",
    closeFailed: "No se pudo cerrar la caja fuerte en el servicio. Prism sigue bloqueado en esta ventana, pero la caja fuerte puede seguir abierta allí: desbloquea o cierra sesión.",
  },
};
