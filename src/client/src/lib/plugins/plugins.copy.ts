import { pickCopy, type Localized } from "@/lib/i18n";

import { pluginsCopyEn } from "./plugins.copy.en";
import { pluginsCopyEs } from "./plugins.copy.es";

const pt = {
  /** O cabeçalho da coluna extra que o plugin de descrições internas acrescenta à grade da tabela. */
  descriptionColumn: "Descrição",
  queryFailed: "Falha ao executar consulta do plugin.",
} as const;

export type PluginsCopy = Localized<typeof pt>;
export const pluginsCopy = pickCopy({ "pt-BR": pt, en: pluginsCopyEn, es: pluginsCopyEs });
