import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

import type { FontRole } from "../_lib/fonts";
import { settingsCopy } from "../_lib/settings.copy";
import { fontChoices, isInstalled, systemFontsQuery, typedFont, type FontChoice } from "../_lib/system-fonts";

const copy = settingsCopy.appearance.fonts;

/** Altura máxima da lista antes de começar a rolar, e o espaço entre o campo e ela: os do `Select`. */
const maxPanelHeight = 288;
const gap = 6;

type PanelPosition = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

type FontPickerProps = {
  id: string;
  /** O nome do campo, que a lista também leva. */
  label: string;
  role: FontRole;
  /** A fonte escolhida (o nome da família), que o campo mostra fechado. */
  value: string;
  onChange: (family: string) => void;
  /** O `id` da dica do campo, que o leitor de tela lê com ele. */
  hintId: string;
};

/** O título do grupo, antes da primeira opção dele. A do app não tem título: ela leva a etiqueta "do Prism". */
const groupTitles: Partial<Record<FontChoice["group"], string>> = { monospace: copy.groups.monospace, other: copy.groups.other };

/**
 * Uma fonte, com busca (RN-CONFIG-008): um campo de texto com o papel de combobox e a lista num portal, como o `Select`. Fechado, o campo mostra a
 * escolhida; digitar filtra a lista pelo pedaço do nome e marca a primeira que combina; as setas andam, Enter escolhe, Esc fecha (e o segundo Esc
 * desfaz o que foi digitado), e sair do campo também desfaz. A lista das fontes do sistema é lida quando o campo recebe o foco (`systemFontsQuery`,
 * a mesma para os dois campos). Sem ela, o campo aceita o nome digitado, se ele pode virar CSS.
 */
export function FontPicker({ id, label, role, value, onChange, hintId }: FontPickerProps) {
  const listboxId = `${id}-lista`;
  const statusId = `${id}-situacao`;

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  /** O que a pessoa digitou desde que abriu; `null` é "nada": o campo mostra a escolhida e a lista vem inteira. */
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const fontsQuery = useQuery({ ...systemFontsQuery, enabled: requested });
  /** `undefined` enquanto não foi lida, `null` se não deu para ler, a lista se deu. */
  const fonts = fontsQuery.data;
  const loading = requested && fontsQuery.isFetching && fonts === undefined;
  const choices = open ? fontChoices(role, fonts, draft ?? "") : [];
  const installed = isInstalled(role, value, fonts);

  const status = invalid ? copy.invalidName : fonts === null ? copy.unreadable : installed === false ? copy.notInstalled : null;
  const emptyText = loading ? copy.loading : choices.length === 0 && Array.isArray(fonts) ? copy.noMatch : null;

  // As opções em seções: a do app sozinha, e cada grupo com o título dele (no editor, as monoespaçadas e as outras).
  const sections: { group: FontChoice["group"]; items: { choice: FontChoice; index: number }[] }[] = [];
  choices.forEach((choice, index) => {
    const last = sections.at(-1);
    if (last?.group === choice.group) last.items.push({ choice, index });
    else sections.push({ group: choice.group, items: [{ choice, index }] });
  });

  useEffect(() => {
    if (!open) return;

    function place() {
      const field = inputRef.current;
      if (!field) return;

      const rect = field.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const dropUp = below < Math.min(maxPanelHeight, panelRef.current?.scrollHeight ?? maxPanelHeight) && above > below;

      setPosition({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(0, Math.min(maxPanelHeight, dropUp ? above : below)),
        ...(dropUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
      });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Mantém a opção ativa à vista enquanto as setas a movem.
  useEffect(() => {
    if (!open || active < 0) return;
    panelRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function close() {
    setOpen(false);
    setDraft(null);
    setActive(-1);
    setInvalid(false);
  }

  function openList() {
    setRequested(true);
    if (open) return;
    setOpen(true);
    setActive(-1);
  }

  function choose(family: string) {
    if (family !== value) onChange(family);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        if (choices.length === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current < 0 ? (step > 0 ? 0 : choices.length - 1) : Math.max(0, Math.min(choices.length - 1, current + step))));
        return;
      }

      case "Enter": {
        event.preventDefault();
        const picked = open && active >= 0 ? choices[active]?.family : undefined;
        if (picked !== undefined) return choose(picked);
        if (draft === null) return open ? close() : openList();

        const typed = typedFont(role, draft, fonts);
        if (typed !== null) choose(typed);
        else if (fonts === null && draft.trim() !== "") setInvalid(true);
        return;
      }

      case "Escape": {
        // O primeiro Esc fecha a lista; o segundo desfaz o que foi digitado; só o terceiro chega às Configurações (que fecham com ele).
        if (!open && draft === null) return;
        event.preventDefault();
        if (open) setOpen(false);
        else close();
        return;
      }

      case "Tab": {
        close();
        return;
      }
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open && choices.length > 0 ? listboxId : undefined}
        aria-activedescendant={open && active >= 0 && active < choices.length ? `${listboxId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={status === null ? hintId : `${hintId} ${statusId}`}
        value={draft ?? value}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => {
          setRequested(true);
          event.currentTarget.select();
        }}
        onClick={(event) => {
          // O clique que deu o foco desfaz a seleção do `focus`: com nada digitado, o texto inteiro fica marcado, e digitar o troca.
          if (draft === null) event.currentTarget.select();
          openList();
        }}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          setInvalid(false);
          setRequested(true);
          setOpen(true);
          // Com a lista lida, a primeira que combina fica marcada e o Enter a escolhe; sem ela, o Enter leva o nome digitado.
          setActive(Array.isArray(fonts) && fontChoices(role, fonts, text).length > 0 ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={cn(controlClassName, open && "border-accent")}
      />

      {status === null ? null : (
        <p id={statusId} aria-live="polite" className={cn("text-xs", invalid ? "text-danger" : "text-muted")}>
          {status}
        </p>
      )}

      {open && position !== null && (choices.length > 0 || emptyText !== null)
        ? createPortal(
            // O clique na lista não tira o foco do campo: sem isto, o `blur` fecharia a lista antes do clique escolher.
            <div ref={panelRef} style={{ position: "fixed", ...position }} onMouseDown={(event) => event.preventDefault()} className="z-50 overflow-y-auto rounded-md border border-border-strong bg-raised p-1 shadow-2xl">
              {choices.length === 0 ? null : (
                <div id={listboxId} role="listbox" aria-label={label}>
                  {sections.map(({ group, items }) => {
                    const options = items.map(({ choice, index }) => (
                      <div
                        key={choice.family}
                        id={`${listboxId}-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={choice.family === value}
                        onPointerEnter={() => setActive(index)}
                        onClick={() => choose(choice.family)}
                        className={cn("flex cursor-pointer items-baseline gap-2 rounded-sm px-2.5 py-2 break-words", index === active ? "bg-selected" : "bg-transparent", choice.family === value ? "font-semibold text-ink" : "text-body")}
                      >
                        <span className="min-w-0 flex-1">{choice.family}</span>
                        {group === "app" ? <span className="flex-none text-xs font-normal text-muted">{copy.appFont}</span> : null}
                      </div>
                    ));
                    const title = groupTitles[group];
                    if (title === undefined) return <Fragment key={group}>{options}</Fragment>;

                    return (
                      <div key={group} role="group" aria-labelledby={`${listboxId}-${group}`}>
                        <div id={`${listboxId}-${group}`} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-semibold text-subtle">
                          {title}
                        </div>
                        {options}
                      </div>
                    );
                  })}
                </div>
              )}
              {emptyText === null ? null : <p className="px-2.5 py-2 text-subtle">{emptyText}</p>}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
