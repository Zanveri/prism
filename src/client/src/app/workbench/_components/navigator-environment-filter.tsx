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

type NavigatorEnvironmentFilterProps = {
  /** Os ambientes do usuário (RN-AMB-001), das pastas e das conexões que o navegador já tem. */
  environments: readonly UserEnvironment[];
  value: EnvironmentChoice;
  onChange: (choice: EnvironmentChoice) => void;
};

/**
 * O seletor de ambiente do navegador (RN-NAV-010), ao lado do campo de busca: o `Select` do app (teclado e leitor de tela como os outros), com
 * "Todos os ambientes", cada ambiente do usuário como a etiqueta colorida dele (na lista e no controle fechado, com o nome inteiro na dica) e "Sem
 * ambiente". O controle fechado fica numa linha só, cortado com reticências quando não cabe (o controle divide a linha com o campo de busca, na
 * largura do navegador); na lista, o texto quebra. Com um filtro escolhido, o "Limpar" (o `x`, como o do campo de busca) volta a "Todos". Sem estado: a escolha é
 * do navegador.
 */
export function NavigatorEnvironmentFilter({ environments, value, onChange }: NavigatorEnvironmentFilterProps) {
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
    <div className="flex min-w-28 flex-[1_1_9rem] items-center gap-1">
      <div className="min-w-0 flex-1">
        <Select value={valueOf(value)} onChange={(chosen) => onChange(choiceOf(chosen))} options={options} aria-label={copy.label} className="h-8 min-h-8 gap-1.5 px-2 py-0 text-xs [&>span:first-child]:truncate" />
      </div>
      {value.type === "all" ? null : (
        <button
          type="button"
          aria-label={copy.clear}
          title={copy.clear}
          onClick={() => onChange(allEnvironments)}
          className="flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-selected hover:text-ink"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
