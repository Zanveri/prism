import { useEffect, useState } from "react";

import { Button, Dialog, FormMessage, RefreshIcon, StatusBadge, useToast } from "@/components/ui";
import { getBridge } from "@/lib/api/bridge";

import type { UpdateNotice, UpdateState } from "../../../electron/update/update-state";
import { ReleaseNotes } from "./release-notes";
import { adoptUpdateState, dismissUpdate, useUpdateSnapshot } from "./update-store";
import { updateCopy } from "./update.copy";

const copy = updateCopy.dialog;
const betaCopy = updateCopy.beta;

type OfferState = Exclude<UpdateState, { status: "none" }>;

/** `2026-10-10` → `10/10/2026`. A data é só o dia: montar um `Date` com ela a deslocaria pelo fuso. */
function formatDay(date: string): string {
  return date.split("-").reverse().join("/");
}

/** 1 MB = 1.048.576 bytes, a conta do Windows, como na tela de Drivers. */
function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/**
 * Baixado e conferido, a instalação segue sozinha? Só com o instalador do Windows, que é o que o texto do diálogo promete
 * ("o Prism fecha, instala a versão nova e abre de novo"). Nos outros formatos o passo seguinte grava na pasta de downloads
 * da pessoa e abre o gerenciador de arquivos: espera o clique dela em "Mostrar na pasta de downloads".
 */
export function installsRightAway(state: UpdateState): boolean {
  return state.status === "ready" && state.format === "nsis";
}

/** O aviso, ao abrir, da atualização do Windows que não foi instalada (RN-INSTALA-003): a versão que não entrou e a de agora. */
export function noticeToast({ version, current, forAllUsers }: UpdateNotice): { title: string; description: string } {
  return { title: updateCopy.notice.title(version), description: forAllUsers ? updateCopy.notice.forAll(current) : updateCopy.notice.forMe(current) };
}

export type UpdateDialogViewProps = {
  state: OfferState;
  /** A caixa "Não verificar ao abrir" (RN-ATUALIZA-003 e 007). */
  noStartupCheck: boolean;
  /** Um pedido ao processo principal está a caminho: os botões esperam. */
  busy: boolean;
  onUpdate: () => void;
  onLater: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onNoStartupCheckChange: (checked: boolean) => void;
};

/**
 * O que o diálogo de versão nova desenha (RN-ATUALIZA-003), só de propriedades, sem estado nem ponte: é o que os testes
 * renderizam. A versão instalada, a nova e a data; as notas de TODAS as versões mais novas, da mais recente para a mais
 * antiga; e as ações do estado em que a atualização está. Tudo o que veio da rede (as notas, a causa de uma falha) é texto:
 * as notas passam pelo interpretador (`ReleaseNotes`), e nada vira HTML, link ou imagem (RN-ATUALIZA-004). Com o canal beta
 * ligado, a versão oferecida pode ser um beta: o cabeçalho diz isso e avisa que pode ter defeitos, e cada beta das notas leva a
 * marca (RN-ATUALIZA-010).
 */
export function UpdateDialogView({ state, noStartupCheck, busy, onUpdate, onLater, onSkip, onCancel, onInstall, onNoStartupCheckChange }: UpdateDialogViewProps) {
  const { status, current, format, forAllUsers, releases } = state;
  const [latest] = releases;
  const downloading = status === "downloading";
  const installing = status === "installing";
  const manual = format !== null && format !== "nsis";
  const percent = downloading && state.totalBytes !== null && state.totalBytes > 0 ? Math.min(100, Math.floor((state.receivedBytes / state.totalBytes) * 100)) : null;

  const footer =
    installing ? undefined : status === "downloading" ? (
      <Button type="button" variant="secondary" onClick={onCancel}>
        {copy.cancel}
      </Button>
    ) : status === "delivered" ? (
      <Button type="button" onClick={onLater}>
        {copy.close}
      </Button>
    ) : (
      <>
        {status === "available" ? (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={busy} className="mr-auto">
            {copy.skip}
          </Button>
        ) : null}
        {/*
          O foco inicial é de "Depois", a saída que não muda nada. O diálogo abre sozinho, por cima de um campo que tinha o
          foco (o usuário do login, por exemplo): com o foco em "Atualizar agora", o Enter ou o Espaço que a pessoa ia dar a
          outra coisa baixaria a versão, rodaria o instalador e fecharia o app sem ela ter escolhido.
        */}
        <Button type="button" variant="secondary" autoFocus data-update-later onClick={onLater} disabled={busy}>
          {copy.later}
        </Button>
        {status === "ready" ? (
          <Button type="button" onClick={onInstall} disabled={busy}>
            {manual ? copy.reveal : copy.install}
          </Button>
        ) : (
          <Button type="button" onClick={onUpdate} disabled={busy || format === null}>
            {status === "failed" ? copy.retry : copy.update}
          </Button>
        )}
      </>
    );
  const offering = status === "available" || status === "failed";

  return (
    <Dialog
      open
      size="lg"
      icon={<RefreshIcon />}
      title={copy.title}
      // O cabeçalho do diálogo não rola. Por isso a linha de confiança (RN-ATUALIZA-009) e o aviso do que "Atualizar agora"
      // vai fazer ficam nele, e não depois das notas: com notas longas, quem decide ainda os tem à vista.
      description={
        <div className="flex flex-col gap-1.5">
          <p data-update-versions>
            {copy.installed}: <span className="font-mono text-ink">{current}</span> · {copy.latest}: <span className="font-mono text-ink">{latest.version}</span>
            {latest.prerelease ? ` ${betaCopy.offered}` : null}
            {latest.date === null ? null : ` ${copy.releasedOn(formatDay(latest.date))}`}
          </p>
          {latest.prerelease ? (
            <p data-update-beta className="text-sm text-ink">
              <StatusBadge tone="warning" className="mr-1.5 align-[1px]">
                {betaCopy.badge}
              </StatusBadge>
              {betaCopy.warning} {betaCopy.warningDetail}
            </p>
          ) : null}
          <p data-update-trust className="text-sm">
            {copy.trust}
          </p>
          {offering ? (
            <p data-update-next className="text-sm text-ink">
              {format === null ? copy.next.unavailable : manual ? copy.next.manual : forAllUsers ? copy.next.nsisForAll : copy.next.nsis}
            </p>
          ) : null}
        </div>
      }
      pending={downloading || installing || busy}
      onClose={onLater}
      footer={footer}
    >
      <div data-update-dialog={status} className="flex flex-col gap-5">
        {status === "failed" ? (
          <FormMessage tone="error">
            <p className="font-semibold">{copy.failed}</p>
            <p className="mt-1 break-words select-text">{state.reason}</p>
          </FormMessage>
        ) : null}

        {status === "downloading" ? (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-ink">{copy.downloading}</p>
            <div className="flex items-center gap-3">
              <div role="progressbar" aria-label={copy.downloadProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <div className={percent === null ? "h-full w-1/3 animate-pulse bg-accent" : "h-full bg-accent transition-[width]"} style={percent === null ? undefined : { width: `${percent}%` }} />
              </div>
              <span className="flex-none font-mono text-xs text-muted">
                {state.totalBytes === null ? copy.received(formatMegabytes(state.receivedBytes)) : copy.receivedOf(formatMegabytes(state.receivedBytes), formatMegabytes(state.totalBytes))}
              </span>
            </div>
          </div>
        ) : null}

        {status === "ready" ? (
          <FormMessage tone="success">
            <p className="font-semibold">{copy.ready}</p>
            <p className="mt-1">{manual ? copy.readyManual : copy.readyNsis}</p>
          </FormMessage>
        ) : null}

        {installing ? (
          <FormMessage tone="success">
            <p className="font-semibold">{copy.installing}</p>
            <p className="mt-1">{forAllUsers ? copy.installingDetailForAll : copy.installingDetail}</p>
          </FormMessage>
        ) : null}

        {status === "delivered" ? (
          <FormMessage tone="success">
            <p className="font-semibold break-all select-text">{copy.delivered(state.fileName)}</p>
            {format === null ? null : <p className="mt-1">{updateCopy.instructions[format]}</p>}
          </FormMessage>
        ) : null}

        <div className="flex flex-col gap-5">
          {releases.map((release) => (
            <section key={release.version} data-update-release={release.version} className="flex flex-col gap-2">
              <h3 className="flex items-baseline gap-2 border-b border-border pb-1.5 font-semibold text-ink">
                <span>{copy.notesOf(release.version)}</span>
                {release.prerelease ? <StatusBadge tone="warning">{betaCopy.badge}</StatusBadge> : null}
                {release.date === null ? null : <span className="font-mono text-xs font-normal text-muted">{formatDay(release.date)}</span>}
              </h3>
              {release.notes === "" ? <p className="text-muted">{copy.noNotes}</p> : <ReleaseNotes text={release.notes} />}
            </section>
          ))}
          {state.omitted > 0 ? <p className="text-sm text-muted">{copy.omitted(state.omitted)}</p> : null}
        </div>

        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted select-none">{copy.sums}</summary>
          {latest.sums.length === 0 ? (
            <p className="mt-2 text-danger">{copy.noSums}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {latest.sums.map((sum) => (
                <li key={sum.file} className="flex flex-col font-mono text-xs select-text">
                  <span className="text-ink">{sum.file}</span>
                  <span className="break-all text-muted">{sum.sha256}</span>
                </li>
              ))}
            </ul>
          )}
        </details>

        {offering ? (
          <label className="flex cursor-pointer items-start gap-2.5 text-ink">
            <input type="checkbox" checked={noStartupCheck} onChange={(event) => onNoStartupCheckChange(event.target.checked)} className="mt-[3px] size-4 flex-none cursor-pointer accent-accent" />
            <span>{copy.noStartupCheck}</span>
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * O diálogo de versão nova, ligado ao estado do processo principal. É montado uma vez, em `app.tsx`, acima do `ApiGate`:
 * aparece assim que a consulta do início acha algo, com o cofre aberto ou fechado, e também na tela de erro da API. Fecha com
 * "Depois" e volta quando outra consulta achar versão (`checkId`).
 *
 * "Atualizar agora" pede o download da versão que o processo principal achou. Conferido o arquivo, o instalador do Windows
 * segue sozinho (o app para a API, roda o instalador e encerra); nos outros formatos o diálogo espera o clique em "Mostrar
 * na pasta de downloads" (RN-ATUALIZA-005 e 006). A tela só manda a versão; endereço, caminho e nome de arquivo nunca saem daqui.
 */
/** O painel do diálogo de versão nova, se ele está na tela. */
function dialogPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-update-dialog]")?.closest<HTMLElement>("[role=dialog]") ?? null;
}

/**
 * O foco está em OUTRO diálogo (um que abriu por cima deste) ou na pilha de avisos? Eles têm os próprios botões: este diálogo
 * não toma o foco de lá nem o devolve a outro lugar. É a mesma pergunta nos três lugares em que este diálogo mexe no foco: quando
 * alguém o pega por trás, quando o estado muda e quando o diálogo fecha. `panel` é `null` quando este diálogo já saiu da tela.
 */
export function focusIsElsewhere(element: Element | null, panel: Element | null): boolean {
  return element !== null && !(panel?.contains(element) ?? false) && element.closest("[role=dialog], [role=alertdialog], [aria-live]") !== null;
}

/** O foco vai para "Depois", a saída que não muda nada; sem esse botão (ou com ele desligado), para o próprio painel. */
function focusLater(panel: HTMLElement) {
  (panel.querySelector<HTMLButtonElement>("[data-update-later]:not(:disabled)") ?? panel).focus();
}

export function UpdateDialog() {
  const { state, dismissed } = useUpdateSnapshot();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [noStartupCheck, setNoStartupCheck] = useState(false);
  const open = state.status !== "none" && state.checkId !== dismissed;

  // A atualização que não foi instalada (RN-INSTALA-003): o processo principal guarda o aviso, e a primeira janela que pergunta
  // o leva, uma vez. O aviso entra na fila mesmo se o efeito já foi desfeito (o `StrictMode` monta duas vezes, e a segunda
  // pergunta volta vazia): quem o mostra é o `ToastProvider`, que continua montado. Sem a ponte (a tela fora do Electron), não há aviso.
  useEffect(() => {
    let updates;
    try {
      ({ updates } = getBridge());
    } catch {
      return;
    }
    updates.takeNotice().then(
      (notice) => {
        if (notice === null) return;
        const { title, description } = noticeToast(notice);
        toast.warning(title, description);
      },
      () => undefined,
    );
  }, [toast]);

  // A caixa mostra a preferência gravada, lida cada vez que o diálogo abre.
  useEffect(() => {
    if (!open) return;

    let active = true;
    getBridge()
      .updates.getPreferences()
      .then(
        (preferences) => {
          if (active) setNoStartupCheck(!preferences.checkOnStartup);
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, [open]);

  // O diálogo segura o foco. Ele fica acima do `ApiGate` e abre sozinho, então é comum a tela de trás montar DEPOIS dele: o
  // campo de usuário do login tem `autoFocus` e tomava o foco, e a pessoa digitaria a senha por trás do diálogo (e o foco
  // inicial em "Depois" não valeria nada). Quem tenta pegar o foco por trás o perde na hora, e o recebe quando o diálogo
  // fecha. Ficam de fora outro diálogo e a pilha de avisos, que têm os próprios botões.
  useEffect(() => {
    if (!open) return;

    let wanted: HTMLElement | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const panel = dialogPanel();
      const target = event.target;
      if (panel === null || !(target instanceof HTMLElement) || panel.contains(target) || focusIsElsewhere(target, panel)) return;

      wanted = target;
      focusLater(panel);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      // Depois de o diálogo sair da tela (e de ele devolver o foco a quem o tinha ao abrir). Se nessa hora o foco está em
      // outro diálogo, aberto por cima, ele fica lá: quem o perdeu por trás não o recebe por baixo de um diálogo aberto.
      const restore = wanted;
      setTimeout(() => {
        if (restore !== null && restore.isConnected && !focusIsElsewhere(document.activeElement, dialogPanel())) restore.focus();
      }, 0);
    };
  }, [open]);

  // Os botões do rodapé mudam com o estado, e o que tinha o foco pode sair da tela (o "Depois" some durante o download) ou
  // nascer desligado (enquanto um pedido está a caminho): o foco cairia fora do diálogo, ou ficaria no painel, sem botão
  // nenhum. A cada mudança ele volta para "Depois", a não ser que a pessoa já esteja num controle do diálogo, ou em outro
  // diálogo aberto por cima deste (o progresso e o fim do download mudam o estado com a pessoa lá).
  const status = state.status;
  useEffect(() => {
    if (!open) return;

    const panel = dialogPanel();
    const focused = document.activeElement;
    if (panel !== null && !focusIsElsewhere(focused, panel) && (focused === panel || !panel.contains(focused))) focusLater(panel);
  }, [open, status, busy]);

  if (state.status === "none" || !open) return null;

  const { updates } = getBridge();
  const { version } = state.releases[0];

  /** Um pedido recusado pelo processo principal rejeita a promessa: a tela diz que não deu, e o estado fica como estava. */
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(updateCopy.toasts.requestFailed, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const install = async () => adoptUpdateState(await updates.install(version));

  return (
    <UpdateDialogView
      state={state}
      noStartupCheck={noStartupCheck}
      busy={busy}
      onUpdate={() =>
        void run(async () => {
          const next = await updates.download(version);
          adoptUpdateState(next);
          if (installsRightAway(next)) await install();
        })
      }
      onInstall={() => void run(install)}
      onCancel={() => void updates.cancel()}
      onLater={dismissUpdate}
      onSkip={() =>
        void run(async () => {
          await updates.skipVersion(version);
          adoptUpdateState({ status: "none" });
        })
      }
      onNoStartupCheckChange={(checked) => {
        setNoStartupCheck(checked);
        updates.setCheckOnStartup(!checked).catch(() => setNoStartupCheck(!checked));
      }}
    />
  );
}
