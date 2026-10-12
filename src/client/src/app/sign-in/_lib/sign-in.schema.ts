import { z } from "zod";

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
  .min(3, "O usuário precisa ter ao menos 3 caracteres.")
  .max(32, "O usuário pode ter no máximo 32 caracteres.")
  .regex(/^[a-z0-9._-]+$/, "Use só letras, números, ponto, hífen e sublinhado.");

/**
 * Entrar não repete as regras da criação: um usuário ou uma senha fora delas só podem ser
 * recusados pela API, com a mesma frase de qualquer outra credencial inválida (RN-COFRE-006).
 * A senha não é aparada nem alterada: espaço nas pontas faz parte dela.
 */
export const signInSchema = z.object({
  userName: z.string().trim().toLowerCase().min(1, "Informe o usuário."),
  password: z.string().min(1, "Informe a senha."),
});

/** O que a API recebe para entrar e para criar o usuário: a confirmação da senha fica na tela. */
export type Credentials = z.infer<typeof signInSchema>;

/** `passwordConfirmation` só confere com a senha na tela: a API recebe `userName` e `password`. */
export const createUserSchema = z
  .object({
    userName: userNameSchema,
    password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres.").max(128, "A senha pode ter no máximo 128 caracteres."),
    passwordConfirmation: z.string(),
  })
  .refine((input) => input.passwordConfirmation === input.password, { path: ["passwordConfirmation"], message: "As senhas não conferem." });
