import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { updatePreferencesQuery, type UpdatePreferences } from "../_lib/update-preferences";
import { UpdatesSection } from "./updates-section";

// O botão de verificar usa o `useToast`, que desenha num portal em `document.body`: o renderizador de servidor não o tem.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

const anchor = "cfg-atualizacoes";
function render(updates?: UpdatePreferences) {
  const client = new QueryClient();
  if (updates !== undefined) client.setQueryData(updatePreferencesQuery.queryKey, updates);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(UpdatesSection, { anchor })));
}

const saved: UpdatePreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false };
/** As caixas da seção, na ordem: o rótulo (o texto do `label` que a envolve) e os atributos do `input`. */
const checkboxes = (markup: string) => [...markup.matchAll(/<label[^>]*><input type="checkbox"([^>]*)\/?><span>([^<]*)<\/span><\/label>/g)].map((match) => ({ label: match[2], attributes: match[1] }));

describe("Configurações › Atualizações: 'Receber versões beta' (RN-ATUALIZA-010)", () => {
  it("é uma caixa logo depois de 'Verificar ao abrir', desligada por padrão", () => {
    const boxes = checkboxes(render(saved));

    expect(boxes.map((box) => box.label)).toEqual(["Verificar atualizações ao abrir o Prism", "Receber versões beta"]);
    expect(boxes[1].attributes).not.toContain("checked");
  });

  it("ligada quando o processo principal guardou ligada; ausente na resposta vale desligada", () => {
    expect(checkboxes(render({ ...saved, receiveBeta: true }))[1].attributes).toContain("checked");
    expect(checkboxes(render({ checkOnStartup: true, skippedVersion: null, lastCheckedAt: null }))[1].attributes).not.toContain("checked");
  });

  it("diz o que é um beta, que pode ter defeitos, e que ligar ou desligar vale a partir da próxima verificação, sem instalar nada", () => {
    const markup = render(saved);

    expect(markup).toContain("pode ter defeitos");
    expect(markup).toContain("só as versões estáveis");
    expect(markup).toContain("vale a partir da próxima verificação e não instala nada");
  });

  it("cada caixa aponta para a frase que a explica (o leitor de tela lê as duas juntas)", () => {
    const markup = render(saved);
    const described = checkboxes(markup).map((box) => /aria-describedby="([^"]+)"/.exec(box.attributes)?.[1]);

    expect(described).toEqual([`${anchor}-startup-hint`, `${anchor}-beta-hint`]);
    for (const id of described) expect(markup).toMatch(new RegExp(`<p id="${id}"[^>]*>[^<]+</p>`));
  });

  it("enquanto a ponte não respondeu, nenhuma caixa aparece", () => {
    expect(checkboxes(render())).toEqual([]);
  });
});
