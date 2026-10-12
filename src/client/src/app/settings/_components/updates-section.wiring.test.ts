import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A seção com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). O que se confere AQUI é a ligação, que o teste de
// marcação não alcança: o que a caixa "Receber versões beta" pede ao processo principal quando a pessoa a marca, o que fica no cache com a resposta, e que
// marcar não consulta nem instala nada (RN-ATUALIZA-010). `useQuery` devolve as preferências do teste; `useMutation` guarda as opções que a seção passou.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  type Options = { mutationFn: (value: boolean) => Promise<unknown>; onSuccess?: (saved: unknown) => void };
  return {
    ...createHookRuntime(),
    preferences: undefined as unknown,
    mutations: [] as Options[],
    queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: rt.preferences, isError: false, refetch: vi.fn() }),
  useQueryClient: () => rt.queryClient,
  useMutation: (options: (typeof rt.mutations)[number]) => {
    rt.mutations.push(options);
    return { isPending: false, variables: undefined, mutate: (value: boolean) => void options.mutationFn(value).then((saved) => options.onSuccess?.(saved)) };
  },
}));

import { elementsOf } from "@/lib/testing/react-tree";

import { updatePreferencesQuery } from "../_lib/update-preferences";
import { UpdatesSection } from "./updates-section";

const bridge = { setReceiveBeta: vi.fn(), setCheckOnStartup: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn(), getPreferences: vi.fn() };
const saved = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false };

/** A caixa cujo `aria-describedby` termina com `hint`: o `input` que a seção devolve, com as propriedades que ele receberia. */
function box(hint: string) {
  const input = elementsOf(rt.render(() => UpdatesSection({ anchor: "cfg-atualizacoes" }))).find((element) => element.type === "input" && String(element.props["aria-describedby"]).endsWith(hint));
  if (input === undefined) throw new Error(`sem a caixa ${hint}`);
  return input.props as { checked: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void };
}
const change = (checked: boolean) => ({ target: { checked } }) as ChangeEvent<HTMLInputElement>;

beforeEach(() => {
  rt.unmount();
  rt.preferences = saved;
  rt.mutations.length = 0;
  rt.queryClient.setQueryData.mockReset();
  for (const spy of Object.values(bridge)) spy.mockReset();
  bridge.setReceiveBeta.mockImplementation(async (value: boolean) => ({ ...saved, receiveBeta: value }));
  vi.stubGlobal("window", { prism: { version: "0.1.0", updates: bridge } });
});

describe("a caixa 'Receber versões beta' ligada ao processo principal", () => {
  it("marcar manda verdadeiro à ponte, e o que ela gravou vai para o cache das preferências", async () => {
    box("-beta-hint").onChange(change(true));

    await vi.waitFor(() => expect(rt.queryClient.setQueryData).toHaveBeenCalledWith(updatePreferencesQuery.queryKey, { ...saved, receiveBeta: true }));
    expect(bridge.setReceiveBeta).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("desmarcar manda falso", async () => {
    rt.preferences = { ...saved, receiveBeta: true };
    expect(box("-beta-hint").checked).toBe(true);

    box("-beta-hint").onChange(change(false));

    await vi.waitFor(() => expect(bridge.setReceiveBeta).toHaveBeenCalledExactlyOnceWith(false));
  });

  it("marcar não consulta, não baixa e não instala nada, e não mexe em 'Verificar ao abrir'", async () => {
    box("-beta-hint").onChange(change(true));
    await vi.waitFor(() => expect(bridge.setReceiveBeta).toHaveBeenCalled());

    expect(bridge.check).not.toHaveBeenCalled();
    expect(bridge.download).not.toHaveBeenCalled();
    expect(bridge.install).not.toHaveBeenCalled();
    expect(bridge.setCheckOnStartup).not.toHaveBeenCalled();
  });

  it("'Verificar ao abrir' continua indo à sua própria ponte", async () => {
    bridge.setCheckOnStartup.mockImplementation(async (value: boolean) => ({ ...saved, checkOnStartup: value }));

    box("-startup-hint").onChange(change(false));

    await vi.waitFor(() => expect(bridge.setCheckOnStartup).toHaveBeenCalledExactlyOnceWith(false));
    expect(bridge.setReceiveBeta).not.toHaveBeenCalled();
  });
});
