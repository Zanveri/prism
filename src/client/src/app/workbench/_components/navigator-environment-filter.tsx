import type { RefObject } from "react";

import type { UserEnvironment } from "@/app/connections/_lib/user-environments";
import { CloseIcon, EnvironmentPill, Select, type SelectOption } from "@/components/ui";

import { allEnvironments, noEnvironment, type EnvironmentChoice } from "../_lib/navigator-environment";
import { navigatorCopy } from "../_lib/navigator.copy";

const copy = navigatorCopy.environmentFilter;

/** O valor de cada escolha no `Select`: o vazio é "Todos" (o padrão, no tom apagado do controle), e o ambiente leva a chave depois de um prefixo. */
const noneValue = "none";
const environmentPrefix = "env:";

function valueOf(choice: EnvironmentChoice): string {
  return choice.type === "all" ? "" : choice.type === "none" ? noneValue : `${environmentPrefix}${choice.key}`;
}

function choiceOf(value: string): EnvironmentChoice {
  if (value === noneValue) return noEnvironment;
  return value.startsWith(environmentPrefix) ? { type: "environment", key: value.slice(environmentPrefix.length) } : allEnvironments;
}

/**
 * O "Limpar o filtro de ambiente" (o clique e o Enter no `x`): o foco vai ao seletor ANTES de a escolha voltar a "Todos", que tira o `x` da tela; depois disso o
 * Chromium põe o foco no corpo da página. O seletor continua na tela, então o foco fica nele.
 */
export function clearChoice(selectRef: RefObject<HTMLButtonElement | null>, onChange: (choice: EnvironmentChoice) => void) {
  selectRef.current?.focus();
  onChange(allEnvironments);
}

type NavigatorEnvironmentFilterProps = {
  /** Os ambientes do usuário (RN-AMB-001), das pastas e das conexões que o navegador já tem. */
  environments: readonly UserEnvironment[];
  value: EnvironmentChoice;
  onChange: (choice: EnvironmentChoice) => void;
  /** O botão do seletor (o `ref` do `Select`): o "Limpar o filtro de ambiente" leva o foco a ele antes de sair da tela. */
  selectRef: RefObject<HTMLButtonElement | null>;
};

/**
 * O seletor de ambiente do navegador (RN-NAV-010), na linha abaixo do campo de busca, ao lado de "Só as conectadas" (`NavigatorFilters`): o `Select` do app
 * (teclado e leitor de tela como os outros), com "Todos os ambientes", cada ambiente do usuário como a etiqueta colorida dele (na lista e no controle fechado,
 * com o nome inteiro na dica) e "Sem ambiente". Ocupa o resto da linha (`flex-[1_1_8rem] min-w-28`, o "Limpar" dentro do lugar dele: escolher ou limpar não
 * muda a largura de nada) e desce para uma linha só dele quando não cabe ao lado do botão; o controle fechado fica numa linha só, cortado com reticências
 * quando o nome não cabe. A lista aberta (`wideList`) não quebra o texto: tem no mínimo a largura do seletor, cresce até o maior texto ("Todos os ambientes" num
 * seletor de 130 px) e não passa da janela. Com um filtro escolhido, o "Limpar" (o `x`, como o do campo de busca) volta a "Todos" e leva o foco ao seletor: o
 * `x` sai da tela, e o foco que estava nele cairia no corpo da página. Sem estado: a escolha e o `ref` do seletor são do navegador.
 */
export function NavigatorEnvironmentFilter({ environments, value, onChange, selectRef }: NavigatorEnvironmentFilterProps) {
  const options: SelectOption[] = [
    { value: "", label: copy.all },
    ...environments.map((environment) => ({
      value: `${environmentPrefix}${environment.key}`,
      label: environment.name,
      content: <EnvironmentPill name={environment.name} color={environment.color} title={environment.name} className="max-w-full overflow-hidden text-ellipsis" />,
    })),
    { value: noneValue, label: copy.none },
  ];

  return (
    <div className="flex min-w-28 flex-[1_1_8rem] items-center gap-1">
      <div className="min-w-0 flex-1">
        <Select value={valueOf(value)} onChange={(chosen) => onChange(choiceOf(chosen))} options={options} aria-label={copy.label} wideList triggerRef={selectRef} className="h-8 min-h-8 gap-1.5 px-2 py-0 text-xs [&>span:first-child]:truncate" />
      </div>
      {value.type === "all" ? null : (
        <button
          type="button"
          aria-label={copy.clear}
          title={copy.clear}
          onClick={() => clearChoice(selectRef, onChange)}
          className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
