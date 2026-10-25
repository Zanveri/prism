import { useEffect, useRef, useState } from "react";

import { apiSourceRefusal, cardButtons, cardSentence, cardState, sourceRefusal, type CardState, type SourceState } from "@/app/connections/_lib/dbeaver-model";
import { dbeaverCopy } from "@/app/connections/_lib/dbeaver.copy";
import { scanDbeaver } from "@/app/connections/_lib/dbeaver.service";
import { Button, PlusIcon } from "@/components/ui";
import { dbeaverAvailable, releaseDbeaverSource, requestDbeaverSource } from "@/lib/api/bridge";

const copy = dbeaverCopy.startHere;

type Card = CardState;

type StartHereProps = {
  /** O foco começa no primeiro botão: o painel aparece logo depois de "Criar usuário" (RN-DBEAVER-001). */
  focusFirst: boolean;
  /** "Importar do DBeaver…" (o diálogo procura sozinho) ou "Escolher a pasta do DBeaver…" (o diálogo abre pedindo a pasta). */
  onImportDbeaver: (start: "find" | "choose") => void;
  onImportPrism: () => void;
  onNewConnection: () => void;
  /** "Agora não": o painel fecha e o convite fica como feito (RN-DBEAVER-001). */
  onDismiss: () => void;
};

/**
 * O "Comece por aqui" (RN-DBEAVER-001): no lugar do estado vazio da área de trabalho, no primeiro uso, três caminhos para a primeira conexão: importar do
 * DBeaver, importar um arquivo do Prism e criar à mão. Ao aparecer, o painel pede ao processo principal que procure o DBeaver e à API que conte o que achou, e
 * **solta a cópia assim que a contagem responde**: guarda só as contagens, e nenhuma cópia com as senhas fica no disco enquanto ele está à vista. Quem clica em
 * "Importar do DBeaver…" abre o diálogo, que procura de novo. Quem decide se o painel aparece, e grava o convite, é a página (`WorkbenchPage`).
 */
export function StartHere({ focusFirst, onImportDbeaver, onImportPrism, onNewConnection, onDismiss }: StartHereProps) {
  const available = dbeaverAvailable();
  const [card, setCard] = useState<Card>({ kind: "searching" });
  const [attempt, setAttempt] = useState(0);
  const first = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!available) return;
    let current = true;

    void (async () => {
      const reply = await requestDbeaverSource("find");
      if (!current) {
        if (reply.status === "found") void releaseDbeaverSource(reply.sourceId);
        return;
      }
      if (reply.status === "found") {
        const scan = await scanDbeaver(reply.sourceId);
        // A cópia tem as senhas na cifra do DBeaver: sai do disco assim que a contagem responde, com ela boa ou não.
        void releaseDbeaverSource(reply.sourceId);
        if (!current) return;

        if (scan.ok) setCard(cardState({ kind: "ready", sourceId: reply.sourceId, where: reply.where, scan: scan.data } satisfies SourceState));
        else setCard({ kind: "refused", message: apiSourceRefusal(scan.error).message });
      } else if (reply.status === "notFound") {
        setCard({ kind: "notFound" });
      } else if (reply.status !== "canceled") {
        setCard({ kind: "refused", message: sourceRefusal(reply)?.message ?? dbeaverCopy.source.bridge });
      }
    })();

    return () => {
      current = false;
    };
  }, [attempt, available]);

  // O foco começa no primeiro botão do painel quando ele aparece logo depois de "Criar usuário", e fica onde está se a pessoa já foi para outro lugar.
  useEffect(() => {
    if (!focusFirst) return;
    const active = document.activeElement;
    if (active === null || active === document.body || panel.current?.contains(active)) first.current?.focus();
  }, [focusFirst, card.kind]);

  const buttons = cardButtons(card);

  return (
    <section ref={panel} aria-label={copy.title} className="flex min-h-0 min-w-0 flex-1 flex-col items-start justify-center-safe gap-5 overflow-y-auto px-10 py-6">
      <div className="flex max-w-[560px] flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-muted">{copy.hint}</p>
      </div>

      <div className="grid w-full max-w-[920px] grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
          <h3 className="font-semibold">{copy.dbeaver.title}</h3>
          {available ? (
            <>
              <p role="status" className="text-muted">
                {cardSentence(card)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {buttons.retry ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => {
                      setCard({ kind: "searching" });
                      setAttempt((count) => count + 1);
                    }}>
                    {dbeaverCopy.source.retry}
                  </Button>
                ) : null}
                <Button
                  ref={first}
                  type="button"
                  // A espera da procura não tira o botão do Tab: o foco do painel novo começa nele.
                  aria-disabled={buttons.primary === null || undefined}
                  onClick={() => {
                    if (buttons.primary === "import") onImportDbeaver("find");
                    else if (buttons.primary === "choose") onImportDbeaver("choose");
                  }}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                >
                  {buttons.primary === "choose" ? dbeaverCopy.source.chooseFolder : copy.dbeaver.action}
                </Button>
                {buttons.link ? (
                  <button type="button" onClick={() => onImportDbeaver("choose")} className="cursor-pointer text-sm text-accent underline-offset-2 hover:underline">
                    {dbeaverCopy.source.chooseFolder}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-muted">{dbeaverCopy.outside}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
          <h3 className="font-semibold">{copy.prism.title}</h3>
          <p className="text-muted">{copy.prism.hint}</p>
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={onImportPrism}>
              {copy.prism.action}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
          <h3 className="font-semibold">{copy.create.title}</h3>
          <p className="text-muted">{copy.create.hint}</p>
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={onNewConnection}>
              <PlusIcon />
              {copy.create.action}
            </Button>
          </div>
        </div>
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        {copy.later}
      </Button>
    </section>
  );
}
