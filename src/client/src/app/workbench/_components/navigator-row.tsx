import type { ComponentProps, CSSProperties, KeyboardEvent, ReactNode } from "react";

import { ReadOnlyMark } from "@/app/connections/_components/read-only-mark";
import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import { engineOption, type Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { driverNotInstalledCode } from "@/app/drivers/_lib/drivers.model";
import type { NavigatorDensity } from "@/app/settings/_lib/preferences";
import { AlertIcon, Button, ChevronIcon, ColumnsIcon, DatabaseIcon, DocumentIcon, EngineTag, EyeIcon, FolderIcon, ForeignKeyIcon, IndexIcon, PowerIcon, RefreshIcon, RoutineIcon, SequenceIcon, TableIcon, iconColorStyle } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { checkView, type CheckState } from "../_lib/connection-checks";
import { connectionChecksCopy } from "../_lib/connection-checks.copy";
import { credentialsHint } from "../_lib/credentials-missing";
import { actionsWidth as actionsWidthOf, navigatorMetrics, rowIndent } from "../_lib/navigator-density";
import { clickEffect, tableTargetOf, type NavKind, type NavNode } from "../_lib/navigator-model";
import type { MatchRange } from "../_lib/navigator-search";
import { isRefreshable } from "../_lib/navigator-toolbar";
import { navigatorCopy } from "../_lib/navigator.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CheckDot } from "./connection-check";

const copy = workbenchCopy.navigator;

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "failed";

/** Os ícones de cada tipo de nó, no traço do canvas. Pasta e esquema usam o mesmo desenho, como lá; o grupo não tem ícone. */
const icons: Partial<Record<NavKind, ReactNode>> = {
  folder: <FolderIcon className="text-muted" />,
  database: <DatabaseIcon />,
  schema: <FolderIcon />,
  table: <TableIcon />,
  view: <EyeIcon />,
  routine: <RoutineIcon />,
  sequence: <SequenceIcon />,
  column: <ColumnsIcon className="text-subtle" />,
  index: <IndexIcon className="text-subtle" />,
  foreignKey: <ForeignKeyIcon className="text-subtle" />,
};

/** O clique caiu no chevron? (Sem `instanceof Element`: o alvo de um evento pode vir de outro contexto, e o teste não tem DOM.) */
const hitsChevron = (target: EventTarget) => "closest" in target && (target as Element).closest("[data-chevron]") !== null;

/** O rótulo com o trecho que a busca achou destacado (RN-BUSCA-001). Sempre texto: o nome vem do banco. */
function Highlighted({ text, range: [start, end] }: { text: string; range: MatchRange }) {
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[2px] bg-accent/30 text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const label = status === "connected" ? copy.status.connected : status === "connecting" ? copy.status.connecting : status === "failed" ? copy.status.failed : copy.status.disconnected;
  const className = status === "connected" ? "bg-success" : status === "failed" ? "bg-danger" : status === "connecting" ? "animate-pulse bg-accent" : "border-[1.5px] border-subtle";

  return <span role="img" aria-label={label} title={label} className={cn("ml-auto size-2 flex-none rounded-full", className)} />;
}

function ActionButton({ label, className, children, ...props }: { label: string } & ComponentProps<"button">) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("flex flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-border hover:text-ink disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>
      {children}
    </button>
  );
}

export type NavigatorRowProps = {
  node: NavNode;
  /** A densidade do navegador (RN-NAV-011): a altura da linha, o recuo e o tamanho dos botões de ação. Sem ela, a confortável, a do canvas. */
  density?: NavigatorDensity;
  index: number;
  open: boolean;
  /** A linha que o Tab alcança (a da última seleção); as outras só se alcançam pelas setas. */
  tabbable: boolean;
  selected: boolean;
  /** A conexão salva, só nas linhas de conexão. */
  connection?: Connection;
  /**
   * A etiqueta ao lado do nome (RN-CONN-015 e RN-PASTA-005): na pasta, o ambiente dela; na conexão, o que ela mostra, o próprio ou o herdado da
   * pasta (`environmentLookup`). Sem ela, nada.
   */
  environment?: ShownEnvironment | null;
  /** RN-PASTA-007: a cor da pasta, só na linha dela; pinta o ícone, aberta ou fechada, ajustada ao contraste do tema (`iconColorStyle`). Sem ela, o neutro. */
  folderColor?: string | null;
  /** RN-PROT-002: na linha da conexão somente leitura, a dica do cadeado (`readOnlyHintOf`), que diz de onde ele vem; sem ela, nada. */
  readOnly?: string | null;
  status?: ConnectionStatus;
  /**
   * RN-VERIF-003: o que a verificação periódica diz da conexão conectada, no lugar do ponto de conectada; sem ela (desligada, ou desconectada), o ponto de
   * sempre. A dica dele vai também na dica da linha: com o mouse em cima, as ações cobrem o ponto.
   */
  check?: CheckState | null;
  /** A falha da verificação num clique (RN-VERIF-003): o botão das ações da linha, só quando ela não respondeu. */
  onCheckFailure?: (node: NavNode) => void;
  busy?: boolean;
  onSelect: (node: NavNode) => void;
  onToggle: (node: NavNode) => void;
  onRetry: (node: NavNode) => void;
  onRefresh: (node: NavNode) => void;
  onNewQuery: (node: NavNode) => void;
  onDisconnect: (node: NavNode) => void;
  /** Duplo clique numa tabela ou visão: abre a aba dela (RN-TABELA-001). Nas demais linhas não é chamado. */
  onOpenTable: (node: NavNode) => void;
  /** O trecho do nome que a busca achou, para o destaque; só na árvore filtrada. */
  match?: MatchRange;
  /**
   * Botão direito na linha (RN-MENU-001): `point` é onde o menu abre, nas coordenadas da janela. Não vale para as linhas de aviso. Devolve se o
   * menu vai abrir: só então a linha toma o foco (é para onde ele volta quando o menu fecha); um pedido ignorado (o `contextmenu` que a tecla
   * de menu gera com o menu do teclado já aberto) não tira o foco de quem o tem.
   */
  onContextMenu: (node: NavNode, point: { x: number; y: number }) => boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, node: NavNode, index: number) => void;
};

/**
 * Uma linha do navegador (RN-ARVORE-001 a 005). Tudo o que vem do banco entra como texto dos
 * filhos do React, nunca como HTML (RN-SHELL-002). As ações do nó aparecem ao passar o mouse ou
 * receber o foco, sobre o fim da linha; o ponto de estado da conexão fica sob elas.
 */
export function NavigatorRow({ node, density = "comfortable", index, open, tabbable, selected, connection, environment, folderColor = null, readOnly = null, status, check = null, onCheckFailure, busy = false, match, onSelect, onToggle, onRetry, onRefresh, onNewQuery, onDisconnect, onOpenTable, onContextMenu, onKeyDown }: NavigatorRowProps) {
  const metrics = navigatorMetrics[density];
  const paddingLeft = rowIndent(metrics, node.depth);

  if (node.kind === "loading") {
    return (
      <div style={{ paddingLeft: paddingLeft + 22 }} className={cn("flex items-center pr-3 text-sm text-subtle italic", metrics.rowClass)}>
        {node.label}
      </div>
    );
  }

  if (node.kind === "error") {
    return (
      <div style={{ paddingLeft: paddingLeft + 22 }} className="flex flex-col items-start gap-1.5 py-1.5 pr-3">
        <p className="text-xs leading-[18px] break-words text-danger">{node.label}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Sempre na ordem do Tab: é a saída do erro. Também entra nas setas, como qualquer linha (`data-row-toggle`). */}
          <Button
            type="button"
            variant="secondary"
            size="compact"
            data-row-toggle
            onClick={() => onRetry(node)}
            onFocus={() => onSelect(node)}
            onKeyDown={(event) => onKeyDown(event, node, index)}
            className="h-7 px-2.5 text-xs"
          >
            {copy.retry}
          </Button>
          {/* RN-DRIVER-006: a conexão é de um banco cujo driver não está instalado; o caminho é a tela de Drivers. */}
          {node.errorCode === driverNotInstalledCode ? (
            <InstallDriverLink size="compact" driverID={node.errorDriverID} data-row-toggle onFocus={() => onSelect(node)} onKeyDown={(event) => onKeyDown(event, node, index)} className="h-7 px-2.5 text-xs" />
          ) : null}
        </div>
      </div>
    );
  }

  const isConnection = node.kind === "connection";
  const connected = status === "connected";
  const name = node.label;
  const hasDetail = Boolean(node.detail) && !isConnection;
  const canRefresh = isRefreshable(node, connected);
  // RN-VERIF-003: o indicador da verificação, só na conexão conectada com ela ligada; a falha ganha o botão que a mostra.
  const view = isConnection && connected && check !== null ? checkView(check) : null;
  const failed = view?.tone === "failed" && onCheckFailure !== undefined;
  // Com o mouse ou o foco na linha, o fim dela é das ações; o conteúdo se afasta delas em vez de ficar escondido.
  const actionsWidth = actionsWidthOf(metrics, Number(isConnection && connection !== undefined) + Number(canRefresh) + Number(isConnection && connected) + Number(failed));
  const opensTab = tableTargetOf(node) !== null;
  const hint = opensTab ? (node.kind === "view" ? copy.openHint.view : copy.openHint.table) : null;
  // A conexão mostra na dica o que a lista da tela de Conexões trazia embaixo do nome e a árvore não mostra: o banco e o endereço (RN-NAV-003), e a última
  // verificação (RN-VERIF-003).
  // RN-TRANSF-015: a conexão que chegou sem usuário e senha diz isso no fim da linha do endereço, sem marca na árvore.
  const tip = isConnection && connection ? `${name}\n${navigatorCopy.row.connectionHint(engineOption(connection.engine).label, connection.host, connection.port, connection.database)}${credentialsHint(connection)}${view === null ? "" : `\n${view.tip}`}` : node.detail ? `${name} — ${node.detail}` : name;

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        // A linha com o botão direito é a selecionada e a que tem o foco: é para onde o foco volta quando o menu fecha. O foco vai antes da montagem do menu,
        // que guarda de onde veio; e só se o menu abre, senão um pedido ignorado tiraria o foco do menu que já está aberto.
        if (onContextMenu(node, { x: event.clientX, y: event.clientY })) event.currentTarget.querySelector<HTMLElement>("[data-row-toggle]")?.focus({ preventScroll: true });
      }}
      className={cn("group relative flex items-center", metrics.rowClass, selected ? "bg-selected" : "hover:bg-selected")}
    >
      <button
        type="button"
        data-row-toggle
        tabIndex={tabbable ? 0 : -1}
        title={hint === null ? tip : `${tip}\n${hint}`}
        onClick={(event) => {
          onSelect(node);
          if (clickEffect(node, { detail: event.detail, onChevron: hitsChevron(event.target) }) === "toggle") onToggle(node);
        }}
        onDoubleClick={opensTab ? () => onOpenTable(node) : undefined}
        onFocus={() => onSelect(node)}
        onKeyDown={(event) => onKeyDown(event, node, index)}
        style={{ paddingLeft, "--actions-width": `${actionsWidth}px` } as CSSProperties}
        className={cn("flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-3 text-left group-focus-within:pr-(--actions-width) group-hover:pr-(--actions-width)", isConnection ? "font-semibold text-ink" : "text-body")}
      >
        {/* O chevron é o alvo de abrir e fechar na tabela, onde o clique no nome só seleciona (`clickEffect`); a área é maior que o desenho, sem mexer na linha. */}
        {node.hasChildren ? (
          <span data-chevron className="-m-1 flex-none p-1">
            <ChevronIcon className={cn("text-subtle transition-transform", !open && "-rotate-90")} />
          </span>
        ) : (
          <span aria-hidden className="size-4 flex-none" />
        )}
        {isConnection && connection ? (
          <EngineTag engine={connection.engine} />
        ) : (
          <span style={node.kind === "folder" && folderColor !== null ? { color: iconColorStyle(folderColor) } : undefined} className="flex-none text-subtle [&>svg]:text-current">
            {icons[node.kind]}
          </span>
        )}
        {/* O nome tem a prioridade: o detalhe ocupa só o que sobra, encolhe primeiro e some antes de o nome ser cortado. */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className={cn("truncate", hasDetail ? ["shrink-0", node.badge ? "max-w-[calc(100%-2.5rem)]" : "max-w-full"] : "min-w-0")}>{match === undefined ? name : <Highlighted text={name} range={match} />}</span>
          <ShownEnvironmentPill environment={environment} />
          {isConnection ? <ReadOnlyMark hint={readOnly} /> : null}
          {node.badge ? <span className="flex-none text-[11px] font-semibold text-accent">{node.badge}</span> : null}
          {hasDetail ? <span className="min-w-0 flex-1 truncate text-right text-xs text-subtle">{node.detail}</span> : null}
        </span>
        {isConnection && status ? view === null ? <StatusDot status={status} /> : <CheckDot view={view} className="ml-auto" /> : null}
      </button>

      {/* Sobre o fim da linha, no lugar do ponto de estado e dos detalhes: só enquanto o mouse ou o foco estão na linha. */}
      <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 bg-selected pl-1 group-focus-within:flex group-hover:flex">
        {failed ? (
          <ActionButton label={connectionChecksCopy.failure.open(name)} tabIndex={tabbable ? 0 : -1} onClick={() => onCheckFailure?.(node)} className={cn("text-danger", metrics.actionClass)}>
            <AlertIcon />
          </ActionButton>
        ) : null}
        {isConnection && connection ? (
          <ActionButton label={copy.newQuery(name)} tabIndex={tabbable ? 0 : -1} onClick={() => onNewQuery(node)} className={metrics.actionClass}>
            <DocumentIcon />
          </ActionButton>
        ) : null}
        {canRefresh ? (
          <ActionButton label={copy.refresh(name)} tabIndex={tabbable ? 0 : -1} onClick={() => onRefresh(node)} className={metrics.actionClass}>
            <RefreshIcon />
          </ActionButton>
        ) : null}
        {isConnection && connected ? (
          <ActionButton label={copy.disconnect(name)} tabIndex={tabbable ? 0 : -1} disabled={busy} onClick={() => onDisconnect(node)} className={metrics.actionClass}>
            <PowerIcon />
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
