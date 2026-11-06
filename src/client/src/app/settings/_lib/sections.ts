import { settingsCopy } from "./settings.copy";

export type SettingsSectionId = "appearance" | "editor" | "updates" | "drivers" | "about" | "plugins" | "results" | "account" | "import" | "transactions" | "security" | "audit";

export type SettingsSection = {
  id: SettingsSectionId;
  /** O `id` do elemento da seção, como o canvas o escreve. O endereço da página é o `id` (`/settings/<id>`), e não uma âncora (`#...`): a rota é em hash. */
  anchor: string;
  label: string;
  /** Depende de uma parte da API que ainda não existe: o cartão aparece, diz o que virá e não tem controle. */
  soon: boolean;
};

/**
 * As seções, cada uma uma página, na ordem da navegação: Conta, Importar (RN-CONFIG-011), Aparência, Editor SQL, Resultados, Transações e Segurança,
 * seguidas por Atualizações, Drivers, Sobre e Plugins.
 */
export const settingsSections: readonly SettingsSection[] = [
  { id: "account", anchor: "cfg-conta", label: settingsCopy.sections.account, soon: false },
  { id: "import", anchor: "cfg-importar", label: settingsCopy.sections.import, soon: false },
  { id: "appearance", anchor: "cfg-aparencia", label: settingsCopy.sections.appearance, soon: false },
  { id: "editor", anchor: "cfg-editor", label: settingsCopy.sections.editor, soon: false },
  { id: "results", anchor: "cfg-resultados", label: settingsCopy.sections.results, soon: false },
  { id: "transactions", anchor: "cfg-transacoes", label: settingsCopy.sections.transactions, soon: false },
  { id: "security", anchor: "cfg-seguranca", label: settingsCopy.sections.security, soon: false },
  { id: "audit", anchor: "cfg-auditoria", label: settingsCopy.sections.audit, soon: false },
  { id: "updates", anchor: "cfg-atualizacoes", label: settingsCopy.sections.updates, soon: false },
  { id: "drivers", anchor: "cfg-drivers", label: settingsCopy.sections.drivers, soon: false },
  { id: "about", anchor: "cfg-sobre", label: settingsCopy.sections.about, soon: false },
  { id: "plugins", anchor: "cfg-plugins", label: settingsCopy.sections.plugins, soon: false },
];
