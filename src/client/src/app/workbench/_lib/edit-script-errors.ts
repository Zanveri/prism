import type { ApiError } from "@/lib/api/prism-api";
import { apiFieldErrors } from "@/lib/utils/form";

import { refusalProblem } from "./saved-scripts";
import { scriptsCopy } from "./scripts.copy";

/** As recusas do "Editar script…" no lugar de cada uma: o campo do nome, a lista dos ícones e a "Cor do ícone". */
export type EditScriptErrors = { name?: string; icon?: string; color?: string };

/**
 * RN-SCRIPT-006: a recusa da API ao "Editar script…", campo a campo. O nome repetido e o inválido dizem o problema com a frase da tela (`refusalProblem`); o
 * `SCRIPT_ICON_INVALID` traz a frase de cada campo em `errors` ("Escolha um dos ícones da lista.", "Use uma cor no formato #RRGGBB."), e cada uma vai ao
 * lugar dela: a do ícone à lista dos ícones, a da cor à "Cor do ícone". Só a recusa sem erro de campo leva o `title` da API, ao campo do código dela (a cor,
 * no `SCRIPT_ICON_INVALID`; o nome, no resto).
 */
export function editScriptErrors(error: Pick<ApiError, "code" | "title" | "errors">, name: string): EditScriptErrors {
  const fields = apiFieldErrors(error.errors);
  const refused = refusalProblem(error.code, name);
  const errors: EditScriptErrors = {
    ...(refused === null ? {} : { name: scriptsCopy.errors[refused] }),
    ...(fields.icon === undefined ? {} : { icon: fields.icon }),
    ...(fields.color === undefined ? {} : { color: fields.color }),
  };
  if (Object.keys(errors).length > 0) return errors;
  return error.code === "SCRIPT_ICON_INVALID" ? { color: error.title } : { name: error.title };
}
