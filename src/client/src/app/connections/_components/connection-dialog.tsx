import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDriverActions } from "@/app/drivers/_components/driver-actions";
import { driverIdOf } from "@/app/drivers/_lib/drivers.model";
import { driversQuery } from "@/app/drivers/_lib/drivers.service";
import { Button, ConfirmDialog, Dialog, FieldError, FormMessage, useToast, type Engine } from "@/components/ui";
import { allowRefusal, type ApiError, type ApiResult } from "@/lib/api/prism-api";
import { apiFieldErrors, focusFirstField, hasUnshownFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { createConnectionSchema, editConnectionSchema, engineOption, newVerification, verificationOf, type Connection, type ConnectionInput, type Folder } from "../_lib/connections.schema";
import { connectionsQuery, createConnection, invalidateLists, runConnectionTest, updateConnection } from "../_lib/connections.service";
import { choiceOf, engineChoices } from "../_lib/engine-choices";
import { environmentLookup } from "../_lib/environment";
import { hasChanges, snapshotOf, type FormSnapshot } from "../_lib/form-leave";
import { confirmationChoiceOf, type ConfirmationChoice } from "../_lib/protections";
import { userEnvironments } from "../_lib/user-environments";
import { passwordAsked, readOnlyChange } from "../_lib/user-password";
import { ConnectionFields } from "./connection-fields";
import { DeleteConnectionDialog } from "./delete-connection-dialog";
import { DriverNotice } from "./driver-notice";
import { EngineGrid, EngineSummary } from "./engine-grid";
import { RevealPasswordDialog } from "./reveal-password-dialog";
import { ShownEnvironmentPill } from "./shown-environment-pill";
import { TestFailure, type TestFailureState } from "./test-failure";
import { UserPasswordDialog } from "./user-password-dialog";

const copy = connectionsCopy.form;
const formID = "connection-dialog-form";
/** Os campos que o formulário tem, pelo `name`: um erro da API com outra chave não apareceria em lugar nenhum. */
const fieldNames = Object.keys(createConnectionSchema.shape);

/** O que abre o diálogo: uma conexão nova (na pasta dada, ou na raiz) ou a edição de uma gravada. */
export type ConnectionDialogRequest = { mode: "new"; folderID: string | null } | { mode: "edit"; connection: Connection };

type ConnectionDialogProps = {
  request: ConnectionDialogRequest;
  folders: Folder[];
  /** Quantas abas de uma conexão estão abertas na área de trabalho: excluir a conexão as fecha, com o SQL que têm. */
  openTabs: (connectionId: string) => number;
  /** Fechou sem gravar (cancelar, Esc, o X, ou depois de excluir). */
  onClose: () => void;
  /** Gravou: quem abriu fecha o diálogo e deixa a conexão à vista na árvore. */
  onSaved: (connection: Connection) => void;
};

/**
 * O formulário de conexão como um diálogo sobre a área de trabalho, como o do DBeaver (RN-NAV-004): nova e edição. As abas, o texto de
 * SQL e os resultados ficam por baixo, intactos. "Nova conexão" começa pela grade de bancos (RN-NAV-005); escolhido o banco (clique e
 * Avançar, duplo clique ou Enter), o mesmo diálogo passa às configurações, com Voltar para trocar o banco. A edição abre direto nas
 * configurações, com o banco à vista. O driver que falta aparece nas configurações, com "Instalar" pelo mesmo fluxo de Configurações ›
 * Drivers (`useDriverActions`); a conexão pode ser salva sem ele.
 *
 * Os campos ficam montados enquanto o diálogo está aberto (escondidos na grade): voltar para trocar o banco não perde o que foi digitado. A
 * senha é estado daqui e de mais nenhum lugar: a revelada (RN-CONN-002) é posta no campo e some quando o diálogo fecha; as mutações que a
 * enviam não são guardadas (`gcTime: 0`). Numa conexão gravada o campo vazio significa "manter" (RN-CONN-004).
 *
 * Fechar sem gravar (Cancelar, Esc, o X, o clique fora) pergunta antes se há o que perder: a foto dos campos contra a de quando as
 * configurações apareceram. O bloqueio por inatividade descarta o diálogo (RN-SEG-001): quem o abre não o desenha com a época do bloqueio
 * trocada.
 */
export function ConnectionDialog({ request, folders, openTabs, onClose, onSaved }: ConnectionDialogProps) {
  const connection = request.mode === "edit" ? request.connection : null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  // A foto dos campos quando as configurações apareceram pela primeira vez: o que estiver diferente dela é o que se perde ao fechar.
  const opened = useRef<FormSnapshot | null>(null);

  // O catálogo de drivers (RN-DRIVER-002): de onde sai a grade de bancos e o estado do driver de cada um.
  const drivers = useQuery(driversQuery);
  const choices = useMemo(() => engineChoices(drivers.data), [drivers.data]);
  const driverActions = useDriverActions();
  // RN-AMB-001: os ambientes que as pastas e as conexões já usam, para a seção Ambiente reaproveitar (a lista é a do navegador, já no cache).
  const savedConnections = useQuery(connectionsQuery);
  const environments = useMemo(() => userEnvironments(folders, savedConnections.data ?? []), [folders, savedConnections.data]);

  const [step, setStep] = useState<"engine" | "settings">(connection === null ? "engine" : "settings");
  const [engine, setEngine] = useState<Engine | null>(connection?.engine ?? null);
  const [port, setPort] = useState(connection === null ? "" : String(connection.port));
  const [folderID, setFolderID] = useState(connection?.folderID ?? (request.mode === "new" ? request.folderID : null) ?? "");
  const [color, setColor] = useState<string | null>(connection?.environmentColor ?? null);
  // RN-PROT-001 e 002: as proteções PRÓPRIAS; as herdadas da pasta escolhida aparecem na seção, e não são gravadas aqui.
  const [confirm, setConfirm] = useState<ConfirmationChoice>(confirmationChoiceOf(connection?.confirmCommands ?? null));
  const [readOnly, setReadOnly] = useState(connection?.readOnly ?? false);
  // RN-PROT-003: a gravação que espera a senha do usuário (o somente leitura que muda, ou a API que a pediu), com a frase do que muda.
  const [asking, setAsking] = useState<{ input: ConnectionInput; change: string } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordShown, setPasswordShown] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  // Por que "Testar conexão" não conectou (a mensagem do banco, ou a frase da API para o driver não instalado): fica no fim do diálogo até a próxima tentativa.
  const [testFailure, setTestFailure] = useState<TestFailureState | null>(null);

  const selected = engine === null ? undefined : choiceOf(choices, engine);
  const canAdvance = selected !== undefined && !selected.disabled;

  // As configurações apareceram: a foto da abertura (uma vez) e o foco no nome, o primeiro campo.
  useEffect(() => {
    if (step !== "settings" || formRef.current === null) return;
    opened.current ??= snapshotOf(new FormData(formRef.current));
    formRef.current.querySelector<HTMLElement>('[name="name"]')?.focus();
  }, [step]);

  /** O 422 de campos: cada mensagem no campo que a API nomeia; o que nenhum campo mostra vira aviso (RN-AVISO-004). */
  function showInvalid(error: ApiError) {
    const fields = apiFieldErrors(error.errors);
    setErrors(fields);
    setRefusal(Object.keys(fields).length > 0 ? null : error.title);
    if (hasUnshownFieldErrors(fields, fieldNames)) toast.error(error.title);
    if (formRef.current) focusFirstField(formRef.current, fields);
  }

  /** O fim de uma gravação, com ou sem a senha do usuário: gravou, ou o 422 dos campos vai a eles. */
  async function settled(result: ApiResult<Connection>) {
    if (!result.ok) {
      showInvalid(result.error);
      return;
    }

    toast.success(connection ? connectionsCopy.toasts.connectionUpdated : connectionsCopy.toasts.connectionCreated);
    await invalidateLists(queryClient);
    onSaved(result.data);
  }

  const save = useMutation({
    // A mutação guarda o que recebeu em `variables`: sem `gcTime` ela deixaria a senha no cache.
    gcTime: 0,
    mutationFn: async (input: ConnectionInput) => allowRefusal(await (connection ? updateConnection(connection.id, input) : createConnection(input)), "CONNECTION_INVALID", "USER_PASSWORD_REQUIRED"),
    onSuccess: async (result, input) => {
      // RN-PROT-003: a API pediu a senha que a tela não previu (a pasta escolhida tira o somente leitura herdado): grava de novo com ela.
      const change = connection ? passwordAsked(result, connection.name) : null;
      if (change !== null) {
        setAsking({ input, change });
        return;
      }
      await settled(result);
    },
    onError: () => void invalidateLists(queryClient),
  });

  // "Testar conexão" (RN-CONN-013) não grava nada. Como a de gravar, não deixa a senha em `variables`.
  const test = useMutation({
    gcTime: 0,
    mutationFn: async (input: ConnectionInput) => runConnectionTest(input, connection?.id),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(connectionsCopy.toasts.connectionTested);
        return;
      }

      if (result.error.code === "CONNECTION_INVALID") {
        showInvalid(result.error);
        return;
      }

      // O toast avisa do acontecimento; a mensagem do banco, que a pessoa precisa ler com calma, fica no diálogo.
      // Com o driver do banco não instalado (RN-DRIVER-006) a mensagem é da API e vem com "Instalar driver".
      toast.error(connectionsCopy.toasts.connectionTestFailed);
      setTestFailure({ message: result.error.detail ?? result.error.title, code: result.error.code, driverID: driverIdOf(result.error.extensions) });
    },
  });

  function changeEngine(next: Engine) {
    // A porta sugerida acompanha o banco, mas só enquanto a pessoa não digitou outra (RN-CONN-012).
    if (port.trim() === "" || (engine !== null && port === String(engineOption(engine).defaultPort))) setPort(String(engineOption(next).defaultPort));
    setEngine(next);
  }

  /** Escolhido o banco (o da grade, ou o que o Enter e o duplo clique pedem), o diálogo passa às configurações. */
  function advance(next: Engine | null = engine) {
    const choice = next === null ? undefined : choiceOf(choices, next);
    if (next === null || choice === undefined || choice.disabled) return;

    changeEngine(next);
    setStep("settings");
  }

  /** Fechar sem gravar: com o que perder, pergunta antes (RN-NAV-004). */
  function requestClose() {
    const current = formRef.current === null ? null : snapshotOf(new FormData(formRef.current));
    if (current !== null && hasChanges(opened.current, current)) setConfirmingDiscard(true);
    else onClose();
  }

  /** Sem nada no campo de uma conexão gravada, o olho pede a senha do usuário; com algo, só mostra ou esconde. */
  function handlePasswordEye() {
    if (connection?.hasPassword && password === "") setRevealing(true);
    else setPasswordShown((current) => !current);
  }

  function handleRevealed(revealed: string) {
    setPassword(revealed);
    setPasswordShown(true);
    setRevealing(false);
  }

  /**
   * Lê e valida o formulário (o mesmo para gravar e para testar); nulo, com os erros nos campos, se algo foi recusado. A verificação periódica (RN-VERIF-001)
   * ainda não está no formulário e vai como a conexão a tem (na nova, o padrão): o `PATCH` grava a conexão por inteiro.
   */
  function readForm(form: HTMLFormElement): ConnectionInput | null {
    setRefusal(null);
    setTestFailure(null);

    const parsed = connection ? parseForm(form, editConnectionSchema) : parseForm(form, createConnectionSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    return parsed.ok ? { ...parsed.data, ...(connection ? verificationOf(connection) : newVerification) } : null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || test.isPending || asking !== null) return;

    const input = readForm(event.currentTarget);
    if (input === null) return;
    // RN-PROT-003: marcar ou desmarcar "Somente leitura" numa conexão que já existe pede a senha do usuário antes de gravar.
    const change = connection ? readOnlyChange(connection.name, connection.readOnly, input.readOnly) : null;
    if (change !== null) setAsking({ input, change });
    else save.mutate(input);
  }

  function handleTest() {
    if (save.isPending || test.isPending || formRef.current === null) return;

    const input = readForm(formRef.current);
    if (input) test.mutate(input);
  }

  // O driver que o teste disse faltar, quando a lista o tem num estado em que se instala: "Instalar driver" abre o diálogo de instalação ali mesmo.
  const missingDriver = testFailure === null ? null : (drivers.data?.find((driver) => driver.id === testFailure.driverID) ?? selected?.driver ?? null);
  const installMissing = missingDriver !== null && (missingDriver.state === "available" || missingDriver.state === "failed") ? () => driverActions.install(missingDriver) : undefined;

  const saving = save.isPending;
  const testing = test.isPending;
  const busy = saving || testing;
  const onSettings = step === "settings";

  const title = connection?.name ?? copy.newTitle;
  const description = !onSettings ? copy.chooseSubtitle : connection ? copy.savedSubtitle(engineOption(connection.engine).label) : copy.newSubtitle;

  const footer = onSettings ? (
    <>
      <div className="mr-auto flex flex-wrap gap-3">
        <Button type="button" variant="ghost" onClick={() => setStep("engine")} disabled={busy}>
          {copy.back}
        </Button>
        {connection ? (
          <Button type="button" variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
            {copy.remove}
          </Button>
        ) : null}
      </div>
      <Button type="button" variant="secondary" onClick={handleTest} disabled={busy}>
        {testing ? copy.testing : copy.test}
      </Button>
      <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>
        {copy.cancel}
      </Button>
      <Button type="submit" form={formID} disabled={busy} className="px-5">
        {saving ? copy.saving : copy.save}
      </Button>
    </>
  ) : (
    <>
      <Button type="button" variant="secondary" onClick={requestClose}>
        {copy.cancel}
      </Button>
      <Button type="button" onClick={() => advance()} disabled={!canAdvance}>
        {copy.next}
      </Button>
    </>
  );

  return (
    <>
      <Dialog open size="lg" title={title} description={description} pending={saving} onClose={requestClose} footer={footer}>
        {onSettings ? null : (
          <div className="flex flex-col gap-3">
            <EngineGrid choices={choices} value={engine} onChange={changeEngine} onPick={advance} />
            {choices.some((choice) => choice.engine === null) ? <p className="text-xs text-muted">{copy.engines.soonNote}</p> : null}
          </div>
        )}

        {/* Montado também na grade (escondido): voltar para trocar o banco não perde o que foi digitado. */}
        <div hidden={!onSettings} className={onSettings ? "flex flex-col gap-5" : undefined}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {selected === undefined ? null : <EngineSummary choice={selected} />}
            {connection ? <ShownEnvironmentPill environment={environmentLookup(folders).connection(connection)} className="h-[22px] px-[9px] text-xs leading-[22px]" /> : null}
          </div>
          {selected === undefined ? null : <DriverNotice choice={selected} actions={driverActions} />}

          <form id={formID} ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            <input type="hidden" name="engine" value={engine ?? ""} />
            <FieldError id="cx-engine-error">{errors.engine}</FieldError>
            <ConnectionFields
              connection={connection}
              folders={folders}
              errors={errors}
              folderID={folderID}
              onFolderChange={setFolderID}
              port={port}
              onPortChange={setPort}
              password={password}
              onPasswordChange={setPassword}
              passwordShown={passwordShown}
              onPasswordEye={handlePasswordEye}
              color={color}
              onColorChange={setColor}
              environments={environments}
              confirm={confirm}
              onConfirmChange={setConfirm}
              readOnly={readOnly}
              onReadOnlyChange={setReadOnly}
            />
            {refusal === null ? null : <FormMessage tone="error">{refusal}</FormMessage>}
          </form>

          {/* O resultado do teste aparece no fim do corpo, que rola: ele mesmo se traz à vista. */}
          {testFailure === null ? null : (
            <div ref={(element) => element?.scrollIntoView({ block: "nearest" })}>
              <TestFailure failure={testFailure} onInstall={installMissing} />
            </div>
          )}
        </div>
      </Dialog>

      {/* Fora do `<form>` e do diálogo: o evento de um diálogo sobe pela árvore do React, e o `submit` dele não pode chegar ao formulário. */}
      {revealing && connection ? <RevealPasswordDialog connection={connection} onRevealed={handleRevealed} onClose={() => setRevealing(false)} /> : null}

      {asking && connection ? (
        <UserPasswordDialog
          change={asking.change}
          send={(userPassword) => updateConnection(connection.id, asking.input, userPassword)}
          refusals={["CONNECTION_INVALID"]}
          onDone={(result) => {
            setAsking(null);
            if (result === null) void invalidateLists(queryClient);
            else void settled(result);
          }}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {confirmingDelete && connection ? <DeleteConnectionDialog connection={connection} openTabs={openTabs(connection.id)} onClose={() => setConfirmingDelete(false)} onDeleted={onClose} /> : null}

      <ConfirmDialog
        open={confirmingDiscard}
        tone="danger"
        title={connection ? copy.discard.editTitle : copy.discard.newTitle}
        description={copy.discard.description}
        confirmLabel={copy.discard.confirm}
        cancelLabel={copy.discard.cancel}
        onConfirm={onClose}
        onCancel={() => setConfirmingDiscard(false)}
      />

      {driverActions.dialogs}
    </>
  );
}
