import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Os ícones da tela, no traço do canvas (16×16, traço de 1,5, pontas redondas). Não há biblioteca
 * de ícones: cada um é só o desenho, e a cor vem do texto em volta (`currentColor`).
 */
function Icon({ className, ...props }: ComponentProps<"svg">) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("flex-none", className)} {...props} />;
}

export function ChevronIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

/** RN-GRADE-021: a seta para cima, da ordem crescente no botão de ordenar do cabeçalho. */
export function ArrowUpIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Icon>
  );
}

/** RN-GRADE-021: a seta para baixo, da ordem decrescente. */
export function ArrowDownIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </Icon>
  );
}

/** RN-GRADE-021: as duas setas, para cima e para baixo, da coluna sem ordem. */
export function ArrowsUpDownIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M5.5 13V3M3 5.5L5.5 3 8 5.5M10.5 3v10M8 10.5l2.5 2.5 2.5-2.5" />
    </Icon>
  );
}

export function FolderIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
    </Icon>
  );
}

export function FolderPlusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
      <path d="M8 7.5v3M6.5 9h3" />
    </Icon>
  );
}

export function FolderMoveIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
      <path d="M5.5 9.25h5M8.75 7.5l1.75 1.75-1.75 1.75" />
    </Icon>
  );
}

export function PencilIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M10.5 2.75l2.75 2.75-8 8H2.5v-2.75z" />
      <path d="M9 4.25l2.75 2.75" />
    </Icon>
  );
}

export function TrashIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11M6.25 4.5V3h3.5v1.5M4 4.5l.6 8.5h6.8l.6-8.5M6.75 7v4M9.25 7v4" />
    </Icon>
  );
}

export function PlusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

/** O menos, par do `PlusIcon` (diminuir o zoom do programa, RN-ZOOM-001). */
export function MinusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M3 8h10" />
    </Icon>
  );
}

export function EyeIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

/** O conta-gotas de "Outra cor" no seletor do ambiente (RN-CONN-017): o bulbo em cima, à direita, o colar e o tubo até a ponta. */
export function EyedropperIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M9 4.5l2.25-2.25a1.77 1.77 0 0 1 2.5 2.5L11.5 7" />
      <path d="M8 3.5l4.5 4.5" />
      <path d="M9.5 5L4 10.5l-1 2.5 2.5-1L11 6.5" />
    </Icon>
  );
}

export function EyeOffIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 13.5l11-11" />
    </Icon>
  );
}

export function LockIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Icon>
  );
}

/** O cadeado aberto ao lado do usuário na barra superior: o cofre dele está aberto. */
export function LockOpenIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
    </Icon>
  );
}

export function PlugIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M6 2v3M10 2v3M4 5h8v2.5a4 4 0 0 1-8 0zM8 11.5V14" />
    </Icon>
  );
}

export function CheckIcon(props: ComponentProps<"svg">) {
  return (
    <Icon strokeWidth="2" {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function DatabaseIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </Icon>
  );
}

/** O diagrama de uma tabela: duas tabelas ligadas por uma chave estrangeira. */
export function DiagramIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="2" y="2.5" width="5" height="4" rx="1" />
      <rect x="9" y="9.5" width="5" height="4" rx="1" />
      <path d="M4.5 6.5v3a2 2 0 0 0 2 2H9" />
    </Icon>
  );
}

/** A busca: a lupa. */
export function SearchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </Icon>
  );
}

export function TableIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 6.5h12M6 6.5V13" />
    </Icon>
  );
}

export function ColumnsIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M3 3h10v10H3zM8 3v10" />
    </Icon>
  );
}

export function IndexIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M3 4h10M3 8h7M3 12h4" />
    </Icon>
  );
}

export function ForeignKeyIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="8" r="2.5" />
      <path d="M7.5 8H14M11.5 8v2.5" />
    </Icon>
  );
}

/** A rotina (procedimento ou função): as chaves de "f(x)". */
export function RoutineIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M6 3C4.5 3 4.5 4.2 4.5 5.5S4.2 8 3 8c1.2 0 1.5.2 1.5 2.5S4.5 13 6 13M10 3c1.5 0 1.5 1.2 1.5 2.5S11.8 8 13 8c-1.2 0-1.5.2-1.5 2.5S11.5 13 10 13" />
    </Icon>
  );
}

/** A sequência: o sustenido (#) de numeração sequencial. */
export function SequenceIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M3.5 6h9M3.5 10h9M6.5 3l-1 10M10.5 3l-1 10" />
    </Icon>
  );
}

export function RefreshIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />
    </Icon>
  );
}

/** O relógio: a atualização automática do resultado (RN-GRADE-014). */
export function TimerIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8.5" r="5.25" />
      <path d="M8 5.75V8.5l1.75 1.25M6.5 1.75h3" />
    </Icon>
  );
}

export function DownloadIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 2.5v7M5 6.8l3 3 3-3M3 12.5h10" />
    </Icon>
  );
}

/** A seta para cima do "Importar conexões…" (seção 9 da especificação): a de baixar, invertida, no mesmo traço. */
export function UploadIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 9.5v-7M5 5.2l3-3 3 3M3 12.5h10" />
    </Icon>
  );
}

export function PowerIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 2v5.5M4.6 4.4a5 5 0 1 0 6.8 0" />
    </Icon>
  );
}

/** Uma consulta: a folha de papel da aba. */
export function DocumentIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M4 2h5.5L12 4.5V14H4z" />
      <path d="M9.5 2v2.5H12" />
    </Icon>
  );
}

/** Duas folhas, uma sobre a outra: "Duplicar conexão" (RN-CONN-016). */
export function DuplicateIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M5.5 5.5h7.5V14H5.5z" />
      <path d="M3 10.5V2h7.5" />
    </Icon>
  );
}

export function CloseIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

/** Executar: o triângulo cheio do canvas. */
export function PlayIcon(props: ComponentProps<"svg">) {
  return (
    <Icon stroke="none" {...props}>
      <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
    </Icon>
  );
}

/** Executar script (RN-SQL-019): os comandos em fila e o triângulo de executar. */
export function PlayScriptIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2.5 4h5M2.5 8h4M2.5 12h5" />
      <path d="M9.5 4.5v7l5-3.5z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Cancelar o comando em execução. */
export function StopIcon(props: ComponentProps<"svg">) {
  return (
    <Icon stroke="none" {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </Icon>
  );
}

/** A área de trabalho: o navegador à esquerda e as abas à direita. */
export function WorkbenchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </Icon>
  );
}

/** Os drivers: o pacote que se baixa. */
export function PackageIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 1.75l5.25 2.5v7.5L8 14.25l-5.25-2.5v-7.5z" />
      <path d="M2.75 4.25L8 6.75l5.25-2.5M8 6.75v7.5" />
    </Icon>
  );
}

/** "Sem cor" nas bolinhas de cor da pasta e do script (RN-PASTA-007 e RN-SCRIPT-006): o traço na diagonal. */
export function NoColorIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M4 12l8-8" />
    </Icon>
  );
}

/*
 * Os ícones que um script pode ter (RN-SCRIPT-006), além do documento, do banco e da tabela, que já existiam: a lista fechada é `scriptIcons`, em
 * `saved-scripts.ts`. Mesmo traço dos outros: 16×16, linha de 1,5, pontas redondas, sem preenchimento.
 */

/** Código: os sinais de menor e de maior, e a barra entre eles. */
export function CodeIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M5 4.5L1.75 8 5 11.5M11 4.5L14.25 8 11 11.5M9.25 3l-2.5 10" />
    </Icon>
  );
}

/** Gráfico: três barras sobre a base. */
export function ChartIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M2.5 13.5h11M4.75 13.5V9M8 13.5V3.5M11.25 13.5V6.5" />
    </Icon>
  );
}

/** Relógio: o mostrador e os dois ponteiros. */
export function ClockIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </Icon>
  );
}

/** Raio. */
export function LightningIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M9 1.75L3.75 9h4l-.75 5.25L12.25 7h-4z" />
    </Icon>
  );
}

/** Inseto: o corpo, as antenas e as seis patas. */
export function BugIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="4.75" y="5.25" width="6.5" height="8.75" rx="3.25" />
      <path d="M6.5 5.25l-.75-2M9.5 5.25l.75-2M4.75 8.5H2.5M11.25 8.5h2.25M4.9 11.5l-2.15 1.25M11.1 11.5l2.15 1.25" />
    </Icon>
  );
}

/** Chave inglesa: a cabeça aberta e o cabo na diagonal. */
export function WrenchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M13.5 4.75a3.25 3.25 0 0 1-4.4 3.05L3.9 13a1.4 1.4 0 0 1-2-2l5.2-5.2a3.25 3.25 0 0 1 4.1-4.2L9.25 3.5l.5 2.25 2.25.5z" />
    </Icon>
  );
}

/** Estrela de cinco pontas. */
export function StarIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 2.2l1.53 4.1 4.37.18-3.43 2.72 1.17 4.22L8 11l-3.64 2.42 1.17-4.22-3.43-2.72 4.37-.18z" />
    </Icon>
  );
}

/** Bandeira: o mastro e o pano recortado. */
/** RN-VERIF-003: a conexão que não respondeu à verificação (o triângulo de atenção, com a exclamação). */
export function AlertIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.75v2.75M8 11.25v.01" />
    </Icon>
  );
}

export function FlagIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M3.5 14V2.5M3.5 3h8.75l-2 3 2 3H3.5" />
    </Icon>
  );
}

/** RN-CONSTRUIR-001: bigorna e martelo do modo Construir. */
export function BuildIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M7.5 2.5l3.5 3.5 1.25-1.25-3.5-3.5z" />
      <path d="M9.25 4.25L4.75 8.75" />
      <path d="M2 10h10.5v1.25c-1.3 0-2.25.6-2.25 1.5H11V14H5.5v-1.25h.75c0-.9-.95-1.5-2.25-1.5-1 0-1.7-.45-2-1.25z" />
    </Icon>
  );
}

/** Círculo com o `i` de dica ou aviso informativo. */
export function InfoIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3M8 5.25v.01" />
    </Icon>
  );
}
