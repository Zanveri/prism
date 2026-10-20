import { describe, expect, it } from "vitest";

import { editScriptErrors } from "./edit-script-errors";
import { scriptsCopy } from "./scripts.copy";

const refusal = (code: string, errors: Record<string, string[]> | null = null) => ({ code, title: `Título de ${code}`, errors });

describe("editScriptErrors: a recusa do Editar script… no lugar de cada campo (RN-SCRIPT-006)", () => {
  it("o ícone fora da lista vai à lista dos ícones, com a frase da API, e não à cor", () => {
    expect(editScriptErrors(refusal("SCRIPT_ICON_INVALID", { icon: ["Escolha um dos ícones da lista."] }), "Fechamento")).toEqual({ icon: "Escolha um dos ícones da lista." });
  });

  it("a cor fora do formato vai à \"Cor do ícone\", com a frase da API; os dois juntos, cada um no seu", () => {
    expect(editScriptErrors(refusal("SCRIPT_ICON_INVALID", { color: ["Use uma cor no formato #RRGGBB."] }), "a")).toEqual({ color: "Use uma cor no formato #RRGGBB." });
    expect(editScriptErrors(refusal("SCRIPT_ICON_INVALID", { icon: ["Escolha um dos ícones da lista."], color: ["Use uma cor no formato #RRGGBB.", "outra"] }), "a")).toEqual({
      icon: "Escolha um dos ícones da lista.",
      color: "Use uma cor no formato #RRGGBB.",
    });
  });

  it("sem erro de campo, o título da API vai ao campo do código: a cor no SCRIPT_ICON_INVALID, o nome no resto", () => {
    expect(editScriptErrors(refusal("SCRIPT_ICON_INVALID"), "a")).toEqual({ color: "Título de SCRIPT_ICON_INVALID" });
    expect(editScriptErrors(refusal("SCRIPT_ICON_INVALID", {}), "a")).toEqual({ color: "Título de SCRIPT_ICON_INVALID" });
    expect(editScriptErrors(refusal("OUTRO_ERRO"), "a")).toEqual({ name: "Título de OUTRO_ERRO" });
  });

  it("o nome repetido e o inválido dizem o problema com a frase da tela, no campo do nome", () => {
    expect(editScriptErrors(refusal("SCRIPT_ALREADY_EXISTS"), "Fechamento")).toEqual({ name: scriptsCopy.errors.taken });
    expect(editScriptErrors(refusal("SCRIPT_NAME_INVALID", { name: ["O nome é inválido."] }), "a\tb")).toEqual({ name: scriptsCopy.errors.control });
  });
});
