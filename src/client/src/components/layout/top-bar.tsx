import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useNavigate } from "react-router";

import { driversCopy } from "@/app/drivers/_lib/drivers.copy";
import { driversQuery } from "@/app/drivers/_lib/drivers.service";
import { SettingsIcon } from "@/app/settings/_components/settings-icon";
import { settingsCopy } from "@/app/settings/_lib/settings.copy";
import { sessionQuery, signOut } from "@/app/sign-in/_lib/sign-in.service";
import { transferExits } from "@/app/workbench/_lib/data-import/data-imports";
import { countsOf, exitQuestion, type ExitQuestion } from "@/app/workbench/_lib/data-import/transfer-exits";
import { ConfirmDialog, LockOpenIcon, RefreshIcon, WorkbenchIcon } from "@/components/ui";
import { CheckUpdatesButton } from "@/components/update/check-updates-button";
import { updateCopy } from "@/components/update/update.copy";
import { pathsConfig } from "@/config/paths.config";
import { sharePeerEvent } from "@/lib/api/bridge";
import { unwrap } from "@/lib/api/prism-api";
import { workspaceSync } from "@/lib/api/workspace-sync";
import { cn } from "@/lib/utils/cn";

import { PoweredByZanveri } from "./powered-by-zanveri";
import { PrismMark } from "./prism-mark";

/**
 * Abaixo de 1100 px (a janela vai até 1024) a barra fica mais compacta, para caber numa linha só com o texto das Configurações
 * (RN-CONFIG-002): menos espaço dentro de cada item. O nome do usuário é o único que encolhe (com reticências): cabe até 32 caracteres.
 */
const itemClassName = "flex h-9 flex-none items-center gap-2 rounded-md px-3 no-underline transition-colors max-[1100px]:px-2";

/**
 * A barra superior das telas de dentro do cofre (RN-NAV-001): a marca com a versão e "Verificar atualizações", o caminho de volta à área
 * de trabalho, o lembrete de reinício pendente de driver, as Configurações, o usuário do cofre aberto e "Sair". Conexões e Drivers não
 * moram mais aqui: as pastas e as conexões são do navegador, e os drivers, de Configurações › Drivers. Sair fecha o cofre (RN-COFRE-008) e
 * leva ao login; o que estava em cache era dele.
 *
 * RN-EXPORT-023 e RN-IMPORT-021: com transferências em andamento em qualquer janela (a lista da API: exportações, importações e cópias para outro banco),
 * "Sair" pergunta antes, com "Continuar exportando" (ou importando, copiando, transferindo) no foco e no Esc; confirmado, elas são canceladas (o `DELETE`
 * de cada uma) e os destinos das exportações soltos, e só então o cofre fecha.
 *
 * `leading` vai logo depois da marca: é onde a área de trabalho põe o botão de mostrar e esconder o navegador (RN-NAV-008), como no canvas.
 */
export function TopBar({ leading }: { leading?: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // O guard já buscou a sessão (mesma chave): aqui só se lê o que ele guardou.
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  // Só lê o que Configurações › Drivers ou o formulário de conexão deixaram no cache (`enabled: false` não busca nada): a barra aparece em
  // toda tela, e a lista de drivers é pedida só por quem a mostra. O lembrete fica enquanto um reinício espera (RN-DRIVER-005).
  const drivers = useQuery({ ...driversQuery, enabled: false });
  const restartPending = drivers.data?.some((driver) => driver.restartRequired) ?? false;
  // Lida direto da ponte, sem `getBridge()`, que lança quando ela não existe: a barra desenhada fora do Electron (um teste
  // de outra tela) só fica sem a versão.
  const version = typeof window === "undefined" ? "" : (window.prism?.version ?? "");

  // RN-EXPORT-023 e RN-IMPORT-021: a pergunta das transferências em andamento, com quantas eram de cada tipo ao clicar.
  const [asking, setAsking] = useState<ExitQuestion | null>(null);
  const [checking, setChecking] = useState(false);

  const leave = useMutation({
    // RN-ABAS-006: as abas de todas as janelas são gravadas antes de o cofre fechar (com prazo, e a falha não impede a saída). As exportações, quando a
    // pessoa confirmou sair com elas, são canceladas antes, com as importações e as cópias, e os destinos soltos.
    mutationFn: async (cancelTransfers: boolean) => {
      if (cancelTransfers) await transferExits.cancelForExit();
      await workspaceSync.flush();
      return unwrap(await signOut());
    },
    onSettled: () => setAsking(null),
    onSuccess: () => {
      // RN-ABAS-004: o "Sair" vale para todas as janelas.
      sharePeerEvent("signOut");
      void navigate(pathsConfig.signIn, { replace: true });
      queryClient.clear();
    },
  });

  /** "Sair": sem transferência em andamento, sai; com alguma, pergunta antes (a resposta lenta da API não segura o botão para sempre: o pedido tem prazo). */
  async function requestLeave() {
    setChecking(true);
    const ahead = await transferExits.ahead().finally(() => setChecking(false));
    if (ahead.length === 0) leave.mutate(false);
    else setAsking(exitQuestion(countsOf(ahead), "signOut"));
  }

  return (
    // RN-JANELA-001: a barra superior é a barra da janela (`window-bar`): arrasta, maximiza no duplo clique e deixa à direita o lugar dos botões do sistema.
    <header className="window-bar flex min-h-12 items-center gap-2 border-b border-border bg-panel py-1.5 pl-3 text-sm">
      {/* A marca com 40 px de altura (RN-MARCA-007, Ruling 137: abaixo disso o traço fino quase some). A caixa dela cresce junto, e a barra,
          que só tem altura mínima, cresce o que precisar; os outros itens continuam com 36 px. */}
      <div className="flex h-10 flex-none items-center gap-2 pr-2 pl-1 text-[15px] font-semibold tracking-[0.01em]">
        <PrismMark height={40} />
        <span>Prism</span>
        {/* A versão e, junto dela, a consulta manual de atualizações (RN-ATUALIZA-002), como na tela de login. */}
        {version !== "" && (
          <span data-app-version className="ml-1 font-mono text-xs font-normal tracking-normal text-muted">
            {updateCopy.version(version)}
          </span>
        )}
        <CheckUpdatesButton />
      </div>

      {leading}

      <nav aria-label="Principal" className="ml-auto flex flex-none items-center gap-2 max-[1100px]:gap-0.5">
        <NavLink to={pathsConfig.workbench} className={({ isActive }) => cn(itemClassName, isActive ? "bg-selected text-ink" : "text-muted hover:bg-selected hover:text-ink")}>
          <WorkbenchIcon />
          <span>Área de trabalho</span>
        </NavLink>
        {/* O lembrete do reinício que ficou para depois (RN-DRIVER-005 e RN-NAV-006): leva a Configurações › Drivers, onde está o "Reiniciar agora". */}
        {restartPending ? (
          <Link to={pathsConfig.drivers} title={driversCopy.restart.topBarHint} className={cn(itemClassName, "text-accent hover:bg-selected")}>
            <RefreshIcon />
            <span>{driversCopy.restart.topBarBadge}</span>
          </Link>
        ) : null}
        {/* Ícone e texto, como os outros itens (RN-CONFIG-002); a dica diz que Ctrl+, também abre (`SettingsShortcut`). */}
        <NavLink to={pathsConfig.settings} title={settingsCopy.titleWithShortcut} className={({ isActive }) => cn(itemClassName, isActive ? "bg-selected text-ink" : "text-muted hover:bg-selected hover:text-ink")}>
          <SettingsIcon />
          <span>{settingsCopy.title}</span>
        </NavLink>
      </nav>

      {session.data?.userName ? (
        <span className="flex h-9 min-w-0 items-center gap-2 px-3 text-muted max-[1100px]:px-2">
          <LockOpenIcon />
          <span title={session.data.userName} className="truncate">
            {session.data.userName}
          </span>
        </span>
      ) : null}

      <button type="button" onClick={() => void requestLeave()} disabled={leave.isPending || checking} className={cn(itemClassName, "cursor-pointer text-muted enabled:hover:bg-selected enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50")}>
        Sair
      </button>

      <PoweredByZanveri />

      <ConfirmDialog
        open={asking !== null}
        tone="danger"
        title={asking?.title ?? ""}
        description={asking?.description}
        confirmLabel={asking?.confirm ?? ""}
        cancelLabel={asking?.keep}
        pendingLabel={asking?.pending}
        pending={leave.isPending}
        onConfirm={() => leave.mutate(true)}
        onCancel={() => setAsking(null)}
      />
    </header>
  );
}
