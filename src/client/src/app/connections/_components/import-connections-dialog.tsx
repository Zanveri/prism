import { memo, useCallback, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, EngineTag, EnvironmentPill, Field, FieldError, FieldLabel, FormMessage, Select, TextField, useToast } from "@/components/ui";
import type { ApiError, ApiResult } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";
import { enterInputID } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
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
  type CheckTree,
  type Collapsed,
} from "../_lib/check-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import { foldersQuery, invalidateLists } from "../_lib/connections.service";
import {
  allImportable,
  conflictCount,
  connectionLine,
  connectionTags,
  fileSizeLabel,
  folderTags,
  importCounter,
  importFileMaxBytes,
  importItems,
  importToast,
  invalidReason,
  nameOf,
  ownQueryCount,
  previewIndex,
  previewSummary,
  previewTree,
  readRefusal,
  rowDescription,
  type PreviewIndex,
  type PreviewTag,
} from "../_lib/import-model";
import { importPassphraseError, importPassphraseOf } from "../_lib/passphrase";
import { transferCopy } from "../_lib/transfer.copy";
import type { ConflictPolicy, ImportPreview, ImportResult, PreviewConnection, PreviewFolder } from "../_lib/transfer.schema";
import { importMutation, previewMutation } from "../_lib/transfer.service";
import { CheckRowFrame, FolderGlyph, TreeSearchBar } from "./check-tree-view";
import { ReadOnlyMark } from "./read-only-mark";

const copy = transferCopy.import;
const formID = "import-connections-form";
/** "Onde colocar": a raiz do navegador, e o que fica sem escolha quando a pasta escolhida some (RN-TRANSF-014). Os IDs das pastas nunca são estes. */
const rootValue = "root";
const noChoice = "none";

/** O arquivo escolhido, lido como texto e guardado só no diálogo (RN-TRANSF-009). */
type ChosenFile = { name: string; size: number; content: string | null };

/** A prévia na tela, com a árvore e o índice dela. */
type ShownPreview = { data: ImportPreview; tree: CheckTree; index: PreviewIndex };

const tagTones: Record<PreviewTag["tone"], string> = {
  neutral: "border-border-strong text-muted",
  attention: "border-accent/50 text-accent",
  danger: "border-danger/50 text-danger",
};

/** As marcas à direita da linha, com a explicação na dica (RN-TRANSF-011). */
function Tags({ tags }: { tags: readonly PreviewTag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex max-w-[45%] flex-none flex-wrap justify-end gap-1">
      {tags.map((tag) => (
        <span key={tag.label} title={tag.hint} className={cn("rounded-full border px-2 text-xs leading-5 whitespace-nowrap", tagTones[tag.tone])}>
          {tag.label}
        </span>
      ))}
    </span>
  );
}

type FolderRowProps = {
  node: CheckNode;
  folder: PreviewFolder;
  state: CheckState;
  open: boolean;
  path: string | null;
  tags: readonly PreviewTag[];
  reason: string | null;
  onToggleOpen: (key: string) => void;
  onMark: (key: string) => void;
};

/**
 * A pasta do arquivo: o ícone com a cor, o nome, o ambiente e o cadeado dela; a que não pode ser importada diz por quê, embaixo, inteiro. O leitor de tela
 * ouve, na caixa, o caminho e as marcas com a explicação de cada uma (`rowDescription`).
 */
const ImportFolderRow = memo(function ImportFolderRow({ node, folder, state, open, path, tags, reason, onToggleOpen, onMark }: FolderRowProps) {
  const name = nameOf(folder);
  const descriptionId = useId();
  const description = rowDescription({ path, line: null, reason, tags });
  return (
    <CheckRowFrame
      node={node}
      state={state}
      open={open}
      disabled={!node.selectable}
      name={name}
      description={description === "" ? null : { id: descriptionId, text: description }}
      onToggleOpen={onToggleOpen}
      onMark={onMark}
      trailing={<Tags tags={tags} />}
      note={reason ?? undefined}
    >
      <FolderGlyph color={folder.color} />
      <span className="min-w-0 truncate text-ink">{name}</span>
      <EnvironmentPill name={folder.environmentName} color={folder.environmentColor} />
      <ReadOnlyMark hint={folder.readOnly ? connectionsCopy.protections.readOnlyMark(null) : null} />
    </CheckRowFrame>
  );
});

type ConnectionRowProps = {
  node: CheckNode;
  connection: PreviewConnection;
  state: CheckState;
  path: string | null;
  tags: readonly PreviewTag[];
  reason: string | null;
  onToggleOpen: (key: string) => void;
  onMark: (key: string) => void;
};

/**
 * A conexão do arquivo: a etiqueta do banco, o nome, o ambiente e o cadeado que valiam nela na origem e, numa segunda linha, o servidor e as credenciais (a
 * senha nunca, RN-CONN-001). A que não pode ser importada tem a caixa desmarcada e desabilitada, e diz por quê, embaixo, inteiro: na segunda linha, que
 * corta, o motivo ficaria escondido. O leitor de tela ouve, na caixa, o caminho, a segunda linha e as marcas com a explicação de cada uma.
 */
const ImportConnectionRow = memo(function ImportConnectionRow({ node, connection, state, path, tags, reason, onToggleOpen, onMark }: ConnectionRowProps) {
  const name = nameOf(connection);
  const line = connectionLine(connection);
  const descriptionId = useId();
  return (
    <CheckRowFrame
      node={node}
      state={state}
      open={false}
      disabled={!node.selectable}
      name={name}
      description={{ id: descriptionId, text: rowDescription({ path, line, reason, tags }) }}
      onToggleOpen={onToggleOpen}
      onMark={onMark}
      trailing={<Tags tags={tags} />}
      detail={line}
      note={reason ?? undefined}
    >
      {connection.engine === null ? null : <EngineTag engine={connection.engine} />}
      <span className="min-w-0 truncate text-ink">{name}</span>
      <EnvironmentPill name={connection.effective.environmentName} color={connection.effective.environmentColor} />
      <ReadOnlyMark hint={connection.effective.readOnly ? connectionsCopy.protections.readOnlyMark(null) : null} />
    </CheckRowFrame>
  );
});

type ImportConnectionsDialogProps = {
  /** A pasta de onde veio ("Importar conexões aqui…"), já escolhida em "Onde colocar"; `null` é a raiz do navegador (RN-TRANSF-001). */
  targetFolderID: string | null;
  /** Importou: quem abriu lê as listas de novo e mostra no navegador o que entrou (RN-TRANSF-014). */
  onImported: (result: ImportResult, targetFolderID: string | null) => void;
  onClose: () => void;
};

/**
 * "Importar conexões" (RN-TRANSF-009 a 014), o diálogo grande, numa página só. A tela lê o arquivo escolhido como texto (um `<input type="file">` e o
 * `File.text()`, sem canal novo no Electron) e o manda à API com a senha de exportação: a prévia mostra o que o arquivo traz e o que a importação faria no
 * lugar escolhido, e a importação refaz tudo com o que ficou marcado. A API não guarda nada de um pedido para o outro, então cada um leva o arquivo e a senha.
 *
 * O arquivo, a senha e a prévia são só estado daqui: nada fica no cache de mutações (`gcTime: 0` e `reset()` assim que a resposta chega), e o diálogo
 * fechado (Cancelar, Esc, o bloqueio, "Sair") não deixa nada. Enquanto "Abrindo…" ou "Atualizando a prévia…" ele fecha, e a resposta que chegar é
 * ignorada (a prévia não grava nada); enquanto "Importando…", não fecha.
 */
export function ImportConnectionsDialog({ targetFolderID, onImported, onClose }: ImportConnectionsDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const folders = useQuery(foldersQuery);
  const baseId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const passphraseID = `${baseId}-passphrase`;

  const [file, setFile] = useState<ChosenFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [shown, setShown] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [destination, setDestination] = useState(targetFolderID ?? rootValue);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShownPreview | null>(null);
  const [previewing, setPreviewing] = useState<"opening" | "refreshing" | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Collapsed>(noneCollapsed);
  const [onConflict, setOnConflict] = useState<ConflictPolicy>("rename");
  const [keepQueries, setKeepQueries] = useState(false);
  // Trocar o arquivo ou a senha apaga a prévia: a resposta de um pedido de antes não vale mais (o número dele não é o de agora).
  const generation = useRef(0);
  // RN-TRANSF-009: um pedido de prévia por vez. A troca de lugar durante "Atualizando a prévia…" espera o fim dele e refaz uma vez só, com o último lugar.
  const queuedRefresh = useRef<string | null>(null);

  // A pasta escolhida que outra janela excluiu: o "Onde colocar" fica sem escolha, com a frase (ajuste durante a renderização, com a lista já na tela).
  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const destinationOptions = useMemo(() => [{ value: rootValue, label: copy.root }, ...folderOptions(buildConnectionTree(folderList, []))], [folderList]);
  if (destination !== rootValue && destination !== noChoice && folders.data !== undefined && !folders.data.some((folder) => folder.id === destination)) {
    setDestination(noChoice);
    setDestinationError(copy.destinationGone);
  }

  const tree = preview?.tree ?? null;
  const visible = useMemo(() => (tree === null ? null : searchVisible(tree, query)), [tree, query]);
  const states = useMemo(() => (tree === null ? new Map<string, CheckState>() : checkStates(tree, marked)), [tree, marked]);
  // RN-BUSCA-001: com a busca, o que casa aparece com os ancestrais abertos; as pastas fechadas antes dela voltam fechadas quando ela é limpa.
  const shownCollapsed = useMemo(() => collapsedFor(collapsed, query), [collapsed, query]);
  const rows = useMemo(() => (tree === null ? [] : shownNodes(tree, visible, shownCollapsed)), [tree, visible, shownCollapsed]);
  // As marcas de cada linha só mudam com a prévia, a escolha dos conflitos e a caixa das consultas: marcar e desmarcar não as refaz.
  const tags = useMemo(() => {
    const byKey = new Map<string, readonly PreviewTag[]>();
    if (preview === null) return byKey;
    for (const folder of preview.data.folders) byKey.set(folder.key, folderTags(preview.tree, preview.index, folder));
    for (const connection of preview.data.connections) byKey.set(connection.key, connectionTags(preview.tree, preview.index, connection, onConflict, keepQueries));
    return byKey;
  }, [preview, onConflict, keepQueries]);
  const reasons = useMemo(() => {
    const byKey = new Map<string, string | null>();
    if (preview === null) return byKey;
    for (const node of preview.tree.nodes) byKey.set(node.key, invalidReason(preview.tree, preview.index, node.key));
    return byKey;
  }, [preview]);

  const onMark = useCallback((key: string) => setMarked((current) => (tree === null ? current : toggle(tree, key, current, visible))), [tree, visible]);
  const onToggleOpen = useCallback((key: string) => setCollapsed((current) => toggleCollapsed(current, query, key)), [query]);

  // As duas levam o arquivo e a senha de exportação: fora do cache de mutações, e esvaziadas assim que a resposta chega (RN-TRANSF-001).
  const previewCall = useMutation(previewMutation);
  const importCall = useMutation(importMutation(queryClient));

  /**
   * A prévia apagada: o arquivo ou a senha mudou, e é preciso abrir de novo (RN-TRANSF-009). Vai junto o que é da prévia: a busca, as pastas fechadas (as
   * chaves `f1`, `c1`… se repetem de um arquivo do Prism para outro, e as pastas da próxima prévia começam abertas), a escolha dos conflitos e a caixa
   * "Manter as consultas de verificação do arquivo", que volta desmarcada, o padrão mais seguro (RN-TRANSF-011): o arquivo de outra pessoa não herda o
   * "manter" dado ao de antes. O lugar fica: foi a pessoa que o escolheu.
   */
  function forgetPreview() {
    generation.current++;
    queuedRefresh.current = null;
    setPreview(null);
    setPreviewing(null);
    setMarked(new Set());
    setQuery("");
    setCollapsed(noneCollapsed);
    setOnConflict("rename");
    setKeepQueries(false);
  }

  /** A recusa da leitura do arquivo, no campo a que se refere, sem aviso de erro (RN-TRANSF-009). */
  function showRefusal(error: ApiError) {
    const refusal = readRefusal(error.code);
    if (refusal === null) return;
    if (refusal.field === "file") {
      // O foco vai ao campo, como na recusa da senha; a frase tem papel de alerta e é anunciada.
      setFileError(refusal.message);
      fileButtonRef.current?.focus();
    } else if (refusal.field === "destination") {
      setDestination(noChoice);
      setDestinationError(refusal.message);
      void invalidateLists(queryClient);
    } else {
      // A senha recusada fica no campo, selecionada: é a que um colega passou, e o "Mostrar senha" ajuda a achar o erro de digitação. A frase é da tela,
      // e não o detalhe da API (RN-TRANSF-010).
      setPassphraseError(error.code === "IMPORT_PASSPHRASE_INVALID" ? (importPassphraseError(passphrase) ?? refusal.message) : refusal.message);
      passphraseRef.current?.focus();
      passphraseRef.current?.select();
    }
  }

  /** Pede a prévia do lugar dado: "Abrir arquivo" (`opening`, tudo marcado) ou a troca de lugar com a prévia à vista (`refreshing`, as marcas continuam). */
  function requestPreview(kind: "opening" | "refreshing", place: string) {
    if (file?.content == null) return;
    const started = generation.current;
    setPreviewing(kind);
    previewCall.mutate(
      { content: file.content, passphrase: importPassphraseOf(passphrase), targetFolderID: place === rootValue ? null : place },
      {
        onSuccess: (result: ApiResult<ImportPreview>) => {
          previewCall.reset();
          if (started !== generation.current) return;

          const queued = queuedRefresh.current;
          queuedRefresh.current = null;
          if (result.ok) {
            const tree = previewTree(result.data);
            setPreview({ data: result.data, tree, index: previewIndex(result.data) });
            setMarked((current) => (kind === "opening" ? allImportable(tree) : validMarks(tree, current)));
            setDestinationError(null);
          } else {
            showRefusal(result.error);
          }

          if (queued !== null && result.ok) requestPreview("refreshing", queued);
          else setPreviewing(null);
        },
        onError: () => {
          previewCall.reset();
          if (started !== generation.current) return;
          queuedRefresh.current = null;
          setPreviewing(null);
        },
      },
    );
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // O mesmo arquivo escolhido de novo tem de chegar aqui outra vez.
    event.target.value = "";
    if (chosen === undefined) return;

    forgetPreview();
    setFileError(null);
    // RN-TRANSF-009: o arquivo de mais de 5 MiB é recusado antes de ser lido, com a frase da API para os limites.
    if (chosen.size > importFileMaxBytes) {
      setFile({ name: chosen.name, size: chosen.size, content: null });
      setFileError(copy.fileErrors.limits);
      return;
    }

    const started = generation.current;
    try {
      const content = await chosen.text();
      if (started === generation.current) setFile({ name: chosen.name, size: chosen.size, content });
    } catch {
      if (started !== generation.current) return;
      setFile({ name: chosen.name, size: chosen.size, content: null });
      setFileError(copy.unreadable);
    }
  }

  function handleOpen() {
    if (previewing !== null || importCall.isPending) return;

    const missingFile = file === null ? copy.fileRequired : null;
    const refusedPassphrase = importPassphraseError(passphrase);
    if (missingFile !== null) setFileError(missingFile);
    setPassphraseError(refusedPassphrase);
    if (destination === noChoice) setDestinationError(copy.destinationGone);
    if (missingFile !== null || fileError !== null || refusedPassphrase !== null || destination === noChoice) return;

    requestPreview("opening", destination);
  }

  function changeDestination(next: string) {
    setDestination(next);
    setDestinationError(null);
    if (preview === null && previewing !== "opening") return;
    // Com a prévia à vista, ela se refaz sozinha; durante um pedido, a troca espera o fim dele.
    if (previewing !== null) queuedRefresh.current = next;
    else requestPreview("refreshing", next);
  }

  /**
   * O Enter nunca importa: importar é só o botão "Importar". Sem isto, o Enter na busca, numa caixa da árvore, num rádio dos conflitos ou na caixa das
   * consultas enviaria o formulário (o botão do rodapé é dele, pelo atributo `form`), e gravaria no cofre tudo o que está marcado. Na senha de exportação,
   * antes da prévia, o Enter é o "Abrir arquivo".
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const field = enterInputID(event);
    if (field === null) return;
    event.preventDefault();
    if (field === passphraseID && preview === null) handleOpen();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview === null || file?.content == null || importCall.isPending || previewing !== null || destination === noChoice) return;

    const items = importItems(preview.tree, marked);
    if (items.length === 0) return;

    const target = destination === rootValue ? null : destination;
    importCall.mutate(
      { content: file.content, passphrase: importPassphraseOf(passphrase), targetFolderID: target, items, onConflict, keepVerificationQueries: keepQueries },
      {
        onSuccess: (result: ApiResult<ImportResult>) => {
          importCall.reset();
          if (!result.ok) {
            showRefusal(result.error);
            return;
          }
          const message = importToast(result.data);
          toast[message.tone](message.message);
          onImported(result.data, target);
          onClose();
        },
        onError: () => importCall.reset(),
      },
    );
  }

  const importing = importCall.isPending;
  const conflicts = preview === null ? 0 : conflictCount(preview.tree, preview.data);
  const ownQueries = preview === null ? 0 : ownQueryCount(preview.tree, preview.data);
  const nothingMarked = preview === null || importItems(preview.tree, marked).length === 0;
  const canImport = !nothingMarked && previewing === null && destination !== noChoice && !importing;

  return (
    <Dialog
      open
      size="lg"
      title={copy.title}
      description={copy.description}
      pending={importing}
      onClose={onClose}
      footer={
        <>
          <p role="status" className="mr-auto self-center text-sm text-muted">
            {preview === null ? "" : importCounter(preview.tree, marked)}
          </p>
          <Button type="button" variant="secondary" onClick={onClose} disabled={importing}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={!canImport}>
            {importing ? copy.submitting : copy.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate className="flex flex-col gap-4">
        {/* RN-TRANSF-009: o arquivo, a senha e o lugar. */}
        <Field>
          <FieldLabel htmlFor={`${baseId}-file`}>{copy.file}</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            {/* O diálogo de abrir do sistema mostra os `.prismconexoes` e aceita "Todos os arquivos"; quem o abre é o botão, que tem o rótulo. */}
            <input ref={fileInput} type="file" accept=".prismconexoes" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void handleFile(event)} />
            <Button
              ref={fileButtonRef}
              id={`${baseId}-file`}
              type="button"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
              aria-describedby={fileError === null ? undefined : `${baseId}-file-error`}
            >
              {copy.chooseFile}
            </Button>
            <span className="min-w-0 truncate text-sm text-body">{file === null ? copy.noFile : copy.chosen(file.name, fileSizeLabel(file.size))}</span>
          </div>
          <FieldError id={`${baseId}-file-error`} role="alert">
            {fileError}
          </FieldError>
        </Field>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
          <div className="flex flex-col gap-2">
            <TextField
              ref={passphraseRef}
              id={passphraseID}
              label={copy.passphrase}
              type={shown ? "text" : "password"}
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                setPassphraseError(null);
                forgetPreview();
              }}
              autoComplete="off"
              spellCheck={false}
              error={passphraseError ?? undefined}
              disabled={importing}
            />
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
              <input type="checkbox" checked={shown} onChange={(event) => setShown(event.target.checked)} className="size-4 accent-accent" />
              {copy.showPassphrase}
            </label>
          </div>
          <Field>
            <FieldLabel htmlFor={`${baseId}-destination`}>{copy.destination}</FieldLabel>
            <Select id={`${baseId}-destination`} value={destination} onChange={changeDestination} options={destinationOptions} invalid={destinationError !== null} disabled={importing} aria-describedby={destinationError === null ? undefined : `${baseId}-destination-error`} />
            <FieldError id={`${baseId}-destination-error`} role="alert">
              {destinationError}
            </FieldError>
          </Field>
        </div>

        <div>
          <Button type="button" variant="secondary" onClick={handleOpen} disabled={previewing !== null || importing}>
            {previewing === "opening" ? copy.opening : copy.open}
          </Button>
        </div>

        {/* RN-TRANSF-011: a prévia, no lugar da frase que diz como chegar a ela. */}
        <section aria-label={copy.preview.label} aria-busy={previewing !== null} className="flex flex-col gap-3 border-t border-border pt-4">
          {/* Sempre na tela, e com o texto trocado: a região anuncia o resumo quando a prévia chega. */}
          <p aria-live="polite" className={preview === null ? "text-muted" : "text-ink"}>
            {preview === null ? (previewing === "opening" ? copy.opening : copy.placeholder) : previewSummary(preview.data)}
          </p>
          {preview === null ? null : (
            <>
              {previewing === "refreshing" ? (
                <p role="status" className="text-sm text-muted">
                  {copy.refreshing}
                </p>
              ) : null}
              <FormMessage tone="warning">{copy.preview.servers}</FormMessage>
              {preview.tree.nodes.length === 0 ? null : (
                <>
                  <TreeSearchBar id={`${baseId}-search`} query={query} onQuery={setQuery} onMarkAll={() => setMarked((current) => markAll(preview.tree, current, visible))} onUnmarkAll={() => setMarked((current) => unmarkAll(preview.tree, current, visible))} />
                  <ul aria-label={copy.preview.tree} className="max-h-[22rem] min-h-32 overflow-y-auto rounded-md border border-border bg-panel p-1">
                    {rows.length === 0 && visible !== null ? <li className="px-2 py-1.5 text-muted">{transferCopy.tree.nothingFound(query.trim())}</li> : null}
                    {rows.map((node) => {
                      const state = states.get(node.key) ?? "unchecked";
                      const rowTags = tags.get(node.key) ?? [];
                      const reason = reasons.get(node.key) ?? null;
                      if (node.kind === "folder") {
                        const folder = preview.index.folders.get(node.key);
                        return folder === undefined ? null : (
                          <ImportFolderRow
                            key={node.key}
                            node={node}
                            folder={folder}
                            state={state}
                            open={!shownCollapsed.has(node.key)}
                            path={pathOf(preview.tree, node.key)}
                            tags={rowTags}
                            reason={reason}
                            onToggleOpen={onToggleOpen}
                            onMark={onMark}
                          />
                        );
                      }
                      const connection = preview.index.connections.get(node.key);
                      return connection === undefined ? null : (
                        <ImportConnectionRow key={node.key} node={node} connection={connection} state={state} path={pathOf(preview.tree, node.key)} tags={rowTags} reason={reason} onToggleOpen={onToggleOpen} onMark={onMark} />
                      );
                    })}
                  </ul>
                </>
              )}

              {/* RN-TRANSF-012: a escolha única dos conflitos de nome, só quando há algum. */}
              {conflicts === 0 ? null : (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm text-ink">{copy.conflicts.legend}</legend>
                  {(["rename", "skip"] as const).map((policy) => (
                    <label key={policy} className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
                      <input type="radio" name={`${baseId}-conflict`} value={policy} checked={onConflict === policy} onChange={() => setOnConflict(policy)} className="size-4 accent-accent" />
                      {policy === "rename" ? copy.conflicts.rename : copy.conflicts.skip}
                    </label>
                  ))}
                  <p className="text-xs text-muted">{copy.conflicts.count(conflicts)}</p>
                </fieldset>
              )}

              {/* RN-TRANSF-011: as consultas de verificação próprias do arquivo entram com a consulta do banco, a não ser que a pessoa as mantenha. */}
              {ownQueries === 0 ? null : (
                <div className="flex flex-col gap-1">
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
                    <input type="checkbox" checked={keepQueries} onChange={(event) => setKeepQueries(event.target.checked)} className="size-4 accent-accent" />
                    {copy.queries.keep}
                  </label>
                  <p className="text-xs text-muted">{copy.queries.hint(ownQueries)}</p>
                </div>
              )}
            </>
          )}
        </section>
      </form>
    </Dialog>
  );
}
