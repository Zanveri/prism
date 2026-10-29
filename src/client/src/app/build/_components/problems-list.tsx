import { AlertIcon, InfoIcon, RefreshIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { buildCopy } from "../_lib/build.copy";
import type { Problem, ProblemFix } from "../_lib/model-check";

export type ProblemsListProps = {
  problems: readonly Problem[];
  lineOf?: Record<string, number>;
  onApplyFix?: (fix: ProblemFix) => void;
  onIgnoreWarning?: (key: string) => void;
  onGoToColumn?: (table: string, column: string | null) => void;
  onReread?: () => void;
};

function fixButtonLabel(fix: ProblemFix): string {
  switch (fix.kind) {
    case "removeForeignKey":
      return "Remover a FK";
    case "createUnique":
      return `Criar único em (${fix.columns.join(", ")})`;
    case "useFkAction":
      return `Usar ${fix.onDelete}`;
    case "useType":
      return `Trocar para ${fix.type}`;
    case "createIdColumn":
      return "Criar coluna id";
    case "createIndexes":
      return `Criar os ${fix.items.length} índices`;
    case "restore":
      return "Restaurar";
    case "revert":
      return "Voltar como era";
    case "removeReferencingForeignKeys":
      return "Remover as FKs";
    case "giveDefault":
      return "Dar um padrão";
    case "useIdentity":
      return "Trocar por AI";
    case "reread":
      return buildCopy.toolbarReread;
  }
}

function problemTitle(problem: Problem): string {
  switch (problem.code) {
    case "W1":
      return "Tabela sem chave primária";
    case "W2":
      return "Tipos diferentes na FK";
    case "W3":
      return "FKs sem índice";
    case "W4":
      return "Identificador exige aspas";
    case "W5":
      return "Tipo fora do catálogo padrão";
    case "W6":
      return "FK sem restrição única no destino";
    case "W7":
      return "Tabela já existe no banco";
    case "W8":
      return "Construção ignorada ao ler texto";
    case "W10":
      return "Comando destrutivo no DDL";
    case "W11":
      return "NOT NULL sem valor padrão";
    case "W12":
      return "FK para tabela fora do modelo";
    case "W13":
      return "Mudança vinda da releitura";
    case "W14":
      return "Sequência não criada no script";
    case "I1":
      return "Sobre a conexão de destino";
    case "I2":
      return "Sobre a leitura do banco";
    case "I3":
      return "Tudo é para outro banco";
    default:
      return `Erro ${problem.code}`;
  }
}

export function formatProblemsSummary(problems: readonly Problem[]): string {
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const warningsText =
    warnings === 0
      ? "nenhum aviso"
      : `${warnings} ${warnings === 1 ? "aviso" : "avisos"}`;
  const errorsText =
    errors === 0
      ? "nenhum erro"
      : `${errors} ${errors === 1 ? "erro" : "erros"}`;
  return `${warningsText} · ${errorsText}`;
}

export function ProblemsList({
  problems,
  lineOf = {},
  onApplyFix,
  onIgnoreWarning,
  onGoToColumn,
  onReread,
}: ProblemsListProps) {
  const summary = formatProblemsSummary(problems);

  return (
    <aside
      aria-labelledby="problemas-titulo"
      className="flex min-w-0 flex-1 basis-[340px] flex-col gap-2.5 border-l border-border bg-panel p-4"
    >
      <div className="flex items-center gap-2">
        <h2 id="problemas-titulo" className="m-0 text-sm font-semibold text-ink">
          {buildCopy.ddlProblemsTitle}
        </h2>
        <span className="text-xs text-muted">{summary}</span>
      </div>

      <p className="m-0 text-xs text-muted">{buildCopy.ddlProblemsExplain}</p>

      {problems.map((problem) => {
        const line =
          (problem.table && problem.column
            ? lineOf[`${problem.table}.${problem.column}`]
            : null) ?? (problem.table ? lineOf[problem.table] : null);
        const isError = problem.severity === "error";
        const isWarning = problem.severity === "warning";

        return (
          <section
            key={problem.key}
            aria-label={problemTitle(problem)}
            className={cn(
              "flex flex-col gap-2 rounded-md border p-3",
              isError
                ? "border-danger bg-surface"
                : isWarning
                  ? "border-border bg-surface"
                  : "border-border bg-transparent",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex-none",
                  isError
                    ? "text-danger"
                    : isWarning
                      ? "text-accent"
                      : "text-muted",
                )}
              >
                {problem.code === "I2" ? (
                  <RefreshIcon />
                ) : isError || isWarning ? (
                  <AlertIcon />
                ) : (
                  <InfoIcon />
                )}
              </span>
              <span className="font-semibold text-ink">
                {problemTitle(problem)}
              </span>
              {line !== undefined && line !== null && (
                <span className="ml-auto text-xs text-muted">
                  linha {line}
                </span>
              )}
            </div>

            <p className="m-0 text-xs text-ink">{problem.message}</p>

            {(problem.fix || isWarning || problem.column) && (
              <div className="flex flex-wrap gap-1.5">
                {problem.fix && (
                  <button
                    type="button"
                    onClick={() => {
                      if (problem.fix?.kind === "reread") {
                        onReread?.();
                      } else if (problem.fix) {
                        onApplyFix?.(problem.fix);
                      }
                    }}
                    className="h-7 cursor-pointer rounded-md border-0 bg-selected px-2.5 text-xs text-ink hover:bg-hover"
                  >
                    {fixButtonLabel(problem.fix)}
                  </button>
                )}

                {problem.table && problem.column && (
                  <button
                    type="button"
                    onClick={() => onGoToColumn?.(problem.table!, problem.column)}
                    className="flex h-7 cursor-pointer items-center rounded-md border border-border-strong bg-transparent px-2.5 text-xs text-ink hover:bg-selected"
                  >
                    {buildCopy.ddlGoToColumn}
                  </button>
                )}

                {isWarning && (
                  <button
                    type="button"
                    onClick={() => onIgnoreWarning?.(problem.key)}
                    className="h-7 cursor-pointer rounded-md border border-border-strong bg-transparent px-2.5 text-xs text-muted hover:bg-selected hover:text-ink"
                  >
                    {buildCopy.ddlIgnoreWarning}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}
