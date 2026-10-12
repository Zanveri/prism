import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { Button, TextField, useToast } from "@/components/ui";
import { parseForm, type FieldErrors } from "@/lib/utils/form";

import { changePasswordSchema, submitPasswordChange, type PasswordField } from "../_lib/account";
import { changePasswordOrRefuse } from "../_lib/account.service";
import { settingsCopy } from "../_lib/settings.copy";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.account;

/** Esvazia campos de senha do formulário: a senha recusada, ou a que acabou de valer, não fica na tela. */
function clearFields(form: HTMLFormElement | null, names: readonly PasswordField[]) {
  for (const name of names) {
    const field = form?.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = "";
  }
}

/** Leva o foco ao campo que a recusa nomeia. */
function focusField(form: HTMLFormElement | null, name: PasswordField) {
  const field = form?.elements.namedItem(name);
  if (field instanceof HTMLElement) field.focus();
}

/**
 * Conta: trocar senha (RN-COFRE-013). Senha atual, nova e a confirmação da nova, que só se confere aqui. A API confere a atual, e cada recusa dela aparece
 * no campo que ela nomeia (`refusalFields`). Trocada a senha (204), os campos se esvaziam, o aviso diz que valeu, e o cofre continua aberto: nada de sair.
 * O quinto erro seguido da senha atual fecha o cofre (a mesma contagem da revelação de senha) e a tela volta ao login com um aviso; a resposta não diz quantas
 * tentativas faltam, e a tela não inventa um contador.
 *
 * Os campos não são controlados: o valor está no próprio campo e sai pelo `FormData` ao enviar, e o estado do React só guarda a mensagem de cada campo. As senhas
 * ficam também nas `variables` da mutação, enquanto a chamada dura (é o que a envia). A mutação não é guardada (`gcTime: 0`) e é esvaziada (`reset`) em todo fim
 * dela (`onSettled`), com resposta ou com a falha que lança, o que apaga as `variables`. A ordem do envio está em `submitPasswordChange`. Sair desta tela, ou o
 * bloqueio por inatividade (que a remonta), joga os campos fora com o resto.
 */
export function AccountSection({ anchor }: { anchor: string }) {
  const toast = useToast();
  const userName = useQuery({ ...sessionQuery, staleTime: Infinity }).data?.userName ?? "";
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    gcTime: 0,
    mutationFn: changePasswordOrRefuse,
    // Aqui e não em `mutate(…, { onSuccess })`: o quinto erro leva a tela ao login, e esta seção sai antes de a resposta ser entregue ao que a chamou.
    onSuccess: (result) => {
      if (result.ok) toast.success(copy.changed, copy.changedDetail);
      else if (result.error.code === "VAULT_LOCKED") toast.warning(copy.vaultLockedAfterFiveAttempts);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    submitPasswordChange({
      isPending: () => mutation.isPending,
      parse: () => parseForm(form, changePasswordSchema),
      showErrors: setErrors,
      mutate: mutation.mutate,
      clearFields: (names) => clearFields(formRef.current, names),
      focusField: (name) => focusField(formRef.current, name),
      release: mutation.reset,
    });
  }

  const pending = mutation.isPending;

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {/* O usuário do cofre, escondido: a convenção dos formulários de senha, para o leitor de tela e o gerenciador de senhas saberem de que conta é esta senha. Não é um campo da tela. */}
        <input type="text" name="userName" autoComplete="username" value={userName} readOnly hidden />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
          <TextField id="cfg-senha-atual" name="currentPassword" type="password" label={copy.currentPassword} autoComplete="current-password" error={errors.currentPassword} />
          <TextField id="cfg-senha-nova" name="newPassword" type="password" label={copy.newPassword} autoComplete="new-password" error={errors.newPassword} />
          <TextField id="cfg-senha-confirma" name="newPasswordConfirmation" type="password" label={copy.newPasswordConfirmation} autoComplete="new-password" error={errors.newPasswordConfirmation} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" disabled={pending}>
            {pending ? copy.submitting : copy.submit}
          </Button>
          <span className="text-xs text-muted">{copy.note}</span>
        </div>
      </form>
    </SettingsCard>
  );
}
