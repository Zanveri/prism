import { useState } from "react";

import { useToast } from "@/components/ui";
import { getBridge } from "@/lib/api/bridge";
import { cn } from "@/lib/utils/cn";

import type { CheckOutcome } from "../../../electron/update/update-state";
import { updateCopy } from "./update.copy";

const copy = updateCopy.toasts;

/**
 * O aviso de cada resultado da consulta manual, ou nada quando há versão nova (aí quem aparece é o diálogo). A causa de uma
 * falha vem do processo principal e é escrita como texto.
 */
export function checkNotice(result: CheckOutcome, version: string): { tone: "success" | "warning" | "error"; title: string; description?: string } | null {
  if (result.outcome === "upToDate") {
    const detail = version === "" ? undefined : result.withoutPackage === undefined ? copy.upToDateDetail(version) : copy.upToDateWithoutPackage(version, result.withoutPackage);
    return { tone: "success", title: copy.upToDate, description: detail };
  }
  if (result.outcome === "noSource") return { tone: "warning", title: copy.noSource, description: copy.noSourceDetail };
  if (result.outcome === "blocked") return { tone: "warning", title: copy.blocked, description: copy.blockedDetail };
  if (result.outcome === "busy") return { tone: "warning", title: copy.busy };
  if (result.outcome === "failed") return { tone: "error", title: copy.checkFailed, description: result.reason };
  return null;
}

/**
 * Uma consulta manual: pergunta ao processo principal, mostra o resultado como aviso e, no fim (inclusive quando falha), avisa quem
 * pediu (`onChecked`). O processo principal grava a hora da tentativa nos dois casos, e quem mostra essa hora (as Configurações) a relê.
 */
export async function runUpdateCheck(toast: ReturnType<typeof useToast>, onChecked?: () => void): Promise<void> {
  try {
    const bridge = getBridge();
    const notice = checkNotice(await bridge.updates.check(), bridge.version);
    if (notice !== null) toast[notice.tone](notice.title, notice.description);
  } catch (error) {
    toast.error(copy.checkFailed, error instanceof Error ? error.message : String(error));
  } finally {
    onChecked?.();
  }
}

/**
 * "Verificar atualizações", junto da versão (RN-ATUALIZA-002): a consulta manual, cujo resultado SEMPRE aparece. Versão nova
 * abre o diálogo (`UpdateDialog`, pelo estado que o processo principal avisa); "o Prism está atualizado", "sem origem",
 * "desligadas nesta abertura" e a falha, com a causa, são avisos (`checkNotice`).
 */
export function CheckUpdatesButton({ className, onChecked }: { className?: string; onChecked?: () => void }) {
  const toast = useToast();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      await runUpdateCheck(toast, onChecked);
    } finally {
      setChecking(false);
    }
  }

  return (
    <button type="button" data-check-updates onClick={() => void check()} disabled={checking} className={cn("cursor-pointer rounded-md px-2 py-1 text-xs font-normal tracking-normal text-muted transition-colors enabled:hover:bg-selected enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50", className)}>
      {checking ? updateCopy.checking : updateCopy.check}
    </button>
  );
}
