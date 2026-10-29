import { lightPaths, markColors, PrismMark, PrismMarkGroup } from "@/components/layout/prism-mark";
import { CheckUpdatesButton } from "@/components/update/check-updates-button";

import { signInCopy } from "../_lib/sign-in.copy";

/** As cores das faixas no palco escuro, de cima para baixo: a cor que cada partícula ganha ao entrar no prisma. */
const bandColors = [markColors.bandTop.dark, markColors.bandMiddle.dark, markColors.bandBottom.dark];

/** Dentro do vidro a luz anda mais devagar: cada unidade lá dentro leva este tanto a mais de tempo que fora dele. */
const slowerInGlass = 2.4;

/** Quanto dura a volta de uma partícula, do começo do raio até o cilindro, e quando a primeira sai: depois da abertura. */
const travel = 4.2;
const firstAfter = 2.3;

const distance = ([ax, ay]: [number, number], [bx, by]: [number, number]) => Math.hypot(bx - ax, by - ay);

/**
 * As partículas de luz: pontos que vêm pelo raio, ganham a cor da faixa ao entrar no prisma, andam mais devagar dentro do vidro e saem pela
 * faixa até o cilindro. Duas por faixa, desencontradas. Seguem o caminho do próprio desenho (`lightPaths`), e ficam num `<svg>` à parte,
 * por cima da ilustração e com o mesmo quadro: não são a marca, e o leitor de tela não as vê. Quem pede menos movimento não as vê.
 */
function LightParticles() {
  return (
    <svg viewBox="0 0 720 360" aria-hidden="true" data-light-particles className="pointer-events-none absolute inset-0 h-full w-full will-change-transform motion-reduce:hidden">
      {lightPaths.flatMap((points, band) => {
        const [ray, glass, beam] = [distance(points[0], points[1]), distance(points[1], points[2]), distance(points[2], points[3])];
        const length = ray + glass + beam;
        const time = ray + glass * slowerInGlass + beam;
        const keyPoints = `0;${ray / length};${(ray + glass) / length};1`;
        const keyTimes = `0;${ray / time};${(ray + glass * slowerInGlass) / time};1`;
        const colorAt = ray / time;
        const path = `M${points.map(([x, y]) => `${x},${y}`).join(" L")}`;

        return [0, travel / 2].map((offset) => {
          const begin = `${firstAfter + band * 0.7 + offset}s`;
          return (
            <g key={`${band}-${offset}`} opacity="0">
              <animateMotion path={path} dur={`${travel}s`} begin={begin} repeatCount="indefinite" calcMode="linear" keyPoints={keyPoints} keyTimes={keyTimes} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.88;1" dur={`${travel}s`} begin={begin} repeatCount="indefinite" />
              <animate attributeName="fill" values={`#F3F5F8;#F3F5F8;${bandColors[band]};${bandColors[band]}`} keyTimes={`0;${colorAt};${colorAt + 0.04};1`} dur={`${travel}s`} begin={begin} repeatCount="indefinite" />
              <circle r="7" fillOpacity="0.22" />
              <circle r="2.2" />
            </g>
          );
        });
      })}
    </svg>
  );
}

/**
 * A ilustração do login: a marca de `assets/` (RN-MARCA-007) sobre a régua do painel, num quadro de 720 × 360 (o `viewBox` do arquivo é o
 * recorte dele que o splash mostra). A régua é do painel, e não da marca: fica por baixo, como sempre esteve. O texto alternativo é o de
 * sempre, e é do quadro.
 *
 * Ela se anima ao abrir e depois fica viva (`prism-scene`, em `globals.css`), com as partículas de luz por cima.
 */
function PrismIllustration() {
  return (
    <div className="relative w-full max-w-[720px]">
      <svg viewBox="0 0 720 360" role="img" aria-label={signInCopy.brand.illustration} fill="none" strokeLinecap="round" strokeLinejoin="round" className="prism-scene block h-auto w-full">
        {/* A régua. */}
        <path d="M24 300.5 H696" className="stroke-border-strong" strokeWidth="1" strokeLinecap="butt" />
        <path
          d="M36 301v9M60 301v5M84 301v5M108 301v5M132 301v5M156 301v9M180 301v5M204 301v5M228 301v5M252 301v5M276 301v9M300 301v5M324 301v5M348 301v5M372 301v5M396 301v9M420 301v5M444 301v5M468 301v5M492 301v5M516 301v9M540 301v5M564 301v5M588 301v5M612 301v5M636 301v9M660 301v5M684 301v5"
          className="stroke-border-strong"
          strokeWidth="1"
          strokeLinecap="butt"
        />

        {/* A marca, por cima. */}
        <PrismMarkGroup />
      </svg>
      <LightParticles />
    </div>
  );
}

/**
 * A metade da marca: o nome com a versão do app (RN-VERSAO-004) e "Verificar atualizações" ao lado dela, a ilustração e a
 * promessa. Sem versão (a ponte não a trouxe), nada é escrito no lugar dela.
 *
 * O painel fica sobre o palco escuro (`stage-dark`) nos dois temas (RN-MARCA-006): o raio branco e o prisma de vidro da ilustração
 * foram desenhados para um fundo escuro, e no tema claro sumiriam. A metade do formulário, ao lado, segue o tema.
 */
export function BrandPanel({ version }: { version: string }) {
  return (
    <section className="stage-dark flex min-w-0 flex-[999_1_520px] flex-col justify-between gap-10 px-12 py-10">
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-[0.01em]">
        <PrismMark height={28} />
        <span>Prism</span>
        {version !== "" && (
          <span data-app-version className="ml-1 font-mono text-xs font-normal tracking-normal text-muted">
            versão {version}
          </span>
        )}
        {/* RN-ATUALIZA-002: a consulta manual fica junto da versão, e não depende do cofre. */}
        <CheckUpdatesButton />
      </div>

      <PrismIllustration />

      <h1 className="max-w-[560px] text-[40px] leading-[46px] font-medium tracking-[-0.01em] text-balance">{signInCopy.brand.title}</h1>
    </section>
  );
}
