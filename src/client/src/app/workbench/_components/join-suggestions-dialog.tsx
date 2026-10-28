import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button, Dialog, ForeignKeyIcon, TableIcon, type Engine } from "@/components/ui";

import type { ForeignKey, ObjectNames, ReferencingForeignKey } from "../_lib/database-sessions.schema";
import { objectNamesKey, objectNamesQuery } from "../_lib/database-sessions.service";
import { cachedLevels, sqlName } from "../_lib/sql-completion";
import { linksOf } from "../_lib/sql-join";
import {
  analyzeStatementForJoinModal,
  buildSelectedJoins,
  childNodesOf,
  formatJoinInsertion,
  setJoinNodeChildren,
  setJoinNodeLoading,
  toggleJoinNode,
  type JoinTreeNode,
  type JoinTreeRoot,
} from "../_lib/sql-join-modal";
import { resolveReference, type ResolvedReference } from "../_lib/sql-references";
import { defaultSchemasOf, linkCatalog } from "../_lib/table-links";
import { foreignKeysQuery, referencedByQuery } from "../_lib/table-structure.service";
import { workbenchCopy } from "../_lib/workbench.copy";

export type JoinSuggestionsDialogProps = {
  open: boolean;
  sql: string;
  cursorOffset: number;
  engine: Engine | undefined;
  connectionId: string | null;
  database: string | undefined;
  userName: string | undefined;
  blankLines: boolean;
  uppercaseKeywords: boolean;
  onClose: () => void;
  onApply: (replacement: { from: number; to: number; text: string }) => void;
};

const copy = workbenchCopy.editor.joinModal;

export function JoinSuggestionsDialog({
  open,
  sql,
  cursorOffset,
  engine,
  connectionId,
  database,
  userName,
  blankLines,
  uppercaseKeywords,
  onClose,
  onApply,
}: JoinSuggestionsDialogProps) {
  const queryClient = useQueryClient();
  const [roots, setRoots] = useState<JoinTreeRoot[]>([]);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);

  const plan = useMemo(() => {
    if (!open) return null;
    return analyzeStatementForJoinModal(sql, cursorOffset, engine, blankLines);
  }, [open, sql, cursorOffset, engine, blankLines]);

  const defaults = useMemo(() => defaultSchemasOf(engine, userName), [engine, userName]);

  const canLoad = open && connectionId !== null && plan !== null && plan.references.length > 0;
  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setRoots([]);
      setUnresolvedNames([]);
      setLoadingInitial(false);
    } else if (connectionId !== null && plan !== null && plan.references.length > 0) {
      setLoadingInitial(true);
    }
  }

  useEffect(() => {
    if (!canLoad || connectionId === null || plan === null) return;

    let cancelled = false;

    const loadRoots = async () => {
      try {
        let names = queryClient.getQueryData<ObjectNames>(objectNamesKey(connectionId, database));
        let catalog = linkCatalog(cachedLevels(queryClient, connectionId, database), names);
        const resolveAll = (): ResolvedReference[] =>
          plan.references
            .map((ref) => resolveReference(ref, catalog, defaults))
            .filter((item): item is ResolvedReference => item !== null);

        let resolvedList = resolveAll();

        if (resolvedList.length < plan.references.length || catalog.size === 0) {
          try {
            names = await queryClient.fetchQuery(objectNamesQuery(connectionId, database, queryClient, true));
            catalog = linkCatalog(cachedLevels(queryClient, connectionId, database), names);
            resolvedList = resolveAll();
          } catch {
            // Segue com o que já estava em cache.
          }
        }

        if (cancelled) return;

        const resolvedRefs = new Set(resolvedList.map((item) => item.reference));
        const missing = plan.references
          .filter((ref) => !resolvedRefs.has(ref))
          .map((ref) => (ref.schema !== null ? `${ref.schema}.${ref.name}` : ref.name));
        setUnresolvedNames(missing);

        const loadedRoots: JoinTreeRoot[] = await Promise.all(
          resolvedList.map(async (resolved, index) => {
            const [outgoing, incoming] = await Promise.all([
              queryClient
                .fetchQuery({ ...foreignKeysQuery(connectionId, resolved.schema, resolved.name, queryClient, true, database), meta: { silent: true } })
                .catch((): ForeignKey[] => []),
              queryClient
                .fetchQuery({ ...referencedByQuery(connectionId, resolved.schema, resolved.name, queryClient, true, database), meta: { silent: true } })
                .catch((): ReferencingForeignKey[] => []),
            ]);
            const links = linksOf(outgoing, incoming);
            const qualifier = resolved.reference.alias ?? sqlName(resolved.name, engine);
            const rootKey = `root:${index}:${resolved.schema}.${resolved.name}:${qualifier}`;
            return {
              key: rootKey,
              schema: resolved.schema,
              name: resolved.name,
              qualifier,
              qualified: resolved.reference.schema !== null,
              nodes: childNodesOf(rootKey, resolved.schema, resolved.name, 1, links),
            };
          }),
        );

        if (!cancelled) {
          setRoots(loadedRoots);
        }
      } finally {
        if (!cancelled) {
          setLoadingInitial(false);
        }
      }
    };

    void loadRoots();

    return () => {
      cancelled = true;
    };
  }, [canLoad, connectionId, database, plan, defaults, engine, queryClient]);

  const selectedJoins = useMemo(() => {
    if (plan === null || roots.length === 0) return [];
    return buildSelectedJoins(roots, {
      used: plan.used,
      usesAliases: plan.usesAliases,
      engine,
      defaultSchemas: defaults,
      uppercaseKeywords,
    });
  }, [roots, plan, engine, defaults, uppercaseKeywords]);

  function handleToggleNode(node: JoinTreeNode, nextChecked: boolean) {
    setRoots((prev) => toggleJoinNode(prev, node.id, nextChecked));

    if (nextChecked && !node.loaded && !node.loading && connectionId !== null) {
      setRoots((prev) => setJoinNodeLoading(prev, node.id, true));
      void Promise.all([
        queryClient
          .fetchQuery({ ...foreignKeysQuery(connectionId, node.targetSchema, node.targetName, queryClient, true, database), meta: { silent: true } })
          .catch((): ForeignKey[] => []),
        queryClient
          .fetchQuery({ ...referencedByQuery(connectionId, node.targetSchema, node.targetName, queryClient, true, database), meta: { silent: true } })
          .catch((): ReferencingForeignKey[] => []),
      ]).then(([outgoing, incoming]) => {
        const links = linksOf(outgoing, incoming);
        setRoots((prev) => setJoinNodeChildren(prev, node.id, links));
      });
    }
  }

  function handleConfirm() {
    if (plan === null || selectedJoins.length === 0) return;
    const text = formatJoinInsertion(selectedJoins, plan.insert);
    onApply({
      from: plan.insert.from,
      to: plan.insert.to,
      text,
    });
    onClose();
  }

  function renderNode(node: JoinTreeNode, rootQualified: boolean) {
    const showSchema = rootQualified || node.targetSchema !== node.sourceSchema;
    const displayTable = showSchema ? `${node.targetSchema}.${node.targetName}` : node.targetName;
    const columnsDetail = `${node.targetName}.${node.targetColumns.join(", ")} = ${node.sourceName}.${node.sourceColumns.join(", ")}`;

    return (
      <div key={node.id} className="flex flex-col">
        <label
          style={{ paddingLeft: `${(node.depth - 1) * 20 + 8}px` }}
          className="flex cursor-pointer items-center gap-2.5 rounded-[5px] py-1.5 pr-2 text-[12.5px] text-fg select-none hover:bg-interactive"
        >
          <input
            type="checkbox"
            checked={node.checked}
            onChange={(event) => handleToggleNode(node, event.target.checked)}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
          />
          <ForeignKeyIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="font-mono font-medium text-fg">{displayTable}</span>
          <span className="truncate font-mono text-[11.5px] text-fg-muted">{columnsDetail}</span>
        </label>

        {node.checked && node.loading && (
          <div
            style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
            className="py-1 text-[11.5px] text-fg-muted"
          >
            {copy.loadingChildren}
          </div>
        )}

        {node.checked && node.loaded && node.children.length === 0 && (
          <div
            style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
            className="py-1 text-[11.5px] text-fg-subtle"
          >
            {copy.noLinks}
          </div>
        )}

        {node.checked && node.children.length > 0 && (
          <div className="flex flex-col border-l border-border-subtle ml-3">
            {node.children.map((child) => renderNode(child, rootQualified))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      title={copy.title}
      description={copy.description}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={selectedJoins.length === 0 || plan === null}
            onClick={handleConfirm}
          >
            {copy.insert(selectedJoins.length)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {connectionId === null ? (
          <p className="text-[12.5px] text-fg-muted">{copy.noConnection}</p>
        ) : plan === null || plan.references.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">{copy.noFromTable}</p>
        ) : loadingInitial ? (
          <p className="text-[12.5px] text-fg-muted">{copy.loading}</p>
        ) : (
          <>
            {unresolvedNames.length > 0 && (
              <p className="text-[12px] text-fg-muted">{copy.unresolvedTables(unresolvedNames.join(", "))}</p>
            )}

            <div className="flex max-h-[320px] flex-col gap-3 overflow-y-auto rounded-[6px] border border-border bg-bg p-2.5">
              {roots.map((root) => {
                const rootDisplay = root.qualified ? `${root.schema}.${root.name}` : root.name;
                return (
                  <div key={root.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 px-1 py-1 text-[12px] font-medium text-fg-muted">
                      <TableIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                      <span className="font-mono text-fg">{rootDisplay}</span>
                      <span className="font-mono text-[11px] text-fg-subtle">({root.schema})</span>
                    </div>
                    {root.nodes.length === 0 ? (
                      <p className="pl-6 py-1 text-[12px] text-fg-subtle">{copy.noLinks}</p>
                    ) : (
                      <div className="flex flex-col">
                        {root.nodes.map((node) => renderNode(node, root.qualified))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedJoins.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-medium text-fg-muted">{copy.previewLabel}</span>
                <pre className="max-h-[140px] overflow-x-auto overflow-y-auto rounded-[6px] border border-border bg-bg px-3 py-2 font-mono text-[12px] text-fg">
                  {selectedJoins.map((join) => join.clause).join("\n")}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
