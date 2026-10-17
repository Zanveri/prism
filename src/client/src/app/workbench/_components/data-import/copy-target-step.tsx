import { useId } from "react";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { Button, EngineTag, FieldError, FormMessage, Input, LockIcon, Select, type SelectOption } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { filterTables, type TargetConnection } from "../../_lib/data-import/copy-wizard";
import type { DatabaseChoices } from "../../_lib/tab-database";

const t = dataImportCopy.copyTarget;

export type CopyTargetStepProps = {
  /** As conexões do cofre, na ordem do navegador, com o ambiente que vale em cada uma. */
  connections: readonly (TargetConnection & { environment: ShownEnvironment | null })[];
  connectionId: string;
  onConnection: (connectionId: string) => void;
  databases: DatabaseChoices;
  onDatabase: (value: string) => void;
  /** Os esquemas do banco escolhido, ou nulo enquanto não chegaram. */
  schemas: readonly string[] | null;
  schema: string | null;
  onSchema: (schema: string) => void;
  /** As tabelas do esquema escolhido (não as visões), ou nulo enquanto não chegaram. */
  tables: readonly string[] | null;
  table: string | null;
  onTable: (table: string) => void;
  search: string;
  onSearch: (search: string) => void;
  /** O que a etapa espera ("Conectando a DW…", "Lendo as tabelas…"), com papel de estado. */
  waiting: string | null;
  /** A falha da conexão ou das listas: a mensagem do banco, "Tentar de novo" quando vale e o driver que falta. */
  failure: { message: string; retry: (() => void) | null; driverID?: string } | null;
  /** O que segura a etapa e que não é espera nem falha (a conexão somente leitura, a própria origem), no próprio lugar. */
  problem: string | null;
};

/** As opções da "Conexão": o nome, a etiqueta do banco e o ambiente; a somente leitura desabilitada, com o cadeado e "somente leitura", e o motivo embaixo. */
export function connectionOptions(connections: CopyTargetStepProps["connections"]): SelectOption[] {
  return connections.map(({ connection, path, readOnly, environment }) => ({
    value: connection.id,
    label: connection.name,
    disabled: readOnly !== null,
    hint: [path === "" ? null : path, readOnly].filter((part) => part !== null).join(" — ") || undefined,
    content: (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <EngineTag engine={connection.engine} />
        <span className="truncate">{connection.name}</span>
        <ShownEnvironmentPill environment={environment} />
        {readOnly === null ? null : (
          <span className="flex items-center gap-1 text-xs text-muted">
            <LockIcon className="size-3.5" />
            {t.readOnlyOption}
          </span>
        )}
      </span>
    ),
  }));
}

/**
 * RN-IMPORT-023, a etapa "Tabela de destino", só de propriedades: a conexão (todas as do cofre, a somente leitura desabilitada), o banco de dados (no Db2,
 * preso ao da conexão, com o motivo), o esquema e a tabela, com a busca e só as tabelas. A espera e a falha das listas aparecem na etapa, com a mensagem do
 * banco e "Tentar de novo"; a tabela que é a própria origem também, no lugar dela.
 */
export function CopyTargetStep(props: CopyTargetStepProps) {
  const id = useId();
  const shown = props.tables === null ? null : filterTables(props.tables, props.search);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-connection`} className="text-sm text-muted">
          {t.connection}
        </label>
        <Select id={`${id}-connection`} value={props.connectionId} options={connectionOptions(props.connections)} onChange={props.onConnection} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-database`} className="text-sm text-muted">
          {t.database}
        </label>
        <Select
          id={`${id}-database`}
          value={props.databases.value}
          options={props.databases.options}
          onChange={props.onDatabase}
          disabled={props.databases.locked}
          aria-describedby={props.databases.locked ? `${id}-database-locked` : undefined}
        />
        {props.databases.locked ? (
          <span id={`${id}-database-locked`} className="text-sm text-muted">
            {t.db2Locked}
          </span>
        ) : null}
      </div>

      {props.failure === null ? null : (
        <div className="flex flex-col items-start gap-2">
          <FormMessage tone="error">{props.failure.message}</FormMessage>
          {props.failure.driverID === undefined ? null : <InstallDriverLink driverID={props.failure.driverID} />}
          {props.failure.retry === null ? null : (
            <Button type="button" variant="secondary" size="compact" onClick={props.failure.retry}>
              {t.retry}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-schema`} className="text-sm text-muted">
          {t.schema}
        </label>
        <Select id={`${id}-schema`} value={props.schema ?? ""} placeholder={t.chooseSchema} options={(props.schemas ?? []).map((schema) => ({ value: schema, label: schema }))} onChange={props.onSchema} disabled={props.schemas === null} />
      </div>

      <fieldset className="flex min-h-0 flex-col gap-1.5" aria-describedby={props.problem === null ? undefined : `${id}-problem`}>
        <legend className="mb-1.5 text-sm text-muted">{t.table}</legend>
        <Input type="search" aria-label={t.search} placeholder={t.search} value={props.search} onChange={(event) => props.onSearch(event.target.value)} disabled={props.tables === null} className="h-8 text-sm" />
        {shown === null ? null : shown.length === 0 ? (
          <p className="text-sm text-muted">{props.tables?.length === 0 ? t.noTables : t.noMatch}</p>
        ) : (
          // A lista rola; o Tab entra na escolhida, e as setas andam entre as tabelas (o grupo de opções nativo).
          <ul aria-label={t.tables} className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border-strong p-1 [content-visibility:auto]">
            {shown.map((name) => (
              <li key={name}>
                <label className={cn("flex cursor-pointer items-center gap-2.5 rounded px-2 py-1 hover:bg-selected", name === props.table ? "bg-selected" : null)}>
                  <input type="radio" name={`${id}-table`} checked={name === props.table} onChange={() => props.onTable(name)} className="size-4 flex-none cursor-pointer accent-accent" />
                  <span className="min-w-0 truncate font-mono text-ink">
                    <bdi>{name}</bdi>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <FieldError id={`${id}-problem`}>{props.problem ?? undefined}</FieldError>
      </fieldset>

      <p role="status" className="min-h-5 text-sm text-muted">
        {props.waiting ?? ""}
      </p>
    </div>
  );
}
