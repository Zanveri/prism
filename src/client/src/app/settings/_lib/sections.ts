import { settingsCopy } from "./settings.copy";

export type SettingsSectionId = "appearance" | "editor" | "updates" | "drivers" | "about" | "plugins" | "results" | "account" | "import" | "transactions" | "security";

export type SettingsSection = {
  id: SettingsSectionId;
  /** O `id` do elemento da seção, como o canvas o escreve. Não é um endereço (`#...`): a rota é em hash, e uma âncora a trocaria. */
  anchor: string;
  label: string;
  /** Depende de uma parte da API que ainda não existe: o cartão aparece, diz o que virá e não tem controle. */
  soon: boolean;
};

/**
 * As seções, na ordem da navegação e da página: primeiro as que funcionam, depois as "em breve". O canvas as põe na ordem
 * Conta, Aparência, Editor SQL, Resultados, Transações e Segurança, com Importar depois de Conta (RN-CONFIG-011); aqui é a mesma, com o que ainda não tem efeito (as Transações)
 * no fim, para o que se vê primeiro ser uma seção que funciona. Atualizações, Drivers, Sobre e Plugins vêm depois das do canvas.
 */
export const settingsSections: readonly SettingsSection[] = [
  { id: "account", anchor: "cfg-conta", label: settingsCopy.sections.account, soon: false },
  { id: "import", anchor: "cfg-importar", label: settingsCopy.sections.import, soon: false },
  { id: "appearance", anchor: "cfg-aparencia", label: settingsCopy.sections.appearance, soon: false },
  { id: "editor", anchor: "cfg-editor", label: settingsCopy.sections.editor, soon: false },
  { id: "results", anchor: "cfg-resultados", label: settingsCopy.sections.results, soon: false },
  { id: "security", anchor: "cfg-seguranca", label: settingsCopy.sections.security, soon: false },
  { id: "updates", anchor: "cfg-atualizacoes", label: settingsCopy.sections.updates, soon: false },
  { id: "drivers", anchor: "cfg-drivers", label: settingsCopy.sections.drivers, soon: false },
  { id: "about", anchor: "cfg-sobre", label: settingsCopy.sections.about, soon: false },
  { id: "plugins", anchor: "cfg-plugins", label: settingsCopy.sections.plugins, soon: false },
  { id: "transactions", anchor: "cfg-transacoes", label: settingsCopy.sections.transactions, soon: true },
];

type SectionTop = { id: string; top: number };
type ScrollView = { scrollTop: number; height: number; contentHeight: number };

/**
 * A seção que a rolagem está mostrando: a última cujo topo já passou da margem de cima. No fim da rolagem é a última, porque
 * as seções curtas do fim nunca chegam ao topo. Sem rolagem nenhuma (tudo cabe) vale a primeira.
 */
export function activeSection(tops: readonly SectionTop[], view: ScrollView, lead = 24): string | null {
  if (tops.length === 0) return null;
  if (view.scrollTop > 0 && view.scrollTop + view.height >= view.contentHeight - 1) return tops[tops.length - 1].id;

  let current = tops[0].id;
  for (const section of tops) if (section.top <= view.scrollTop + lead) current = section.id;
  return current;
}
