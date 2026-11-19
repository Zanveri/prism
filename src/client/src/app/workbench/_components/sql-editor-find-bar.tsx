import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { ArrowDownIcon, ArrowUpIcon, Button, ChevronIcon, CloseIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { FindOptions } from "../_lib/sql-editor-vscode";
import { workbenchCopy } from "../_lib/workbench.copy";

export type EditorOverlayMode = "find" | "goto";

export type SqlEditorFindBarProps = {
  mode: EditorOverlayMode;
  showReplace: boolean;
  focusRequest: { target: "find" | "replace" | "goto"; seq: number };
  query: string;
  replacement: string;
  options: FindOptions;
  totalMatches: number;
  activeMatch: number;
  invalidRegex: boolean;
  goToValue: string;
  lineCount: number;
  mac: boolean;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onToggleReplace: () => void;
  onOptionsChange: (options: FindOptions) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onGoToValueChange: (value: string) => void;
  onSubmitGoToLine: () => void;
  onSwitchMode: (mode: EditorOverlayMode, showReplace?: boolean) => void;
  onClose: () => void;
};

export function SqlEditorFindBar({
  mode,
  showReplace,
  focusRequest,
  query,
  replacement,
  options,
  totalMatches,
  activeMatch,
  invalidRegex,
  goToValue,
  lineCount,
  mac,
  onQueryChange,
  onReplacementChange,
  onToggleReplace,
  onOptionsChange,
  onFindNext,
  onFindPrevious,
  onReplaceOne,
  onReplaceAll,
  onGoToValueChange,
  onSubmitGoToLine,
  onSwitchMode,
  onClose,
}: SqlEditorFindBarProps) {
  const copy = workbenchCopy.editor.findBar;
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const goToInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const target =
      focusRequest.target === "goto"
        ? goToInputRef.current
        : focusRequest.target === "replace"
          ? replaceInputRef.current
          : findInputRef.current;
    if (target !== null) {
      target.focus();
      target.select();
    }
  }, [focusRequest.seq, focusRequest.target]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const mod = mac ? event.metaKey : event.ctrlKey;
    const lower = event.key.toLowerCase();

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (mod && !event.shiftKey && !event.altKey && lower === "f") {
      event.preventDefault();
      event.stopPropagation();
      onSwitchMode("find");
      return;
    }

    if (((!mac && mod && !event.shiftKey && !event.altKey && lower === "h") || (mac && mod && event.altKey && !event.shiftKey && lower === "f"))) {
      event.preventDefault();
      event.stopPropagation();
      onSwitchMode("find", true);
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && lower === "g") {
      event.preventDefault();
      event.stopPropagation();
      onSwitchMode("goto");
      return;
    }

    if (mode !== "find") return;

    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.code === "KeyC") {
        event.preventDefault();
        event.stopPropagation();
        onOptionsChange({ ...options, matchCase: !options.matchCase });
        return;
      }
      if (event.code === "KeyW") {
        event.preventDefault();
        event.stopPropagation();
        onOptionsChange({ ...options, wholeWord: !options.wholeWord });
        return;
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        event.stopPropagation();
        onOptionsChange({ ...options, regex: !options.regex });
        return;
      }
    }

    if (event.key === "F3" || (mac && event.metaKey && !event.altKey && lower === "g")) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) onFindPrevious();
      else onFindNext();
      return;
    }

    if (mod && event.altKey && event.key === "Enter" && showReplace) {
      event.preventDefault();
      event.stopPropagation();
      onReplaceAll();
    }
  }

  if (mode === "goto") {
    return (
      <div
        role="region"
        aria-label={copy.goToLineLabel}
        onKeyDown={handleKeyDown}
        className="absolute top-2 right-5 z-20 flex items-center gap-1.5 rounded-md border border-border-strong bg-panel px-2 py-1.5 shadow-2xl"
      >
        <input
          ref={goToInputRef}
          type="text"
          inputMode="numeric"
          value={goToValue}
          aria-label={copy.goToLineLabel}
          placeholder={copy.goToLinePlaceholder(lineCount)}
          onChange={(event) => onGoToValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              onSubmitGoToLine();
            }
          }}
          className="h-7 w-48 rounded border border-border-strong bg-raised px-2 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-subtle focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
        />
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onSubmitGoToLine}>
          {copy.goToLineSubmit}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={copy.close} title={copy.close} onClick={onClose}>
          <CloseIcon />
        </Button>
      </div>
    );
  }

  const hasQuery = query.length > 0;
  const emptyResults = hasQuery && !invalidRegex && totalMatches === 0;
  const statusText = invalidRegex
    ? copy.invalidRegex
    : !hasQuery || totalMatches === 0
      ? copy.noResults
      : copy.matchCount(activeMatch >= 0 ? activeMatch + 1 : 1, totalMatches);

  return (
    <div
      role="region"
      aria-label={copy.label}
      onKeyDown={handleKeyDown}
      className="absolute top-2 right-5 z-20 flex items-start gap-1 rounded-md border border-border-strong bg-panel p-1.5 shadow-2xl"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={showReplace}
        aria-label={copy.toggleReplace}
        title={copy.toggleReplace}
        onClick={onToggleReplace}
        className={cn("size-7 self-stretch", showReplace && "h-auto")}
      >
        <ChevronIcon direction={showReplace ? "down" : "right"} className="size-3.5" />
      </Button>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "flex h-7 w-60 items-center gap-0.5 rounded border bg-raised pr-1 pl-2 focus-within:ring-1",
              invalidRegex ? "border-danger focus-within:border-danger focus-within:ring-danger" : "border-border-strong focus-within:border-accent focus-within:ring-accent",
            )}
          >
            <input
              ref={findInputRef}
              type="text"
              value={query}
              aria-label={copy.findLabel}
              aria-invalid={invalidRegex || undefined}
              placeholder={copy.findPlaceholder}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.shiftKey) onFindPrevious();
                  else onFindNext();
                }
              }}
              className="min-w-0 flex-1 bg-transparent font-sans text-xs text-ink outline-none placeholder:text-subtle"
            />
            <OptionToggle
              pressed={options.matchCase}
              label={copy.matchCase}
              onClick={() => onOptionsChange({ ...options, matchCase: !options.matchCase })}
            >
              Aa
            </OptionToggle>
            <OptionToggle
              pressed={options.wholeWord}
              label={copy.wholeWord}
              onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
            >
              <span className="underline decoration-current underline-offset-2">ab</span>
            </OptionToggle>
            <OptionToggle
              pressed={options.regex}
              label={copy.regex}
              onClick={() => onOptionsChange({ ...options, regex: !options.regex })}
            >
              .*
            </OptionToggle>
          </div>

          <span
            aria-live="polite"
            className={cn(
              "min-w-[5.25rem] px-1 text-xs select-none",
              invalidRegex || emptyResults ? "text-danger" : "text-muted",
            )}
          >
            {statusText}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={totalMatches === 0}
            aria-label={copy.previousMatch}
            title={copy.previousMatch}
            onClick={onFindPrevious}
          >
            <ArrowUpIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={totalMatches === 0}
            aria-label={copy.nextMatch}
            title={copy.nextMatch}
            onClick={onFindNext}
          >
            <ArrowDownIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={copy.close}
            title={copy.close}
            onClick={onClose}
          >
            <CloseIcon className="size-3.5" />
          </Button>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1.5">
            <input
              ref={replaceInputRef}
              type="text"
              value={replacement}
              aria-label={copy.replaceLabel}
              placeholder={copy.replacePlaceholder}
              onChange={(event) => onReplacementChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  onReplaceOne();
                }
              }}
              className="h-7 w-60 rounded border border-border-strong bg-raised px-2 font-sans text-xs text-ink outline-none placeholder:text-subtle focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent"
            />
            <Button
              type="button"
              variant="secondary"
              size="compact"
              className="h-7 px-2 text-xs"
              disabled={totalMatches === 0 || invalidRegex}
              title={copy.replaceOneTitle}
              onClick={onReplaceOne}
            >
              {copy.replaceOne}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              className="h-7 px-2 text-xs"
              disabled={totalMatches === 0 || invalidRegex}
              title={copy.replaceAllTitle}
              onClick={onReplaceAll}
            >
              {copy.replaceAll}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionToggle({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded px-1 font-mono text-[11px] leading-none transition-colors",
        pressed
          ? "border border-accent bg-selected font-semibold text-ink"
          : "border border-transparent text-muted hover:bg-selected hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
