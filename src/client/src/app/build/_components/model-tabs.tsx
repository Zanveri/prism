import { buildCopy } from "@/app/build/_lib/build.copy";
import { BuildIcon, CloseIcon, EnvironmentPill, PlusIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export type OpenModelTab = {
  id: string;
  name: string;
  environmentName?: string | null;
  environmentColor?: string | null;
};

type ModelTabsProps = {
  tabs: readonly OpenModelTab[];
  activeModelId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewModel: () => void;
  onShowModelsList: () => void;
};

export function ModelTabs({
  tabs,
  activeModelId,
  onSelectTab,
  onCloseTab,
  onNewModel,
  onShowModelsList,
}: ModelTabsProps) {
  return (
    <nav
      aria-label={buildCopy.openModelsNavLabel}
      className="flex flex-wrap items-stretch gap-0.5 border-b border-border bg-canvas px-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeModelId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex h-10 items-center gap-2 border-b-2 px-3.5",
              isActive
                ? "border-accent bg-panel text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            <button
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelectTab(tab.id)}
              className="flex h-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-inherit"
            >
              <BuildIcon />
              <span>{tab.name}</span>
              <EnvironmentPill
                name={tab.environmentName ?? null}
                color={tab.environmentColor ?? null}
              />
            </button>
            <button
              type="button"
              aria-label={`Fechar ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-subtle hover:bg-selected hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        aria-label={buildCopy.newModelButton}
        title={buildCopy.newModelButton}
        onClick={onNewModel}
        className="flex h-8 w-8 cursor-pointer items-center justify-center self-center rounded-md border-0 bg-transparent text-muted hover:bg-selected hover:text-ink"
      >
        <PlusIcon />
      </button>

      <button
        type="button"
        onClick={onShowModelsList}
        className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 self-center rounded-md border-0 bg-transparent px-2.5 text-muted hover:bg-selected hover:text-ink"
      >
        <span>{buildCopy.savedModelsLink}</span>
      </button>
    </nav>
  );
}
