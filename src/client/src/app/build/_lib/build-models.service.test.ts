import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBuildModel,
  deleteBuildModel,
  getBuildModel,
  listBuildModels,
  updateBuildModel,
  type BuildModelDto,
} from "./build-models.service";

const base = "http://127.0.0.1:51234";
const bridge = {
  getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }),
  onApiExit: () => () => {},
  restartApi: async () => {},
};

const id = "0199c3a0-0000-7000-8000-000000000001";
const dto: BuildModelDto = {
  id,
  name: "manutencao",
  body: '{"version":1}',
  createdAt: "2026-10-29T14:00:00Z",
  updatedAt: "2026-10-29T14:10:00Z",
};

function fetchAnswers(response: Response) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refusal = (status: number, type: string) =>
  new Response(
    JSON.stringify({ type, title: `Título de ${type}`, status, errors: { Name: ["mensagem"] } }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );

const request = (fake: ReturnType<typeof fetchAnswers>) => {
  const [url, init] = fake.mock.calls[0];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
};

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("build-models.service (seção 7)", () => {
  it("lista, lê por id, cria e exclui modelos", async () => {
    let fake = fetchAnswers(json([dto]));
    expect(await listBuildModels()).toEqual({ ok: true, data: [dto] });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/build-models`, method: "GET" });

    fake = fetchAnswers(json(dto));
    expect(await getBuildModel(id)).toEqual({ ok: true, data: dto });
    expect(request(fake).url).toBe(`${base}/api/user/build-models/${id}`);

    fake = fetchAnswers(json(dto, 201));
    expect(await createBuildModel({ name: "manutencao", body: dto.body })).toEqual({ ok: true, data: dto });
    expect(request(fake)).toEqual({
      url: `${base}/api/user/build-models`,
      method: "POST",
      body: { name: "manutencao", body: dto.body },
    });

    fake = fetchAnswers(new Response(null, { status: 204 }));
    expect(await deleteBuildModel(id)).toEqual({ ok: true, data: undefined });
    expect(request(fake)).toMatchObject({ url: `${base}/api/user/build-models/${id}`, method: "DELETE" });
  });

  it("PATCH manda expectedUpdatedAt e 409 BUILD_MODEL_CHANGED volta como recusa", async () => {
    const fake = fetchAnswers(json(dto));
    expect(
      await updateBuildModel(id, { body: dto.body, expectedUpdatedAt: dto.updatedAt }),
    ).toEqual({ ok: true, data: dto });
    expect(request(fake)).toEqual({
      url: `${base}/api/user/build-models/${id}`,
      method: "PATCH",
      body: { body: dto.body, expectedUpdatedAt: dto.updatedAt },
    });

    fetchAnswers(refusal(409, "BUILD_MODEL_CHANGED"));
    expect(
      await updateBuildModel(id, { body: dto.body, expectedUpdatedAt: dto.updatedAt }),
    ).toMatchObject({ ok: false, error: { code: "BUILD_MODEL_CHANGED" } });
  });
});
