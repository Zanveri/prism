import { cn } from "@/lib/utils/cn";

/**
 * A lista das etapas à esquerda dos assistentes (RN-EXPORT-003 e RN-IMPORT-002): a atual destacada (`aria-current="step"`), as anteriores clicáveis e as
 * seguintes não; com uma gravação em andamento (`locked`), nenhuma leva de volta.
 */
export function WizardStepsNav<T extends string>({ label, steps, names, current, locked, onVisit }: { label: string; steps: readonly T[]; names: Record<T, string>; current: T; locked: boolean; onVisit: (step: T) => void }) {
  const at = steps.indexOf(current);
  return (
    <nav aria-label={label} className="w-36 flex-none">
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => {
          const isCurrent = step === current;
          const visitable = index < at && !locked;
          return (
            <li key={step}>
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={!isCurrent && !visitable}
                onClick={() => (visitable ? onVisit(step) : undefined)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm", isCurrent ? "bg-selected font-semibold text-ink" : visitable ? "cursor-pointer text-body hover:bg-selected" : "cursor-default text-subtle")}
              >
                <span aria-hidden className={cn("flex size-5 flex-none items-center justify-center rounded-full border text-xs", isCurrent ? "border-accent text-accent" : "border-border-strong")}>
                  {index + 1}
                </span>
                {names[step]}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
