import type { KeyboardEvent, RefObject } from "react";

import { CloseIcon, SearchIcon } from "@/components/ui";

import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.navigator.search;

type NavigatorSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Seta para baixo e Enter levam o foco à lista, à linha que o Tab alcança. */
  onFocusList: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

/**
 * O campo de busca do navegador (RN-BUSCA-001), no tamanho e nas cores do canvas: 32 px, fundo e borda dos campos, lupa à esquerda.
 * Esc limpa o texto; com o campo vazio, devolve o foco à lista. O botão de limpar só existe com texto, e o do próprio navegador
 * (o `x` do `type="search"`) fica escondido para não haver dois. Divide a linha com o seletor de ambiente (RN-NAV-010): quem dá a margem é a linha.
 */
export function NavigatorSearchField({ value, onChange, onFocusList, inputRef }: NavigatorSearchFieldProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (value === "") onFocusList();
      else onChange("");
    } else if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      onFocusList();
    }
  }

  return (
    <div className="flex h-8 min-w-32 flex-[1_1_8rem] items-center gap-2 rounded-md border border-border bg-raised px-2.5 text-subtle focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        aria-label={copy.label}
        placeholder={copy.label}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
      />
      {value === "" ? null : (
        <button
          type="button"
          aria-label={copy.clear}
          title={copy.clear}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="-mr-1 flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
