import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";

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
import { activeSection, settingsSections, type SettingsSection } from "./_lib/sections";
import { arrivalOf, withoutArrival } from "./_lib/settings-route";
import { settingsCopy } from "./_lib/settings.copy";
import { isCloseSettingsKey } from "./_lib/shortcut";

const copy = settingsCopy;

/** Enquanto a rolagem de um clique na navegação anda, a seção marcada é a clicada, e não as que ela atravessa. */
const clickLockMs = 900;

/** O corpo de uma seção. A ordem das seções é a de `settingsSections`; aqui só se diz o que cada uma mostra. */
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
 * Configurações (RN-CONFIG-001), no desenho de `Configuracoes.dc.html`: cabeçalho com o usuário e "Fechar · Esc", a navegação
 * entre as seções à esquerda e os cartões à direita. As seções que têm efeito hoje funcionam de verdade; as que dependem da
 * API trazem só o cartão "em breve". Abre pela barra superior e por Ctrl+, (`SettingsShortcut`); fechar volta à área de
 * trabalho, que continua montada por baixo (`routes.tsx`): as abas estão como estavam.
 *
 * `?section=<seção>` chega já na seção (o endereço dos drivers, `/drivers`, chega como `?section=drivers`), e `?driver=<id>` destaca a linha
 * daquele driver em Drivers (o "Instalar driver" de uma conexão sem driver, RN-NAV-006). Os dois são lidos ao chegar e saem da URL juntos:
 * remontar a tela (o bloqueio por inatividade remonta as telas de dentro do cofre) não rola nem destaca de novo.
 */
export function SettingsPage() {
  const navigate = useNavigate();
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const [searchParams, setSearchParams] = useSearchParams();

  const scroller = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const lockedUntil = useRef(0);
  // A chegada é da visita: lida da URL ao montar (e de novo se outra chegar com a tela aberta), e guardada aqui depois de a URL ser limpa.
  const requested = arrivalOf(searchParams);
  const [arrival, setArrival] = useState(requested);
  const [activeId, setActiveId] = useState<string | null>(arrival.section ?? settingsSections[0].id);
  if ((requested.section !== null && requested.section !== arrival.section) || (requested.driver !== null && requested.driver !== arrival.driver)) {
    setArrival(requested);
    setActiveId(requested.section);
  }

  const spendable = withoutArrival(searchParams) !== null;
  useEffect(() => {
    if (spendable) setSearchParams((current) => withoutArrival(current) ?? current, { replace: true });
  }, [spendable, setSearchParams]);

  // Ao abrir (pelo ícone da barra, pelo Ctrl+, ou por um link) o foco vai ao título da tela: sem isto ele cairia no <body>, e quem usa o
  // teclado ou um leitor de tela recomeçaria do topo do documento sem saber onde está. Chegando numa seção, vai ao título DELA, com a
  // rolagem até lá; a linha destacada de um driver, se já está na tela, fica no meio da área (ela mesma rola quando chega, se a lista ainda
  // estava a caminho).
  useEffect(() => {
    const section = settingsSections.find((candidate) => candidate.id === arrival.section);
    const target = section === undefined ? null : document.getElementById(section.anchor);

    if (section === undefined || target === null) {
      title.current?.focus({ preventScroll: true });
      return;
    }

    lockedUntil.current = Date.now() + clickLockMs;
    const row = target.querySelector<HTMLElement>('li[aria-current="true"]');
    (row ?? target).scrollIntoView({ block: row === null ? "start" : "center" });
    target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [arrival.section]);

  // Esc fecha. A lista aberta de um campo trata o Esc antes e o marca como tratado; um diálogo para a propagação do teclado.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCloseSettingsKey(event)) void navigate(pathsConfig.workbench);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  // A seção marcada na navegação acompanha a rolagem.
  useEffect(() => {
    const container = scroller.current;
    if (container === null) return;

    let frame = 0;

    function update() {
      frame = 0;
      if (container === null || Date.now() < lockedUntil.current) return;

      const origin = container.getBoundingClientRect().top - container.scrollTop;
      const tops = settingsSections.map((section) => ({ id: section.id, top: (document.getElementById(section.anchor)?.getBoundingClientRect().top ?? origin) - origin }));
      setActiveId(activeSection(tops, { scrollTop: container.scrollTop, height: container.clientHeight, contentHeight: container.scrollHeight }));
    }

    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(update);
    }

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  function select(section: SettingsSection) {
    const target = document.getElementById(section.anchor);
    if (target === null) return;

    lockedUntil.current = Date.now() + clickLockMs;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    // Quem navega pelo teclado continua da seção: o foco vai ao título dela.
    target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel py-2 pr-4 pl-6">
        <h1 ref={title} tabIndex={-1} className="text-lg font-semibold">
          {copy.title}
        </h1>
        {session.data?.userName ? (
          <span className="flex items-center gap-2 text-muted">
            <LockOpenIcon />
            <span>{session.data.userName}</span>
          </span>
        ) : null}
        <Link to={pathsConfig.workbench} className="ml-auto flex h-9 items-center gap-2 rounded-md border border-border-strong px-3 text-ink no-underline transition-colors hover:bg-selected">
          <CloseIcon />
          <span>{copy.close}</span>
          <kbd className="font-mono text-[11px] text-muted">{copy.closeKey}</kbd>
        </Link>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-wrap items-start overflow-auto">
        <SettingsNav sections={settingsSections} activeId={activeId} onSelect={select} />

        <main className="min-w-0 flex-[999_1_560px] pt-5 pr-8 pb-12 pl-3">
          <div className="flex max-w-[920px] flex-col gap-5">
            {settingsSections.map((section) => (
              <SectionBody key={section.id} section={section} highlightedDriver={arrival.driver} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
