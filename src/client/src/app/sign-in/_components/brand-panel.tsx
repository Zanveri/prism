import { PrismMark, PrismMarkGroup } from "@/components/layout/prism-mark";
import { StatusBadge } from "@/components/ui";
import { CheckUpdatesButton } from "@/components/update/check-updates-button";
import { cn } from "@/lib/utils/cn";

import { signInCopy } from "../_lib/sign-in.copy";

/** Os três bancos que o Prism abre, com a cor de cada um (`text-*`) nos selos abaixo da promessa. */
const databases = [
  { code: "IFX", name: "Informix", color: "text-informix" },
  { code: "DB2", name: "Db2", color: "text-db2" },
  { code: "PG", name: "PostgreSQL", color: "text-postgres" },
] as const;

/**
 * A ilustração do login: a marca de `assets/` (RN-MARCA-007) sobre a régua do painel, num quadro de 720 × 360 (o `viewBox` do arquivo é o
 * recorte dele que o splash mostra). A régua é do painel, e não da marca: fica por baixo, como sempre esteve. O texto alternativo é o de
 * sempre, e é do quadro.
 */
function PrismIllustration() {
  return (
    <svg viewBox="0 0 720 360" role="img" aria-label={signInCopy.brand.illustration} fill="none" strokeLinecap="round" strokeLinejoin="round" className="h-auto w-full max-w-[720px]">
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
  );
}

/**
 * A metade da marca: o nome com a versão do app (RN-VERSAO-004) e "Verificar atualizações" ao lado dela, a ilustração, a
 * promessa e os três bancos que o Prism abre. Sem versão (a ponte não a trouxe), nada é escrito no lugar dela.
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

      <div className="flex flex-col gap-5">
        <h1 className="max-w-[560px] text-[40px] leading-[46px] font-medium tracking-[-0.01em] text-balance">{signInCopy.brand.title}</h1>
        <ul className="flex flex-wrap gap-3">
          {databases.map((database) => (
            <li key={database.code} className="flex h-8 items-center gap-2 rounded-md border border-border pr-3 pl-2">
              <StatusBadge className={cn("min-w-8 justify-center border-current font-semibold", database.color)}>{database.code}</StatusBadge>
              <span>{database.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
