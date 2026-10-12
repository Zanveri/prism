import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { Button, FormMessage, TextField } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { parseForm, type FieldErrors } from "@/lib/utils/form";

import { signInCopy } from "../_lib/sign-in.copy";
import { signInSchema, type Credentials } from "../_lib/sign-in.schema";
import { signInOrRefuse } from "../_lib/sign-in.service";

const copy = signInCopy.signIn;

/** "Entrar": usuário e senha. A recusa da credencial fica aqui, no formulário, e não em aviso. */
export function SignInForm({ onCreateUser }: { onCreateUser: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    // A mutação guarda o que recebeu em `variables`: sem `gcTime` ela deixaria a senha no cache.
    gcTime: 0,
    mutationFn: (input: Credentials) => signInOrRefuse(input),
    onSuccess: (result) => {
      if (result.ok) {
        // RN-COFRE-007: entrar fecha o cofre de quem estava antes; o que estava em cache era dele.
        queryClient.clear();
        void navigate(pathsConfig.workbench, { replace: true });
        return;
      }

      // Cofre de um Prism mais novo (RN-VERSAO-005) não é erro de senha: o que a pessoa digitou fica como está.
      if (result.error.code !== "INVALID_CREDENTIALS") return;

      // A senha recusada não serve para nada: o campo volta vazio e com o foco.
      const password = formRef.current?.querySelector<HTMLInputElement>('[name="password"]');
      if (password) {
        password.value = "";
        password.focus();
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.reset();

    const parsed = parseForm(event.currentTarget, signInSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (parsed.ok) mutation.mutate(parsed.data);
  }

  const refusal = mutation.data !== undefined && !mutation.data.ok ? mutation.data.error.code : null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <TextField id="sign-in-user-name" name="userName" type="text" label={copy.userName} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus error={errors.userName} className="h-11" />

      <TextField id="sign-in-password" name="password" type="password" label={copy.password} autoComplete="current-password" error={errors.password} className="h-11" />

      {/* Usuário inexistente e senha errada: a mesma frase (RN-COFRE-006). O cofre de um Prism mais novo tem a sua (RN-VERSAO-005). */}
      {refusal === null ? null : <FormMessage tone="error">{refusal === "VAULT_FORMAT_UNSUPPORTED" ? copy.vaultFormatUnsupported : copy.invalidCredentials}</FormMessage>}

      <Button type="submit" disabled={mutation.isPending} className="h-11 w-full">
        {mutation.isPending ? copy.submitting : copy.submit}
      </Button>

      <p className="text-muted">
        {copy.toCreate.question}{" "}
        <button type="button" onClick={onCreateUser} className="cursor-pointer text-postgres hover:underline">
          {copy.toCreate.action}
        </button>
      </p>
    </form>
  );
}
