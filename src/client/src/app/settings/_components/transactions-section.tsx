import { isolationLevels, transactionModes, type IsolationLevel, type TransactionMode } from "@/app/workbench/_lib/transaction";
import { transactionCopy } from "@/app/workbench/_lib/transaction.copy";
import { Field, FieldLabel, Select } from "@/components/ui";

import { settingsCopy } from "../_lib/settings.copy";
import { usePreferences } from "../_lib/use-preferences";
import { SettingsCard } from "./settings-card";

const copy = settingsCopy.transactions;
const editorCopy = transactionCopy.editor;

const modeOptions = transactionModes.map((mode) => ({
  value: mode,
  label: mode === "manual" ? editorCopy.manual : editorCopy.autoCommit,
}));

const isolationOptions = isolationLevels.map((level) => ({
  value: level,
  label: editorCopy.levels[level],
}));

/**
 * Transações (RN-CONFIG-007 e RN-ISOL-006): o modo de transação padrão (`autoCommit` ou `manual`) e o nível de isolamento padrão das abas novas.
 * Mudar não mexe nas abas já abertas; quando o nível escolhido não existe no banco da aba nova, ela abre em "Padrão do banco".
 */
export function TransactionsSection({ anchor }: { anchor: string }) {
  const { preferences, update } = usePreferences();

  return (
    <SettingsCard anchor={anchor} title={copy.title}>
      <div className="grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
        <Field>
          <FieldLabel htmlFor="cfg-modo-transacao">{copy.defaultMode}</FieldLabel>
          <Select
            id="cfg-modo-transacao"
            value={preferences.transactions.mode}
            options={modeOptions}
            onChange={(value) => {
              if ((transactionModes as readonly string[]).includes(value)) {
                update({ transactions: { mode: value as TransactionMode } });
              }
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cfg-nivel-isolamento">{copy.defaultIsolation}</FieldLabel>
          <Select
            id="cfg-nivel-isolamento"
            value={preferences.transactions.isolationLevel}
            options={isolationOptions}
            onChange={(value) => {
              if ((isolationLevels as readonly string[]).includes(value)) {
                update({ transactions: { isolationLevel: value as IsolationLevel } });
              }
            }}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">{copy.note}</p>
    </SettingsCard>
  );
}
