import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api/prism-api";

import { columnsQuery, foreignKeysQuery, indexesQuery } from "../table-structure.service";
import type { SqlOptions, SqlPlan, SqlTable } from "./generate-sql";
import { readSqlOptions, writeSqlOptions, type RememberedSqlOptions } from "./generate-sql-choices";
import { runSqlFlow, sqlDialogView, type CatalogAnswer, type SqlDialogPhase, type SqlDialogRequest, type SqlDialogView, type SqlFlowDeps, type TargetAnswer } from "./generate-sql-flow";
import { generateSqlCopy } from "./generate-sql.copy";

const dialogCopy = generateSqlCopy.dialog;

/**
 * O diálogo "Gerar SQL" (RN-GRADE-018) ligado: abre com as linhas da seleção daquele instante, segue o caminho de `runSqlFlow`, lembra as opções por usuário,
 * copia e abre a aba de consulta. As peças que falam com a API e com a grade vêm de quem o usa (`GenerateSqlDeps`: a grade, `use-grid-generate-sql.ts`,
 * entrega o alvo pelo contexto dela, `GridSelectionContext.sqlTarget`, o mesmo do "Copiar como"); `catalogReader` monta a do CREATE.
 */

/** O que o diálogo recebe ao abrir, com o resultado: as respostas do `edit-target` ficam guardadas por ele. */
export type GenerateSqlRequest = SqlDialogRequest & { resultId: string };

export type GenerateSqlDeps = SqlFlowDeps & {
  /** Abre a aba de consulta nova, da mesma conexão e do mesmo banco do resultado, com o texto no editor; nada é executado (RN-GRADE-018). */
  openQueryTab: (sql: string) => void;
  /** Escreve na área de transferência; rejeita quando não dá. Por padrão, `navigator.clipboard.writeText`. */
  copyText?: (text: string) => Promise<void>;
  /** RN-GRADE-014: segura a atualização automática enquanto o diálogo está aberto; o que devolve a solta. */
  hold?: () => () => void;
};

/** O que o componente do diálogo desenha e o que cada controle faz. */
export type GenerateSqlDialogProps = {
  view: SqlDialogView;
  options: SqlOptions;
  onOption: (patch: Partial<RememberedSqlOptions>) => void;
  onTarget: (target: SqlTable) => void;
  onRetry: () => void;
  onCopy: () => void;
  onOpenInTab: () => void;
  onClose: () => void;
};

/** O `catalog` do caminho (o CREATE): as três listas da Estrutura, pela sessão da árvore e do mesmo cache (RN-TABELA-003), com a mensagem da falha. */
export function catalogReader(queryClient: QueryClient, connectionId: string, database?: string): SqlFlowDeps["catalog"] {
  return async (table): Promise<CatalogAnswer> => {
    try {
      const [columns, foreignKeys, indexes] = await Promise.all([
        queryClient.fetchQuery(columnsQuery(connectionId, table.schema, table.name, queryClient, true, database)),
        queryClient.fetchQuery(foreignKeysQuery(connectionId, table.schema, table.name, queryClient, true, database)),
        queryClient.fetchQuery(indexesQuery(connectionId, table.schema, table.name, queryClient, true, database)),
      ]);
      return { kind: "catalog", columns, foreignKeys, indexes };
    } catch (error) {
      return { kind: "failed", message: error instanceof ApiRequestError ? (error.error.detail ?? error.error.title) : null };
    }
  };
}

const defaultCopy = (text: string) => navigator.clipboard.writeText(text);

/** A fase do resultado que mudou com o diálogo aberto, sempre a mesma: o texto memorizado não é refeito por ela a cada renderização. */
const changedPhase: SqlDialogPhase = { kind: "changed" };

/** O que o diálogo guarda enquanto está aberto. */
type Open = { request: GenerateSqlRequest; phase: SqlDialogPhase };

/**
 * O gancho do diálogo. `open` abre com o pedido (o item e as linhas de agora); `dialog` é nulo com ele fechado. `planOf` diz o que o resultado permite depois
 * da primeira resposta (o motivo dos itens desabilitados dali em diante, RN-GRADE-006). Fechar (o "Fechar", o Esc, o X, o "Cancelar" da busca, o bloqueio
 * por inatividade, que manda um Esc ao diálogo) interrompe o que estava em andamento, e nada mais aparece.
 */
export function useGenerateSql({ userName, deps }: { userName: string | null; deps: GenerateSqlDeps }) {
  const toast = useToast();
  const [open, setOpen] = useState<Open | null>(null);
  const [options, setOptions] = useState<SqlOptions>(() => readSqlOptions(userName));
  const current = useRef<{ controller: AbortController; release: (() => void) | null } | null>(null);
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  const answers = useRef(new Map<string, TargetAnswer>());
  const plans = useRef(new Map<string, SqlPlan>());

  const stop = useCallback(() => {
    const running = current.current;
    current.current = null;
    running?.controller.abort();
    running?.release?.();
  }, []);

  // Desmontado com o diálogo aberto (a aba que fecha), nada fica preso: a busca para e a atualização automática volta.
  useEffect(() => stop, [stop]);

  const start = useCallback(
    (request: GenerateSqlRequest, keepOptions: boolean) => {
      const release = current.current?.release ?? latest.current.hold?.() ?? null;
      current.current?.controller.abort();
      const controller = new AbortController();
      current.current = { controller, release };
      setOpen({ request, phase: request.item === "create" && request.records !== null ? { kind: "catalog" } : { kind: "checking" } });
      if (!keepOptions) setOptions(readSqlOptions(userName));

      const flow: SqlFlowDeps = {
        ...latest.current,
        // A resposta do `edit-target` vale para o resultado: a segunda escolha não pergunta de novo, e o "Tentar de novo" da falha, sim.
        target: async (signal) => {
          const known = answers.current.get(request.resultId);
          if (known !== undefined) return known;
          const answer = await latest.current.target(signal);
          if (answer.kind === "target" || answer.kind === "notEditable") answers.current.set(request.resultId, answer);
          return answer;
        },
      };
      // O plano do CREATE dos Registros não vem do alvo (é a tabela da aba, sem colunas nem chave, `recordsPlan`): não diz o que os outros itens permitem, e
      // não fica para o submenu.
      const fromTarget = request.item !== "create" || request.records === null;
      const show = (phase: SqlDialogPhase) => {
        if (controller.signal.aborted) return;
        if (fromTarget && (phase.kind === "rows" || phase.kind === "ddl" || (phase.kind === "refused" && phase.plan !== null))) plans.current.set(request.resultId, phase.plan as SqlPlan);
        setOpen((now) => (now?.request === request ? { request, phase } : now));
      };
      void runSqlFlow(request, flow, controller.signal, show).catch((error: unknown) => {
        console.error("[prism] gerar SQL:", error);
        show({ kind: "failed", title: request.item === "create" ? dialogCopy.catalogFailed : dialogCopy.targetFailed, message: null });
      });
    },
    [userName],
  );

  const close = useCallback(() => {
    stop();
    setOpen(null);
  }, [stop]);

  const openDialog = useCallback((request: GenerateSqlRequest) => start(request, false), [start]);

  // RN-GRADE-018: a execução que já rodava trocou as linhas com o diálogo aberto: nada é gerado. O texto é refeito só quando a fase ou as opções mudam, e não
  // a cada renderização de quem mostra o diálogo: com muitas linhas, gerar custa.
  const phase: SqlDialogPhase | null = open === null ? null : open.phase.kind === "changed" || deps.stillCurrent() ? open.phase : changedPhase;
  const view = useMemo(() => (open === null || phase === null ? null : sqlDialogView(open.request, phase, options)), [open, phase, options]);

  let dialog: GenerateSqlDialogProps | null = null;
  if (open !== null && view !== null) {
    const text = view.body.kind === "text" ? view.body.text : null;
    dialog = {
      view,
      options,
      onOption: (patch) => {
        const next = { ...options, ...patch };
        setOptions(next);
        writeSqlOptions(userName, next);
      },
      onTarget: (target) => setOptions({ ...options, target }),
      onRetry: () => {
        answers.current.delete(open.request.resultId);
        start(open.request, true);
      },
      onCopy: () => {
        if (text === null) return;
        void (deps.copyText ?? defaultCopy)(text).then(
          () => {
            toast.success(dialogCopy.copied);
            close();
          },
          () => toast.warning(dialogCopy.notCopied),
        );
      },
      onOpenInTab: () => {
        if (text === null) return;
        deps.openQueryTab(text);
        close();
      },
      onClose: close,
    };
  }

  return {
    open: openDialog,
    close,
    dialog,
    /** O plano do resultado depois da primeira resposta, para o motivo dos itens desabilitados no submenu (`sqlMenuStates`). */
    planOf: (resultId: string): SqlPlan | null => plans.current.get(resultId) ?? null,
  };
}
