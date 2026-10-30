import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Os ícones da tela, no traço do canvas (16×16, traço de 1,5, pontas redondas). Não há biblioteca
 * de ícones: cada um é só o desenho, e a cor vem do texto em volta (`currentColor`).
 */
function Icon({ className, ...props }: ComponentProps<"svg">) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("flex-none", className)} {...props} />;
}

export type ChevronDirection = "down" | "up" | "left" | "right";

export type ChevronIconProps = Omit<ComponentProps<"svg">, "direction"> & {
  direction?: ChevronDirection;
};

export function ChevronIcon({
  direction = "down",
  ...props
}: ChevronIconProps) {
  const path =
    direction === "up"
      ? "M4 10l4-4 4 4"
      : direction === "left"
        ? "M10 4L6 8l4 4"
        : direction === "right"
          ? "M6 4l4 4-4 4"
          : "M4 6l4 4 4-4";

  const iconFamily =
    direction === "up"
      ? "chevron-up"
      : direction === "left"
        ? "chevron-left"
        : direction === "right"
          ? "chevron-right"
          : "chevron";

  return (
    <Icon data-icon={iconFamily} {...props}>
      <path d={path} />
    </Icon>
  );
}

/** Seta para a esquerda (ex.: "Voltar ao diagrama"). */
export function ArrowLeftIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="arrow-left" {...props}>
      <path d="M13 8H3M7 4L3 8l4 4" />
    </Icon>
  );
}

/** Seta para a direita. */
export function ArrowRightIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="arrow-right" {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

/** RN-GRADE-021: a seta para cima, da ordem crescente no botão de ordenar do cabeçalho. */
export function ArrowUpIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="arrow-up" {...props}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Icon>
  );
}

/** RN-GRADE-021: a seta para baixo, da ordem decrescente. */
export function ArrowDownIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="arrow-down" {...props}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </Icon>
  );
}

/** RN-GRADE-021: as duas setas, para cima e para baixo, da coluna sem ordem. */
export function ArrowsUpDownIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="arrows-up-down" {...props}>
      <path className="icon-part-up" d="M5.5 13V3M3 5.5L5.5 3 8 5.5" />
      <path className="icon-part-down" d="M10.5 3v10M8 10.5l2.5 2.5 2.5-2.5" />
    </Icon>
  );
}

export function FolderIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="folder" {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
    </Icon>
  );
}

export function FolderPlusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="folder-plus" {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
      <path className="icon-part-pop" d="M8 7.5v3M6.5 9h3" />
    </Icon>
  );
}

export function FolderMoveIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="folder-move" {...props}>
      <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
      <path className="icon-part-right" d="M5.5 9.25h5M8.75 7.5l1.75 1.75-1.75 1.75" />
    </Icon>
  );
}

export function PencilIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="pencil" {...props}>
      <path d="M10.5 2.75l2.75 2.75-8 8H2.5v-2.75z" />
      <path d="M9 4.25l2.75 2.75" />
    </Icon>
  );
}

export function TrashIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="trash" {...props}>
      <path className="icon-part-lid" d="M2.5 4.5h11M6.25 4.5V3h3.5v1.5" />
      <path d="M4 4.5l.6 8.5h6.8l.6-8.5M6.75 7v4M9.25 7v4" />
    </Icon>
  );
}

export function PlusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="plus" {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

/** O menos, par do `PlusIcon` (diminuir o zoom do programa, RN-ZOOM-001). */
export function MinusIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="minus" {...props}>
      <path d="M3 8h10" />
    </Icon>
  );
}

export function EyeIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="eye" {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle className="icon-part-pop" cx="8" cy="8" r="2" />
    </Icon>
  );
}

/** O conta-gotas de "Outra cor" no seletor do ambiente (RN-CONN-017): o bulbo em cima, à direita, o colar e o tubo até a ponta. */
export function EyedropperIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="eyedropper" {...props}>
      <path d="M9 4.5l2.25-2.25a1.77 1.77 0 0 1 2.5 2.5L11.5 7" />
      <path d="M8 3.5l4.5 4.5" />
      <path d="M9.5 5L4 10.5l-1 2.5 2.5-1L11 6.5" />
    </Icon>
  );
}

export function EyeOffIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="eye-off" {...props}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 13.5l11-11" />
    </Icon>
  );
}

export function LockIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="lock" {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path className="icon-part-shackle" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Icon>
  );
}

/** O cadeado aberto ao lado do usuário na barra superior: o cofre dele está aberto. */
export function LockOpenIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="lock" {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path className="icon-part-shackle" d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
    </Icon>
  );
}

export function PlugIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="plug" {...props}>
      <path d="M6 2v3M10 2v3M4 5h8v2.5a4 4 0 0 1-8 0zM8 11.5V14" />
    </Icon>
  );
}

export function CheckIcon(props: ComponentProps<"svg">) {
  return (
    <Icon strokeWidth="2" data-icon="check" {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function DatabaseIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="database" {...props}>
      <ellipse className="icon-part-up" cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </Icon>
  );
}

/** O diagrama de uma tabela: duas tabelas ligadas por uma chave estrangeira. */
export function DiagramIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="diagram" {...props}>
      <rect x="2" y="2.5" width="5" height="4" rx="1" />
      <rect x="9" y="9.5" width="5" height="4" rx="1" />
      <path d="M4.5 6.5v3a2 2 0 0 0 2 2H9" />
    </Icon>
  );
}

/** A busca: a lupa. */
export function SearchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="search" {...props}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </Icon>
  );
}

export function TableIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="table" {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 6.5h12M6 6.5V13" />
    </Icon>
  );
}

export function ColumnsIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="table" {...props}>
      <path d="M3 3h10v10H3zM8 3v10" />
    </Icon>
  );
}

export function IndexIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="lines" {...props}>
      <path d="M3 4h10M3 8h7M3 12h4" />
    </Icon>
  );
}

export function ForeignKeyIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="key" {...props}>
      <circle cx="5" cy="8" r="2.5" />
      <path d="M7.5 8H14M11.5 8v2.5" />
    </Icon>
  );
}

/** A rotina (procedimento ou função): as chaves de "f(x)". */
export function RoutineIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="code" {...props}>
      <path d="M6 3C4.5 3 4.5 4.2 4.5 5.5S4.2 8 3 8c1.2 0 1.5.2 1.5 2.5S4.5 13 6 13M10 3c1.5 0 1.5 1.2 1.5 2.5S11.8 8 13 8c-1.2 0-1.5.2-1.5 2.5S11.5 13 10 13" />
    </Icon>
  );
}

/** A sequência: o sustenido (#) de numeração sequencial. */
export function SequenceIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="sequence" {...props}>
      <path d="M3.5 6h9M3.5 10h9M6.5 3l-1 10M10.5 3l-1 10" />
    </Icon>
  );
}

export function RefreshIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="refresh" {...props}>
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />
    </Icon>
  );
}

/** O relógio: a atualização automática do resultado (RN-GRADE-014). */
export function TimerIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="timer" {...props}>
      <circle cx="8" cy="8.5" r="5.25" />
      <path className="icon-part-hand" d="M8 5.75V8.5l1.75 1.25" />
      <path className="icon-part-down" d="M6.5 1.75h3" />
    </Icon>
  );
}

export function DownloadIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="download" {...props}>
      <path className="icon-part-down" d="M8 2.5v7M5 6.8l3 3 3-3" />
      <path d="M3 12.5h10" />
    </Icon>
  );
}

/** A seta para cima do "Importar conexões…" (seção 9 da especificação): a de baixar, invertida, no mesmo traço. */
export function UploadIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="upload" {...props}>
      <path className="icon-part-up" d="M8 9.5v-7M5 5.2l3-3 3 3" />
      <path d="M3 12.5h10" />
    </Icon>
  );
}

export function PowerIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="power" {...props}>
      <path className="icon-part-down" d="M8 2v5.5" />
      <path d="M4.6 4.4a5 5 0 1 0 6.8 0" />
    </Icon>
  );
}

/** Uma consulta: a folha de papel da aba. */
export function DocumentIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="document" {...props}>
      <path d="M4 2h5.5L12 4.5V14H4z" />
      <path d="M9.5 2v2.5H12" />
    </Icon>
  );
}

/** Duas folhas, uma sobre a outra: "Duplicar conexão" (RN-CONN-016). */
export function DuplicateIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="duplicate" {...props}>
      <path className="icon-part-ne" d="M5.5 5.5h7.5V14H5.5z" />
      <path d="M3 10.5V2h7.5" />
    </Icon>
  );
}

export function CloseIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="close" {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

/** Executar: o triângulo cheio do canvas. */
export function PlayIcon(props: ComponentProps<"svg">) {
  return (
    <Icon stroke="none" data-icon="play" {...props}>
      <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
    </Icon>
  );
}

/** Executar script (RN-SQL-019): os comandos em fila e o triângulo de executar. */
export function PlayScriptIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="play-script" {...props}>
      <path d="M2.5 4h5M2.5 8h4M2.5 12h5" />
      <path className="icon-part-right" d="M9.5 4.5v7l5-3.5z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Cancelar o comando em execução. */
export function StopIcon(props: ComponentProps<"svg">) {
  return (
    <Icon stroke="none" data-icon="stop" {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </Icon>
  );
}

/** A área de trabalho: o navegador à esquerda e as abas à direita. */
export function WorkbenchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="panel" {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </Icon>
  );
}

/** Os drivers: o pacote que se baixa. */
export function PackageIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="package" {...props}>
      <path d="M8 1.75l5.25 2.5v7.5L8 14.25l-5.25-2.5v-7.5z" />
      <path d="M2.75 4.25L8 6.75l5.25-2.5M8 6.75v7.5" />
    </Icon>
  );
}

/** "Sem cor" nas bolinhas de cor da pasta e do script (RN-PASTA-007 e RN-SCRIPT-006): o traço na diagonal. */
export function NoColorIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="no-color" {...props}>
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
    <Icon data-icon="code" {...props}>
      <path d="M5 4.5L1.75 8 5 11.5M11 4.5L14.25 8 11 11.5M9.25 3l-2.5 10" />
    </Icon>
  );
}

/** Gráfico: três barras sobre a base. */
export function ChartIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="chart" {...props}>
      <path d="M2.5 13.5h11" />
      <path className="icon-part-bar" d="M4.75 13.5V9M8 13.5V3.5M11.25 13.5V6.5" />
    </Icon>
  );
}

/** Relógio: o mostrador e os dois ponteiros. */
export function ClockIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="clock" {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path className="icon-part-hand" d="M8 4.75V8l2.25 1.5" />
    </Icon>
  );
}

/** Raio. */
export function LightningIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="lightning" {...props}>
      <path d="M9 1.75L3.75 9h4l-.75 5.25L12.25 7h-4z" />
    </Icon>
  );
}

/** Inseto: o corpo, as antenas e as seis patas. */
export function BugIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="bug" {...props}>
      <rect x="4.75" y="5.25" width="6.5" height="8.75" rx="3.25" />
      <path d="M6.5 5.25l-.75-2M9.5 5.25l.75-2M4.75 8.5H2.5M11.25 8.5h2.25M4.9 11.5l-2.15 1.25M11.1 11.5l2.15 1.25" />
    </Icon>
  );
}

/** Chave inglesa: a cabeça aberta e o cabo na diagonal. */
export function WrenchIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="wrench" {...props}>
      <path d="M13.5 4.75a3.25 3.25 0 0 1-4.4 3.05L3.9 13a1.4 1.4 0 0 1-2-2l5.2-5.2a3.25 3.25 0 0 1 4.1-4.2L9.25 3.5l.5 2.25 2.25.5z" />
    </Icon>
  );
}

/** Estrela de cinco pontas. */
export function StarIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="star" {...props}>
      <path d="M8 2.2l1.53 4.1 4.37.18-3.43 2.72 1.17 4.22L8 11l-3.64 2.42 1.17-4.22-3.43-2.72 4.37-.18z" />
    </Icon>
  );
}

/** Bandeira: o mastro e o pano recortado. */
/** RN-VERIF-003: a conexão que não respondeu à verificação (o triângulo de atenção, com a exclamação). */
export function AlertIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="alert" {...props}>
      <path d="M8 2.5l6 10.5H2z" />
      <path d="M8 6.75v2.75M8 11.25v.01" />
    </Icon>
  );
}

export function FlagIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="flag" {...props}>
      <path d="M3.5 14V2.5M3.5 3h8.75l-2 3 2 3H3.5" />
    </Icon>
  );
}

/** RN-CONSTRUIR-001: bigorna e martelo do modo Construir. */
export function BuildIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="build" {...props}>
      <path className="icon-part-hammer" d="M7.5 2.5l3.5 3.5 1.25-1.25-3.5-3.5z" />
      <path className="icon-part-hammer" d="M9.25 4.25L4.75 8.75" />
      <path d="M2 10h10.5v1.25c-1.3 0-2.25.6-2.25 1.5H11V14H5.5v-1.25h.75c0-.9-.95-1.5-2.25-1.5-1 0-1.7-.45-2-1.25z" />
    </Icon>
  );
}

/*
 * Os ícones das seções de Configurações que nenhum outro ícone da tela cobria (os outros reaproveitam os que já existem: `settings-nav.tsx`).
 * Mesmo traço: 16×16, linha de 1,5, pontas redondas, sem preenchimento.
 */

/** Conta: a cabeça e os ombros de uma pessoa. */
export function UserIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="user" {...props}>
      <circle className="icon-part-up" cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 13.5a5.25 5.25 0 0 1 10.5 0" />
    </Icon>
  );
}

/** Aparência: a paleta de pintor, com o furo do polegar e quatro tintas. */
export function PaletteIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="palette" {...props}>
      <path d="M8 2a6 6 0 0 0 0 12c.9 0 1.4-.55 1.4-1.3 0-.75-.55-1.05-.55-1.8 0-.75.6-1.2 1.35-1.2H12a2 2 0 0 0 2-2C14 4.45 11.3 2 8 2z" />
      <path d="M5 8.25h.01M5.75 5.25h.01M8.75 4.5h.01M11 6.25h.01" />
    </Icon>
  );
}

/** Sobre: o "i" de informação, num círculo. */
export function InfoIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="info" {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path className="icon-part-pop" d="M8 7.5v3.25M8 5.25h.01" />
    </Icon>
  );
}

/** Plugins: a peça de quebra-cabeça, com um pino em cima e outro à direita (o plugue, `PlugIcon`, é o das conexões). */
export function PuzzleIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="puzzle" {...props}>
      <path d="M2.25 5h3a1.75 1.75 0 1 1 2.5 0h3v3a1.75 1.75 0 1 1 0 2.5v3h-8.5z" />
    </Icon>
  );
}

/** Transações: as duas setas opostas, da ida e da volta. */
export function TransactionIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="transaction" {...props}>
      <path className="icon-part-right" d="M2.75 5.5h10.5M10.5 2.75l2.75 2.75-2.75 2.75" />
      <path className="icon-part-left" d="M13.25 10.5H2.75M5.5 7.75L2.75 10.5l2.75 2.75" />
    </Icon>
  );
}

/** Desfazer: seta curva para a esquerda. */
export function UndoIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="undo" {...props}>
      <path d="M5 6H10.5a3 3 0 0 1 0 6H7M5 6l2.5-2.5M5 6l2.5 2.5" />
    </Icon>
  );
}

/** Refazer: seta curva para a direita. */
export function RedoIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="redo" {...props}>
      <path d="M11 6H5.5a3 3 0 0 0 0 6H9M11 6L8.5 3.5M11 6L8.5 8.5" />
    </Icon>
  );
}

/** Mais ações: três pontos alinhados na horizontal. */
export function MoreIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="dots" {...props}>
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Alça de arrasto: seis pontos em duas colunas. */
export function GripIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      width="12"
      height="16"
      viewBox="0 0 12 16"
      fill="currentColor"
      aria-hidden="true"
      data-icon="dots"
      {...props}
    >
      <circle cx="4" cy="5" r="1" />
      <circle cx="8" cy="5" r="1" />
      <circle cx="4" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="4" cy="11" r="1" />
      <circle cx="8" cy="11" r="1" />
    </svg>
  );
}

/** Mover pelo diagrama: cruz com setas nas quatro pontas. */
export function MoveIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="move" {...props}>
      <path d="M8 2v12M2 8h12M8 2L6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" />
    </Icon>
  );
}

/** Cursor de seleção no diagrama. */
export function CursorIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="cursor" {...props}>
      <path d="M3.5 2.5l4.2 10.5 1.6-4.2 4.2-1.6z" />
    </Icon>
  );
}

/** Ajustar à tela: quatro cantos de enquadramento. */
export function FitIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="expand" {...props}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </Icon>
  );
}

/** Mini-mapa: quadro com recorte no canto inferior direito. */
export function MinimapIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="panel" {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <rect x="8.5" y="7.5" width="4" height="3.5" rx="0.5" fill="currentColor" />
    </Icon>
  );
}

/** Chave primária (PK) nas linhas de coluna do diagrama. */
export function KeyIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="key" {...props}>
      <circle cx="5" cy="8" r="2.6" />
      <path d="M7.6 8H14M11.5 8v2.2M13.5 8v1.6" />
    </Icon>
  );
}

/** Referência de chave estrangeira (FK) nas linhas de coluna do diagrama. */
export function LinkIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="link" {...props}>
      <path className="icon-part-right" d="M2.5 8h8M8 5l3.2 3L8 11" />
      <circle cx="13" cy="8" r="1.5" />
    </Icon>
  );
}

/** Ligar colunas no modo Construir: curva entre dois nós. */
export function ConnectColumnsIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="diagram" {...props}>
      <circle cx="3.5" cy="4.5" r="2" />
      <circle cx="12.5" cy="11.5" r="2" />
      <path d="M5.5 4.5c3.5 0 1.5 7 5 7" />
    </Icon>
  );
}

/** Organizar automaticamente os cartões do diagrama. */
export function AutoLayoutIcon(props: ComponentProps<"svg">) {
  return (
    <Icon data-icon="diagram" {...props}>
      <rect x="2" y="2" width="4.5" height="3.5" rx="0.8" />
      <rect x="9.5" y="2" width="4.5" height="3.5" rx="0.8" />
      <rect x="5.8" y="10.5" width="4.5" height="3.5" rx="0.8" />
      <path d="M4.2 5.5v2.5h7.6V5.5M8 8v2.5" />
    </Icon>
  );
}
