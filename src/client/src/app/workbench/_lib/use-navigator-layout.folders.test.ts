import { afterEach, describe, expect, it, vi } from "vitest";

// O gancho das pastas abertas (RN-NAV-014) com os ganchos do React simulados (`createHookRuntime`): o que se confere AQUI é a ligação com o usuário do cofre
// (`sessionQuery`) e com a loja da janela; as regras da loja são de `folder-memory.test.ts`. A sessão é de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), session: undefined as { unlocked: boolean; userName: string } | undefined };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: rt.session }) }));

import { folderMemoryStore } from "./folder-memory";
import { useOpenFolders } from "./use-navigator-layout";

const [a, b] = ["0b1c2d3e-4f50-4a6b-8c7d-000000000001", "0b1c2d3e-4f50-4a6b-8c7d-000000000002"];

let users = 0;
const signIn = () => {
  rt.session = { unlocked: true, userName: `gancho.${++users}` };
  return rt.session.userName;
};

afterEach(() => {
  rt.unmount();
  rt.session = undefined;
});

describe("useOpenFolders: as pastas abertas do usuário do cofre aberto (RN-NAV-014)", () => {
  it("sem nada lembrado, tudo fechado; é o mesmo conjunto a cada renderização", () => {
    signIn();

    const [open] = rt.render(() => useOpenFolders("connections"));
    expect(open.size).toBe(0);
    expect(rt.render(() => useOpenFolders("connections"))[0]).toBe(open);
  });

  it("a mudança vai para a loja, na árvore pedida e na chave do usuário; a renderização seguinte a vê", () => {
    const user = signIn();
    const [, change] = rt.render(() => useOpenFolders("scripts"));

    expect(change({ open: [a, b] })).toBe(true);

    expect([...folderMemoryStore.get(user, "scripts")]).toEqual([a, b]);
    expect(folderMemoryStore.get(user, "connections").size).toBe(0);
    expect([...rt.render(() => useOpenFolders("scripts"))[0]]).toEqual([a, b]);
    expect(rt.render(() => useOpenFolders("connections"))[0].size).toBe(0);
  });

  it("devolve se a mudança alterou algo: abrir a que já está aberta, não", () => {
    signIn();
    const [, change] = rt.render(() => useOpenFolders("connections"));

    expect(change({ open: [a] })).toBe(true);
    expect(change({ open: [a] })).toBe(false);
    expect(change({ close: [b] })).toBe(false);
    expect(change({ closeAll: true })).toBe(true);
  });

  it("outro usuário na mesma janela tem a lembrança dele", () => {
    const first = signIn();
    rt.render(() => useOpenFolders("connections"))[1]({ open: [a] });

    const second = signIn();
    expect(second).not.toBe(first);
    expect(rt.render(() => useOpenFolders("connections"))[0].size).toBe(0);
    expect([...folderMemoryStore.get(first, "connections")]).toEqual([a]);
  });

  it("sem usuário (a sessão ainda não chegou), nada aberto e nada gravado", () => {
    const [open, change] = rt.render(() => useOpenFolders("connections"));

    expect(open.size).toBe(0);
    expect(change({ open: [a] })).toBe(false);
    expect(rt.render(() => useOpenFolders("connections"))[0].size).toBe(0);
  });
});
