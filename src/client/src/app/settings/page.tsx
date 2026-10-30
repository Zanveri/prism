import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { CloseIcon, LockOpenIcon } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";

import { AboutSection } from "./_components/about-section";
import { AccountSection } from "./_components/account-section";
import { AppearanceSection } from "./_components/appearance-section";
import { DriversSection } from "./_components/drivers-section";
import { EditorSection } from "./_components/editor-section";
import { ImportSection } from "./_components/import-section";
import { PluginsSection } from "./_components/plugins-section";
import { ResultsSection } from "./_components/results-section";
import { SecuritySection } from "./_components/security-section";
import { ComingSoonCard } from "./_components/settings-card";
import { UpdatesSection } from "./_components/updates-section";
import { SettingsNav } from "./_components/settings-nav";
import { settingsSections, type SettingsSection } from "./_lib/sections";
import { driverOf, sectionOf, settingsTo, withoutArrival } from "./_lib/settings-route";
import { settingsCopy } from "./_lib/settings.copy";
import { isCloseSettingsKey } from "./_lib/shortcut";

const copy = settingsCopy;

/** O corpo da página de uma seção. A ordem das seções é a de `settingsSections`; aqui só se diz o que cada uma mostra. */
function SectionBody({ section, highlightedDriver }: { section: SettingsSection; highlightedDriver: string | null }) {
  switch (section.id) {
    case "appearance":
      return <AppearanceSection anchor={section.anchor} />;
    case "editor":
      return <EditorSection anchor={section.anchor} />;
    case "updates":
      return <UpdatesSection anchor={section.anchor} />;
    case "drivers":
      return <DriversSection anchor={section.anchor} highlightedId={highlightedDriver} />;
    case "about":
      return <AboutSection anchor={section.anchor} />;
    case "plugins":
      return <PluginsSection anchor={section.anchor} />;
    case "results":
      return <ResultsSection anchor={section.anchor} />;
    case "security":
      return <SecuritySection anchor={section.anchor} />;
    case "account":
      return <AccountSection anchor={section.anchor} />;
    case "import":
      return <ImportSection anchor={section.anchor} />;
    case "transactions":
      return <ComingSoonCard anchor={section.anchor} title={copy.transactions.title} description={copy.transactions.description} />;
  }
}

/**
 * Configurações (RN-CONFIG-001), no desenho de `Configuracoes.dc.html`: cabeçalho com o usuário e "Fechar · Esc", a navegação entre as seções
 * à esquerda e, à direita, a página da seção aberta, na largura e na altura toda da janela, rolando sozinha. Cada seção é uma página
 * (`/settings/<seção>`); `/settings`, ou uma seção que não existe, leva à primeira. As seções que têm efeito hoje funcionam de verdade; as que
 * dependem da API trazem só o "em breve". Abre pela barra superior e por Ctrl+, (`SettingsShortcut`); fechar volta à área de trabalho, que
 * continua montada por baixo (`routes.tsx`): as abas estão como estavam.
 *
 * `?driver=<id>` destaca a linha daquele driver em Drivers (o "Instalar driver" de uma conexão sem driver, RN-NAV-006, chega em
 * `/settings/drivers?driver=<id>`). É lido ao chegar e sai da URL: remontar a tela (o bloqueio por inatividade remonta as telas de dentro do
 * cofre) não destaca de novo. A seção fica no endereço, e o bloqueio volta à mesma página.
 */
export function SettingsPage() {
  const section = sectionOf(useParams().section);
  return section === undefined ? <Navigate to={settingsTo()} replace /> : <SettingsScreen section={section} />;
}

function SettingsScreen({ section }: { section: SettingsSection }) {
  const navigate = useNavigate();
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const [searchParams, setSearchParams] = useSearchParams();
  const title = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string | null>(null);

  // O driver apontado é da visita: lido da URL ao chegar (e de novo se outro chegar com a tela aberta), e guardado aqui depois de a URL ser limpa.
  const requested = driverOf(searchParams);
  const [highlightedDriver, setHighlightedDriver] = useState(requested);
  if (requested !== null && requested !== highlightedDriver) setHighlightedDriver(requested);

  const spendable = withoutArrival(searchParams) !== null;
  useEffect(() => {
    if (spendable) setSearchParams((current) => withoutArrival(current) ?? current, { replace: true });
  }, [spendable, setSearchParams]);

  // Ao abrir (pelo ícone da barra, pelo Ctrl+, ou por um link) o foco vai ao título da tela: sem isto ele cairia no <body>, e quem usa o teclado
  // ou um leitor de tela recomeçaria do topo do documento sem saber onde está. Trocando de seção, vai ao título da página nova, para quem navega
  // pelo teclado continuar dali. A linha destacada de um driver rola até a vista sozinha (`DriverSections`).
  useEffect(() => {
    const previous = shown.current;
    shown.current = section.id;
    if (previous === section.id) return;

    const target = previous === null ? title.current : document.getElementById(`${section.anchor}-title`);
    target?.focus({ preventScroll: true });
  }, [section]);

  // Esc fecha. A lista aberta de um campo trata o Esc antes e o marca como tratado; um diálogo para a propagação do teclado.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCloseSettingsKey(event)) void navigate(pathsConfig.workbench);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-full flex-col">
      {/* RN-JANELA-001: com a área de trabalho escondida, este cabeçalho é a barra da janela. Numa linha só, da altura da barra superior: quem encolhe é o nome do usuário. */}
      <header className="window-bar flex min-h-12 flex-none items-center gap-x-4 border-b border-border bg-panel py-2 pl-6">
        <h1 ref={title} tabIndex={-1} className="text-lg font-semibold">
          {copy.title}
        </h1>
        {session.data?.userName ? (
          <span className="flex min-w-0 items-center gap-2 text-muted">
            <LockOpenIcon />
            <span title={session.data.userName} className="truncate">
              {session.data.userName}
            </span>
          </span>
        ) : null}
        <Link to={pathsConfig.workbench} className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border-strong px-3 text-ink no-underline transition-colors hover:bg-selected">
          <CloseIcon />
          <span>{copy.close}</span>
          <kbd className="font-mono text-[11px] text-muted">{copy.closeKey}</kbd>
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <SettingsNav sections={settingsSections} />

        {/* Uma página por seção: a chave devolve a rolagem ao topo a cada troca. */}
        <main key={section.id} className="min-w-0 flex-1 overflow-y-auto px-8 pt-6 pb-12">
          <SectionBody section={section} highlightedDriver={highlightedDriver} />
        </main>
      </div>
    </div>
  );
}
