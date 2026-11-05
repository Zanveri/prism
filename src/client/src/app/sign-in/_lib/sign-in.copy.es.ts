import type { SignInCopy } from "./sign-in.copy";

export const signInCopyEs: SignInCopy = {
  brand: {
    title: "Abre, conecta, consulta.",
    illustration: "Un haz de luz entra en el prisma y sale en tres franjas de color, cada una llegando a una base de datos",
  },
  subtitle: "Cada usuario tiene su propia caja fuerte de conexiones.",
  signIn: {
    title: "Iniciar sesión",
    userName: "Usuario",
    password: "Contraseña",
    submit: "Iniciar sesión",
    submitting: "Iniciando sesión…",
    invalidCredentials: "Usuario o contraseña no válidos.",
    vaultFormatUnsupported: "Esta caja fuerte fue creada por una versión más reciente de Prism. Actualiza Prism para abrirla.",
    toCreate: { question: "¿Primer acceso?", action: "Crear usuario" },
  },
  createUser: {
    title: "Crear usuario",
    userName: "Usuario",
    password: "Contraseña",
    passwordConfirmation: "Confirmar contraseña",
    submit: "Crear usuario",
    submitting: "Creando…",
    created: "Usuario creado.",
    userAlreadyExists: "Ya existe un usuario con ese nombre.",
    toSignIn: { question: "¿Ya tienes usuario?", action: "Iniciar sesión" },
  },
  vaultNotice: "Tu contraseña no se almacena. Genera la clave que abre tu caja fuerte: si la olvidas, las conexiones guardadas no se pueden recuperar.",
  validation: {
    userNameMin: "El usuario debe tener al menos 3 caracteres.",
    userNameMax: "El usuario puede tener como máximo 32 caracteres.",
    userNameFormat: "Usa solo letras, números, punto, guion y guion bajo.",
    userNameRequired: "Indica el usuario.",
    passwordRequired: "Indica la contraseña.",
    passwordMin: "La contraseña debe tener al menos 8 caracteres.",
    passwordMax: "La contraseña puede tener como máximo 128 caracteres.",
    passwordMismatch: "Las contraseñas no coinciden.",
  },
};
