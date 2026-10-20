import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, EngineTag, EnvironmentPill, Field, FieldError, FieldLabel, FormMessage, Input, Select, useToast } from "@/components/ui";
import { releaseDbeaverSource, requestDbeaverSource } from "@/lib/api/bridge";
import type { ApiError, ApiResult } from "@/lib/api/prism-api";
import { enterInputID } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { checkStates, collapsedFor, markAll, noneCollapsed, pathOf, searchVisible, shownNodes, toggle, toggleCollapsed, unmarkAll, validMarks, type CheckNode, type CheckState, type CheckTree, type Collapsed } from "../_lib/check-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import { foldersQuery, invalidateLists } from "../_lib/connections.service";
import { dbeaverCopy } from "../_lib/dbeaver.copy";
import {
  allProjects,
  apiSourceRefusal,
  connectedCount,
  connectionLine,
  dbeaverConnectionTags,
  dbeaverCounter,
  dbeaverFolderTags,
  dbeaverToast,
  drdaPortFor,
  drdaPortsOf,
  drdaRows,
  drdaSignature,
  existingMarked,
  hasAnyPassword,
  marksAfterScopeChange,
  originLabel,
  overwriteChanges,
  parseDrdaInput,
  previewNotices,
  previewSummary,
  projectNameOf,
  projectOptions,
  readRefusal,
  showsProjects,
  sourceRefusal,
  validProject,
  type DbeaverFound,
  type DbeaverStart,
  type DrdaRow,
  type SourceState,
} from "../_lib/dbeaver-model";
import type { DbeaverImportResult, DbeaverPreview, DbeaverPreviewConnection, DbeaverScan } from "../_lib/dbeaver.schema";
import { dbeaverImportMutation, dbeaverPreviewMutation, scanDbeaver } from "../_lib/dbeaver.service";
import { allImportable, importItems, invalidReason, nameOf, previewIndex, previewTree, rowDescription, type PreviewIndex, type PreviewTag } from "../_lib/import-model";
import { transferCopy } from "../_lib/transfer.copy";
import type { ConflictPolicy } from "../_lib/transfer.schema";
import { CheckRowFrame, TreeSearchBar } from "./check-tree-view";
import { ImportFolderRow, Tags } from "./import-connections-dialog";
import { ReadOnlyMark } from "./read-only-mark";

const copy = dbeaverCopy;
const importCopy = transferCopy.import;
const formID = "import-dbeaver-form";
/** "Onde colocar": a raiz do navegador, e o que fica sem escolha quando a pasta escolhida some (RN-TRANSF-014). Os IDs das pastas nunca são estes. */
const rootValue = "root";
const noChoice = "none";
/** Quanto a pessoa fica sem digitar na porta DRDA para a prévia se refazer sozinha (RN-DBEAVER-015). */
const drdaPauseMs = 500;

/** A prévia na tela, com a árvore e o índice dela. */
type ShownPreview = { data: DbeaverPreview; tree: CheckTree; index: PreviewIndex };

/** A origem do diálogo, ou nenhuma ainda (a escolha de pasta desistida logo ao abrir). */
type Origin = SourceState | { kind: "none" };

/** A pergunta de sobrescrever (RN-DBEAVER-017): a primeira tela dela, ou a lista com as caixas (`chosen` são as chaves marcadas para sobrescrever). */
type Question = { mode: "ask" } | { mode: "choose"; chosen: ReadonlySet<string> };

type DbeaverConnectionRowProps = {
  node: CheckNode;
  connection: DbeaverPreviewConnection;
  state: CheckState;
  path: string | null;
  tags: readonly PreviewTag[];
  reason: string | null;
  drdaPort: number | null;
  onToggleOpen: (key: string) => void;
  onMark: (key: string) => void;
};

/**
 * A conexão do DBeaver: a etiqueta do banco, o nome, o ambiente e o cadeado que ela terá e, numa segunda linha, o servidor (com o `INFORMIXSERVER`) e as
 * credenciais (a senha nunca, RN-CONN-001). A que não pode ser importada tem a caixa desmarcada e desabilitada, e diz por quê, embaixo, inteiro. O leitor de
 * tela ouve, na caixa, o caminho, a segunda linha e as marcas com a explicação de cada uma.
 */
const DbeaverConnectionRow = memo(function DbeaverConnectionRow({ node, connection, state, path, tags, reason, drdaPort, onToggleOpen, onMark }: DbeaverConnectionRowProps) {
  const name = nameOf(connection);
  const line = connectionLine(connection, drdaPort);
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

type ImportDbeaverDialogProps = {
  /** A pasta de onde veio ("Importar do DBeaver aqui…"), já escolhida em "Onde colocar"; `null` é a raiz do navegador (RN-DBEAVER-003). */
  targetFolderID: string | null;
  start: DbeaverStart;
  /** Aberto como convite (RN-DBEAVER-002): "Agora não" no lugar de "Cancelar". */
  invite: boolean;
  /** Importou: quem abriu lê as listas de novo e mostra no navegador o que entrou (RN-DBEAVER-014). */
  onImported: (result: DbeaverImportResult, targetFolderID: string | null) => void;
  /** Fechou: `imported` depois de importar, `dismissed` em "Cancelar", "Agora não", Esc e no X. Quem abriu como convite grava o convite nos dois (RN-DBEAVER-002). */
  onClose: (outcome: "imported" | "dismissed") => void;
};

/**
 * "Importar do DBeaver" (RN-DBEAVER-014 a 017), numa página só: o "Importar conexões" da seção 34 com outra origem. A origem é a cópia que o processo principal
 * fez (`requestDbeaverSource`; a tela só tem o identificador), a API a lê, decifra as senhas e devolve a prévia, e a importação refaz tudo com o que ficou
 * marcado. A API não guarda nada de um pedido para o outro.
 *
 * A cópia tem as senhas na cifra do DBeaver: só este diálogo aberto a segura, e ela é solta ao fechar (a API a apaga depois da importação que deu certo), ao
 * trocar de origem e em qualquer saída. A prévia e a importação ficam fora do cache de mutações (`gcTime: 0` e `reset()`), como as da RN-TRANSF-001. O bloqueio, o
 * "Sair" e o quinto erro de senha desmontam o diálogo (quem o abre confere a época do bloqueio), e nada do que estava nele sobrevive.
 *
 * Marcar e desmarcar não refaz a prévia; trocar o projeto, "Levar as senhas", o lugar ou as portas DRDA a refaz, um pedido de cada vez. Com alguma conexão
 * marcada que já existe no Prism, "Importar" abre antes a pergunta de sobrescrever.
 */
export function ImportDbeaverDialog({ targetFolderID, start, invite, onImported, onClose }: ImportDbeaverDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const folders = useQuery(foldersQuery);
  const baseId = useId();
  const startRef = useRef(start);

  const [origin, setOrigin] = useState<Origin>(start.type === "choose" ? { kind: "none" } : { kind: "searching" });
  const [originError, setOriginError] = useState<string | null>(null);
  const [projectChoice, setProjectChoice] = useState(allProjects);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [withPasswords, setWithPasswords] = useState(true);
  const [destination, setDestination] = useState(targetFolderID ?? rootValue);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [drdaValues, setDrdaValues] = useState<Readonly<Record<string, string>>>({});
  const [preview, setPreview] = useState<ShownPreview | null>(null);
  const [previewing, setPreviewing] = useState<"opening" | "refreshing" | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Collapsed>(noneCollapsed);
  const [onConflict, setOnConflict] = useState<ConflictPolicy>("rename");
  const [question, setQuestion] = useState<Question | null>(null);

  // A cópia que este diálogo segura, e as contagens que invalidam o que um pedido de antes ainda trouxer: uma por origem e uma por prévia.
  const held = useRef<string | null>(null);
  const session = useRef(0);
  const generation = useRef(0);
  // RN-DBEAVER-014: um pedido de prévia por vez. O que muda durante um espera o fim dele e refaz uma vez só, com o que valer então.
  const queuedRefresh = useRef(false);
  // O que a última prévia pediu das portas DRDA, para saber se a pessoa digitou algo depois; e o servidor de cada linha já vista (a prévia nova pode não tê-las).
  const previewedPorts = useRef("");
  /** A árvore de antes da troca de projeto, para o que ela não tinha chegar marcado (`marksAfterScopeChange`); nula sem prévia à vista. */
  const scopeBefore = useRef<CheckTree | null>(null);
  const serverOf = useRef(new Map<string, DrdaRow>());
  // "Importar" apertado com uma porta DRDA digitada e ainda não vista pela prévia: ela se refaz e a importação segue.
  const submitAfterPreview = useRef(false);

  const scan: DbeaverScan | null = origin.kind === "ready" ? origin.scan : null;
  const several = scan !== null && showsProjects(scan);
  const projectName = scan === null ? null : projectNameOf(scan, projectChoice);

  // A pasta escolhida que outra janela excluiu: o "Onde colocar" fica sem escolha, com a frase (ajuste durante a renderização, com a lista já na tela).
  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const destinationOptions = useMemo(() => [{ value: rootValue, label: importCopy.root }, ...folderOptions(buildConnectionTree(folderList, []))], [folderList]);
  if (destination !== rootValue && destination !== noChoice && folders.data !== undefined && !folders.data.some((folder) => folder.id === destination)) {
    setDestination(noChoice);
    setDestinationError(importCopy.destinationGone);
  }

  const tree = preview?.tree ?? null;
  const visible = useMemo(() => (tree === null ? null : searchVisible(tree, query)), [tree, query]);
  const states = useMemo(() => (tree === null ? new Map<string, CheckState>() : checkStates(tree, marked)), [tree, marked]);
  // RN-BUSCA-001: com a busca, o que casa aparece com os ancestrais abertos; as pastas fechadas antes dela voltam fechadas quando ela é limpa.
  const shownCollapsed = useMemo(() => collapsedFor(collapsed, query), [collapsed, query]);
  const rows = useMemo(() => (tree === null ? [] : shownNodes(tree, visible, shownCollapsed)), [tree, visible, shownCollapsed]);

  // As portas DRDA (RN-DBEAVER-010 e 015): uma linha por servidor do DBeaver com Informix marcado, e as digitadas e válidas.
  const ports = useMemo(() => (preview === null ? [] : drdaRows(preview.tree, preview.data, marked)), [preview, marked]);
  for (const row of ports) serverOf.current.set(row.key, row);
  const typedPorts = drdaPortsOf([...serverOf.current.values()], drdaValues);
  const signature = drdaSignature(typedPorts);

  // As marcas de cada linha só mudam com a prévia, a escolha dos conflitos e as portas DRDA: marcar e desmarcar não as refaz.
  const tags = useMemo(() => {
    const byKey = new Map<string, readonly PreviewTag[]>();
    if (preview === null) return byKey;
    for (const folder of preview.data.folders) byKey.set(folder.key, dbeaverFolderTags(preview.tree, preview.index, folder));
    for (const connection of preview.data.connections) byKey.set(connection.key, dbeaverConnectionTags(preview.tree, preview.index, connection, onConflict, drdaPortFor(connection, drdaValues)));
    return byKey;
  }, [preview, onConflict, drdaValues]);
  const reasons = useMemo(() => {
    const byKey = new Map<string, string | null>();
    if (preview === null) return byKey;
    for (const node of preview.tree.nodes) byKey.set(node.key, invalidReason(preview.tree, preview.index, node.key));
    return byKey;
  }, [preview]);

  const onMark = useCallback((key: string) => setMarked((current) => (tree === null ? current : toggle(tree, key, current, visible))), [tree, visible]);
  const onToggleOpen = useCallback((key: string) => setCollapsed((current) => toggleCollapsed(current, query, key)), [query]);

  // As duas levam o `sourceId` e trazem os usuários e os servidores do DBeaver: fora do cache de mutações, e esvaziadas assim que a resposta chega.
  const previewCall = useMutation(dbeaverPreviewMutation);
  const importCall = useMutation(dbeaverImportMutation(queryClient));

  // O que um pedido de prévia leva, lido na hora do pedido (e não de uma renderização antiga).
  const latest = useRef({ projectName, withPasswords, destination, typedPorts, scan });
  useEffect(() => {
    latest.current = { projectName, withPasswords, destination, typedPorts, scan };
  });

  /** A prévia apagada: a origem mudou (RN-DBEAVER-014). Vai junto o que é da prévia, e as portas digitadas (o servidor de outro DBeaver não é este). */
  function forgetPreview() {
    generation.current++;
    queuedRefresh.current = false;
    submitAfterPreview.current = false;
    previewedPorts.current = "";
    scopeBefore.current = null;
    setPreview(null);
    setPreviewing(null);
    setMarked(new Set());
    setQuery("");
    setCollapsed(noneCollapsed);
    setOnConflict("rename");
    setQuestion(null);
  }

  function forgetOrigin() {
    forgetPreview();
    serverOf.current = new Map();
    latest.current = { ...latest.current, typedPorts: [] };
    setDrdaValues({});
    setProjectChoice(allProjects);
    setOriginError(null);
    setProjectError(null);
  }

  /** A recusa da prévia ou da importação, no campo a que se refere, sem aviso de erro (RN-DBEAVER-014 e 016). */
  function showRefusal(error: ApiError) {
    const refusal = readRefusal(error.code, several);
    if (refusal === null) return;
    if (refusal.field === "destination") {
      setDestination(noChoice);
      setDestinationError(refusal.message);
      void invalidateLists(queryClient);
    } else if (refusal.field === "project") {
      setProjectError(refusal.message);
    } else if (refusal.missing) {
      // Só o 404 `DBEAVER_SOURCE_MISSING` pede a origem de novo sozinho: a cópia sumiu.
      held.current = null;
      forgetOrigin();
      setOrigin({ kind: "refused", message: refusal.message, retry: true });
    } else {
      setOriginError(refusal.message);
    }
  }

  /**
   * Pede a prévia: "opening" (tudo marcado), o que refaz com a prévia à vista (`refreshing`, as marcas continuam) ou a troca de projeto (`scoping`, as marcas
   * continuam e o que a árvore de antes não tinha chega marcado).
   */
  function requestPreview(kind: "opening" | "refreshing" | "scoping", sourceId: string) {
    const now = latest.current;
    const started = generation.current;
    previewedPorts.current = drdaSignature(now.typedPorts);
    setPreviewing(kind === "scoping" ? "opening" : kind);
    previewCall.mutate(
      { sourceId, project: now.projectName, targetFolderID: now.destination === rootValue ? null : now.destination, withPasswords: now.withPasswords, drdaPorts: now.typedPorts },
      {
        onSuccess: (result: ApiResult<DbeaverPreview>) => {
          previewCall.reset();
          if (started !== generation.current) return;

          const again = queuedRefresh.current;
          queuedRefresh.current = false;
          if (result.ok) {
            const built = previewTree(result.data);
            setPreview({ data: result.data, tree: built, index: previewIndex(result.data) });
            const before = scopeBefore.current;
            scopeBefore.current = null;
            setMarked((current) => (kind === "opening" || (kind === "scoping" && before === null) ? allImportable(built) : kind === "scoping" && before !== null ? marksAfterScopeChange(built, current, before) : validMarks(built, current)));
            setDestinationError(null);
            setOriginError(null);
            setProjectError(null);
          } else {
            submitAfterPreview.current = false;
            showRefusal(result.error);
          }

          if (again && result.ok) requestPreview("refreshing", sourceId);
          else setPreviewing(null);
        },
        onError: () => {
          previewCall.reset();
          if (started !== generation.current) return;
          queuedRefresh.current = false;
          submitAfterPreview.current = false;
          setPreviewing(null);
        },
      },
    );
  }

  /** Refaz a prévia com o que vale agora; durante um pedido, a troca espera o fim dele. */
  function refresh() {
    const sourceId = held.current;
    if (sourceId === null || (preview === null && previewing === null)) return;
    if (previewing !== null) queuedRefresh.current = true;
    else requestPreview("refreshing", sourceId);
  }

  /** A origem achada e contada: o seletor do projeto, "Levar as senhas" e a primeira prévia, tudo marcado. */
  async function scanSource(sourceId: string, where: DbeaverFound["where"], token: number) {
    held.current = sourceId;
    const result = await scanDbeaver(sourceId);
    if (token !== session.current) return;

    if (!result.ok) {
      const refusal = apiSourceRefusal(result.error);
      if (refusal.missing) held.current = null;
      setOrigin({ kind: "refused", message: refusal.message, retry: true });
      return;
    }
    const counted = result.data;
    latest.current = { ...latest.current, scan: counted, projectName: null };
    setOrigin({ kind: "ready", sourceId, where, scan: counted });
    requestPreview("opening", sourceId);
  }

  /** Procura o DBeaver (`find`) ou abre o diálogo de pasta (`choose`), e conta o que achou. A cópia anterior é solta pelo processo principal. */
  async function acquire(mode: "find" | "choose") {
    const token = ++session.current;
    if (mode === "find") {
      held.current = null;
      forgetOrigin();
      setOrigin({ kind: "searching" });
    }
    const reply = await requestDbeaverSource(mode);
    if (token !== session.current) return;
    // Desistir da escolha de pasta deixa tudo como estava.
    if (reply.status === "canceled") return;

    held.current = null;
    forgetOrigin();
    const refusal = sourceRefusal(reply);
    if (refusal !== null || reply.status !== "found") {
      setOrigin({ kind: "refused", message: refusal?.message ?? copy.source.bridge, retry: refusal?.retry ?? true });
      return;
    }
    setOrigin({ kind: "searching" });
    await scanSource(reply.sourceId, reply.where, token);
  }

  /** O diálogo sai: o que um pedido de antes ainda trouxer não vale, e a cópia é solta. */
  function retire() {
    session.current++;
    generation.current++;
    const sourceId = held.current;
    held.current = null;
    if (sourceId !== null) void releaseDbeaverSource(sourceId);
  }

  // Ao abrir: a procura, a pasta ou a cópia do convite. Ao fechar, a cópia é solta (a da importação que deu certo a API já apagou; soltar limpa o registro).
  useEffect(() => {
    const token = ++session.current;
    const opening = startRef.current;
    if (opening.type === "copy") void scanSource(opening.sourceId, opening.where, token);
    else void acquire(opening.type);
    return retire;
    // Só ao montar: as funções leem o que precisam por referências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pessoa parou de digitar numa porta DRDA: a prévia se refaz (RN-DBEAVER-015).
  useEffect(() => {
    if (preview === null || signature === previewedPorts.current) return;
    const timer = setTimeout(refresh, drdaPauseMs);
    return () => clearTimeout(timer);
    // `refresh` lê o estado de agora; o que decide é a assinatura das portas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, preview]);

  function changeProject(next: string) {
    if (scan === null || !validProject(scan, next)) return;
    setProjectChoice(next);
    setProjectError(null);
    // As chaves da prévia (`p2`, `f2_1`, `c2_1`…) levam a posição do projeto: o mesmo item tem a mesma chave em "Todos os projetos" e com o projeto escolhido, e as marcas
    // continuam (RN-DBEAVER-014). Sem prévia à vista (a anterior foi recusada), abre de novo, tudo marcado.
    const sourceId = held.current;
    if (sourceId === null) return;
    latest.current = { ...latest.current, projectName: projectNameOf(scan, next) };
    generation.current++;
    queuedRefresh.current = false;
    scopeBefore.current = preview === null ? null : preview.tree;
    setPreview(null);
    setQuery("");
    setCollapsed(noneCollapsed);
    setQuestion(null);
    requestPreview("scoping", sourceId);
  }

  function changeWithPasswords(next: boolean) {
    setWithPasswords(next);
    latest.current = { ...latest.current, withPasswords: next };
    refresh();
  }

  function changeDestination(next: string) {
    setDestination(next);
    setDestinationError(null);
    latest.current = { ...latest.current, destination: next };
    refresh();
  }

  function changePort(key: string, value: string) {
    setDrdaValues((current) => ({ ...current, [key]: value }));
  }

  /**
   * O Enter nunca importa: importar é só o botão "Importar". Sem isto, o Enter na busca, numa caixa da árvore, num rádio dos conflitos ou num campo de porta
   * enviaria o formulário (o botão do rodapé é dele, pelo atributo `form`), e gravaria no cofre tudo o que está marcado. No campo da porta DRDA o Enter só
   * confirma o que foi digitado.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const field = enterInputID(event);
    if (field === null) return;
    event.preventDefault();
    if (field.startsWith(`${baseId}-drda-`)) refresh();
  }

  /** O que a importação leva e grava; `overwrite` são as chaves das que já existem e se sobrescrevem. */
  function runImport(overwrite: string[]) {
    const sourceId = held.current;
    if (preview === null || sourceId === null || importCall.isPending || previewing !== null || destination === noChoice) return;

    const items = importItems(preview.tree, marked);
    if (items.length === 0) return;

    const target = destination === rootValue ? null : destination;
    setQuestion(null);
    importCall.mutate(
      { sourceId, project: projectName, targetFolderID: target, withPasswords, drdaPorts: typedPorts, items, onConflict, overwrite },
      {
        onSuccess: (result: ApiResult<DbeaverImportResult>) => {
          importCall.reset();
          if (!result.ok) {
            showRefusal(result.error);
            return;
          }
          const message = dbeaverToast(result.data);
          toast[message.tone](message.message);
          onImported(result.data, target);
          onClose("imported");
        },
        onError: () => importCall.reset(),
      },
    );
  }

  const existing = preview === null ? [] : existingMarked(preview.tree, preview.data, marked);

  /** "Importar": sem nenhuma marcada que já existe, grava direto; com alguma, abre a pergunta (RN-DBEAVER-016). */
  function submitNow() {
    if (existing.length === 0) runImport([]);
    else setQuestion({ mode: "ask" });
  }
  const submitRef = useRef(submitNow);
  useEffect(() => {
    submitRef.current = submitNow;
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview === null || importCall.isPending || destination === noChoice) return;
    // Uma porta DRDA digitada e ainda não vista pela prévia: ela se refaz primeiro, e a importação segue (a pergunta mostra o que muda com a porta).
    if (previewing === null && signature !== previewedPorts.current && held.current !== null) {
      submitAfterPreview.current = true;
      requestPreview("refreshing", held.current);
      return;
    }
    if (previewing !== null) return;
    submitNow();
  }

  useEffect(() => {
    if (previewing !== null || !submitAfterPreview.current) return;
    submitAfterPreview.current = false;
    submitRef.current();
  }, [previewing]);

  const importing = importCall.isPending;
  const nothingMarked = preview === null || importItems(preview.tree, marked).length === 0;
  const canImport = !nothingMarked && previewing === null && destination !== noChoice && !importing;
  const conflicts = preview === null ? 0 : preview.data.connections.filter((connection) => connection.conflict && preview.tree.byKey.get(connection.key)?.selectable === true).length;

  function close() {
    if (question !== null) setQuestion(null);
    else onClose("dismissed");
  }

  if (question !== null && preview !== null) {
    const connected = connectedCount(existing);
    const chosenKeys = question.mode === "choose" ? question.chosen : new Set<string>();
    return (
      <Dialog
        open
        size="lg"
        title={copy.overwrite.title}
        description={copy.overwrite.question(existing.length)}
        pending={importing}
        onClose={close}
        footer={
          question.mode === "ask" ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setQuestion(null)} autoFocus>
                {copy.overwrite.cancel}
              </Button>
              <Button type="button" variant="secondary" onClick={() => runImport([])}>
                {copy.overwrite.none}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setQuestion({ mode: "choose", chosen: new Set(existing.map((connection) => connection.key)) })}>
                {copy.overwrite.choose}
              </Button>
              <Button type="button" onClick={() => runImport(existing.map((connection) => connection.key))}>
                {copy.overwrite.all}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setQuestion(null)} autoFocus>
                {copy.overwrite.cancel}
              </Button>
              <Button type="button" onClick={() => runImport(existing.filter((connection) => chosenKeys.has(connection.key)).map((connection) => connection.key))}>
                {copy.overwrite.submitChosen}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-body">
            {copy.overwrite.what}
            {typedPorts.length > 0 && existing.some((connection) => connection.engine === 3) ? copy.overwrite.whatDrda : ""}
          </p>
          {connected === 0 ? null : <FormMessage tone="warning">{copy.overwrite.connected(connected)}</FormMessage>}
          {question.mode === "ask" ? null : (
            <ul aria-label={copy.overwrite.list} className="flex max-h-[20rem] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-panel p-1">
              {existing.map((connection) => {
                const changes = overwriteChanges(connection, drdaPortFor(connection, drdaValues));
                const info = connection.existing;
                const rowId = `${baseId}-overwrite-${connection.key}`;
                return (
                  <li key={connection.key} className="flex items-start gap-2 rounded px-2 py-1.5">
                    <input
                      id={rowId}
                      type="checkbox"
                      checked={chosenKeys.has(connection.key)}
                      onChange={(event) =>
                        setQuestion((current) => {
                          if (current?.mode !== "choose") return current;
                          const next = new Set(current.chosen);
                          if (event.target.checked) next.add(connection.key);
                          else next.delete(connection.key);
                          return { mode: "choose", chosen: next };
                        })
                      }
                      className="mt-1 size-4 flex-none accent-accent"
                    />
                    <label htmlFor={rowId} className="flex min-w-0 flex-1 cursor-pointer flex-col">
                      <span className="truncate text-ink">{info?.name ?? nameOf(connection)}</span>
                      {info?.path ? <span className="truncate text-xs text-muted">{info.path}</span> : null}
                      <span className="text-xs text-body">{changes.join("; ")}</span>
                      {info?.connected === true ? <span className="text-xs text-accent">{copy.overwrite.rowConnected}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>
    );
  }

  const notices = preview === null ? [] : previewNotices(preview.data.notes, projectName !== null || !several);
  const infoNotices = notices.filter((notice) => notice.tone === "info");
  const warningNotices = notices.filter((notice) => notice.tone === "warning");

  return (
    <Dialog
      open
      size="lg"
      title={copy.dialog.title}
      description={copy.dialog.description}
      pending={importing}
      onClose={close}
      footer={
        <>
          <p role="status" className="mr-auto self-center text-sm text-muted">
            {preview === null ? "" : dbeaverCounter(preview.tree, marked, existing.length)}
          </p>
          <Button type="button" variant="secondary" onClick={() => onClose("dismissed")} disabled={importing}>
            {invite ? copy.dialog.later : copy.dialog.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={!canImport}>
            {importing ? copy.dialog.submitting : copy.dialog.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate className="flex flex-col gap-4">
        {/* RN-DBEAVER-014: a origem, com o botão da pasta e, nas recusas, "Tentar de novo". */}
        <Field>
          <FieldLabel htmlFor={`${baseId}-origin`}>{copy.dialog.origin}</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            {origin.kind === "ready" || origin.kind === "searching" ? (
              <span id={`${baseId}-origin`} aria-live="polite" className="min-w-0 text-sm text-body">
                {origin.kind === "ready" ? originLabel(origin.where) : copy.source.searching}
              </span>
            ) : (
              <span id={`${baseId}-origin`} role="status" className="min-w-0 text-sm text-body">
                {origin.kind === "refused" ? origin.message : copy.source.none}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {origin.kind === "refused" && origin.retry ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void acquire("find")} disabled={importing}>
                {copy.source.retry}
              </Button>
            ) : null}
            {origin.kind === "searching" ? null : (
              <Button type="button" variant="secondary" size="sm" onClick={() => void acquire("choose")} disabled={importing || previewing === "opening"} aria-describedby={`${baseId}-origin`}>
                {copy.source.chooseFolder}
              </Button>
            )}
          </div>
          <FieldError id={`${baseId}-origin-error`} role="alert">
            {originError}
          </FieldError>
        </Field>

        {scan === null ? null : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
            {several ? (
              <Field>
                <FieldLabel htmlFor={`${baseId}-project`}>{copy.dialog.project}</FieldLabel>
                <Select id={`${baseId}-project`} value={projectChoice} onChange={changeProject} options={projectOptions(scan.projects)} invalid={projectError !== null} disabled={importing} aria-describedby={projectError === null ? undefined : `${baseId}-project-error`} />
                <FieldError id={`${baseId}-project-error`} role="alert">
                  {projectError}
                </FieldError>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor={`${baseId}-destination`}>{importCopy.destination}</FieldLabel>
              <Select id={`${baseId}-destination`} value={destination} onChange={changeDestination} options={destinationOptions} invalid={destinationError !== null} disabled={importing} aria-describedby={destinationError === null ? undefined : `${baseId}-destination-error`} />
              <FieldError id={`${baseId}-destination-error`} role="alert">
                {destinationError}
              </FieldError>
            </Field>
          </div>
        )}

        {scan === null || !hasAnyPassword(scan) ? null : (
          <div className="flex flex-col gap-1">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
              <input type="checkbox" checked={withPasswords} onChange={(event) => changeWithPasswords(event.target.checked)} disabled={importing} aria-describedby={`${baseId}-passwords-help`} className="size-4 accent-accent" />
              {copy.dialog.withPasswords}
            </label>
            <p id={`${baseId}-passwords-help`} className="text-xs text-muted">
              {copy.dialog.withPasswordsHelp}
            </p>
          </div>
        )}

        {/* RN-DBEAVER-015: a prévia, sozinha, no lugar da frase que diz que ela vem. */}
        <section aria-label={copy.dialog.previewLabel} aria-busy={previewing !== null} className="flex flex-col gap-3 border-t border-border pt-4">
          <p aria-live="polite" className={preview === null ? "text-muted" : "text-ink"}>
            {preview === null ? (origin.kind === "ready" || origin.kind === "searching" ? copy.dialog.placeholder : "") : previewSummary(preview.data, projectName, withPasswords)}
          </p>
          {preview === null ? null : (
            <>
              {previewing === "refreshing" ? (
                <p role="status" className="text-sm text-muted">
                  {copy.dialog.refreshing}
                </p>
              ) : null}
              {origin.kind === "ready" && origin.where === "chosen" ? <FormMessage tone="warning">{copy.preview.servers}</FormMessage> : null}
              {warningNotices.map((notice) => (
                <FormMessage key={notice.key} tone="warning">
                  {notice.text}
                </FormMessage>
              ))}
              {infoNotices.map((notice) => (
                <p key={notice.key} className="text-sm text-muted">
                  {notice.text}
                </p>
              ))}

              {/* RN-DBEAVER-010 e 015: a porta DRDA de cada servidor do Informix marcado. Vazio, a porta é a do DBeaver. */}
              {ports.length === 0 ? null : (
                <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <legend className="px-1 text-sm text-ink">{copy.drda.title}</legend>
                  <p className="text-xs text-muted">{copy.drda.help}</p>
                  <table aria-label={copy.drda.table} className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th scope="col" className="py-1 pr-3 font-normal">
                          {copy.drda.server}
                        </th>
                        <th scope="col" className="w-40 py-1 font-normal">
                          {copy.drda.title}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ports.map((port) => {
                        const value = drdaValues[port.key] ?? "";
                        const invalid = parseDrdaInput(value).kind === "invalid";
                        const fieldId = `${baseId}-drda-${port.key}`;
                        return (
                          <tr key={port.key} className="align-top">
                            <th scope="row" className="py-1 pr-3 text-left font-normal text-body">
                              <span className="break-all">{port.host}</span> <span className="text-muted">· {copy.drda.sqli(port.port)}</span>
                              {port.server === null ? null : <span className="text-muted"> · {copy.preview.server(port.server)}</span>}
                            </th>
                            <td className="py-1">
                              <Input
                                id={fieldId}
                                aria-label={copy.drda.field(port.host)}
                                value={value}
                                onChange={(event) => changePort(port.key, event.target.value)}
                                inputMode="numeric"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={copy.drda.placeholder}
                                aria-invalid={invalid || undefined}
                                aria-describedby={invalid ? `${fieldId}-error` : undefined}
                                disabled={importing}
                              />
                              <FieldError id={`${fieldId}-error`}>{invalid ? copy.drda.invalid : undefined}</FieldError>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </fieldset>
              )}

              {preview.tree.nodes.length === 0 ? null : (
                <>
                  <TreeSearchBar id={`${baseId}-search`} query={query} onQuery={setQuery} onMarkAll={() => setMarked((current) => markAll(preview.tree, current, visible))} onUnmarkAll={() => setMarked((current) => unmarkAll(preview.tree, current, visible))} />
                  <ul aria-label={copy.dialog.tree} className="max-h-[22rem] min-h-32 overflow-y-auto rounded-md border border-border bg-panel p-1">
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
                      const connection = preview.data.connections.find((candidate) => candidate.key === node.key);
                      return connection === undefined ? null : (
                        <DbeaverConnectionRow
                          key={node.key}
                          node={node}
                          connection={connection}
                          state={state}
                          path={pathOf(preview.tree, node.key)}
                          tags={rowTags}
                          reason={reason}
                          drdaPort={drdaPortFor(connection, drdaValues)}
                          onToggleOpen={onToggleOpen}
                          onMark={onMark}
                        />
                      );
                    })}
                  </ul>
                </>
              )}

              {/* RN-TRANSF-012: a escolha única dos conflitos de nome, só quando há algum. */}
              {conflicts === 0 ? null : (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm text-ink">{importCopy.conflicts.legend}</legend>
                  {(["rename", "skip"] as const).map((policy) => (
                    <label key={policy} className="flex w-fit cursor-pointer items-center gap-2 text-sm text-body">
                      <input type="radio" name={`${baseId}-conflict`} value={policy} checked={onConflict === policy} onChange={() => setOnConflict(policy)} className="size-4 accent-accent" />
                      {policy === "rename" ? importCopy.conflicts.rename : importCopy.conflicts.skip}
                    </label>
                  ))}
                  <p className="text-xs text-muted">{importCopy.conflicts.count(conflicts)}</p>
                </fieldset>
              )}
            </>
          )}
        </section>
      </form>
    </Dialog>
  );
}
