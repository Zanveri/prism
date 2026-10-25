import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dbeaverImportResultSchema, dbeaverPreviewSchema, dbeaverScanSchema, dbeaverStateSchema } from "./dbeaver.schema";
import { dbeaverImportMutation, dbeaverPreviewMutation, getDbeaverState, importDbeaver, inviteDbeaver, markInvited, previewDbeaver, scanDbeaver } from "./dbeaver.service";

// O contrato da seção 40 ("Rotas e respostas"): as rotas, os corpos e as respostas, com a API simulada pelo `fetch`. Tudo sintético: hosts `.invalid`.
const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };
const source = "0f8fad5b-d9cb-469f-a165-70867728950e";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const reply = (body: unknown, status = 200): Fetch => async () => Response.json(body, { status });
const problem = (status: number, type: string): Fetch => async () => new Response(JSON.stringify({ type, title: `Título de ${type}`, status }), { status });
const sent = (fetch: ReturnType<typeof vi.fn<Fetch>>, call = 0) => {
  const [url, init] = fetch.mock.calls[call];
  return { url, method: init.method, body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>) };
};

const connection = {
  key: "c1",
  folderKey: "f1",
  name: "ESTOQUE DEV",
  engine: 3,
  host: "ifx-dev.exemplo.invalid",
  port: 55080,
  database: "estoque",
  userName: "fulano",
  hasPassword: true,
  verificationEnabled: null,
  verificationInterval: null,
  verificationQuery: null,
  effective: { readOnly: false, confirmCommands: "all", environmentName: "Desenvolvimento", environmentColor: null },
  conflict: false,
  copyName: null,
  strengthened: null,
  invalid: null,
  server: "ifx_dev_tcp",
  dbeaverType: "dev",
  existing: { connectionID: "0199e0a2-0000-7000-8000-000000000001", name: "ESTOQUE DEV", path: "Estoque / Dev", connected: true },
  overwrite: { name: false, engine: false, host: true, port: false, database: false, userName: false, password: true, environment: false, keepsName: false, dropsPassword: false },
  leftOut: ["informixServer", "sshTunnel", "codigoDeUmaVersaoNova"],
};
const preview = {
  folders: [{ key: "f1", parentKey: null, name: "Estoque", color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, existing: false, strengthened: null, invalid: null, nameCut: true }],
  connections: [connection],
  notes: { protectedProjects: ["Vendas"], credentialsUnreadable: [], credentialsProtected: [], unreadableFiles: [], withoutSavedPassword: 8, savedPasswordMissing: 0 },
};
const imported = { folderIDs: [], connectionIDs: ["0199e0a2-0000-7000-8000-000000000002"], mergedFolders: 0, renamed: 1, skipped: 0, updatedIDs: ["0199e0a2-0000-7000-8000-000000000001"] };
const request = { sourceId: source, project: null, targetFolderID: null, withPasswords: true, drdaPorts: [] };

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("o estado e o convite (RN-DBEAVER-018)", () => {
  it("GET devolve o convite e a última importação, nulos até acontecer", async () => {
    const fetch = vi.fn<Fetch>(reply({ invitedAt: null, lastImportAt: "2026-10-20T14:32:00Z" }));
    vi.stubGlobal("fetch", fetch);

    expect(await getDbeaverState()).toEqual({ ok: true, data: { invitedAt: null, lastImportAt: "2026-10-20T14:32:00Z" } });
    expect([sent(fetch).url, sent(fetch).method]).toEqual([`${base}/api/user/connections/dbeaver`, "GET"]);
    expect(dbeaverStateSchema.safeParse({ invitedAt: null }).success).toBe(false);
  });

  it("PUT grava o convite sem corpo (204); `markInvited` lê o estado de novo e não lança se a gravação falha", async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    expect(await inviteDbeaver()).toEqual({ ok: true, data: undefined });
    expect([sent(fetch).url, sent(fetch).method, sent(fetch).body]).toEqual([`${base}/api/user/connections/dbeaver/invite`, "PUT", undefined]);

    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await markInvited(queryClient);
    expect(invalidate).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn<Fetch>(problem(503, "VAULT_UNAVAILABLE")));
    invalidate.mockClear();
    await expect(markInvited(queryClient)).resolves.toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("scanDbeaver: POST api/user/connections/dbeaver/scan (RN-DBEAVER-007)", () => {
  it("leva só o `sourceId` e devolve o lugar da cópia e as contagens de cada projeto", async () => {
    const body = { where: "flatpak", projects: [{ name: "General", connections: 24, importable: 22, withPassword: 1, protected: false, nameInvalid: false, credentialsUnreadable: false, credentialsProtected: false }] };
    const fetch = vi.fn<Fetch>(reply(body));
    vi.stubGlobal("fetch", fetch);

    expect(await scanDbeaver(source)).toEqual({ ok: true, data: body });
    expect(sent(fetch)).toEqual({ url: `${base}/api/user/connections/dbeaver/scan`, method: "POST", body: { sourceId: source } });
  });

  it("o lugar que a tela não conhece é recusado, e as recusas vêm com o código", async () => {
    expect(dbeaverScanSchema.safeParse({ where: "outro", projects: [] }).success).toBe(false);

    vi.stubGlobal("fetch", vi.fn<Fetch>(problem(404, "DBEAVER_SOURCE_MISSING")));
    expect(await scanDbeaver(source)).toMatchObject({ ok: false, error: { status: 404, code: "DBEAVER_SOURCE_MISSING" } });
  });
});

describe("previewDbeaver e importDbeaver (RN-DBEAVER-015 e 016)", () => {
  it("a prévia leva a origem, o lugar e \"Levar as senhas\"; o projeto e as portas DRDA só quando há", async () => {
    const fetch = vi.fn<Fetch>(reply(preview));
    vi.stubGlobal("fetch", fetch);

    expect((await previewDbeaver(request)).ok).toBe(true);
    expect(sent(fetch)).toEqual({ url: `${base}/api/user/connections/dbeaver/import/preview`, method: "POST", body: { sourceId: source, targetFolderID: null, withPasswords: true } });

    const drdaPorts = [{ host: "ifx-dev.exemplo.invalid", port: 55080, server: "ifx_dev_tcp", drdaPort: 9089 }];
    await previewDbeaver({ ...request, project: "Vendas", withPasswords: false, targetFolderID: "0199e0a2-0000-7000-8000-0000000000f9", drdaPorts });
    expect(sent(fetch, 1).body).toEqual({ sourceId: source, project: "Vendas", targetFolderID: "0199e0a2-0000-7000-8000-0000000000f9", withPasswords: false, drdaPorts });
  });

  it("a importação leva o da prévia, as chaves marcadas, a escolha dos conflitos e as que se sobrescrevem", async () => {
    const fetch = vi.fn<Fetch>(reply(imported));
    vi.stubGlobal("fetch", fetch);

    expect(await importDbeaver({ ...request, items: ["c1"], onConflict: "rename", overwrite: ["c1"] })).toEqual({ ok: true, data: imported });
    expect(sent(fetch)).toEqual({
      url: `${base}/api/user/connections/dbeaver/import`,
      method: "POST",
      body: { sourceId: source, targetFolderID: null, withPasswords: true, items: ["c1"], onConflict: "rename", overwrite: ["c1"] },
    });
  });

  it("a prévia traz as marcas do DBeaver; o código de \"ficou de fora\" que a tela não conhece é ignorado, e a senha é recusada", () => {
    const parsed = dbeaverPreviewSchema.parse(preview);
    expect(parsed.folders[0].nameCut).toBe(true);
    expect(parsed.connections[0]).toMatchObject({ server: "ifx_dev_tcp", dbeaverType: "dev", leftOut: ["informixServer", "sshTunnel"], existing: { name: "ESTOQUE DEV", connected: true }, overwrite: { host: true, port: false } });
    expect(parsed.notes).toMatchObject({ protectedProjects: ["Vendas"], withoutSavedPassword: 8, savedPasswordMissing: 0, credentialsUnreadable: [] });

    expect(dbeaverPreviewSchema.safeParse({ ...preview, connections: [{ ...connection, password: "segredo" }] }).success).toBe(false);
  });

  it("a prévia sem `notes`, `existing`, `overwrite` e `leftOut` vem com os padrões", () => {
    const bare = Object.fromEntries(Object.entries(connection).filter(([name]) => !["existing", "overwrite", "leftOut"].includes(name)));
    const parsed = dbeaverPreviewSchema.parse({ folders: [], connections: [bare] });

    expect(parsed.connections[0]).toMatchObject({ existing: null, overwrite: null, leftOut: [] });
    expect(parsed.notes).toEqual({ protectedProjects: [], credentialsUnreadable: [], credentialsProtected: [], unreadableFiles: [], unreadableProjects: [], withoutSavedPassword: 0, savedPasswordMissing: 0 });
  });

  it("a resposta da importação tem os IDs criados e os atualizados", () => {
    expect(dbeaverImportResultSchema.safeParse(imported).success).toBe(true);
    expect(dbeaverImportResultSchema.safeParse({ ...imported, updatedIDs: ["x"] }).success).toBe(false);
    expect(dbeaverImportResultSchema.safeParse({ folderIDs: [], connectionIDs: [], mergedFolders: 0, renamed: 0, skipped: 0 }).success).toBe(false);
  });
});

/**
 * RN-DBEAVER-003: a prévia e a importação não ficam no cache de mutações da tela (têm usuários e servidores do DBeaver). As mutações rodam aqui num cache de
 * verdade, como o diálogo as usa: o observador assinado, o `mutate` e o `reset()` assim que a resposta chega, também na recusa.
 */
describe("o cache de mutações fica vazio depois de cada chamada (RN-DBEAVER-003)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("a prévia some do cache com o `reset()`, e a recusa que o diálogo mostra no lugar volta como valor", async () => {
    const queryClient = new QueryClient();
    vi.stubGlobal("fetch", vi.fn<Fetch>(reply(preview)));
    const observer = new MutationObserver(queryClient, dbeaverPreviewMutation);
    const stop = observer.subscribe(() => {});

    const result = await observer.mutate(request);
    expect(result.ok).toBe(true);
    observer.reset();
    stop();
    await settle();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);

    vi.stubGlobal("fetch", vi.fn<Fetch>(problem(404, "DBEAVER_SOURCE_MISSING")));
    const refused = new MutationObserver(queryClient, dbeaverPreviewMutation);
    expect(await refused.mutate(request)).toMatchObject({ ok: false, error: { code: "DBEAVER_SOURCE_MISSING" } });
    // A que não é do diálogo vai ao aviso central: lança.
    vi.stubGlobal("fetch", vi.fn<Fetch>(problem(422, "IMPORT_INVALID")));
    await expect(new MutationObserver(queryClient, dbeaverPreviewMutation).mutate(request)).rejects.toThrow();
  });

  it("a importação lê as listas e a data da última importação de novo, só quando deu certo", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    vi.stubGlobal("fetch", vi.fn<Fetch>(reply(imported)));

    await new MutationObserver(queryClient, dbeaverImportMutation(queryClient)).mutate({ ...request, items: ["c1"], onConflict: "rename", overwrite: [] });
    expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([["folders"], ["connections"], ["dbeaver-state"]]);

    invalidate.mockClear();
    vi.stubGlobal("fetch", vi.fn<Fetch>(problem(404, "FOLDER_NOT_FOUND")));
    expect(await new MutationObserver(queryClient, dbeaverImportMutation(queryClient)).mutate({ ...request, items: ["c1"], onConflict: "rename", overwrite: [] })).toMatchObject({ ok: false });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
