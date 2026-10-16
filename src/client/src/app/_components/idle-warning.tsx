import { LockIcon } from "@/components/ui";

import { dataExportCopy } from "@/app/workbench/_lib/data-export/data-export.copy";

import { lockCopy } from "../_lib/lock.copy";

const copy = lockCopy.warning;

/**
 * O aviso de 60 segundos antes do bloqueio (RN-SEG-001): diz quanto falta e como cancelar. Não é um diálogo nem toma o foco: a
 * pessoa está no meio de uma coisa, e mexer o mouse ou digitar já o desfaz (o temporizador o tira da tela). Fica no alto, à direita, sob a barra
 * superior (a faixa de abas e o "Executar" ficam à esquerda), longe da pilha de avisos do canto de baixo; o ponteiro passa por ele (`pointer-events-none`), o que também conta como mexer.
 *
 * É só o desenho (`aria-hidden`): a contagem que muda a cada segundo não pode ser lida 60 vezes. Quem fala com o leitor de tela é o `IdleAnnouncer`.
 */
export function IdleWarning({ secondsLeft, discardedExports = 0 }: { secondsLeft: number; discardedExports?: number }) {
  return (
    <div className="pointer-events-none fixed top-14 right-5 z-[70] w-[min(440px,calc(100vw-2.5rem))]">
      <div aria-hidden="true" data-idle-warning className="flex animate-toast-in items-start gap-3 rounded-lg border border-accent/60 bg-raised py-3 pr-4 pl-4 shadow-2xl motion-reduce:animate-none">
        <LockIcon className="mt-[3px] text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{copy.title}</p>
          <p className="mt-0.5 text-sm text-muted">{copy.countdown(secondsLeft)}</p>
          {/* RN-SEG-001 e RN-EXPORT-023: o bloqueio descarta as exportações cuja entrega falhou e espera outro destino. */}
          {discardedExports > 0 ? <p className="mt-0.5 text-sm text-muted">{dataExportCopy.exits.discardedAtLock(discardedExports)}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * O que o leitor de tela ouve do aviso: a frase fixa, uma vez, sem a contagem. Uma região `role="status"` que já nasce preenchida não é
 * anunciada (o leitor só anuncia o que MUDA numa região que ele já conhece), então esta fica montada o tempo todo, vazia, e só recebe o texto
 * quando o aviso começa. Escondida da tela (`sr-only`). Com exportações cuja entrega falhou, a frase de que o bloqueio as descarta vai junto
 * (RN-SEG-001 e RN-EXPORT-023): o desenho do aviso é `aria-hidden`, e sem isso quem usa o leitor de tela não saberia.
 */
export function IdleAnnouncer({ active, discardedExports = 0 }: { active: boolean; discardedExports?: number }) {
  return (
    <p role="status" className="sr-only">
      {active ? (discardedExports > 0 ? `${copy.announcement} ${dataExportCopy.exits.discardedAtLock(discardedExports)}` : copy.announcement) : ""}
    </p>
  );
}
