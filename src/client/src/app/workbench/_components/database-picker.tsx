import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { DatabaseIcon, Select, useToast, type Engine } from "@/components/ui";

import { loadServerDatabases, treeQuery } from "../_lib/database-sessions.service";
import { databaseChoices, databaseOfValue, type DatabaseChoices } from "../_lib/tab-database";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.editor.database;

type DatabasePickerViewProps = {
  id: string;
  choices: DatabaseChoices;
  /** A lista dos bancos está a caminho (a pessoa abriu a lista, e ela ainda não estava em cache). */
  loading: boolean;
  /** Há comando em andamento na aba: a troca espera, porque a resposta dele é do banco de agora. */
  busy: boolean;
  onOpen: () => void;
  onChange: (value: string) => void;
};

/**
 * RN-ARVORE-007, só o desenho: o rótulo "Banco", a lista com o banco em que a aba roda e, no Db2, o motivo de ela estar presa, à vista e ligado ao
 * controle. O controle fechado fica numa linha só (o nome que não cabe termina em reticências, sem engrossar a barra) e a lista aberta (`wideList`) mostra o
 * nome inteiro. Enquanto a lista vem, uma frase numa região viva o diz (o leitor de tela ouve).
 */
export function DatabasePickerView({ id, choices, loading, busy, onOpen, onChange }: DatabasePickerViewProps) {
  const reasonId = `${id}-motivo`;
  const selectedLabel = choices.options.find((option) => option.value === choices.value)?.label;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        {copy.label}
      </label>
      <div className="relative flex min-w-0 items-center">
        <DatabaseIcon className="pointer-events-none absolute top-1/2 left-2 z-10 size-3.5 -translate-y-1/2 text-subtle" />
        <Select
          id={id}
          value={choices.value}
          options={choices.options}
          onChange={onChange}
          onOpen={onOpen}
          disabled={choices.locked || busy}
          title={selectedLabel === undefined ? copy.label : `${copy.label}: ${selectedLabel}`}
          aria-describedby={choices.locked ? reasonId : undefined}
          wideList
          className="h-7 min-h-7 w-auto max-w-48 min-w-28 border-border py-0 pr-2 pl-7 text-xs transition-colors hover:border-border-strong [&>span:first-child]:truncate"
        />
      </div>
      {choices.locked ? (
        <span id={reasonId} className="text-xs text-muted">
          {copy.locked}
        </span>
      ) : null}
      <span role="status" className={loading ? "text-xs text-muted" : "sr-only"}>
        {loading ? copy.loading : null}
      </span>
    </div>
  );
}

type DatabasePickerProps = {
  connectionId: string;
  /** O banco da aba; sem ele, o da conexão. */
  database: string | undefined;
  engine: Engine | undefined;
  busy: boolean;
  /** A pessoa escolheu outro banco (`undefined`: o da conexão). Quem recebe pergunta antes, se for o caso, e troca. */
  onChoose: (database: string | undefined) => void;
};

/**
 * RN-ARVORE-007: o banco em que a aba de consulta roda, na barra do editor, e a troca dele. A lista é a dos bancos do servidor da árvore (RN-ARVORE-006): a
 * mesma consulta e o mesmo cache. Esta barra só LÊ o cache (a consulta desligada nunca abre sessão sozinha, nem depois de "Desconectar", RN-SESSAO-004);
 * quem busca é abrir a lista, como expandir a conexão na árvore, e só quando ela ainda não está em cache ou foi atualizada.
 */
export function DatabasePicker({ connectionId, database, engine, busy, onChoose }: DatabasePickerProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const connections = useQuery(connectionsQuery);
  const listed = useQuery(treeQuery({ type: "connection", connectionId }, queryClient, false));
  const [loading, setLoading] = useState(false);

  const connectionDatabase = connections.data?.find((connection) => connection.id === connectionId)?.database;
  const choices = databaseChoices({ nodes: listed.data, current: database, connectionDatabase, engine });

  function load() {
    if (choices.locked || loading || (listed.data !== undefined && !listed.isStale)) return;

    setLoading(true);
    void loadServerDatabases(queryClient, connectionId)
      .then((outcome) => {
        if (outcome === "reopened") toast.warning(workbenchCopy.toasts.sessionReopened);
      })
      .finally(() => setLoading(false));
  }

  return (
    <DatabasePickerView
      id={id}
      choices={choices}
      loading={loading}
      busy={busy}
      onOpen={load}
      onChange={(value) => {
        if (value !== choices.value) onChoose(databaseOfValue(value));
      }}
    />
  );
}
