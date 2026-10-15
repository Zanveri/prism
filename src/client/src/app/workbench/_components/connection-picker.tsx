import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup, type EnvironmentLookup, type ShownEnvironment } from "@/app/connections/_lib/environment";
import { CheckIcon, ChevronIcon, EngineTag, PlugIcon } from "@/components/ui";
import { engineTags } from "@/components/ui/engine-tag";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

import { connectionReveal } from "../_lib/connection-intent";
import { choiceKeyTarget, connectionChoices, connectionShortcut, connectionShortcutLabel, type ConnectionChoice } from "../_lib/tab-connection";
import { useConnectedIds } from "../_lib/use-connected-ids";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.editor.connection;

/** A largura da lista e o espaço até o botão; a altura máxima é a do `Select` com a busca e o "Mostrar no navegador". */
const panelWidth = 400;
const gap = 6;
const margin = 8;
const maxPanelHeight = 400;

type ConnectionButtonViewProps = {
  /** A conexão da aba; `null` na aba sem conexão, e `undefined` enquanto a lista de conexões não chegou. */
  connection: Connection | null | undefined;
  environment: ShownEnvironment | null;
  shortcut: { label: string; aria: string };
  open: boolean;
  panelId: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onToggle: () => void;
};

/**
 * RN-ARVORE-008, só o desenho do botão: a sigla do banco, o nome da conexão e a etiqueta do ambiente (o próprio ou o herdado da pasta), como o botão
 * "Conexão e esquema desta aba" do canvas; a dica traz o servidor, o usuário e o atalho. Na aba sem conexão, "Sem conexão". O nome acessível começa pelo
 * que se vê, na mesma ordem, e só depois diz que é a conexão desta aba.
 */
export function ConnectionButtonView({ connection, environment, shortcut, open, panelId, buttonRef, onToggle }: ConnectionButtonViewProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={connection === undefined ? copy.loadingLabel : connection === null ? copy.noneLabel : copy.label(engineTags[connection.engine], connection.name, environment?.name ?? null)}
      title={connection == null ? copy.noneTitle(shortcut.label) : copy.title(connection.host, connection.port, connection.userName, shortcut.label)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-keyshortcuts={shortcut.aria}
      onClick={onToggle}
      className={cn("flex h-8 max-w-80 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-raised px-2.5 text-sm text-ink hover:border-border-strong", open && "border-accent")}
    >
      {connection === undefined ? (
        <span className="text-muted">{copy.loading}</span>
      ) : connection === null ? (
        <>
          <PlugIcon className="flex-none text-subtle" />
          <span className="text-muted">{copy.none}</span>
        </>
      ) : (
        <>
          <EngineTag engine={connection.engine} />
          <span className="min-w-0 truncate">{connection.name}</span>
          <ShownEnvironmentPill environment={environment} />
        </>
      )}
      <ChevronIcon aria-hidden className="flex-none text-subtle" />
    </button>
  );
}

type ConnectionListViewProps = {
  id: string;
  query: string;
  choices: ConnectionChoice[];
  /** Quantas conexões o usuário tem: sem nenhuma, a lista diz que é preciso criar uma; com elas e a busca sem achar, diz que nada combina. */
  total: number;
  /** A opção marcada pelas setas (`-1`: nenhuma). */
  active: number;
  /** A conexão da aba, marcada na lista. */
  current: string | null;
  environments: EnvironmentLookup;
  /** Há comando em andamento na aba: a troca espera (as conexões ficam desabilitadas, com o motivo), e "Mostrar no navegador" continua. */
  busy: boolean;
  onQuery: (query: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onActive: (index: number) => void;
  onChoose: (choice: ConnectionChoice) => void;
  onReveal: () => void;
};

/**
 * RN-ARVORE-008, só o desenho da lista: o campo de busca (um combobox: as setas marcam, Enter escolhe, Esc fecha), as conexões em dois grupos quando há
 * conectadas (as conectadas primeiro), cada uma com a sigla, o nome, o ambiente e o caminho de pastas, e "Mostrar no navegador", que revela a conexão da aba
 * na árvore. Quem filtra e ordena é `connectionChoices`.
 */
export function ConnectionListView({ id, query, choices, total, active, current, environments, busy, onQuery, onKeyDown, onActive, onChoose, onReveal }: ConnectionListViewProps) {
  const listId = `${id}-lista`;
  const statusId = `${id}-situacao`;
  const grouped = choices.some((choice) => choice.connected);
  const empty = total === 0 ? copy.empty : choices.length === 0 ? copy.noMatch(query.trim()) : null;

  const option = (choice: ConnectionChoice, index: number) => {
    const { connection } = choice;
    const selected = connection.id === current;
    return (
      <div
        key={connection.id}
        id={`${listId}-${index}`}
        data-index={index}
        role="option"
        aria-selected={selected}
        aria-disabled={busy || undefined}
        title={`${connection.host}:${connection.port}`}
        onPointerEnter={() => onActive(index)}
        onClick={() => onChoose(choice)}
        className={cn("flex min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5", busy ? "cursor-not-allowed opacity-60" : "cursor-pointer", index === active ? "bg-selected" : "bg-transparent", selected ? "font-semibold text-ink" : "text-body")}
      >
        <EngineTag engine={connection.engine} />
        <span className="min-w-0 truncate">{connection.name}</span>
        <ShownEnvironmentPill environment={environments.connection(connection)} />
        <span className="ml-auto min-w-0 truncate pl-2 text-xs font-normal text-muted">{choice.path === "" ? copy.root : choice.path}</span>
        {selected ? <CheckIcon aria-label={copy.current} className="flex-none text-accent" /> : null}
      </div>
    );
  };

  const sections = grouped
    ? [
        { key: "connected", title: copy.connected, items: choices.flatMap((choice, index) => (choice.connected ? [{ choice, index }] : [])) },
        { key: "others", title: copy.others, items: choices.flatMap((choice, index) => (choice.connected ? [] : [{ choice, index }])) },
      ].filter((section) => section.items.length > 0)
    : null;

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <input
        type="text"
        role="combobox"
        aria-label={copy.search}
        aria-autocomplete="list"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={active >= 0 && active < choices.length ? `${listId}-${active}` : undefined}
        aria-describedby={busy ? statusId : undefined}
        placeholder={copy.searchPlaceholder}
        value={query}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(controlClassName, "h-8 flex-none px-2.5 text-sm")}
      />
      {busy ? (
        <p id={statusId} role="status" className="px-1 text-xs text-muted">
          {copy.busy}
        </p>
      ) : null}
      {/* O clique numa opção não tira o foco do campo: sem isto, ele cairia no corpo da página até a escolha o devolver. */}
      <div id={listId} role="listbox" aria-label={copy.list} onMouseDown={(event) => event.preventDefault()} className="min-h-0 overflow-y-auto">
        {sections === null
          ? choices.map(option)
          : sections.map((section) => (
              <div key={section.key} role="group" aria-labelledby={`${listId}-${section.key}`}>
                <div id={`${listId}-${section.key}`} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-semibold text-subtle">
                  {section.title}
                </div>
                {section.items.map(({ choice, index }) => option(choice, index))}
              </div>
            ))}
      </div>
      {empty === null ? null : <p className="px-2.5 py-2 text-sm text-subtle">{empty}</p>}
      <div className="mt-1 flex-none border-t border-border pt-1">
        <button type="button" onClick={onReveal} disabled={current === null} className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-sm text-body hover:bg-selected hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
          {copy.reveal}
        </button>
      </div>
    </div>
  );
}

type ConnectionListPanelProps = {
  id: string;
  current: string | null;
  connections: readonly Connection[];
  environments: EnvironmentLookup;
  busy: boolean;
  /** Fecha a lista; `restoreFocus` devolve o foco, na hora, a quem o tinha antes de abrir (o editor, no Ctrl+9). */
  onClose: (restoreFocus: boolean) => void;
  onChoose: (connectionId: string) => void;
};

/**
 * A lista aberta, com o estado dela (o texto da busca e a opção marcada). Só ela lê as abas da área de trabalho e as sessões da árvore em cache, para saber
 * quais conexões estão conectadas: o botão fechado, montado em cada aba de consulta, não redesenha a cada mudança das abas.
 */
export function ConnectionListPanel({ id, current, connections, environments, busy, onClose, onChoose }: ConnectionListPanelProps) {
  const folders = useQuery(foldersQuery);
  const connected = useConnectedIds(connections);

  const [query, setQuery] = useState("");
  const choices = connectionChoices(connections, folders.data ?? [], connected, query);
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex((choice) => choice.connection.id === current)));

  // Fecha e devolve o foco ANTES de trocar: com alterações não salvas na grade, a troca abre a pergunta (RN-EDIT-007), e o diálogo dela guarda quem tem o
  // foco ao abrir para devolvê-lo ao fechar. Assim ele guarda o editor (ou o botão), e não o campo de busca, que sai da página junto com a lista.
  function choose(choice: ConnectionChoice | undefined) {
    if (choice === undefined || busy) return;
    onClose(true);
    if (choice.connection.id !== current) onChoose(choice.connection.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const target = choiceKeyTarget(event.key, active, choices.length);
    if (target !== null) {
      event.preventDefault();
      setActive(target);
      document.getElementById(`${id}-lista-${target}`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(choices[active]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
    }
  }

  return (
    <ConnectionListView
      id={id}
      query={query}
      choices={choices}
      total={connections.length}
      active={active}
      current={current}
      environments={environments}
      busy={busy}
      onQuery={(text) => {
        setQuery(text);
        setActive(0);
      }}
      onKeyDown={handleKeyDown}
      onActive={setActive}
      onChoose={choose}
      onReveal={() => {
        // RN-ARVORE-008: o navegador revela e escolhe a conexão, abre as pastas acima dela e aparece se estava escondido; o foco vai à linha dela.
        if (current === null) return;
        onClose(false);
        connectionReveal.request(current);
      }}
    />
  );
}

type PanelPosition = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/**
 * Devolve o foco a quem o tinha quando a lista abriu (o botão, ou o editor no Ctrl+9) e, se esse saiu da página, ao botão. Na hora, e não no quadro seguinte:
 * a escolha que pergunta antes de trocar (RN-EDIT-007) abre a pergunta logo em seguida, e um foco adiado chegaria depois de o botão "Cancelar" dela pegar o
 * dele, levando-o para trás do diálogo (o Enter iria ao editor, e o Esc não fecharia a pergunta).
 */
export function focusBack(saved: Element | null, button: HTMLElement | null) {
  const target = saved instanceof HTMLElement && saved.isConnected ? saved : button;
  target?.focus();
}

type ConnectionPickerProps = {
  /** A conexão da aba; nula na aba sem conexão. */
  connectionId: string | null;
  busy: boolean;
  /** A lista aberta: quem decide é a aba, que também a abre pelo Ctrl+9. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A pessoa escolheu outra conexão. Quem recebe pergunta antes, se for o caso, e troca. */
  onChoose: (connectionId: string) => void;
};

/**
 * RN-ARVORE-008: o botão da conexão da aba de consulta, na barra do editor, antes do banco, e a lista que a troca. A lista vai num portal `position: fixed`
 * em `document.body`, como a do `Select`, para o `overflow-hidden` de um painel não a recortar. O teclado dela não sobe à aba (o F5, o Ctrl+S e o Ctrl+W
 * da aba não valem enquanto se digita a busca), e ela fecha com Esc, com o Ctrl+9 (que a abriu), com a escolha, com o clique fora e com o foco que sai dela.
 * O foco volta a quem o tinha antes de abrir (o botão, ou o editor no Ctrl+9), na hora e antes da troca (`focusBack`).
 */
export function ConnectionPicker({ connectionId, busy, open, onOpenChange, onChoose }: ConnectionPickerProps) {
  const panelId = useId();
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const environments = useMemo(() => environmentLookup(folders.data ?? []), [folders.data]);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const shortcut = connectionShortcutLabel(typeof navigator === "undefined" ? "" : navigator.platform);

  const connection = connectionId === null ? null : connections.data?.find((candidate) => candidate.id === connectionId);

  // Quem tinha o foco ao abrir (o botão, ou o editor no Ctrl+9) o recebe de volta ao fechar pela lista. A lista só monta depois deste efeito (a posição nasce
  // nula a cada abertura), e o campo de busca, que pega o foco, ainda não existe aqui.
  useEffect(() => {
    if (open) returnFocus.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function place() {
      const rect = button.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const width = Math.min(panelWidth, window.innerWidth - 2 * margin);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      // Abre para cima quando não cabe embaixo e há mais espaço em cima.
      const dropUp = below < Math.min(maxPanelHeight, panel.current?.scrollHeight ?? maxPanelHeight) && above > below;
      setPosition({ left, width, maxHeight: Math.max(0, Math.min(maxPanelHeight, dropUp ? above : below)), ...(dropUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }) });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      setPosition(null);
    };
  }, [open]);

  // Fecha ao clicar fora, sem mexer no foco (o clique já o levou aonde a pessoa quis).
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (button.current?.contains(target) || panel.current?.contains(target)) return;
      onOpenChange(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  function close(restoreFocus: boolean) {
    // O foco sai da lista antes de ela sair da página: com ele dentro, cairia no corpo da página.
    if (restoreFocus) focusBack(returnFocus.current, button.current);
    onOpenChange(false);
  }

  return (
    <>
      <ConnectionButtonView connection={connection} environment={connection == null ? null : environments.connection(connection)} shortcut={shortcut} open={open} panelId={panelId} buttonRef={button} onToggle={() => onOpenChange(!open)} />
      {open && position !== null
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              role="dialog"
              aria-label={copy.list}
              style={{ position: "fixed", ...position }}
              // O teclado da lista é dela: o Ctrl+W, o F5 e o Ctrl+S da aba não valem enquanto se digita a busca (o portal sobe pela árvore do React). Por isso
              // o Ctrl+9, que abre a lista pela aba, é tratado aqui também: com o foco nela (a busca, "Mostrar no navegador"), ele a fecha e devolve o foco.
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.defaultPrevented || !connectionShortcut(event)) return;
                event.preventDefault();
                close(true);
              }}
              onBlur={(event) => {
                const next = event.relatedTarget as Node | null;
                if (next !== null && !panel.current?.contains(next) && !button.current?.contains(next)) onOpenChange(false);
              }}
              className="z-50 flex flex-col overflow-hidden rounded-md border border-border-strong bg-raised p-1.5 text-sm shadow-2xl"
            >
              <ConnectionListPanel id={panelId} current={connectionId} connections={connections.data ?? []} environments={environments} busy={busy} onClose={close} onChoose={onChoose} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
