import type { LevelView } from "./table-structure";
import type { TabOrientation } from "./table-view";

/**
 * As seções da Estrutura de uma tabela, na ordem da lista lateral (RN-TABELA-009). A lista é feita desta ordem: seção nova (a "Referenciada por" e as
 * restrições de conferência, RN-CAT-004 e 005) entra aqui, com o nome em `workbench.copy.ts` e o conteúdo em `StructureSections`, e a lista a mostra sem
 * redesenho. O tipo exige um nome e um título para cada uma (`Record<StructureSection, …>`, nos dois lugares).
 */
export const structureSections = ["columns", "foreignKeys", "indexes", "ddl"] as const;

export type StructureSection = (typeof structureSections)[number];

/** A seção com que a Estrutura abre, até a pessoa escolher outra: a primeira. */
export const firstSection: StructureSection = structureSections[0];

/**
 * A orientação da lista de seções, a partir da direção que o CSS deu a ela (`flex-direction`): uma fileira (a faixa no topo, com o painel estreito) é
 * horizontal, e o resto (a coluna ao lado da seção) é vertical. É o `aria-orientation` e as setas que valem: a lista diz a orientação de quem a vê.
 */
export function orientationOf(flexDirection: string): TabOrientation {
  return flexDirection.startsWith("row") ? "horizontal" : "vertical";
}

/**
 * Onde o texto de uma célula (nome de coluna, de restrição ou de índice, colunas, referência) pode quebrar a linha por escolha: depois de cada `_` e de cada `.`.
 * A tabela da Estrutura não tem barra horizontal nem corta o texto, então um nome comprido quebra; sem estes pontos a linha cairia no meio de uma palavra
 * (`academic_pe` / `riod_systems`), e com eles cai entre as palavras (`academic_` / `period_systems`). Quem desenha põe um `<wbr>` entre as partes, que não é
 * caractere: o texto selecionado e copiado é o mesmo. As partes juntas são o texto.
 */
export function breakableParts(text: string): string[] {
  return text.split(/(?<=[_.])/);
}

/** O que a entrada da lista mostra à direita do nome: nada, quantos itens a seção tem, ou que a lista dela falhou. */
export type EntryMark = { kind: "none" } | { kind: "count"; count: number } | { kind: "failed" };

/**
 * A marca da entrada de uma seção que é uma lista do catálogo, a partir do estado dela (`levelView`) e de quantas linhas tem. Só a lista que chegou tem
 * contagem, e zero é contagem (`empty`): enquanto carrega, a entrada não mostra número nenhum, e a que falhou mostra o aviso no lugar do número, mesmo
 * que uma lista de antes (de um "Atualizar" que falhou) ainda esteja na mão. A entrada do DDL não tem marca: ele depende das três listas e a própria
 * seção diz por que ainda não há texto.
 */
export function entryMark(view: LevelView, rows: number): EntryMark {
  if (view.kind === "error") return { kind: "failed" };
  if (view.kind === "loading") return { kind: "none" };
  return { kind: "count", count: view.kind === "empty" ? 0 : rows };
}
