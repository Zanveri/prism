import { z } from "zod";

import type { ApiResult } from "@/lib/api/prism-api";
import type { FieldErrors, ParsedForm } from "@/lib/utils/form";

import type { PasswordChange } from "./account.service";
import { settingsCopy } from "./settings.copy";

const copy = settingsCopy.account;

/** Os campos do formulário, pelo `name`: a ordem é a da tela, e é a do foco quando mais de um é recusado. */
export type PasswordField = "currentPassword" | "newPassword" | "newPasswordConfirmation";

/** Os três campos de senha, na ordem da tela. */
export const passwordFields: readonly PasswordField[] = ["currentPassword", "newPassword", "newPasswordConfirmation"];

/**
 * O formulário de trocar a senha (RN-COFRE-013). A senha atual só se pede: o que ela é, só a API sabe (qualquer texto é uma senha, certa ou errada), e
 * por isso nenhuma regra de formato cai nela. A nova segue as regras da criação de conta (RN-COFRE-010: de 8 a 128 caracteres, sem regra de
 * composição). A confirmação só confere com a nova, na tela: a API recebe a senha atual e a nova. Nenhuma senha é aparada nem alterada: o espaço
 * nas pontas faz parte dela.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, copy.currentRequired),
    newPassword: z.string().min(8, copy.newTooShort).max(128, copy.newTooLong),
    newPasswordConfirmation: z.string(),
  })
  .refine((input) => input.newPasswordConfirmation === input.newPassword, { path: ["newPasswordConfirmation"], message: copy.confirmationMismatch });

/** O que o formulário faz com uma recusa da API: a mensagem no campo dela, os campos que voltam vazios e para onde vai o foco. */
export type Refusal = { errors: FieldErrors; clear: PasswordField[]; focus: PasswordField };

/**
 * As recusas que o formulário mostra no próprio lugar, cada uma no campo que a API nomeia (RN-COFRE-013). A senha recusada não fica na tela: volta vazia
 * a que foi recusada, e o que a recusa não toca fica. Senha atual errada não esvazia as novas (não foram elas as erradas), e nova inválida ou igual à
 * atual não esvazia a atual (já conferiu, ou ainda nem foi conferida). `null` para qualquer outra falha: não é de campo nenhum, e vai ao aviso central
 * (o quinto erro seguido, `VAULT_LOCKED`, fecha o cofre e o formulário nem chega a mostrar nada).
 */
export function refusalFields(code: string): Refusal | null {
  switch (code) {
    case "INVALID_PASSWORD":
      return { errors: { currentPassword: copy.invalidCurrent }, clear: ["currentPassword"], focus: "currentPassword" };
    case "PASSWORD_INVALID":
      return { errors: { newPassword: copy.newInvalid }, clear: ["newPassword", "newPasswordConfirmation"], focus: "newPassword" };
    case "PASSWORD_UNCHANGED":
      return { errors: { newPassword: copy.unchanged }, clear: ["newPassword", "newPasswordConfirmation"], focus: "newPassword" };
    default:
      return null;
  }
}

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** As peças de que `submitPasswordChange` precisa. O componente liga as de verdade, e o teste, as de mentira que anotam a ordem das chamadas. */
export type SubmitPasswordChangeDeps = {
  /** Há uma troca em andamento? Um segundo envio é ignorado. */
  isPending: () => boolean;
  /** Lê os campos e confere o esquema (`parseForm`: leva o foco ao primeiro campo recusado). */
  parse: () => ParsedForm<ChangePasswordInput>;
  /** Mostra a mensagem de cada campo; vazio apaga as que estavam. */
  showErrors: (errors: FieldErrors) => void;
  /** Envia à API (`mutation.mutate`): `onSuccess` recebe o que ela respondeu, e `onSettled` roda em todo fim, inclusive o da falha que lança. */
  mutate: (input: PasswordChange, options: { onSuccess: (result: ApiResult<void>) => void; onSettled: () => void }) => void;
  /** Esvazia campos de senha. */
  clearFields: (names: readonly PasswordField[]) => void;
  /** Leva o foco a um campo. */
  focusField: (name: PasswordField) => void;
  /** Solta o que guardou as senhas enviadas (`mutation.reset()`: apaga as `variables`). */
  release: () => void;
};

/**
 * O envio do formulário de trocar a senha (RN-COFRE-013), sem React e com as peças injetadas: o que importa nele é a ORDEM, e é isso que os
 * testes conferem. Um envio com outro em andamento não faz nada. O que o esquema recusa fica na tela, com as senhas digitadas, para a pessoa
 * corrigir. Aceito, vai à API só o que ela recebe (a confirmação da nova senha fica aqui). Quando a resposta chega: trocou, os três campos
 * se esvaziam; recusa de campo, a mensagem vai ao campo dele, a senha recusada se esvazia e o foco vai a ele (nesta ordem: o foco cai no campo
 * já vazio); qualquer outra falha não mexe no formulário, e vai ao aviso central. As senhas são soltas por último e em todo fim (`release`,
 * em `onSettled`), a falha que lança também: só `onSuccess` deixaria as `variables` da mutação, com as duas senhas, vivas depois de uma falha.
 */
export function submitPasswordChange(deps: SubmitPasswordChangeDeps): void {
  if (deps.isPending()) return;

  const parsed = deps.parse();
  deps.showErrors(parsed.ok ? {} : parsed.errors);
  if (!parsed.ok) return;

  deps.mutate(
    { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword },
    {
      onSuccess(result) {
        if (result.ok) {
          deps.clearFields(passwordFields);
          return;
        }

        const refusal = refusalFields(result.error.code);
        if (refusal === null) return;

        deps.showErrors(refusal.errors);
        deps.clearFields(refusal.clear);
        deps.focusField(refusal.focus);
      },
      onSettled: deps.release,
    },
  );
}
