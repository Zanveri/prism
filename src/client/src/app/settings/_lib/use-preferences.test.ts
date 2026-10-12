import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { preferencesStore } from "./preferences";
import { usePreferences } from "./use-preferences";

function Probe() {
  const { preferences, signedIn } = usePreferences();
  return createElement("output", null, `${signedIn ? "dentro" : "fora"}:${preferences.theme}:${preferences.editor.fontSize}`);
}

function render(userName: string | null) {
  const client = new QueryClient();
  client.setQueryData(sessionQuery.queryKey, { unlocked: userName !== null, userName });

  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
}

describe("usePreferences", () => {
  it("lê as preferências do usuário do cofre aberto", () => {
    preferencesStore.set("hook.ana", { theme: "light", editor: { fontSize: 18 } });

    expect(render("hook.ana")).toBe("<output>dentro:light:18</output>");
  });

  it("outro usuário recebe o padrão, não as de quem usou antes", () => {
    preferencesStore.set("hook.ana", { theme: "light" });

    expect(render("hook.bia")).toBe("<output>dentro:dark:13</output>");
  });

  it("com o cofre fechado (sem usuário) vale o padrão", () => {
    expect(render(null)).toBe("<output>fora:dark:13</output>");
  });
});
