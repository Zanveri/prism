import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";

import { Button, ChevronIcon, FolderIcon, iconColorStyle, Input } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { CheckNode, CheckState } from "../_lib/check-tree";
import { transferCopy } from "../_lib/transfer.copy";

const copy = transferCopy.tree;

/** Põe o estado misto no `<input>`: o `indeterminate` não existe como atributo, e quem o põe é a referência, a cada desenho. */
export function indeterminateRef(state: CheckState) {
  return (element: { indeterminate: boolean } | null) => {
    if (element !== null) element.indeterminate = state === "mixed";
  };
}

type TriStateBoxProps = { state: CheckState; disabled?: boolean; label: string; describedBy?: string; onChange: () => void };

/**
 * A caixa de três estados da árvore de marcar (RN-TRANSF-002): marcada, desmarcada ou mista. A mista é o `indeterminate` do próprio `<input>`, que o leitor de
 * tela anuncia como "misto" (`indeterminateRef`). O Espaço marca e desmarca, como em toda caixa; o Enter não envia o formulário do diálogo (quem o barra é o
 * próprio diálogo, `enterInputID`).
 */
export function TriStateBox({ state, disabled = false, label, describedBy, onChange }: TriStateBoxProps) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      aria-describedby={describedBy}
      checked={state === "checked"}
      ref={indeterminateRef(state)}
      disabled={disabled}
      onChange={onChange}
      className="size-4 flex-none cursor-pointer accent-accent disabled:cursor-not-allowed"
    />
  );
}

/** O ícone da pasta com a cor dela (RN-PASTA-007), pelo `iconColorStyle`, que passa em 3:1 nos seis temas. */
export function FolderGlyph({ color }: { color: string | null }) {
  return (
    <span style={color === null ? undefined : { color: iconColorStyle(color) }} className="flex-none text-subtle [&>svg]:text-current">
      <FolderIcon />
    </span>
  );
}

type CheckRowFrameProps = {
  node: CheckNode;
  state: CheckState;
  /** A pasta está aberta (as de dentro aparecem); só conta na pasta com algo dentro. */
  open: boolean;
  /** A caixa não se marca: o item que não pode ser importado, ou a pasta sem nada que possa (RN-TRANSF-014). */
  disabled: boolean;
  /** O nome acessível da caixa: o do item. */
  name: string;
  /**
   * O que o leitor de tela ouve ao chegar na caixa, além do nome (`aria-describedby`): o caminho de pastas, que distingue as "NOMINAL" de cada ambiente, e o
   * que só aparece na dica do mouse. `id` vem de quem chama, que pode ligá-lo a mais um controle da linha (a escolha do que vai).
   */
  description?: { id: string; text: string } | null;
  onToggleOpen: (key: string) => void;
  onMark: (key: string) => void;
  /** O que vem depois da caixa, dentro do rótulo dela: o ícone, a etiqueta do banco, o nome, o ambiente, o cadeado. */
  children: ReactNode;
  /** O que fica à direita, fora do rótulo: a escolha do que vai (exportar), as marcas (importar). */
  trailing?: ReactNode;
  /** A segunda linha, embaixo do nome (o servidor e as credenciais da prévia), numa linha só. */
  detail?: ReactNode;
  /** Embaixo da segunda linha, inteira e quebrando a linha: por que o item não pode ser importado (RN-TRANSF-014), que não pode ficar cortado. */
  note?: ReactNode;
};

/**
 * Uma linha da árvore de marcar, a mesma nos dois diálogos: o recuo do nível, a seta de abrir e fechar da pasta com algo dentro, a caixa e o rótulo. A linha
 * guarda a chave (`data-key`), para o diálogo rolar até a de onde foi aberto. `content-visibility` deixa o navegador pular o desenho das linhas fora da vista:
 * com 2.000 conexões e 2.000 pastas (RN-TRANSF-006) a lista não é virtual, para o Tab andar por todas as caixas e escolhas (RN-TRANSF-002).
 */
export function CheckRowFrame({ node, state, open, disabled, name, description = null, onToggleOpen, onMark, children, trailing, detail, note }: CheckRowFrameProps) {
  const opensAndCloses = node.kind === "folder" && !node.leaf;

  return (
    <li data-key={node.key} style={{ paddingLeft: 4 + node.depth * 18 }} className="flex min-h-9 items-center gap-2 rounded-sm py-1 pr-2 [contain-intrinsic-size:auto_36px] [content-visibility:auto] hover:bg-selected">
      {opensAndCloses ? (
        <button
          type="button"
          aria-label={copy.contents(name)}
          aria-expanded={open}
          onClick={() => onToggleOpen(node.key)}
          className="flex size-5 flex-none cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-border hover:text-ink"
        >
          <ChevronIcon className={cn("transition-transform", !open && "-rotate-90")} />
        </button>
      ) : (
        <span aria-hidden className="size-5 flex-none" />
      )}
      <label className={cn("flex min-w-0 flex-1 items-start gap-2", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="flex h-5 items-center">
          <TriStateBox state={state} disabled={disabled} label={name} describedBy={description?.id} onChange={() => onMark(node.key)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">{children}</span>
          {detail === undefined ? null : <span className="truncate font-mono text-xs text-muted">{detail}</span>}
          {note === undefined ? null : <span className="text-xs whitespace-normal text-danger">{note}</span>}
        </span>
      </label>
      {/* `hidden`: o leitor de tela lê o texto pela ligação, e não de novo ao percorrer a lista. */}
      {description === null ? null : (
        <span id={description.id} hidden>
          {description.text}
        </span>
      )}
      {trailing}
    </li>
  );
}

type TreeSearchBarProps = {
  id: string;
  query: string;
  onQuery: (query: string) => void;
  onMarkAll: () => void;
  onUnmarkAll: () => void;
  disabled?: boolean;
};

/** O Enter na busca não faz nada: ela filtra enquanto se digita, e o Enter enviaria o formulário do diálogo (exportar, ou importar tudo o que está marcado). */
function swallowEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

/** "Buscar pastas e conexões", ao lado de "Marcar todas" e "Desmarcar todas", que agem só no que a busca mostra (RN-TRANSF-002). */
export function TreeSearchBar({ id, query, onQuery, onMarkAll, onUnmarkAll, disabled = false }: TreeSearchBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={id}
        type="search"
        aria-label={copy.search}
        placeholder={copy.search}
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)}
        onKeyDown={swallowEnter}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="h-9 min-w-48 flex-1"
      />
      <Button type="button" variant="secondary" size="sm" onClick={onMarkAll} disabled={disabled}>
        {copy.markAll}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onUnmarkAll} disabled={disabled}>
        {copy.unmarkAll}
      </Button>
    </div>
  );
}
