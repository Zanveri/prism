import { useState } from "react";

import { getBridge } from "@/lib/api/bridge";

import { BrandPanel } from "./_components/brand-panel";
import { CreateUserForm } from "./_components/create-user-form";
import { SignInForm } from "./_components/sign-in-form";
import { signInCopy } from "./_lib/sign-in.copy";

/**
 * O aviso do cofre fica sempre à vista, nos dois formulários: quem cria o usuário precisa saber,
 * antes de escolher a senha, que ela não tem recuperação (RN-COFRE-009).
 */
function VaultNotice() {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border px-3.5 py-3 text-sm text-muted">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 flex-none">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
      </svg>
      <span>{signInCopy.vaultNotice}</span>
    </div>
  );
}

/**
 * A porta do cofre, em duas metades como no canvas: a marca e o formulário. "Entrar" e "Criar
 * usuário" trocam de lugar no mesmo painel; cada formulário é dono do que foi digitado nele, e a
 * senha some quando ele sai da tela.
 */
export function SignInPage() {
  const [mode, setMode] = useState<"sign-in" | "create-user">("sign-in");
  const title = mode === "sign-in" ? signInCopy.signIn.title : signInCopy.createUser.title;

  return (
    // A raiz do app não rola (`globals.css`): numa janela baixa, é esta área que rola até o botão de entrar.
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-wrap-reverse bg-background">
        <BrandPanel version={getBridge().version} />

        <section className="flex min-w-0 flex-[1_1_420px] flex-col items-center justify-center border-l border-border bg-panel px-10 py-12">
          <div className="flex w-full max-w-[360px] flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-2xl leading-[30px] font-semibold">{title}</h2>
              <p className="text-muted">{signInCopy.subtitle}</p>
            </div>

            {mode === "sign-in" ? <SignInForm onCreateUser={() => setMode("create-user")} /> : <CreateUserForm onSignIn={() => setMode("sign-in")} />}

            <VaultNotice />
          </div>
        </section>
      </div>
    </div>
  );
}
