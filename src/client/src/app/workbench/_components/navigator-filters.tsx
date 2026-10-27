import type { RefObject } from "react";

import type { UserEnvironment } from "@/app/connections/_lib/user-environments";

import type { EnvironmentChoice } from "../_lib/navigator-environment";
import { NavigatorConnectedFilter } from "./navigator-connected-filter";
import { NavigatorEnvironmentFilter } from "./navigator-environment-filter";
import { NavigatorSearchField } from "./navigator-search-field";

type NavigatorFiltersProps = {
  /** O campo "Filtrar objetos" (RN-BUSCA-001): o texto, quem o muda, a seta para baixo e o Enter (a lista) e o `ref` do `input` (Ctrl+F e Ctrl+Shift+E). */
  query: string;
  onQueryChange: (value: string) => void;
  onFocusList: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** O seletor de ambiente (RN-NAV-010): os ambientes do usuário, a escolha e quem a muda. */
  environments: readonly UserEnvironment[];
  environmentChoice: EnvironmentChoice;
  onEnvironmentChange: (choice: EnvironmentChoice) => void;
  /** "Só as conectadas" (RN-NAV-013): quantas estão conectadas, se está ligado e o clique que o alterna. */
  connectedCount: number;
  onlyConnected: boolean;
  onToggleConnected: () => void;
};

/**
 * A barra de filtros do navegador, abaixo da barra de ações (RN-NAV-002), e o único lugar que diz a disposição dela (RN-NAV-010, RN-NAV-013 e RN-BUSCA-001):
 *
 * - **Linha 1**: o campo "Filtrar objetos" sozinho, na largura toda, como no canvas, mesmo no navegador largo, em que os três caberiam numa linha. O campo é
 *   `w-full h-8 flex-none` (`NavigatorSearchField`): sem base flexível, que na coluna das duas linhas o faria crescer na altura.
 * - **Linha 2**, `flex-wrap`: "N conectadas" à esquerda, `flex-none` e `whitespace-nowrap`, que nunca é cortado; e o seletor de ambiente à direita, com o resto
 *   da largura (`flex-[1_1_8rem] min-w-28` no lugar dele, com o "Limpar o filtro de ambiente" dentro: escolher ou limpar não muda a largura de nada). Quando o seletor
 *   não cabe ao lado do botão, com 128 px pelo menos, ele desce para uma linha só dele, na largura toda. Na fonte do app, a 320 px (o padrão) os dois cabem lado a
 *   lado também com "Nenhuma conectada" (a base de 8 rem deixa ≈18 px de folga; a de 9 rem deixava 1,6 e quebraria com qualquer fonte da interface mais larga), e a 200
 *   px (o mínimo) o seletor desce. Fechado, o nome que não cabe no seletor termina em reticências.
 *
 * Os 6 px entre as linhas e entre os controles deixam o anel de foco (2 px, com 2 de afastamento) inteiro, e os 8 px até a árvore são os do canvas. A ordem do
 * DOM é a da tela, e por isso a do Tab: o campo, o "Limpar a busca", "Só as conectadas", o seletor e o "Limpar o filtro de ambiente". Sem estado: o texto da busca
 * e as duas escolhas são do navegador, e o que cada controle faz não muda. A linha de estado da busca (RN-BUSCA-002) fica logo abaixo desta barra, nunca ao lado
 * do campo.
 */
export function NavigatorFilters({ query, onQueryChange, onFocusList, inputRef, environments, environmentChoice, onEnvironmentChange, connectedCount, onlyConnected, onToggleConnected }: NavigatorFiltersProps) {
  return (
    <div className="mx-2 mb-2 flex flex-none flex-col gap-1.5">
      <NavigatorSearchField value={query} onChange={onQueryChange} onFocusList={onFocusList} inputRef={inputRef} />
      <div className="flex flex-wrap items-center gap-1.5">
        <NavigatorConnectedFilter count={connectedCount} on={onlyConnected} onToggle={onToggleConnected} />
        <NavigatorEnvironmentFilter environments={environments} value={environmentChoice} onChange={onEnvironmentChange} />
      </div>
    </div>
  );
}
