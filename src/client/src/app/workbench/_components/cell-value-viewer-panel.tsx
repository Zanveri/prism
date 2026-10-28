import { useRef, useState } from "react";

import { CloseIcon, DownloadIcon, DuplicateIcon, PencilIcon, UploadIcon, useHost, useToast } from "@/components/ui";
import { openExternalEditor } from "@/lib/api/bridge";
import { hostClipboard } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import {
  bytesToHexPrefixed,
  CELL_VALUE_FORMATS,
  cellFilePayload,
  cellFormatExtension,
  cellValueToBytes,
  detectCellValueFormat,
  formatCellValue,
  isHexPrefixedBinary,
  normalizeEditedCellValue,
  type CellValueFormat,
} from "../_lib/cell-value-viewer";
import type { CellValueViewerState } from "../_lib/grid-editing";
import { recordsCopy } from "../_lib/records.copy";
import { saveCellFile } from "../_lib/save-file";

const copy = recordsCopy.valueViewer;
const HEX_COLUMNS = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "0A", "0B", "0C", "0D", "0E", "0F"] as const;

function ExternalEditorIcon({ className }: { className?: string }) {
  return (
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
      className={cn("flex-none", className)}
    >
      <path d="M9.5 2.5h4v4M13.5 2.5L8 8" />
      <path d="M7 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" />
    </svg>
  );
}

function WordWrapIcon({ className }: { className?: string }) {
  return (
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
      className={cn("flex-none", className)}
    >
      <path d="M2.5 4h11M2.5 8h8.5a2 2 0 0 1 0 4H8.5M10 10.5L8.5 12 10 13.5M2.5 12h3" />
    </svg>
  );
}

type CellValueViewerPanelProps = {
  state: CellValueViewerState;
  nullText?: string;
};

/**
 * Painel lateral "Valor" (atalho `F7`), inspirado no visualizador de células do DBeaver:
 * - Fica ao lado da grade de resultados (tanto nos Registros da tabela quanto no resultado de consultas SQL), mantendo os resultados visíveis.
 * - Detecta automaticamente o formato (`JSON`, `XML`, `HTML`, `Binary` ou `Text`) a partir do tipo de dado da coluna (`JSON`, `JSONB`, `BSON`, `XML`, `BYTEA`, `BLOB`, `TEXT`, etc.).
 * - No modo `JSON` (e também `XML` / `HTML`), permite ver tanto a forma formatada (`Formatado`) quanto a forma crua (`Cru`).
 * - No modo `Binary`, exibe a tabela hexadecimal + ASCII (16 bytes por linha: `Offset | 00..0F | ASCII`).
 * - Permite copiar o valor, salvar em arquivo, abrir num editor de texto externo e, quando a célula é editável, editar, carregar de arquivo, definir `NULL` e aplicar.
 */
export function CellValueViewerPanel({ state, nullText = "NULL" }: CellValueViewerPanelProps) {
  const host = useHost();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [manualFormat, setManualFormat] = useState<{ column: number; format: CellValueFormat } | null>(null);
  const [formatted, setFormatted] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<{ cellKey: string; value: string } | null>(null);

  const active = state.active;
  if (!state.open) return null;
  const column = state.column;
  const rawValue = state.value;
  const isNull = rawValue === null;
  const isBinaryColumn =
    column?.kind === "binary" || detectCellValueFormat(column) === "binary";

  const autoFormat = detectCellValueFormat(column);
  const format: CellValueFormat =
    active !== null && manualFormat !== null && manualFormat.column === active.column
      ? manualFormat.format
      : autoFormat;

  const cellKey = active !== null ? `${active.row}:${active.column}:${rawValue ?? "__NULL__"}` : "none";
  const hasDraft = draftState !== null && draftState.cellKey === cellKey;

  const rendered = formatCellValue(rawValue ?? "", {
    format,
    formatted,
    isBinaryColumn,
  });

  const initialEditableText =
    isNull
      ? ""
      : format === "binary"
        ? rawValue !== null && isHexPrefixedBinary(rawValue)
          ? rawValue
          : bytesToHexPrefixed(cellValueToBytes(rawValue ?? "", isBinaryColumn))
        : rendered.text;

  const canEdit =
    state.editable?.editable === true &&
    active !== null &&
    typeof state.onCommitValue === "function";
  const isEditing = canEdit && editingCellKey === cellKey;
  const displayedText = hasDraft
    ? draftState.value
    : isEditing && format === "binary"
      ? initialEditableText
      : isNull
        ? ""
        : rendered.text;
  const canSetNull = state.setNullAccess?.editable === true && active !== null && typeof state.onCommitValue === "function";
  const supportsFormatToggle = format === "json" || format === "xml" || format === "html";

  const bytesCount = rawValue !== null ? cellValueToBytes(hasDraft ? draftState.value : rawValue, isBinaryColumn).length : 0;
  const charsCount = displayedText.length;

  function handleFormatChange(nextFormat: CellValueFormat) {
    setManualFormat({ column: active?.column ?? -1, format: nextFormat });
    setDraftState(null);
  }

  function handleToggleEdit() {
    if (!canEdit) return;
    if (isEditing) {
      setEditingCellKey(null);
      setDraftState(null);
    } else {
      setEditingCellKey(cellKey);
    }
  }

  function handleToggleFormatted(nextFormatted: boolean) {
    setFormatted(nextFormatted);
    if (hasDraft) {
      const nextRendered = formatCellValue(draftState.value, {
        format,
        formatted: nextFormatted,
        isBinaryColumn: false,
      });
      setDraftState({ cellKey, value: nextRendered.text });
    }
  }

  function handleCopy() {
    if (active === null || isNull) return;
    void hostClipboard(host)
      .writeText(displayedText)
      .then(
        () => toast.success(recordsCopy.edit.menu.copied),
        () => toast.warning(recordsCopy.edit.menu.notCopied),
      );
  }

  function handleSaveFile() {
    if (active === null || isNull) return;
    const sourceText = hasDraft ? draftState.value : (rawValue ?? "");
    const payload = cellFilePayload(sourceText, format, formatted, isBinaryColumn, column?.name);
    saveCellFile(payload.filename, payload.content, payload.mime, host.document);
    toast.success(copy.savedFile(payload.filename));
  }

  function handleOpenExternal() {
    if (active === null || isNull) return;
    const extension = cellFormatExtension(format);
    void openExternalEditor({
      content: displayedText,
      extension,
      ...(column?.name === undefined ? {} : { name: column.name }),
    }).then(
      (ok) => {
        if (ok) toast.success(copy.openedExternal);
        else toast.warning(copy.openExternalFailed);
      },
      () => toast.warning(copy.openExternalFailed),
    );
  }

  function handleApply() {
    if (!isEditing || !state.onCommitValue) return;
    const rawDraft = hasDraft ? draftState.value : initialEditableText;
    const valueToCommit = normalizeEditedCellValue(rawDraft, {
      format,
      isBinaryColumn,
    });
    state.onCommitValue(valueToCommit);
    setDraftState(null);
    setEditingCellKey(null);
  }

  function handleRevert() {
    setDraftState(null);
    setEditingCellKey(null);
  }

  function handleSetNull() {
    if (!canSetNull || !state.onCommitValue) return;
    state.onCommitValue(null);
    setDraftState(null);
    setEditingCellKey(null);
  }

  return (
    <aside
      aria-label={copy.title}
      data-testid="cell-value-viewer-panel"
      className="flex h-full w-88 min-w-72 max-w-[50%] shrink-0 flex-col border-l border-border bg-panel select-text"
    >
      {/* Cabeçalho estilo DBeaver: aba "Valor" + informações da coluna + ações rápidas */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-ink">{copy.title}</span>
          {column !== null && (
            <span className="truncate font-mono text-2xs text-muted" title={`${column.name} (${column.type})`}>
              {column.name} <span className="text-subtle">({column.type})</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="value-viewer-copy"
            disabled={active === null || isNull}
            onClick={handleCopy}
            title={copy.copy}
            aria-label={copy.copy}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <DuplicateIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="value-viewer-save-file"
            disabled={active === null || isNull}
            onClick={handleSaveFile}
            title={copy.saveFile}
            aria-label={copy.saveFile}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="value-viewer-open-external"
            disabled={active === null || isNull}
            onClick={handleOpenExternal}
            title={copy.openExternal}
            aria-label={copy.openExternal}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <ExternalEditorIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="value-viewer-close"
            onClick={state.onClose}
            title={copy.close}
            aria-label={copy.close}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Barra de formato (Binary, HTML, JSON, Text, XML) + alternância Formatado / Cru + Quebrar linhas */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-border bg-panel px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <select
            aria-label={copy.formatLabel}
            data-testid="value-viewer-format-select"
            value={format}
            onChange={(event) => handleFormatChange(event.target.value as CellValueFormat)}
            className="h-6 rounded border border-border bg-surface px-1.5 text-xs text-ink outline-none focus:border-accent"
          >
            {CELL_VALUE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {supportsFormatToggle && (
            <div className="inline-flex h-6 items-center rounded border border-border bg-surface p-0.5">
              <button
                type="button"
                data-testid="value-viewer-mode-formatted"
                aria-pressed={formatted}
                onClick={() => handleToggleFormatted(true)}
                className={cn(
                  "h-5 rounded-xs px-1.5 text-2xs font-medium transition-colors",
                  formatted ? "bg-selected text-ink" : "text-muted hover:text-ink",
                )}
              >
                {copy.formatted}
              </button>
              <button
                type="button"
                data-testid="value-viewer-mode-raw"
                aria-pressed={!formatted}
                onClick={() => handleToggleFormatted(false)}
                className={cn(
                  "h-5 rounded-xs px-1.5 text-2xs font-medium transition-colors",
                  !formatted ? "bg-selected text-ink" : "text-muted hover:text-ink",
                )}
              >
                {copy.raw}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              type="button"
              data-testid="value-viewer-edit-toggle"
              aria-pressed={isEditing}
              onClick={handleToggleEdit}
              title={copy.editValue}
              aria-label={copy.editValue}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded border px-1.5 text-2xs transition-colors",
                isEditing
                  ? "border-accent/40 bg-selected text-ink"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {(format !== "binary" || isEditing) && (
            <button
              type="button"
              data-testid="value-viewer-word-wrap"
              aria-pressed={wordWrap}
              onClick={() => setWordWrap((prev) => !prev)}
              title={copy.wordWrap}
              aria-label={copy.wordWrap}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded border px-1.5 text-2xs transition-colors",
                wordWrap
                  ? "border-accent/40 bg-selected text-ink"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              <WordWrapIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Corpo principal do visualizador */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {active === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted">
            {copy.noCellSelected}
          </div>
        ) : isNull && !hasDraft && !isEditing ? (
          <div className="flex flex-1 flex-col p-3">
            <span className="inline-flex w-fit rounded bg-raised px-1.5 py-0.5 font-mono text-xs italic text-subtle">
              {nullText}
            </span>
          </div>
        ) : format === "binary" && rendered.hexDump !== undefined && !isEditing ? (
          <div className="min-h-0 flex-1 overflow-auto bg-surface p-2 font-mono text-[11px] leading-5">
            <table data-testid="value-viewer-hex-table" className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-subtle">
                  <th className="pr-3 pb-1 font-normal">Offset</th>
                  {HEX_COLUMNS.map((colHex) => (
                    <th key={colHex} className="px-1 pb-1 text-center font-normal">
                      {colHex}
                    </th>
                  ))}
                  <th className="pl-3 pb-1 font-normal">ASCII</th>
                </tr>
              </thead>
              <tbody>
                {rendered.hexDump.rows.map((row, rowIndex) => (
                  <tr key={row.offset} className="hover:bg-raised">
                    <td
                      data-testid={`value-viewer-hex-offset-${rowIndex}`}
                      className="pr-3 text-subtle select-all"
                    >
                      {row.offset}
                    </td>
                    {row.hex.map((byteHex, byteIndex) => (
                      <td
                        key={`${row.offset}-${byteIndex}`}
                        className="px-1 text-center text-ink"
                      >
                        {byteHex}
                      </td>
                    ))}
                    <td
                      data-testid={`value-viewer-hex-ascii-${rowIndex}`}
                      className="pl-3 whitespace-pre text-accent select-all"
                    >
                      {row.ascii}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {format === "json" && rendered.validJson === false && (rawValue ?? "").trim().length > 0 && (
              <div className="border-b border-border bg-raised px-2.5 py-1 text-2xs text-muted">
                {copy.invalidJson}
              </div>
            )}
            <textarea
              data-testid="value-viewer-textarea"
              aria-label={copy.title}
              readOnly={!isEditing}
              value={displayedText}
              placeholder={isNull ? nullText : undefined}
              onChange={(event) => {
                if (!isEditing) return;
                setDraftState({ cellKey, value: event.target.value });
              }}
              className={cn(
                "min-h-0 flex-1 resize-none border-0 bg-surface p-2.5 font-mono text-xs leading-relaxed text-ink outline-none",
                wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto",
              )}
            />
          </div>
        )}
      </div>

      {/* Rodapé com tamanho (bytes / caracteres) e controles de edição (Definir NULL, Carregar arquivo, Reverter, Aplicar) */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-2.5 py-1.5 text-2xs text-muted">
        <div className="flex items-center gap-2">
          {active !== null && !isNull && (
            <span>
              {format === "binary" ? copy.bytesCount(bytesCount) : `${copy.charsCount(charsCount)} · ${copy.bytesCount(bytesCount)}`}
            </span>
          )}
          {active !== null && state.editable?.editable === false && (
            <span className="text-subtle" title={state.editable.reason}>
              {copy.readOnlyHint}
            </span>
          )}
        </div>

        {(isEditing || canSetNull) && (
          <div className="flex items-center gap-1">
            {isEditing && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if ((isBinaryColumn || format === "binary") && typeof file.arrayBuffer === "function") {
                      void file.arrayBuffer().then((buffer) => {
                        setDraftState({ cellKey, value: bytesToHexPrefixed(new Uint8Array(buffer)) });
                      });
                      return;
                    }
                    void file.text().then((text) => {
                      setDraftState({ cellKey, value: text });
                    });
                  }}
                />
                <button
                  type="button"
                  data-testid="value-viewer-load-file"
                  onClick={() => fileInputRef.current?.click()}
                  title={copy.loadFile}
                  className="inline-flex h-6 items-center gap-1 rounded border border-border bg-panel px-1.5 text-2xs text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {canSetNull && (
              <button
                type="button"
                data-testid="value-viewer-set-null"
                onClick={handleSetNull}
                className="inline-flex h-6 items-center rounded border border-border bg-panel px-2 text-2xs text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {copy.setNull}
              </button>
            )}
            {isEditing && (
              <button
                type="button"
                data-testid="value-viewer-revert"
                onClick={handleRevert}
                className="inline-flex h-6 items-center rounded border border-border bg-panel px-2 text-2xs text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {copy.revert}
              </button>
            )}
            {isEditing && (
              <button
                type="button"
                data-testid="value-viewer-apply"
                disabled={!hasDraft && !isNull}
                onClick={handleApply}
                className="inline-flex h-6 items-center rounded bg-accent px-2 text-2xs font-medium text-white transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
              >
                {copy.apply}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
