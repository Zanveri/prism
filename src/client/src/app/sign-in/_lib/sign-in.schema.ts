import { z } from "zod";

import { signInCopy } from "./sign-in.copy";

const { validation } = signInCopy;

/** A resposta de `GET`, `POST api/public/sessions` e `POST api/public/users`. `userName` é nulo com o cofre fechado. */
export const sessionSchema = z.object({ unlocked: z.boolean(), userName: z.string().nullable() });

export type Session = z.infer<typeof sessionSchema>;

/**
 * O nome de usuário como a API grava (RN-COFRE-010): sem espaços nas pontas e em minúsculas, para a
 * tela e a API concordarem sobre o que é o mesmo usuário. A normalização vem antes das regras, ou
 * `Marina.Costa` seria recusado em vez de virar `marina.costa`.
 */
const userNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, validation.userNameMin)
  .max(32, validation.userNameMax)
  .regex(/^[a-z0-9._-]+$/, validation.userNameFormat);

/**
 * Entrar não repete as regras da criação: um usuário ou uma senha fora delas só podem ser
 * recusados pela API, com a mesma frase de qualquer outra credencial inválida (RN-COFRE-006).
 * A senha não é aparada nem alterada: espaço nas pontas faz parte dela.
 */
export const signInSchema = z.object({
  userName: z.string().trim().toLowerCase().min(1, validation.userNameRequired),
  password: z.string().min(1, validation.passwordRequired),
});

/** O que a API recebe para entrar e para criar o usuário: a confirmação da senha fica na tela. */
export type Credentials = z.infer<typeof signInSchema>;

/** `passwordConfirmation` só confere com a senha na tela: a API recebe `userName` e `password`. */
export const createUserSchema = z
  .object({
    userName: userNameSchema,
    password: z.string().min(8, validation.passwordMin).max(128, validation.passwordMax),
    passwordConfirmation: z.string(),
  })
  .refine((input) => input.passwordConfirmation === input.password, { path: ["passwordConfirmation"], message: validation.passwordMismatch });
