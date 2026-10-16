import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { saveText } from "@/app/workbench/_lib/save-file";
import { Button, Dialog, EngineTag, FormMessage, Select, TextField, useToast } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";
import { apiFieldErrors, enterInputID, type FieldErrors } from "@/lib/utils/form";

import {
  checkStates,
  collapsedFor,
  markAll,
  noneCollapsed,
  pathOf,
  searchVisible,
  shownNodes,
  toggle,
  toggleCollapsed,
  unmarkAll,
  validMarks,
  type CheckNode,
  type CheckState,
  type Collapsed,
} from "../_lib/check-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection, Folder } from "../_lib/connections.schema";
import { connectionsQuery, foldersQuery, invalidateLists } from "../_lib/connections.service";
import { environmentLookup, type ShownEnvironment } from "../_lib/environment";
import {
  applyToMarked,
  credentialsOf,
  credentialsOffered,
  exceedsLimits,
  exportCounter,
  exportFileName,
  exportFileType,
  exportRequestOf,
  exportSelection,
  exportTree,
  initialMarks,
  isEmptySelection,
  userPasswordChange,
  type ExportOrigin,
} from "../_lib/export-model";
import { exportPassphraseError, exportPassphraseOf, samePassphrase } from "../_lib/passphrase";
import { readOnlyHintOf } from "../_lib/protections";
import { transferCopy } from "../_lib/transfer.copy";
import type { CredentialsChoice, ExportResult } from "../_lib/transfer.schema";
import { exportConnections, exportMutation, exportRefusals } from "../_lib/transfer.service";
import { CheckRowFrame, FolderGlyph, TreeSearchBar } from "./check-tree-view";
import { ReadOnlyMark } from "./read-only-mark";
import { ShownEnvironmentPill } from "./shown-environment-pill";
import { UserPasswordDialog } from "./user-password-dialog";

const copy = transferCopy.export;
const formID = "export-connections-form";
const choiceOrder: readonly CredentialsChoice[] = ["none", "user", "userAndPassword"];
const choiceLabel: Record<CredentialsChoice, string> = { none: copy.credentials.none, user: copy.credentials.user, userAndPassword: copy.credentials.userAndPassword };
/** As recusas que o "Confirme a sua senha" devolve ao "Exportar conexões" (as da senha do Prism ele mostra no campo dele). */
const afterPasswordRefusals = exportRefusals.filter((code) => code !== "USER_PASSWORD_REQUIRED");

/** O caminho de pastas para o leitor de tela, ligado à caixa (e à escolha do que vai): as "NOMINAL" e as "DATA FIX" se repetem em cada pasta de ambiente. */
function useRowDescription(path: string | null) {
  const id = useId();
  return path === null ? null : { id, text: transferCopy.tree.inFolder(path) };
}

type FolderRowProps = { node: CheckNode; folder: Folder; state: CheckState; open: boolean; path: string | null; environment: ShownEnvironment | null; onToggleOpen: (key: string) => void; onMark: (key: string) => void };

/** A linha da pasta: o ícone com a cor dela, o nome, a etiqueta do ambiente dela e o cadeado do somente leitura dela (RN-TRANSF-002). */
const ExportFolderRow = memo(function ExportFolderRow({ node, folder, state, open, path, environment, onToggleOpen, onMark }: FolderRowProps) {
  const description = useRowDescription(path);
  return (
    <CheckRowFrame node={node} state={state} open={open} disabled={false} name={folder.name} description={description} onToggleOpen={onToggleOpen} onMark={onMark}>
      <FolderGlyph color={folder.color} />
      <span className="min-w-0 truncate text-ink">{folder.name}</span>
      <ShownEnvironmentPill environment={environment} />
      <ReadOnlyMark hint={folder.readOnly ? connectionsCopy.protections.readOnlyMark(null) : null} />
    </CheckRowFrame>
  );
});

type ConnectionRowProps = {
  node: CheckNode;
  connection: Connection;
  state: CheckState;
  choice: CredentialsChoice;
  path: string | null;
  environment: ShownEnvironment | null;
  readOnly: string | null;
  onMark: (key: string) => void;
  onChoice: (id: string, choice: CredentialsChoice) => void;
  onToggleOpen: (key: string) => void;
};

/**
 * A linha da conexão: a etiqueta do banco, o nome, o ambiente que vale nela (próprio ou herdado), o cadeado do somente leitura (o dela ou o de uma pasta
 * acima), o usuário gravado e a escolha do que vai (RN-TRANSF-002 e 003). Desmarcada, a escolha fica desabilitada e guarda o que estava; a conexão sem
 * usuário só tem "Sem usuário e senha", desabilitada, com a dica.
 */
const ExportConnectionRow = memo(function ExportConnectionRow({ node, connection, state, choice, path, environment, readOnly, onMark, onChoice, onToggleOpen }: ConnectionRowProps) {
  const description = useRowDescription(path);
  const offered = credentialsOffered(connection);
  const noUser = connection.userName === "";
  const hint = noUser ? copy.credentials.noUserHint : offered.includes("userAndPassword") ? undefined : copy.credentials.noPasswordHint;

  return (
    <CheckRowFrame
      node={node}
      state={state}
      open={false}
      disabled={false}
      name={connection.name}
      description={description}
      onToggleOpen={onToggleOpen}
      onMark={onMark}
      trailing={
        <span title={hint} className="w-48 flex-none">
          <Select
            aria-label={copy.credentials.label(connection.name)}
            aria-describedby={description?.id}
            value={choice}
            onChange={(value) => onChoice(connection.id, value as CredentialsChoice)}
            options={choiceOrder.filter((option) => offered.includes(option)).map((option) => ({ value: option, label: choiceLabel[option] }))}
            disabled={state !== "checked" || noUser}
            className="min-h-8 py-1 text-sm"
          />
        </span>
      }
    >
      <EngineTag engine={connection.engine} />
      <span className="min-w-0 truncate text-ink">{connection.name}</span>
      <ShownEnvironmentPill environment={environment} />
      <ReadOnlyMark hint={readOnly} />
      <span className="ml-auto flex-none truncate font-mono text-xs text-muted">{noUser ? copy.noUser : copy.user(connection.userName)}</span>
    </CheckRowFrame>
  );
});

type ExportConnectionsDialogProps = {
  /** De onde abriu (RN-TRANSF-001): a conexão, a pasta (com tudo dentro) ou o espaço vazio do navegador. */
  origin: ExportOrigin;
  onClose: () => void;
};

/**
 * "Exportar conexões" (RN-TRANSF-002 a 008), o diálogo grande. A árvore é a das listas do navegador (`foldersQuery` e `connectionsQuery`), inteira e sem os
 * filtros dele: o que outra janela cria aparece desmarcado quando a lista é lida de novo, e o que ela exclui some com a marca (`validMarks`).
 *
 * Quem monta e cifra o arquivo é a API; a tela recebe o texto já cifrado e o entrega ao diálogo de salvar do sistema (`saveText`, como o "Exportar CSV"). As
 * chamadas que levam senha não ficam no cache de mutações (`gcTime: 0` e `reset()` assim que a resposta chega), e as senhas digitadas, as marcas e as
 * escolhas são só estado daqui: o diálogo fechado (Cancelar, Esc, o bloqueio, "Sair") não deixa nada. A resposta que chega depois de o cofre fechar é
 * descartada (a época do bloqueio mudou), e o arquivo não vai ao diálogo de salvar (RN-TRANSF-008).
 */
export function ExportConnectionsDialog({ origin, onClose }: ExportConnectionsDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const folders = useQuery(foldersQuery);
  const connections = useQuery(connectionsQuery);
  const baseId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const passphraseAgainRef = useRef<HTMLInputElement>(null);
  const passphraseID = `${baseId}-passphrase`;
  const passphraseAgainID = `${baseId}-passphrase-again`;
  // A época do bloqueio quando o pedido com a senha do Prism saiu: o cofre que fechou no meio descarta o arquivo.
  const sentAt = useRef(0);

  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const connectionList = useMemo(() => connections.data ?? [], [connections.data]);
  const tree = useMemo(() => exportTree(folderList, connectionList), [folderList, connectionList]);
  const folderById = useMemo(() => new Map(folderList.map((folder) => [folder.id, folder])), [folderList]);
  const connectionById = useMemo(() => new Map(connectionList.map((connection) => [connection.id, connection])), [connectionList]);
  const environments = useMemo(() => environmentLookup(folderList), [folderList]);
  const readOnlyHints = useMemo(() => new Map(connectionList.map((connection) => [connection.id, readOnlyHintOf(connection.protections, folderList)])), [connectionList, folderList]);

  // As marcas com que abre saem das listas, que o navegador já tem: um ajuste durante a renderização, uma vez, quando elas chegam.
  const [seeded, setSeeded] = useState<{ scrollTo: string | null } | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  if (seeded === null && folders.data !== undefined && connections.data !== undefined) {
    const initial = initialMarks(tree, origin);
    setSeeded({ scrollTo: initial.scrollTo });
    setMarked(initial.marked);
  }
  const [choices, setChoices] = useState<ReadonlyMap<string, CredentialsChoice>>(new Map());
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Collapsed>(noneCollapsed);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseAgain, setPassphraseAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [limits, setLimits] = useState(false);
  // RN-TRANSF-005: o "Confirme a sua senha" aberto, com a frase do que vai acontecer.
  const [asking, setAsking] = useState<string | null>(null);

  // O que outra janela excluiu sai da árvore com a marca; o que ela criou aparece desmarcado.
  const effective = useMemo(() => validMarks(tree, marked), [tree, marked]);
  const visible = useMemo(() => searchVisible(tree, query), [tree, query]);
  const states = useMemo(() => checkStates(tree, effective), [tree, effective]);
  // RN-BUSCA-001: com a busca, o que casa aparece com os ancestrais abertos; as pastas fechadas antes dela voltam fechadas quando ela é limpa.
  const shownCollapsed = useMemo(() => collapsedFor(collapsed, query), [collapsed, query]);
  const rows = useMemo(() => shownNodes(tree, visible, shownCollapsed), [tree, visible, shownCollapsed]);
  const selection = useMemo(() => exportSelection(tree, effective, choices, connectionById), [tree, effective, choices, connectionById]);
  // As conexões marcadas que os botões "Para as marcadas" alcançam: com a busca, só as que ela mostra.
  const bulkTargets = useMemo(() => selection.connections.filter((connection) => visible === null || visible.has(connection.id)), [selection, visible]);

  const onMark = useCallback((key: string) => setMarked((current) => toggle(tree, key, validMarks(tree, current), visible)), [tree, visible]);
  const onToggleOpen = useCallback((key: string) => setCollapsed((current) => toggleCollapsed(current, query, key)), [query]);
  const onChoice = useCallback((id: string, choice: CredentialsChoice) => setChoices((current) => new Map(current).set(id, choice)), []);

  // Aberto pela entrada de uma conexão ou de uma pasta, o diálogo rola até ela (RN-TRANSF-002), uma vez.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || seeded === null) return;
    scrolled.current = true;
    if (seeded.scrollTo !== null) listRef.current?.querySelector(`[data-key="${CSS.escape(seeded.scrollTo)}"]`)?.scrollIntoView({ block: "center" });
  }, [seeded]);

  /**
   * A resposta da exportação, com ou sem a senha do Prism (`withUserPassword`). `epoch` é a época do bloqueio quando o pedido saiu: o cofre que fechou no
   * meio descarta o arquivo.
   */
  function finished(result: ApiResult<ExportResult> | null, epoch: number, withUserPassword: boolean) {
    if (result === null) return;
    if (result.ok) {
      // RN-TRANSF-008: a resposta que chega depois de o cofre fechar (o bloqueio, o "Sair", o quinto erro noutra janela) não vai ao diálogo de salvar.
      if (vaultLock.isLocked() || vaultLock.epoch() !== epoch) return;
      saveText(exportFileName(new Date()), result.data.content, exportFileType);
      toast.success(copy.toast(result.data));
      onClose();
      return;
    }

    const { code } = result.error;
    if (code === "EXPORT_PASSPHRASE_INVALID") {
      // A frase é da tela: as regras que ela confere antes do pedido, ou, com a senha do Prism no pedido, a senha de exportação igual a ela (RN-TRANSF-004),
      // que só a API sabe conferir. O "Confirme a sua senha" já fechou, e a recusa aparece no campo.
      const local = exportPassphraseError(passphrase);
      setErrors({ passphrase: local ?? (withUserPassword ? copy.passphraseErrors.samePrismPassword : (apiFieldErrors(result.error.errors).passphrase ?? result.error.title)) });
      passphraseRef.current?.focus();
    } else if (code === "EXPORT_LIMITS_EXCEEDED") {
      setLimits(true);
    } else if (code === "FOLDER_NOT_FOUND" || code === "CONNECTION_NOT_FOUND") {
      // A pasta ou a conexão marcada que outra janela excluiu: as listas vêm de novo, o item some com a marca, e o diálogo fica aberto.
      void invalidateLists(queryClient);
      toast.error(copy.gone);
    } else if (code === "USER_PASSWORD_REQUIRED") {
      // A API pediu a senha do Prism que a tela não previu (uma conexão ganhou senha noutra janela): pede e manda de novo.
      setAsking(userPasswordChange(selection));
    }
  }

  // Sem a senha do Prism, a exportação sai daqui. Como a do "Revelar senha", ela não fica no cache de mutações: nem as senhas que leva, nem o arquivo que traz.
  const exporting = useMutation(exportMutation);

  /**
   * O Enter só exporta nos dois campos da senha de exportação. Na busca, numa caixa da árvore ou em "Mostrar senha" ele enviaria o formulário (o botão do
   * rodapé é dele, pelo atributo `form`): a pessoa que aperta Enter para buscar não pediu para exportar.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const field = enterInputID(event);
    if (field !== null && field !== passphraseID && field !== passphraseAgainID) event.preventDefault();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exporting.isPending || asking !== null || isEmptySelection(selection)) return;

    setLimits(false);
    // Os limites que a tela sabe conferir (as contagens e os níveis) vêm antes de tudo, sem pedir nada à API nem a senha do Prism.
    if (exceedsLimits(selection)) {
      setLimits(true);
      return;
    }

    const next: FieldErrors = { passphrase: exportPassphraseError(passphrase) ?? undefined, passphraseAgain: samePassphrase(passphrase, passphraseAgain) ? undefined : copy.passphraseErrors.mismatch };
    setErrors(next);
    if (next.passphrase !== undefined || next.passphraseAgain !== undefined) {
      (next.passphrase !== undefined ? passphraseRef : passphraseAgainRef).current?.focus();
      return;
    }

    // RN-TRANSF-005: com alguma senha de banco no arquivo, o Prism pede a senha do Prism, uma vez, quantas forem as conexões.
    if (selection.withPassword.length > 0) {
      setAsking(userPasswordChange(selection));
      return;
    }

    const epoch = vaultLock.epoch();
    exporting.mutate(exportRequestOf(selection, choices, exportPassphraseOf(passphrase)), {
      onSuccess: (result) => {
        exporting.reset();
        finished(result, epoch, false);
      },
      onError: () => exporting.reset(),
    });
  }

  const pending = exporting.isPending;
  const empty = isEmptySelection(selection);
  const passwords = selection.withPassword.length;

  return (
    <>
      <Dialog
        open
        size="lg"
        title={copy.title}
        description={copy.description}
        pending={pending}
        onClose={onClose}
        footer={
          <>
            {/* Acima dos botões: o aviso das senhas de banco (RN-TRANSF-003) e a recusa dos limites (RN-TRANSF-006). */}
            {passwords > 0 ? (
              <FormMessage tone="warning" className="w-full">
                {copy.passwordsWarning(passwords)}
              </FormMessage>
            ) : null}
            {limits ? (
              <FormMessage tone="error" className="w-full">
                {copy.limits}
              </FormMessage>
            ) : null}
            <p role="status" className="mr-auto self-center text-sm text-muted">
              {exportCounter(selection)}
            </p>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              {copy.cancel}
            </Button>
            <Button type="submit" form={formID} disabled={pending || empty} title={empty ? copy.nothingMarked : undefined}>
              {pending ? copy.submitting : copy.submit}
            </Button>
          </>
        }
      >
        <form id={formID} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate className="flex flex-col gap-4">
          <TreeSearchBar id={`${baseId}-search`} query={query} onQuery={setQuery} onMarkAll={() => setMarked((current) => markAll(tree, validMarks(tree, current), visible))} onUnmarkAll={() => setMarked((current) => unmarkAll(tree, validMarks(tree, current), visible))} />

          <ul ref={listRef} aria-label={copy.tree} className="max-h-[22rem] min-h-40 overflow-y-auto rounded-md border border-border bg-panel p-1">
            {rows.length === 0 && visible !== null ? <li className="px-2 py-1.5 text-muted">{transferCopy.tree.nothingFound(query.trim())}</li> : null}
            {rows.map((node) => {
              const state = states.get(node.key) ?? "unchecked";
              if (node.kind === "folder") {
                const folder = folderById.get(node.key);
                return folder === undefined ? null : (
                  <ExportFolderRow
                    key={node.key}
                    node={node}
                    folder={folder}
                    state={state}
                    open={!shownCollapsed.has(node.key)}
                    path={pathOf(tree, node.key)}
                    environment={environments.folder(folder.id)}
                    onToggleOpen={onToggleOpen}
                    onMark={onMark}
                  />
                );
              }
              const connection = connectionById.get(node.key);
              return connection === undefined ? null : (
                <ExportConnectionRow
                  key={node.key}
                  node={node}
                  connection={connection}
                  state={state}
                  choice={credentialsOf(choices, connection)}
                  path={pathOf(tree, node.key)}
                  environment={environments.connection(connection)}
                  readOnly={readOnlyHints.get(connection.id) ?? null}
                  onMark={onMark}
                  onChoice={onChoice}
                  onToggleOpen={onToggleOpen}
                />
              );
            })}
          </ul>

          {/* RN-TRANSF-003: a escolha em todas as marcadas de uma vez; com a busca, só nas que ela mostra. */}
          <div role="group" aria-label={visible === null ? copy.credentials.bulk : copy.credentials.bulkSearching} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{visible === null ? copy.credentials.bulk : copy.credentials.bulkSearching}</span>
            {choiceOrder.map((choice) => (
              <Button key={choice} type="button" variant="secondary" size="sm" disabled={bulkTargets.length === 0} onClick={() => setChoices((current) => applyToMarked(current, choice, bulkTargets))}>
                {choiceLabel[choice]}
              </Button>
            ))}
          </div>

          {/* RN-TRANSF-004: a senha de exportação, sempre, digitada duas vezes. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
            <TextField
              ref={passphraseRef}
              id={passphraseID}
              label={copy.passphrase}
              type={shown ? "text" : "password"}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              error={errors.passphrase}
            />
            <TextField
              ref={passphraseAgainRef}
              id={passphraseAgainID}
              label={copy.passphraseAgain}
              type={shown ? "text" : "password"}
              value={passphraseAgain}
              onChange={(event) => setPassphraseAgain(event.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              error={errors.passphraseAgain}
            />
          </div>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={shown} onChange={(event) => setShown(event.target.checked)} className="size-4 accent-accent" />
            {copy.showPassphrase}
          </label>
          <p className="text-xs text-muted">{copy.passphraseHint}</p>
        </form>
      </Dialog>

      {/* Fora do `<form>` e do diálogo: o evento de um diálogo sobe pela árvore do React, e o `submit` dele não pode chegar ao formulário de baixo. */}
      {asking === null ? null : (
        <UserPasswordDialog
          change={asking}
          description={copy.userPassword.description}
          submitLabel={copy.userPassword.submit}
          send={(userPassword) => {
            sentAt.current = vaultLock.epoch();
            return exportConnections(exportRequestOf(selection, choices, exportPassphraseOf(passphrase), userPassword));
          }}
          refusals={afterPasswordRefusals}
          onDone={(result) => {
            setAsking(null);
            finished(result, sentAt.current, true);
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
