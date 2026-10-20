import { afterEach, describe, expect, it, vi } from "vitest";

// A seção Scripts com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). O que se confere aqui é a ligação do título
// da seção com a escolha lembrada (RN-NAV-012): a lista e o que ela faz têm teste próprio (`scripts-section.test.ts`), e a loja, o dela
// (`navigator-layout.test.ts`). A sessão e a lista de scripts vêm prontas, e o resto do que a seção usa é de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), userName: "scripts.ana" };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: (options: { queryKey: readonly unknown[] }) => (options.queryKey[0] === "session" ? { data: { unlocked: true, userName: rt.userName } } : { data: [], isError: false }),
}));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { ui: { navigatorDensity: "comfortable" } } }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ openScriptTab() {}, renameScript() {}, forgetScript() {} }) }));

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { elementsOf } from "@/lib/testing/react-tree";

import { navigatorLayoutStore } from "../_lib/navigator-layout";
import { ScriptsSection } from "./scripts-section";

afterEach(() => rt.unmount());

/** O título que recolhe e abre, a área da lista e a seção, como a renderização de agora os entrega. */
function drawn() {
  const found = elementsOf(rt.render(() => ScriptsSection()));
  const header = found.find((element) => element.type === "button" && "aria-expanded" in element.props);
  const list = found.find((element) => element.type === "div" && "hidden" in element.props);
  const section = found.find((element) => element.type === "section");
  if (header === undefined || list === undefined || section === undefined) throw new Error("A seção não tem o título, a lista ou a própria seção.");
  return { header, list, section };
}

describe("a seção Scripts lembra se ficou recolhida (RN-NAV-012)", () => {
  it("a chave da sessão é a do guard: é dela que sai o usuário", () => {
    expect(sessionQuery.queryKey[0]).toBe("session");
  });

  it("aberta por padrão; o título a recolhe, e a escolha vai para a loja do navegador, na chave do usuário", () => {
    const opened = drawn();
    expect(opened.header.props["aria-expanded"]).toBe(true);
    expect(opened.list.props.hidden).toBe(false);
    expect(String(opened.section.props.className)).toContain("max-h-[40%]");

    (opened.header.props.onClick as () => void)();
    expect(navigatorLayoutStore.get(rt.userName).scriptsCollapsed).toBe(true);

    const closed = drawn();
    expect(closed.header.props["aria-expanded"]).toBe(false);
    expect(closed.list.props.hidden).toBe(true);
    expect(String(closed.section.props.className)).not.toContain("max-h-[40%]");
  });

  it("volta recolhida na próxima vez que a seção monta (outra entrada, outra janela), e o título a abre de novo", () => {
    navigatorLayoutStore.set(rt.userName, { scriptsCollapsed: true });
    rt.unmount();

    const again = drawn();
    expect(again.header.props["aria-expanded"]).toBe(false);

    (again.header.props.onClick as () => void)();
    expect(navigatorLayoutStore.get(rt.userName).scriptsCollapsed).toBe(false);
    expect(drawn().header.props["aria-expanded"]).toBe(true);
  });

  it("recolher a seção não esconde o navegador, que mora na mesma chave", () => {
    navigatorLayoutStore.set(rt.userName, { hidden: false, scriptsCollapsed: false });

    (drawn().header.props.onClick as () => void)();
    expect(navigatorLayoutStore.get(rt.userName)).toEqual({ hidden: false, scriptsCollapsed: true });
  });
});
