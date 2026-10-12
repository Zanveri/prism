import { useSyncExternalStore } from "react";

import inkMonogram from "@assets/zanveri/zanveri-monogram-ink.svg";
import paperMonogram from "@assets/zanveri/zanveri-monogram-paper.svg";
import { currentScheme, subscribeSystemScheme, type Scheme } from "@/app/settings/_lib/theme";

/**
 * O monograma da Zanveri de cada esquema de cor (RN-MARCA-008): os arquivos de `assets/zanveri/`, como a empresa os entregou. O claro
 * (`paper`) sobre os temas escuros e o escuro (`ink`) sobre os claros; a faixa vermelha é a mesma nos dois.
 */
export const monogramOf = { dark: paperMonogram, light: inkMonogram } as const satisfies Record<Scheme, string>;

type SchemeSources = {
  root: Node | null;
  Observer: (new (callback: () => void) => Pick<MutationObserver, "observe" | "disconnect">) | undefined;
  onSystemScheme: (listener: () => void) => () => void;
};

const browserSources = (): SchemeSources => ({
  root: typeof document === "undefined" ? null : document.documentElement,
  Observer: typeof MutationObserver === "undefined" ? undefined : MutationObserver,
  onSystemScheme: subscribeSystemScheme,
});

/**
 * Avisa quando o esquema de cor do <html> pode ter mudado: o tema trocado em Configurações (o atributo `data-theme`) ou, com "seguir o
 * sistema", o claro e escuro do sistema. Para `useSyncExternalStore`; as fontes são injetáveis para o teste, que não tem DOM.
 */
export function subscribeRootScheme(listener: () => void, sources: SchemeSources = browserSources()): () => void {
  const observer = sources.root !== null && sources.Observer !== undefined ? new sources.Observer(listener) : null;
  if (observer !== null && sources.root !== null) observer.observe(sources.root, { attributes: true, attributeFilter: ["data-theme"] });
  const stopSystem = sources.onSystemScheme(listener);

  return () => {
    observer?.disconnect();
    stopSystem();
  };
}

/**
 * O selo como a barra o mostra: "powered by", o monograma e o nome em texto, na tipografia do app (o wordmark inteiro não se lê nesta
 * altura). Discreto: o tom apagado do texto, o monograma da altura de uma letra maiúscula e meia, e some abaixo de 1280 px, antes de a
 * barra apertar o resto (a janela vai até 1024). É lido "powered by Zanveri" uma vez: o monograma tem texto alternativo vazio, porque o
 * nome já está escrito ao lado.
 *
 * O `object-view-box` só recorta a margem transparente do arquivo (o desenho do "Z" vai de x 240 a 3828 e de y 776 a 3328, num quadro de
 * 4096 × 4096): sem ele o "Z" ficaria com 60% da altura da imagem.
 */
export function PoweredByZanveriView({ scheme }: { scheme: Scheme }) {
  return (
    <span className="hidden flex-none items-center gap-1.5 px-2 text-xs text-subtle min-[1280px]:flex">
      <span>powered by</span>
      <img src={monogramOf[scheme]} alt="" draggable={false} className="block h-4 w-auto [object-view-box:inset(776px_268px_768px_240px)]" />
      <span className="font-semibold tracking-[0.01em] text-muted">Zanveri</span>
    </span>
  );
}

/** O selo "powered by Zanveri" da barra superior (RN-MARCA-008), com o monograma do esquema de cor do tema em uso. */
export function PoweredByZanveri() {
  const scheme = useSyncExternalStore(subscribeRootScheme, () => currentScheme(), (): Scheme => "dark");

  return <PoweredByZanveriView scheme={scheme} />;
}
