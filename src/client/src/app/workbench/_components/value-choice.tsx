import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { controlClassName } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { ColumnValues } from "../_lib/query.schema";
import { choiceValues, type Choice, type ChoiceScope } from "../_lib/value-choice";
import { variableFieldsCopy as copy } from "../_lib/variable-fields.copy";

type Entry = ColumnValues["values"][number];

type ValueChoiceProps = {
  id: string;
  choice: Choice;
  scope: ChoiceScope;
  /** A lista escolhe vários: os escolhidos são `items`; o valor simples é `text`. */
  list: boolean;
  text: string;
  items: readonly string[];
  onText: (text: string) => void;
  onToggle: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  autoFocus: boolean;
};

type Page = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; values: Entry[]; hasMore: boolean };

/**
 * A escolha com busca (RN-VAR-031): a caixa (`combobox`) com a lista (`listbox`) dos valores da coluna, cada um com a descrição, 100 por vez, com "Carregar mais". A
 * busca filtra 300 ms depois de a pessoa parar de digitar, e a nova cancela a anterior. As setas andam, Enter escolhe, Esc fecha a lista. A pessoa pode digitar o
 * valor em vez de escolher; quem confere é o diálogo.
 */
export function ValueChoice({ id, choice, scope, list, text, items, onText, onToggle, onBlur, disabled, invalid, describedBy, autoFocus }: ValueChoiceProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(list ? "" : text);
  const [page, setPage] = useState<Page>({ status: "loading" });
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const timer = setTimeout(async () => {
      setPage({ status: "loading" });
      const result = await choiceValues(scope, choice, search.trim() === "" ? {} : { search: search.trim() }, abort.signal);
      if (abort.signal.aborted) return;
      setActive(0);
      setPage(result.ok ? { status: "ready", values: result.data.values, hasMore: result.data.hasMore } : { status: "failed", message: result.error.title });
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, search, attempt, scope, choice]);

  async function loadMore() {
    if (page.status !== "ready") return;
    const result = await choiceValues(scope, choice, { ...(search.trim() === "" ? {} : { search: search.trim() }), offset: page.values.length });
    setPage((current) => (current.status !== "ready" ? current : result.ok ? { status: "ready", values: [...current.values, ...result.data.values], hasMore: result.data.hasMore } : { status: "failed", message: result.error.title }));
  }

  const values = page.status === "ready" ? page.values : [];
  const choose = (entry: Entry | undefined) => {
    if (entry === undefined || entry.truncated) return;
    if (list) onToggle(entry.value);
    else {
      onText(entry.value);
      setSearch(entry.value);
      setOpen(false);
    }
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      setActive((at) => Math.max(0, Math.min(values.length - 1, at + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && open && values.length > 0) {
      event.preventDefault();
      choose(values[active]);
    } else if (event.key === "Enter" && list && search.trim() !== "") {
      event.preventDefault();
      onToggle(search.trim());
      setSearch("");
    } else if (event.key === "Escape" && open) {
      // O Esc fecha só a lista: o diálogo vê o `defaultPrevented` e fica aberto.
      event.preventDefault();
      setOpen(false);
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;
  const note = copy.choiceNote(choice.tableText, choice.column, choice.description !== null);

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && values.length > 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        disabled={disabled}
        value={search}
        placeholder={copy.search}
        className={controlClassName}
        onChange={(event) => {
          setSearch(event.target.value);
          if (!list) onText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onBlur();
        }}
        onKeyDown={onKeyDown}
      />
      <p className="text-xs text-muted">{note}</p>
      {open ? (
        <div className="rounded-md border border-border-strong bg-panel">
          <ul id={listId} role="listbox" aria-multiselectable={list || undefined} className="max-h-56 overflow-y-auto py-1">
            {values.map((entry, index) => {
              const selected = list ? items.includes(entry.value) : entry.value === text;
              return (
                <li
                  key={`${entry.value}-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={entry.truncated || undefined}
                  title={entry.truncated ? copy.truncated : undefined}
                  className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", index === active && "bg-selected", entry.truncated && "cursor-not-allowed text-subtle")}
                  // O clique não pode tirar o foco da caixa antes de escolher.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(entry)}
                >
                  {list ? <input type="checkbox" tabIndex={-1} readOnly checked={selected} aria-hidden="true" /> : null}
                  <span className="font-mono">{entry.value}</span>
                  {entry.description === null ? null : <span className="truncate text-muted">— {entry.description}</span>}
                </li>
              );
            })}
          </ul>
          {page.status === "loading" ? <p className="px-3 py-2 text-sm text-muted">{copy.loading}</p> : null}
          {page.status === "ready" && values.length === 0 ? <p className="px-3 py-2 text-sm text-muted">{copy.noValues}</p> : null}
          {page.status === "failed" ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-danger" role="alert">
              <span>{page.message}</span>
              <button type="button" className="text-ink underline" onPointerDown={(event) => event.preventDefault()} onClick={() => setAttempt((at) => at + 1)}>
                {copy.tryAgain}
              </button>
            </div>
          ) : null}
          {page.status === "ready" && page.hasMore ? (
            <button type="button" className="w-full px-3 py-2 text-left text-sm text-accent" onPointerDown={(event) => event.preventDefault()} onClick={() => void loadMore()}>
              {copy.loadMore}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
