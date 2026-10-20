import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { Button, useHost } from "@/components/ui";
import { placeMenu } from "@/components/ui/context-menu";
import { isHtmlElement, isNode } from "@/lib/host/host";

import { gridFilterCopy } from "../_lib/grid-filter.copy";
import type { OpenCustomFilter } from "../_lib/use-record-edits";

const copy = gridFilterCopy.custom;

/**
 * O campo pequeno do "Personalizado" (RN-GRADE-013), sobre a grade, onde o menu abriu: `"code" =` e o valor. Enter filtra
 * (o valor vira literal do banco, RN-TABELA-007, e a condição junta ao campo de filtro e é executada), Esc e o clique fora cancelam. O valor que não vira
 * literal fica no campo, com o motivo embaixo. As teclas não sobem para a grade nem para a aba. Ao fechar, o foco volta a quem o tinha (a grade).
 */
export function CustomFilterField({ prefix, point, problem, onApply, onClose }: OpenCustomFilter) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  // RN-ABAS-017: o campo abre na página de onde nasceu (a da janela da aba, ou a da janela do resultado).
  const current = useHost();
  const [host] = useState(current);
  const [opener] = useState(() => (isHtmlElement(host.document.activeElement) ? host.document.activeElement : null));
  const problemId = useId();
  const close = useEffectEvent(() => onClose());

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();
    const { left, top } = placeMenu(point, { width, height }, { width: host.view.innerWidth, height: host.view.innerHeight });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = "visible";
    // O foco entra no campo só agora: escondido (`visibility: hidden`, até a medida), ele não o recebe, e o `autoFocus` do React chega antes.
    input.current?.focus({ preventScroll: true });
  }, [point, host]);

  useEffect(() => {
    const element = box.current;
    const onOutside = (event: Event) => {
      if (!(isNode(event.target) && element?.contains(event.target))) close();
    };
    const page = host.document;
    page.addEventListener("pointerdown", onOutside, true);
    return () => {
      page.removeEventListener("pointerdown", onOutside, true);
      // O foco volta à grade quando o campo sai de verdade e o foco ficou sem dono (filtrou, ou Esc). Conferido no fim do evento e só com o campo fora do
      // DOM: o `StrictMode` desmonta e monta os efeitos de mentira, e aí o campo segue vivo, com o foco.
      setTimeout(() => {
        const lost = page.activeElement === null || page.activeElement === page.body;
        if (element?.isConnected !== true && lost && opener?.isConnected === true) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, [opener, host]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onApply(value);
    }
  }

  return createPortal(
    <div ref={box} role="group" aria-label={copy.label(prefix)} onKeyDown={handleKeyDown} style={{ left: 0, top: 0, visibility: "hidden" }} className="fixed z-50 flex max-w-[min(480px,calc(100vw-1rem))] flex-col gap-1.5 rounded-md border border-border-strong bg-raised p-2 shadow-2xl">
      <div className="flex items-center gap-2">
        <span className="max-w-48 flex-none truncate font-editor text-sm text-ink" title={prefix}>
          {prefix}
        </span>
        <input
          ref={input}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={copy.label(prefix)}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : problemId}
          title={copy.hint}
          spellCheck={false}
          autoComplete="off"
          className="h-7 w-56 min-w-0 rounded-sm border border-accent bg-background px-1.5 font-editor text-sm text-ink outline-none"
        />
        <Button type="button" size="compact" className="h-7 px-2.5 text-xs" onClick={() => onApply(value)}>
          {copy.apply}
        </Button>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
      {problem === null ? (
        <p className="text-xs text-muted">{copy.hint}</p>
      ) : (
        <p id={problemId} role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </div>,
    host.document.body,
  );
}
