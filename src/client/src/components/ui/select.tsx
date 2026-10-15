import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

/**
 * Uma opção. `content` desenha a opção no lugar do rótulo, na lista e no controle fechado (a etiqueta colorida de um ambiente, RN-NAV-010); o rótulo
 * continua sendo o nome dela na busca pela inicial, e o que o `content` mostra tem de dizer o mesmo para o leitor de tela.
 */
export type SelectOption = { value: string; label: string; content?: ReactNode };

type SelectProps = {
  id?: string;
  /** Campo enviado no `FormData`. Ausente, o valor não vai no formulário. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Primeira opção, de valor vazio. Ausente, não existe escolha nula. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Rótulo acessível quando o controle não tem um `<label htmlFor>`. */
  "aria-label"?: string;
  /** O texto que explica o controle (o motivo de ele estar desabilitado, por exemplo). */
  "aria-describedby"?: string;
  /** A lista abriu: quem só busca as opções quando a pessoa as quer (a lista dos bancos da aba) as pede aqui. Elas podem chegar com a lista aberta. */
  onOpen?: () => void;
  className?: string;
};

/** Altura máxima da lista antes de começar a rolar. */
const maxPanelHeight = 288;
/** Espaço entre o controle e a lista. */
const gap = 6;
/** Altura aproximada de uma opção, usada só antes de a lista existir para ser medida. */
const optionHeight = 38;
const panelPadding = 10;
/** Janela em que as teclas digitadas se somam na busca por inicial. */
const typeaheadMs = 600;

type PanelPosition = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** Sem acento e sem caixa: "producao" acha "Produção". */
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/**
 * Escolha única numa lista. O gatilho é um botão com o papel de combobox e a lista vai num portal
 * `position: fixed` em `document.body`, para o `overflow-hidden` de um painel não a recortar.
 * Teclado como o de um `<select>`: setas, Home, End, Enter, espaço, Esc e a inicial da opção.
 */
export function Select({ id, name, value, onChange, options, placeholder, disabled = false, invalid = false, "aria-label": ariaLabel, "aria-describedby": ariaDescribedBy, onOpen, className }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ search: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // O placeholder é uma opção de valor vazio, a primeira da lista.
  const items: SelectOption[] = placeholder === undefined ? options : [{ value: "", label: placeholder }, ...options];
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  // As opções que chegam com a lista aberta mudam a posição da escolhida: o destaque que estava nela vai junto, e o Enter não escolhe outra por engano.
  // Ajuste durante a renderização, como o React recomenda para o estado que segue uma propriedade.
  const [shownSelected, setShownSelected] = useState(selectedIndex);
  if (shownSelected !== selectedIndex) {
    setShownSelected(selectedIndex);
    if (open && activeIndex === shownSelected) setActiveIndex(selectedIndex);
  }

  useEffect(() => {
    if (!open) return;

    function place() {
      const trigger = buttonRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const height = Math.min(maxPanelHeight, panelRef.current?.scrollHeight ?? items.length * optionHeight + panelPadding);
      // Abre para cima quando não cabe embaixo e há mais espaço em cima.
      const dropUp = below < height && above > below;

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
  }, [open, items.length]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Mantém a opção ativa à vista enquanto as setas a movem.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    panelRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
    onOpen?.();
  }

  function choose(index: number) {
    const item = items[index];
    if (!item) return;

    setOpen(false);
    // Como num `<select>`: depois de escolher, o foco volta ao controle. Na hora, e antes do `onChange`: quem recebe a escolha pode abrir uma pergunta (trocar
    // o banco da aba com alterações não salvas na grade, RN-EDIT-007), e o diálogo dela guarda quem tem o foco ao abrir para devolvê-lo ao fechar. Adiado para
    // o quadro seguinte, o foco chegaria depois de o diálogo pegar o dele e voltaria ao controle, atrás da pergunta.
    buttonRef.current?.focus();
    onChange(item.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openAt(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }

        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current < 0 ? (step > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, current + step))));
        return;
      }

      case "Home":
      case "End": {
        if (!open) return;
        event.preventDefault();
        setActiveIndex(event.key === "Home" ? 0 : items.length - 1);
        return;
      }

      case "Enter":
      case " ": {
        event.preventDefault();
        if (open) choose(activeIndex);
        else openAt(selectedIndex >= 0 ? selectedIndex : 0);
        return;
      }

      case "Escape": {
        if (!open) return;
        // O `Dialog` em volta vê `defaultPrevented` e não se fecha junto.
        event.preventDefault();
        setOpen(false);
        return;
      }

      case "Tab": {
        setOpen(false);
        return;
      }

      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;

        const now = Date.now();
        const search = now - typeahead.current.at > typeaheadMs ? event.key : typeahead.current.search + event.key;
        typeahead.current = { search, at: now };

        const found = items.findIndex((item) => normalizeSearch(item.label).startsWith(normalizeSearch(search)));
        if (found < 0) return;

        event.preventDefault();
        if (open) setActiveIndex(found);
        else choose(found);
      }
    }
  }

  return (
    <div className="relative">
      {name === undefined ? null : <input type="hidden" name={name} value={value} />}

      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={onKeyDown}
        // `h-auto`: um rótulo comprido quebra a linha em vez de ser cortado.
        className={cn(controlClassName, "flex h-auto min-h-10 cursor-pointer items-center justify-between gap-2 py-2 text-left", open && "border-accent", className)}
      >
        <span className={cn("min-w-0 flex-1 break-words", selected === undefined || selected.value === "" ? "text-subtle" : "text-ink")}>{selected === undefined ? (placeholder ?? "") : (selected.content ?? selected.label)}</span>
        <span aria-hidden className="flex-none text-xs text-subtle">▾</span>
      </button>

      {open && position !== null
        ? createPortal(
            <div ref={panelRef} id={listboxId} role="listbox" aria-labelledby={triggerId} style={{ position: "fixed", ...position }} className="z-50 overflow-y-auto rounded-md border border-border-strong bg-raised p-1 shadow-2xl">
              {items.map((item, index) => {
                const isSelected = item.value === value;

                return (
                  <div
                    key={item.value}
                    id={`${listboxId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={cn("cursor-pointer rounded-sm px-2.5 py-2 break-words", index === activeIndex ? "bg-selected" : "bg-transparent", isSelected ? "font-semibold text-ink" : item.value === "" ? "text-subtle" : "text-body")}
                  >
                    {item.content ?? item.label}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
