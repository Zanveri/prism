import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { driversCopy } from "@/app/drivers/_lib/drivers.copy";
import { databaseLogoOf, engineBrands, type DatabaseLogo } from "@/assets/databases/database-logos";
import { DatabaseIcon, EngineTag, StatusBadge, type Engine } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { connectionsCopy } from "../_lib/connections.copy";
import type { EngineChoice, EngineChoiceState } from "../_lib/engine-choices";
import { gridKeyTarget, gridTabStop } from "../_lib/engine-grid";

const copy = connectionsCopy.form;

/** A cor do estado embaixo do nome: o que falta em âmbar, o que falhou em vermelho, o resto apagado. */
const stateColors: Record<EngineChoiceState, string> = {
  bundled: "text-muted",
  installed: "text-muted",
  missing: "text-accent",
  installing: "text-ink",
  failed: "text-danger",
  unavailable: "text-muted",
  comingSoon: "text-muted",
  unknown: "text-muted",
};

function brandOf(choice: Pick<EngineChoice, "engine" | "driver">): string | null {
  return choice.engine === null ? (choice.driver?.id ?? null) : engineBrands[choice.engine];
}

/** A caixa da marca: a mesma medida da ficha, para a grade não mudar de altura de um banco para outro. */
const markBox = "flex h-10 w-12 flex-none items-center justify-center rounded-md";

/**
 * A logo do fabricante (Ruling 136), em PNG sem fundo.
 */
function LogoMark({ logo }: { logo: DatabaseLogo }) {
  return (
    <span aria-hidden className={markBox}>
      <img src={logo.src} alt="" draggable={false} className="size-7 object-contain" />
    </span>
  );
}

/**
 * A marca de um banco na grade e no passo das configurações (RN-NAV-005): a logo do fabricante em PNG sem fundo onde há uma nas fontes que a
 * Ruling 136 aceita (`src/assets/databases/README.md`); senão, a ficha de hoje: a colorida dos bancos que o Prism conecta, e o desenho
 * genérico de banco de dados dos "em breve", que não têm cor no app.
 */
export function EngineMark({ choice }: { choice: Pick<EngineChoice, "engine" | "driver"> }) {
  const brand = brandOf(choice);
  const logo = brand === null ? null : databaseLogoOf(brand);
  if (logo !== null) return <LogoMark logo={logo} />;

  if (choice.engine === null) {
    return (
      <span aria-hidden className={cn(markBox, "border border-border-strong text-subtle")}>
        <DatabaseIcon />
      </span>
    );
  }

  return <EngineTag engine={choice.engine} aria-hidden className="h-10 w-12 flex-none rounded-md border-2 text-sm" />;
}

/** O banco escolhido, no topo do passo das configurações (RN-NAV-005: "com o banco escolhido à vista"). */
export function EngineSummary({ choice }: { choice: EngineChoice }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <EngineMark choice={choice} />
      <div className="flex min-w-0 flex-col">
        <span className="font-semibold text-ink">{choice.label}</span>
        {choice.stateLabel === "" ? null : <span className={cn("text-xs", stateColors[choice.state])}>{choice.stateLabel}</span>}
      </div>
      {choice.restartPending ? <StatusBadge tone="warning">{driversCopy.row.restartPending}</StatusBadge> : null}
    </div>
  );
}

type EngineGridProps = {
  choices: readonly EngineChoice[];
  /** O banco escolhido, ou nenhum ainda. */
  value: Engine | null;
  /** O clique, as setas e o Espaço escolhem. */
  onChange: (engine: Engine) => void;
  /** Enter e o duplo clique escolhem e avançam às configurações. */
  onPick: (engine: Engine) => void;
};

/** O `id` da descrição de uma opção (o estado e o motivo): a chave da opção é única na grade. */
const stateId = (choice: EngineChoice) => `cx-engine-${choice.key.replace(":", "-")}-state`;

/**
 * A grade de bancos com que "Nova conexão" começa, como o assistente do DBeaver (RN-NAV-005): cada banco do catálogo de drivers, com a marca,
 * o nome e o estado do driver; o "em breve" e o sem driver para a plataforma desabilitados, com o motivo (a descrição da opção).
 *
 * É um grupo de escolha única com teclado completo: uma parada de tabulação só (o escolhido, ou o primeiro que se pode escolher), as setas
 * nas duas direções (para cima e para baixo andam uma linha; quantas colunas há, a própria grade diz, porque ela se ajusta à largura), Home e
 * End; as setas e o Espaço escolhem, e Enter (ou o duplo clique) escolhe e avança. O desabilitado entra no caminho das setas, para quem usa
 * leitor de tela saber dele e do motivo, mas não é escolhido. Ao montar, o foco vai à parada de tabulação.
 */
export function EngineGrid({ choices, value, onChange, onPick }: EngineGridProps) {
  const grid = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const selected = choices.findIndex((choice) => choice.engine !== null && choice.engine === value);
  const tabStop = focused ?? gridTabStop(choices, selected);

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, []);

  const enabledEngine = (index: number) => {
    const choice = choices[index];
    return choice === undefined || choice.disabled ? null : choice.engine;
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const from = items.indexOf(event.target as HTMLElement);
    if (from < 0) return;

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const engine = enabledEngine(from);
      if (engine !== null) (event.key === "Enter" ? onPick : onChange)(engine);
      return;
    }

    const columns = (event.currentTarget.ownerDocument.defaultView?.getComputedStyle(event.currentTarget).gridTemplateColumns ?? "").split(" ").filter(Boolean).length;
    const target = gridKeyTarget(event.key, from, items.length, columns);
    if (target === null) return;

    event.preventDefault();
    items[target].focus();
    setFocused(target);
    const engine = enabledEngine(target);
    if (engine !== null) onChange(engine);
  }

  return (
    <div ref={grid} role="radiogroup" aria-label={copy.engine} onKeyDown={handleKeyDown} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {choices.map((choice, index) => {
        const checked = index === selected;
        const engine = enabledEngine(index);

        return (
          <div
            key={choice.key}
            role="radio"
            aria-checked={checked}
            aria-disabled={choice.disabled ? true : undefined}
            aria-describedby={stateId(choice)}
            tabIndex={index === tabStop ? 0 : -1}
            onFocus={() => setFocused(index)}
            onClick={engine === null ? undefined : () => onChange(engine)}
            onDoubleClick={engine === null ? undefined : () => onPick(engine)}
            className={cn(
              "flex min-w-0 flex-col items-start gap-2 rounded-lg border p-3 outline-none transition-colors select-none focus-visible:ring-2 focus-visible:ring-accent",
              checked ? "border-accent bg-selected" : "border-border",
              choice.disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-selected",
            )}
          >
            <EngineMark choice={choice} />
            <span className={cn("font-semibold break-words", choice.disabled ? "text-muted" : "text-ink")}>{choice.label}</span>
            <span id={stateId(choice)} className={cn("text-xs", stateColors[choice.state])}>
              {choice.stateLabel}
              {/* O "em breve" mostra só o estado; o motivo (o mesmo para todos) vai para o leitor de tela e para a nota embaixo da grade. */}
              {choice.reason === null ? null : choice.engine === null ? <span className="sr-only"> {choice.reason}</span> : <span className="mt-0.5 block text-muted">{choice.reason}</span>}
            </span>
            {choice.restartPending ? <StatusBadge tone="warning">{driversCopy.row.restartPending}</StatusBadge> : null}
          </div>
        );
      })}
    </div>
  );
}
