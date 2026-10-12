import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { signInCopy } from "@/app/sign-in/_lib/sign-in.copy";
import { signInSchema } from "@/app/sign-in/_lib/sign-in.schema";
import { sessionQuery, signInOrRefuse, signOut } from "@/app/sign-in/_lib/sign-in.service";
import { PrismMark } from "@/components/layout/prism-mark";
import { Button, FormMessage, LockIcon, TextField } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { ApiRequestError, unwrap, userActionDeadlineMs } from "@/lib/api/prism-api";
import { parseForm, type FieldErrors } from "@/lib/utils/form";

import { blockOutsideKeys, lockDialogHandlers } from "../_lib/lock-dialog";
import { unlockBlocked, unlockMutationOptions, type CloseState, type UnlockResult } from "../_lib/lock-vault";
import { lockCopy } from "../_lib/lock.copy";

const copy = lockCopy.screen;

/** Só a senha: o usuário é o do cofre que fechou, e a regra dela é a do login (não vazia). */
const passwordSchema = signInSchema.pick({ password: true });

export type LockScreenViewProps = {
  userName: string;
  titleId: string;
  /** A recusa da API ao desbloquear: a mesma frase da tela de login (RN-COFRE-006), ou a do cofre de um Prism mais novo (RN-VERSAO-005). */
  refusal: "INVALID_CREDENTIALS" | "VAULT_FORMAT_UNSUPPORTED" | null;
  /** A recusa do campo, antes de ir à API (senha vazia). */
  errors: FieldErrors;
  /**
   * A chamada falhou por outro motivo (o aviso central ficaria por baixo desta tela, então a frase é daqui). `...NoResponse`: a API não respondeu (o prazo
   * da chamada acabou, ou ela está fora do ar), e a tela diz isso; a ação volta a ser aceita.
   */
  failure: "unlock" | "signOut" | "unlockNoResponse" | "signOutNoResponse" | null;
  /** Onde está o fechamento do cofre na API: a tela diz a verdade, e "Desbloquear" espera por ele. */
  closeState: CloseState;
  unlocking: boolean;
  signingOut: boolean;
  formRef?: Ref<HTMLFormElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
};

/**
 * O que a tela de bloqueio mostra (RN-SEG-001): a marca, o usuário, a senha, "Desbloquear" e "Sair". Só de propriedades, como as
 * outras telas que os testes desenham; `LockScreen` põe isto num diálogo modal e liga os botões.
 */
/** A frase de cada falha: a da própria tela, porque o aviso central ficaria por baixo dela. */
const failureText = { unlock: copy.unlockFailed, signOut: copy.signOutFailed, unlockNoResponse: copy.unlockNoResponse, signOutNoResponse: copy.signOutNoResponse } satisfies Record<NonNullable<LockScreenViewProps["failure"]>, string>;

/** Qual falha a tela diz de uma chamada que lançou: a API não respondeu (o prazo acabou, ou ela está fora do ar), ou qualquer outra. */
export function failureOf(action: "unlock" | "signOut", error: unknown): NonNullable<LockScreenViewProps["failure"]> {
  return error instanceof ApiRequestError && error.error.code === "NETWORK_ERROR" ? `${action}NoResponse` : action;
}

export function LockScreenView({ userName, titleId, refusal, errors, failure, closeState, unlocking, signingOut, formRef, onSubmit, onSignOut }: LockScreenViewProps) {
  const busy = unlocking || signingOut;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3 text-lg font-semibold tracking-[0.01em]">
        <PrismMark height={56} />
        <span>Prism</span>
      </div>

      <section className="flex w-full max-w-[400px] flex-col gap-5 rounded-xl border border-border bg-panel p-8">
        <div className="flex flex-col gap-1.5">
          <h1 id={titleId} className="text-2xl leading-[30px] font-semibold">
            {copy.title}
          </h1>
          <p id={`${titleId}-description`} className="text-muted">
            {copy.description[closeState]}
          </p>
        </div>

        {/* Quem é o dono do cofre: o desbloqueio abre o cofre dele e de mais ninguém. */}
        <p data-lock-user className="flex h-10 items-center gap-2.5 rounded-md border border-border bg-raised px-3 text-ink">
          <LockIcon className="text-muted" />
          <span className="sr-only">{copy.userLabel}: </span>
          <span className="min-w-0 truncate">{userName}</span>
        </p>

        <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <TextField id="lock-password" name="password" type="password" label={copy.password} autoComplete="current-password" error={errors.password} className="h-11" />

          {closeState === "closing" ? <p className="text-sm text-muted">{copy.closing}</p> : null}
          {closeState === "retrying" ? <FormMessage tone="warning">{copy.closeRetrying}</FormMessage> : null}
          {closeState === "gaveUp" ? <FormMessage tone="warning">{copy.closeFailed}</FormMessage> : null}
          {refusal === null ? null : <FormMessage tone="error">{refusal === "VAULT_FORMAT_UNSUPPORTED" ? signInCopy.signIn.vaultFormatUnsupported : signInCopy.signIn.invalidCredentials}</FormMessage>}
          {failure === null ? null : <FormMessage tone="error">{failureText[failure]}</FormMessage>}

          <div className="flex gap-3">
            <Button type="submit" disabled={busy || unlockBlocked(closeState)} className="h-11 flex-1">
              {unlocking ? copy.unlocking : copy.unlock}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onSignOut} className="h-11">
              {signingOut ? copy.signingOut : copy.signOut}
            </Button>
          </div>
        </form>

        <p className="text-sm text-muted">{copy.kept}</p>
      </section>
    </div>
  );
}

/**
 * O `<dialog>` da tela de bloqueio, só de propriedades (os testes o desenham). Nada o fecha: `closedby="none"` (nem o Esc, nem um clique
 * fora, nem um quadro), o cancelamento e o `close` são tratados (`lockDialogHandlers`), e o teclado não passa dele. O `role` está escrito
 * de propósito: o diálogo de versão nova procura `[role=dialog]` para não tomar o foco de quem está em outro diálogo (`focusIsElsewhere`).
 */
export function LockDialog({ dialogRef, titleId, handlers, children }: { dialogRef: Ref<HTMLDialogElement>; titleId: string; handlers: ReturnType<typeof lockDialogHandlers>; children: ReactNode }) {
  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      tabIndex={-1}
      closedby="none"
      data-lock-screen
      onFocus={handlers.onFocus}
      onKeyDown={handlers.onKeyDown}
      onCancel={handlers.onCancel}
      onClose={handlers.onClose}
      className="m-0 h-dvh max-h-none w-dvw max-w-none overflow-auto border-0 bg-background p-0 text-body outline-none backdrop:bg-background"
    >
      {children}
    </dialog>
  );
}

/** Os tratadores do diálogo não dependem de nada da tela: um conjunto só. */
const dialogHandlers = lockDialogHandlers();

/**
 * A tela de bloqueio (RN-SEG-001): um `<dialog>` aberto com `showModal()`. É a peça da plataforma que faz o que o bloqueio precisa
 * e que nenhum `z-index` faria: vai para a camada de cima, acima de tudo (avisos e diálogos incluídos); deixa o **resto do
 * documento inerte**, fora da ordem do teclado, do ponteiro e dos leitores de tela (`inert`), inclusive o que nascer depois, como um
 * diálogo que abra sozinho (os portais do `Dialog`, do menu e dos avisos estão no `body`, onde um `inert` posto na área de trabalho
 * não chegaria); prende o Tab; e, ao fechar, devolve o foco a quem o tinha. Por baixo, a área de trabalho continua montada, com as
 * abas, os editores e os formulários como estavam.
 *
 * O Esc não fecha, e o teclado não chega aos atalhos da janela (Ctrl+, abre as Configurações por um ouvinte em `window`): nada do
 * que está por baixo age enquanto a senha não for digitada. O desbloqueio é `unlockVault` (a ordem e a conferência da resposta estão lá).
 */
export function LockScreen({ closeState, onUnlocked }: { closeState: CloseState; onUnlocked: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});

  // O guard já buscou a sessão (mesma chave): é dela o usuário cujo cofre fechou.
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? "";

  // O "Sair" de verdade, o mesmo da barra superior: fecha o cofre, vai ao login e o que estava em cache era dele.
  const leave = useMutation({
    networkMode: "always",
    meta: { silent: true },
    // Com prazo: a API que não responde não deixa a tela em "Saindo…" para sempre (nem "Desbloquear" desabilitado); estourado, ela volta a aceitar ação e diz a falha.
    mutationFn: async () => unwrap(await signOut(AbortSignal.timeout(userActionDeadlineMs))),
    onSuccess: () => {
      void navigate(pathsConfig.signIn, { replace: true });
      queryClient.clear();
    },
  });

  const unlock = useMutation({
    // O mesmo prazo no desbloqueio: a API que não responde devolve a tela com a falha dita, e o campo e os botões voltam a aceitar ação.
    ...unlockMutationOptions({ userName, signIn: (credentials) => signInOrRefuse(credentials, AbortSignal.timeout(userActionDeadlineMs)), onUnlocked }),
    onSuccess: (result: UnlockResult) => {
      if (result.kind === "unlocked") return;

      // A API respondeu que entrou, mas não é o cofre que bloqueou: nada de desbloquear. A saída de verdade leva ao login, e tudo é descartado.
      if (result.kind === "mismatch") return leave.mutate();

      // Cofre de um Prism mais novo (RN-VERSAO-005) não é erro de senha: o que a pessoa digitou fica como está. Senha recusada não serve para nada: o campo volta vazio e com o foco, como no login.
      if (result.code !== "INVALID_CREDENTIALS") return;

      const field = form.current?.querySelector<HTMLInputElement>('[name="password"]');
      if (field) {
        field.value = "";
        field.focus();
      }
    },
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    element.showModal();
    element.querySelector<HTMLInputElement>('[name="password"]')?.focus();

    // Ao desmontar (desbloqueou, ou saiu) o diálogo sai da camada de cima e o foco volta para onde estava.
    return () => element.close();
  }, []);

  // O teclado que vem de fora do diálogo (o foco foi parar no `body`) não chega aos atalhos da janela.
  useEffect(() => blockOutsideKeys(window, (target) => target instanceof Node && dialog.current?.contains(target) === true), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // O desbloqueio espera o cofre fechar (ou a tentativa desistir): abrir o cofre com o fechamento a caminho o fecharia por cima.
    if (unlock.isPending || leave.isPending || unlockBlocked(closeState)) return;
    unlock.reset();

    const parsed = parseForm(event.currentTarget, passwordSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (parsed.ok) unlock.mutate(parsed.data.password);
  }

  const refusal = unlock.data?.kind === "refused" && (unlock.data.code === "INVALID_CREDENTIALS" || unlock.data.code === "VAULT_FORMAT_UNSUPPORTED") ? unlock.data.code : null;

  return (
    <LockDialog dialogRef={dialog} titleId={titleId} handlers={dialogHandlers}>
      <LockScreenView
        userName={userName}
        titleId={titleId}
        refusal={refusal}
        errors={errors}
        failure={unlock.isError ? failureOf("unlock", unlock.error) : leave.isError ? failureOf("signOut", leave.error) : null}
        closeState={closeState}
        unlocking={unlock.isPending}
        signingOut={leave.isPending}
        formRef={form}
        onSubmit={handleSubmit}
        onSignOut={() => leave.mutate()}
      />
    </LockDialog>
  );
}
