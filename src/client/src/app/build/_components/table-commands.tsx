export type TableCommandsProps = {
  ddl: string;
  removedColumnNames: string[];
};

export function TableCommands({ ddl, removedColumnNames }: TableCommandsProps) {
  const trimmed = ddl.trim();
  if (!trimmed) {
    return null;
  }

  const commandCount = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean).length;

  return (
    <section
      aria-labelledby="h-mudancas"
      className="flex flex-col gap-2 border-t border-border pt-3"
    >
      <div className="flex h-7 items-center gap-2">
        <h2 id="h-mudancas" className="m-0 text-[13px] font-semibold">
          O que esta tabela vai gerar
        </h2>
        <span className="text-xs text-subtle">
          {commandCount} {commandCount === 1 ? "comando" : "comandos"}, no DDL
          de diferenças
        </span>
      </div>

      <pre className="m-0 box-border overflow-x-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre text-body">
        {trimmed}
      </pre>

      {removedColumnNames.length > 0 ? (
        <p className="m-0 flex items-start gap-2 text-xs leading-[18px] text-body">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            data-icon="alert"
            className="mt-px shrink-0 text-accent"
          >
            <path d="M8 2.5l6 10.5H2z" />
            <path d="M8 7v2.5M8 11.25v.01" />
          </svg>
          <span>
            Remover{" "}
            <span className="font-mono">{removedColumnNames[0]}</span> apaga os
            dados dessa coluna. Se era para trocar o nome, restaure-a e
            renomeie: renomear vira <span className="font-mono">RENAME COLUMN</span>{" "}
            e mantém os dados.
          </span>
        </p>
      ) : null}
    </section>
  );
}
