import type { SignInCopy } from "./sign-in.copy";

export const signInCopyEn: SignInCopy = {
  brand: {
    title: "Open, connect, query.",
    illustration: "A beam of light enters the prism and leaves as three bands of color, each one reaching a database",
  },
  subtitle: "Each user has their own connection vault.",
  signIn: {
    title: "Sign in",
    userName: "User",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    invalidCredentials: "Invalid user or password.",
    vaultFormatUnsupported: "This vault was created by a newer version of Prism. Update Prism to open it.",
    toCreate: { question: "First time here?", action: "Create user" },
  },
  createUser: {
    title: "Create user",
    userName: "User",
    password: "Password",
    passwordConfirmation: "Confirm password",
    submit: "Create user",
    submitting: "Creating…",
    created: "User created.",
    userAlreadyExists: "A user with this name already exists.",
    toSignIn: { question: "Already have a user?", action: "Sign in" },
  },
  vaultNotice: "Your password is not stored. It generates the key that opens your vault: if you forget it, the saved connections cannot be recovered.",
  validation: {
    userNameMin: "The user name must have at least 3 characters.",
    userNameMax: "The user name can have at most 32 characters.",
    userNameFormat: "Use only letters, numbers, dot, hyphen and underscore.",
    userNameRequired: "Enter the user name.",
    passwordRequired: "Enter the password.",
    passwordMin: "The password must have at least 8 characters.",
    passwordMax: "The password can have at most 128 characters.",
    passwordMismatch: "The passwords do not match.",
  },
};
