import { MutationObserver, type MutationObserverOptions, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { exportResultSchema, importPreviewSchema, importResultSchema } from "./transfer.schema";
import { exportConnections, exportMutation, importConnections, importMutation, previewImport, previewMutation } from "./transfer.service";

// O contrato da seção 34 ("Rotas e respostas"): as rotas, os corpos e as respostas, com a API simulada pelo `fetch`.
const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const reply = (body: unknown, status = 200): Fetch => async () => Response.json(body, { status });
const problem = (status: number, type: string, errors?: Record<string, string[]>): Fetch => async () => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...(errors === undefined ? {} : { errors }) }), { status });
const sent = (fetch: ReturnType<typeof vi.fn<Fetch>>) => {
  const [url, init] = fetch.mock.calls[0];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> };
};

const exported = { content: '{"kind":"prism-connections","version":1}', folders: 5, connections: 3, withUser: 2, withPassword: 1 };
const preview = {
  folders: [{ key: "f1", parentKey: null, name: "Estoque", color: "#4C8DFF", environmentName: null, environmentColor: null, confirmCommands: "none", readOnly: false, existing: true, strengthened: null, invalid: null }],
  connections: [
    {
      key: "c1",
      folderKey: "f1",
      name: "DATA FIX",
      engine: 3,
      host: "informix-prd.exemplo.invalid",
      port: 9089,
      database: "estoque",
      userName: "datafix",
      hasPassword: true,
      verificationEnabled: true,
      verificationInterval: 30,
      verificationQuery: null,
      effective: { readOnly: true, confirmCommands: "all", environmentName: "Production", environmentColor: "#FF8A7A" },
      conflict: false,
      copyName: "DATA FIX (cópia)",
      strengthened: { readOnly: true, confirmCommands: null, environmentName: null, environmentColor: null },
      invalid: null,
    },
  ],
};
const imported = { folderIDs: ["0199e0a2-0000-7000-8000-0000000000f1"], connectionIDs: ["0199e0a2-0000-7000-8000-000000000001"], mergedFolders: 1, renamed: 0, skipped: 0 };

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("exportConnections: POST api/user/connections/export (RN-TRANSF-008)", () => {
  it("leva as pastas marcadas, as conexões com a escolha de cada uma e a senha de exportação; sem a senha do Prism, a chave nem vai", async () => {
    const fetch = vi.fn<Fetch>(reply(exported));
    vi.stubGlobal("fetch", fetch);

    expect(await exportConnections({ folderIDs: ["f1"], connections: [{ id: "c1", credentials: "none" }], passphrase: "senha-de-exportação" })).toEqual({ ok: true, data: exported });
    const call = sent(fetch);
    expect([call.url, call.method]).toEqual([`${base}/api/user/connections/export`, "POST"]);
    expect(call.body).toEqual({ folderIDs: ["f1"], connections: [{ id: "c1", credentials: "none" }], passphrase: "senha-de-exportação" });
    expect(call.body).not.toHaveProperty("userPassword");
  });

  it("com a senha do Prism (RN-TRANSF-005), ela vai em `userPassword`", async () => {
    const fetch = vi.fn<Fetch>(reply(exported));
    vi.stubGlobal("fetch", fetch);
    await exportConnections({ folderIDs: [], connections: [{ id: "c1", credentials: "userAndPassword" }], passphrase: "senha-de-exportação", userPassword: "senha do prism" });

    expect(sent(fetch).body).toMatchObject({ userPassword: "senha do prism" });
  });

  it("a resposta tem o arquivo e as contagens; sem o arquivo, é recusada", () => {
    expect(exportResultSchema.safeParse(exported).success).toBe(true);
    expect(exportResultSchema.safeParse({ ...exported, content: "" }).success).toBe(false);
    expect(exportResultSchema.safeParse({ folders: 1, connections: 0, withUser: 0, withPassword: 0 }).success).toBe(false);
  });
});

describe("previewImport e importConnections (RN-TRANSF-011 e 014)", () => {
  it("a prévia leva o arquivo, a senha e o lugar (nulo é a raiz)", async () => {
    const fetch = vi.fn<Fetch>(reply(preview));
    vi.stubGlobal("fetch", fetch);
    const result = await previewImport({ content: "{…}", passphrase: "senha-de-exportação", targetFolderID: null });

    expect(result.ok).toBe(true);
    const call = sent(fetch);
    expect([call.url, call.method]).toEqual([`${base}/api/user/connections/import/preview`, "POST"]);
    expect(call.body).toEqual({ content: "{…}", passphrase: "senha-de-exportação", targetFolderID: null });
  });

  it("a importação leva o da prévia, as chaves marcadas, a escolha dos conflitos e a caixa das consultas", async () => {
    const fetch = vi.fn<Fetch>(reply(imported));
    vi.stubGlobal("fetch", fetch);
    const request = { content: "{…}", passphrase: "senha-de-exportação", targetFolderID: "0199e0a2-0000-7000-8000-0000000000f9", items: ["c1"], onConflict: "skip" as const, keepVerificationQueries: false };

    expect(await importConnections(request)).toEqual({ ok: true, data: imported });
    expect(sent(fetch).url).toBe(`${base}/api/user/connections/import`);
    expect(sent(fetch).body).toEqual(request);
  });

  it("a prévia que traga a senha de uma conexão é recusada por inteiro (RN-CONN-001)", () => {
    const withPassword = { ...preview, connections: [{ ...preview.connections[0], password: "segredo" }] };
    expect(importPreviewSchema.safeParse(withPassword).success).toBe(false);
    expect(importPreviewSchema.safeParse({ ...withPassword, connections: [{ ...preview.connections[0], password: null }] }).success).toBe(false);
  });

  it("o item que não pode ser importado vem como veio: os textos podem faltar, e o banco que este Prism não conhece é nulo", () => {
    const parsed = importPreviewSchema.parse({
      folders: [{ key: "f9", parentKey: null, invalid: "Informe o nome da pasta." }],
      connections: [{ key: "c9", folderKey: null, name: "Novo", engine: null, host: null, port: null, userName: null, effective: null, strengthened: null, invalid: "Este Prism não conhece o banco MySql." }],
    });

    expect(parsed.folders[0]).toMatchObject({ name: null, existing: false, readOnly: false, strengthened: { readOnly: false, confirmCommands: null, environmentName: null, environmentColor: null }, invalid: "Informe o nome da pasta." });
    expect(parsed.connections[0]).toMatchObject({ name: "Novo", engine: null, host: null, port: null, database: null, userName: "", hasPassword: false, verificationQuery: null, conflict: false, invalid: "Este Prism não conhece o banco MySql." });
  });

  it("a conexão sem usuário vem com `userName` vazio, e sem senha; o `effective` nulo não acrescenta nada", () => {
    const parsed = importPreviewSchema.parse({ folders: [], connections: [{ ...preview.connections[0], userName: null, hasPassword: null, effective: null, strengthened: null, engine: 9 }] });

    expect(parsed.connections[0]).toMatchObject({ userName: "", hasPassword: false, engine: null, effective: { readOnly: false, confirmCommands: null, environmentName: null } });
  });

  it("a resposta da importação tem os IDs criados e as contagens", () => {
    expect(importResultSchema.safeParse(imported).success).toBe(true);
    expect(importResultSchema.safeParse({ ...imported, folderIDs: ["f1"] }).success).toBe(false);
  });
});

/**
 * RN-TRANSF-001: as chamadas que levam senha ou arquivo não ficam no cache de mutações da tela, nem `variables` (as senhas, o arquivo) nem `data` (o arquivo
 * cifrado, a prévia). As mutações dos diálogos rodam aqui num cache de verdade, como o diálogo as usa: o observador assinado, o `mutate` e o `reset()` assim
 * que a resposta chega, também na recusa.
 */
describe("o cache de mutações fica vazio depois de cada chamada (RN-TRANSF-001)", () => {
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Roda a mutação como o diálogo: assinada, e esvaziada assim que a resposta chega. Devolve o que o cache tinha logo antes do `reset()` e depois. */
  async function asTheDialog<TData, TVariables>(queryClient: QueryClient, options: MutationObserverOptions<TData, Error, TVariables>, variables: TVariables) {
    const observer = new MutationObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {});
    await observer.mutate(variables).catch(() => undefined);
    const before = queryClient.getMutationCache().getAll().length;
    observer.reset();
    unsubscribe();
    await settle();
    return { before, after: queryClient.getMutationCache().getAll() };
  }

  const exportRequest = { folderIDs: [], connections: [{ id: "c1", credentials: "userAndPassword" as const }], passphrase: "senha-de-exportação", userPassword: "senha do prism" };
  const previewRequest = { content: '{"kind":"prism-connections"}', passphrase: "senha-de-exportação", targetFolderID: null };

  it.each([
    ["a exportação que deu certo", reply(exported)],
    ["a recusa da senha de exportação, que volta como valor", problem(422, "EXPORT_PASSPHRASE_INVALID", { passphrase: ["Use uma senha de exportação diferente da sua senha do Prism."] })],
    ["a recusa que vai ao aviso central", problem(422, "EXPORT_INVALID")],
  ])("exportar: %s", async (_case, answer) => {
    vi.stubGlobal("fetch", answer);
    const queryClient = createQueryClient(toast);
    const { before, after } = await asTheDialog(queryClient, exportMutation, exportRequest);

    expect(before).toBe(1);
    expect(after).toEqual([]);
  });

  it.each([
    ["a prévia", reply(preview)],
    ["a senha que não confere", problem(422, "IMPORT_PASSPHRASE_WRONG", { passphrase: ["A senha de exportação não confere, ou o arquivo foi alterado."] })],
    ["o arquivo de um Prism mais novo", problem(409, "IMPORT_FILE_NEWER")],
  ])("a prévia: %s", async (_case, answer) => {
    vi.stubGlobal("fetch", answer);
    const { before, after } = await asTheDialog(createQueryClient(toast), previewMutation, previewRequest);

    expect(before).toBe(1);
    expect(after).toEqual([]);
  });

  it.each([
    ["a importação", reply(imported)],
    ["o lugar que outra janela excluiu", problem(404, "FOLDER_NOT_FOUND")],
    ["nada marcado, que vai ao aviso central", problem(422, "IMPORT_EMPTY")],
  ])("importar: %s", async (_case, answer) => {
    vi.stubGlobal("fetch", answer);
    const queryClient = createQueryClient(toast);
    const { before, after } = await asTheDialog(queryClient, importMutation(queryClient), { ...previewRequest, items: ["c1"], onConflict: "rename" as const, keepVerificationQueries: false });

    expect(before).toBe(1);
    expect(after).toEqual([]);
  });

  it("o diálogo que fechou antes da resposta (Cancelar durante “Abrindo…”, o bloqueio): a mutação sem observador sai do cache quando a resposta chega", async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (answer = resolve)));
    const queryClient = createQueryClient(toast);
    const observer = new MutationObserver(queryClient, previewMutation);
    const unsubscribe = observer.subscribe(() => {});
    const running = observer.mutate(previewRequest);
    await vi.waitFor(() => expect(answer).toBeDefined());

    unsubscribe();
    answer(Response.json(preview));
    await running;
    await settle();

    expect(queryClient.getMutationCache().getAll()).toEqual([]);
  });

  it("sem o `reset()`, a mutação assinada ficaria no cache com as senhas: é por isso que o diálogo o chama", async () => {
    vi.stubGlobal("fetch", reply(exported));
    const queryClient = createQueryClient(toast);
    const observer = new MutationObserver(queryClient, exportMutation);
    observer.subscribe(() => {});
    await observer.mutate(exportRequest);
    await settle();

    expect(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.variables)).toEqual([exportRequest]);
  });
});
