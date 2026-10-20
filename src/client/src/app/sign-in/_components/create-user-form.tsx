import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { dbeaverEntry } from "@/app/workbench/_lib/dbeaver-entry";
import { Button, TextField, useToast } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { sharePeerEvent } from "@/lib/api/bridge";
import { allowRefusal, type ApiError } from "@/lib/api/prism-api";
import { focusFirstField, parseForm, type FieldErrors } from "@/lib/utils/form";

import { signInCopy } from "../_lib/sign-in.copy";
import { createUserSchema, type Credentials } from "../_lib/sign-in.schema";
import { createUser } from "../_lib/sign-in.service";

const copy = signInCopy.createUser;

/** A recusa da API no campo que ela nomeia; a mensagem dela vale mais que o título genérico. */
function refusedFields({ code, title, errors }: ApiError): FieldErrors {
  if (code === "USER_ALREADY_EXISTS") return { userName: copy.userAlreadyExists };
  if (code === "USERNAME_INVALID") return { userName: errors?.userName?.[0] ?? title };
  return { password: errors?.password?.[0] ?? title };
}

/** "Primeiro acesso": usuário, senha e confirmação. Criado o usuário, o cofre dele já abre. */
export function CreateUserForm({ onSignIn }: { onSignIn: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    // A mutação guarda o que recebeu em `variables`: sem `gcTime` ela deixaria a senha no cache.
    gcTime: 0,
    mutationFn: async (input: Credentials) => allowRefusal(await createUser(input), "USER_ALREADY_EXISTS", "USERNAME_INVALID", "PASSWORD_INVALID"),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(copy.created);
        // RN-COFRE-007: criar entra, e entrar fecha o cofre de quem estava antes. RN-ABAS-004: o login libera as outras janelas.
        queryClient.clear();
        // RN-DBEAVER-002: esta é a janela em que se entrou; a página da área de trabalho decide sobre o convite do DBeaver.
        dbeaverEntry.arm({ created: true });
        sharePeerEvent("signIn");
        void navigate(pathsConfig.workbench, { replace: true });
        return;
      }

      // As senhas digitadas não voltam à tela; o foco vai para o campo que a API recusou.
      const form = formRef.current;
      for (const password of form?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []) password.value = "";
      if (form) focusFirstField(form, refusedFields(result.error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();

    const parsed = parseForm(event.currentTarget, createUserSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    // Só o que a API recebe: a confirmação da senha não sai do formulário.
    if (parsed.ok) mutation.mutate({ userName: parsed.data.userName, password: parsed.data.password });
  }

  const shown = mutation.data !== undefined && !mutation.data.ok ? refusedFields(mutation.data.error) : errors;

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <TextField id="create-user-user-name" name="userName" type="text" label={copy.userName} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus error={shown.userName} className="h-11" />

      <TextField id="create-user-password" name="password" type="password" label={copy.password} autoComplete="new-password" error={shown.password} className="h-11" />

      <TextField id="create-user-password-confirmation" name="passwordConfirmation" type="password" label={copy.passwordConfirmation} autoComplete="new-password" error={shown.passwordConfirmation} className="h-11" />

      <Button type="submit" disabled={mutation.isPending} className="h-11 w-full">
        {mutation.isPending ? copy.submitting : copy.submit}
      </Button>

      <p className="text-muted">
        {copy.toSignIn.question}{" "}
        <button type="button" onClick={onSignIn} className="cursor-pointer text-postgres hover:underline">
          {copy.toSignIn.action}
        </button>
      </p>
    </form>
  );
}
