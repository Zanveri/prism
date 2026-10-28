import { connectionsCopy } from "../_lib/connections.copy";
import type { Folder } from "../_lib/connections.schema";

const copy = connectionsCopy.internalDescriptions;

type FolderInternalDescriptionsProps = {
  idPrefix: string;
  subject: "folder";
  checked: boolean;
  onChange: (checked: boolean) => void;
};

type ConnectionInternalDescriptionsProps = {
  idPrefix: string;
  subject: "connection";
  /** Escolha explícita da conexão (`true` ou `false`), ou `null` quando herda da pasta. */
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  /** Pasta ancestral que tem "Utilizar descrições internas" marcado, se houver. */
  inheritedFolder: Folder | null;
};

export type InternalDescriptionsSectionProps = FolderInternalDescriptionsProps | ConnectionInternalDescriptionsProps;

/**
 * Seção com o checkbox "Utilizar descrições internas" nos diálogos de pasta e de conexão.
 * Quando marcado numa pasta, todas as conexões dentro dela (e das subpastas) ficam com a opção marcada por padrão,
 * permitindo desmarcar individualmente em qualquer conexão.
 */
export function InternalDescriptionsSection(props: InternalDescriptionsSectionProps) {
  const { idPrefix, subject } = props;
  const checkboxId = `${idPrefix}-use-internal-descriptions`;
  const hintId = `${idPrefix}-use-internal-descriptions-hint`;
  const inheritedId = `${idPrefix}-use-internal-descriptions-inherited`;

  const isFolder = subject === "folder";
  const inheritedFolder = isFolder ? null : props.inheritedFolder;
  const effectiveChecked = isFolder ? props.checked : props.value !== null ? props.value : inheritedFolder !== null;
  const hiddenValue = isFolder ? String(props.checked) : props.value === null ? "" : String(props.value);

  function handleCheckboxChange(nextChecked: boolean) {
    if (isFolder) {
      props.onChange(nextChecked);
      return;
    }
    if (inheritedFolder !== null && nextChecked) {
      props.onChange(null);
      return;
    }
    props.onChange(nextChecked);
  }

  return (
    <section aria-label={copy.label} className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
      <input type="hidden" name="useInternalDescriptions" value={hiddenValue} />
      <div className="flex items-start gap-2.5">
        <input
          id={checkboxId}
          type="checkbox"
          checked={effectiveChecked}
          onChange={(event) => handleCheckboxChange(event.target.checked)}
          aria-describedby={inheritedFolder === null ? hintId : `${inheritedId} ${hintId}`}
          className="m-0 mt-[2px] size-[18px] flex-none cursor-pointer accent-accent"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={checkboxId} className="flex w-fit cursor-pointer items-center gap-1.5 font-medium text-ink">
            <span>{copy.label}</span>
          </label>
          {inheritedFolder !== null ? (
            <span id={inheritedId} className="text-xs text-body">
              {effectiveChecked ? copy.inheritedFrom(inheritedFolder.name) : copy.overriddenOffFrom(inheritedFolder.name)}
            </span>
          ) : null}
          <span id={hintId} className="text-xs text-muted">
            {isFolder ? copy.folderHint : copy.connectionHint}
          </span>
        </div>
      </div>
    </section>
  );
}
