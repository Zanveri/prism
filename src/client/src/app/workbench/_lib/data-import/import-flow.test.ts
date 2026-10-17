import { describe, expect, it, vi } from "vitest";

import type { ApiError, ApiResult } from "@/lib/api/prism-api";

import type { SourceReply, SourceStatus } from "../../../../../electron/transfer-messages";
import { defaultImportChoices } from "./import-choices";
import { createImportFlow, importStepProblem, mapsByName, type ImportFlowDeps } from "./import-flow";
import type { ImportPreview, ImportPreviewRequest, ImportRead, ImportReadRequest, ImportStartRequest } from "./imports.schema";

const fileId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherFileId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const place = { connectionId: "c1", schema: "estoque", table: "pedido" };

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const refusal = (code: string, change: Partial<ApiError> = {}): ApiResult<never> => ({ ok: false, error: { status: 422, code, title: `Título de ${code}`, detail: null, errors: null, extensions: {}, ...change } });

const read = (change: Partial<ImportRead> = {}): ImportRead => ({
  encoding: { name: "utf-8", bom: true },
  delimiter: ";",
  listKey: null,
  sheets: null,
  sheet: null,
  columns: ["id", "nome"],
  shownColumns: 2,
  rows: [{ line: 2, values: ["1", "Ana"], short: false }],
  ...change,
});

const table = {
  schema: "estoque",
  name: "pedido",
  oneAtATime: false,
  columns: [
    { name: "id", type: "integer", nullable: false, defaultValue: null, generated: null, class: "number" as const, importable: true, reason: null },
    { name: "nome", type: "text", nullable: true, defaultValue: null, generated: null, class: "text" as const, importable: true, reason: null },
  ],
  referencedBy: [],
};

const preview = (change: Partial<ImportPreview> = {}): ImportPreview => ({
  table,
  columns: ["id", "nome"],
  mapping: [
    { source: 0, target: "id" },
    { source: 1, target: "nome" },
  ],
  shownColumns: 2,
  rows: [{ line: 2, problem: null, short: false, cells: [{ value: "1", problem: null }, { value: "Ana", problem: null }] }],
  ...change,
});

function harness(change: Partial<ImportFlowDeps> = {}) {
  const timers: (() => void)[] = [];
  const reads: { request: ImportReadRequest; answer: Deferred<ApiResult<ImportRead>> }[] = [];
  const previews: { request: ImportPreviewRequest; answer: Deferred<ApiResult<ImportPreview>> }[] = [];
  const starts: ImportStartRequest[] = [];
  const statuses: SourceStatus[] = [];
  const released: string[] = [];
  const started: unknown[] = [];
  let chooseAnswer: Deferred<SourceReply | { status: "error" }> = deferred();
  let startAnswer: ApiResult<{ id: string }> = { ok: true, data: { id: "job-1" } };
  const deps: ImportFlowDeps = {
    place,
    initialChoices: defaultImportChoices(),
    available: () => true,
    choose: () => chooseAnswer.promise,
    status: async () => statuses.shift() ?? { status: "ready" },
    release: async (id) => void released.push(id),
    read: (request) => {
      const answer = deferred<ApiResult<ImportRead>>();
      reads.push({ request, answer });
      return answer.promise;
    },
    preview: (request) => {
      const answer = deferred<ApiResult<ImportPreview>>();
      previews.push({ request, answer });
      return answer.promise;
    },
    start: async (request) => {
      starts.push(request);
      return startAnswer;
    },
    windowId: () => 1,
    schedule: (run) => {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    onStarted: (job) => void started.push(job),
    ...change,
  };
  const flow = createImportFlow(deps);
  return {
    flow,
    reads,
    previews,
    starts,
    statuses,
    released,
    started,
    tick: async () => {
      const run = timers.shift();
      run?.();
      await flush();
    },
    choose: async (reply: SourceReply | { status: "error" }) => {
      chooseAnswer = deferred();
      const pending = flow.chooseFile();
      chooseAnswer.resolve(reply);
      await pending;
    },
    /** O diálogo do sistema aberto, sem resposta ainda: a resposta é do teste. */
    openDialog: () => {
      chooseAnswer = deferred();
      const answer = chooseAnswer;
      return { pending: flow.chooseFile(), answer: (reply: SourceReply | { status: "error" }) => answer.resolve(reply) };
    },
    answerStart: (answer: ApiResult<{ id: string }>) => (startAnswer = answer),
  };
}

const chosen = (id = fileId, fileName = "pedidos.csv"): SourceReply => ({ status: "chosen", fileId: id, fileName, size: 1200 });

/** Escolhe, copia (pronto na primeira consulta) e responde a leitura. */
async function readyToMap(h: ReturnType<typeof harness>, answer = read()) {
  await h.choose(chosen());
  await h.tick();
  h.reads.at(-1)?.answer.resolve({ ok: true, data: answer });
  await flush();
}

describe("o arquivo (RN-IMPORT-003 e 018)", () => {
  it("escolhido, a cópia é consultada a cada 250 ms até ficar pronta, com a porcentagem; pronta, a leitura sai com as escolhas da pessoa", async () => {
    const h = harness();
    h.statuses.push({ status: "copying", copied: 450, size: 1000 });
    await h.choose(chosen());
    expect(h.flow.snapshot().source).toEqual({ status: "copying", fileId, fileName: "pedidos.csv", size: 1200, copied: 0 });
    expect(importStepProblem(h.flow.snapshot(), "file")).toBe("Espere a cópia do arquivo terminar.");
    await h.tick();
    expect(h.flow.snapshot().source).toMatchObject({ status: "copying", copied: 450, size: 1000 });
    await h.tick();
    expect(h.flow.snapshot().source.status).toBe("ready");
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0].request).toEqual({ fileID: fileId, format: "csv", reader: { encoding: "auto", delimiter: "auto", header: true, quote: "double", nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true } });
  });

  it("o formato vem da extensão; a recusa da escolha fica no campo, sem pedir nada; desistir do diálogo deixa tudo como estava", async () => {
    const h = harness();
    await h.choose(chosen(fileId, "dados.XLSX"));
    expect(h.flow.snapshot().format).toBe("xlsx");
    await h.choose({ status: "canceled" });
    expect(h.flow.snapshot().source).toMatchObject({ status: "copying", fileId });
    await h.choose({ status: "notAFile" });
    expect(h.flow.snapshot().source).toEqual({ status: "none", problem: "Escolha um arquivo, e não uma pasta ou um dispositivo." });
    // A escolha recusada solta o arquivo de antes: "Trocar arquivo…" solta.
    expect(h.released).toEqual([fileId]);
  });

  it("fora do Electron, \"Escolher arquivo…\" diz que importar só funciona no app, sem pedir nada", async () => {
    const choose = vi.fn();
    const h = harness({ available: () => false, choose });
    await h.flow.chooseFile();
    expect(choose).not.toHaveBeenCalled();
    expect(h.flow.snapshot().source).toEqual({ status: "none", problem: "Importar só funciona no app do Prism." });
  });

  it("trocar o arquivo solta o de antes e recomeça do Arquivo, sem a leitura e o mapeamento", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    expect(h.flow.snapshot().step).toBe("mapping");
    h.flow.goTo("file");
    await h.choose(chosen(otherFileId, "outro.json"));
    expect(h.released).toEqual([fileId]);
    expect(h.flow.snapshot()).toMatchObject({ step: "file", format: "json", targets: null, read: { status: "idle" }, preview: { status: "idle" } });
  });

  it("\"Cancelar\" a cópia solta o arquivo; a cópia que falha fica no campo com a frase, e o arquivo é solto; o que sumiu pede o arquivo de novo", async () => {
    const h = harness();
    await h.choose(chosen());
    h.flow.cancelCopy();
    expect(h.released).toEqual([fileId]);
    expect(h.flow.snapshot().source).toEqual({ status: "none", problem: null });

    h.statuses.push({ status: "failed", reason: "diskFull", message: "Não há espaço na pasta de dados do Prism para copiar o arquivo." });
    await h.choose(chosen(otherFileId));
    await h.tick();
    expect(h.flow.snapshot().source).toEqual({ status: "failed", fileName: "pedidos.csv", message: "Não há espaço na pasta de dados do Prism para copiar o arquivo." });
    expect(h.released).toEqual([fileId, otherFileId]);
    expect(importStepProblem(h.flow.snapshot(), "file")).toBe("Não há espaço na pasta de dados do Prism para copiar o arquivo.");

    h.statuses.push({ status: "missing" });
    await h.choose(chosen());
    await h.tick();
    expect(h.flow.snapshot().source).toEqual({ status: "none", problem: "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo." });
  });

  it("fechar solta o arquivo, também no meio da cópia; o arquivo escolhido com o assistente já fechado é solto na chegada", async () => {
    const h = harness();
    await h.choose(chosen());
    h.flow.close();
    expect(h.released).toEqual([fileId]);

    const answer = deferred<SourceReply | { status: "error" }>();
    const late = harness({ choose: () => answer.promise });
    const pending = late.flow.chooseFile();
    late.flow.close();
    answer.resolve(chosen(otherFileId));
    await pending;
    expect(late.released).toEqual([otherFileId]);
  });

  it("fechar com o diálogo de \"Trocar arquivo…\" aberto (o bloqueio, o \"Sair\" de outra janela) solta o arquivo pronto de antes; desistir dele o devolve", async () => {
    const h = harness();
    await readyToMap(h);
    const dialog = h.openDialog();
    // Com o diálogo aberto, o campo continua o de antes (o arquivo ainda é do assistente).
    expect(h.flow.snapshot().source).toEqual({ status: "choosing", before: { status: "ready", fileId, fileName: "pedidos.csv", size: 1200 } });
    h.flow.close();
    expect(h.released).toEqual([fileId]);
    dialog.answer({ status: "canceled" });
    await dialog.pending;
    expect(h.released).toEqual([fileId]);

    const kept = harness();
    await readyToMap(kept);
    const again = kept.openDialog();
    again.answer({ status: "canceled" });
    await again.pending;
    expect(kept.flow.snapshot().source).toEqual({ status: "ready", fileId, fileName: "pedidos.csv", size: 1200 });
    expect(kept.released).toEqual([]);
    kept.flow.close();
    expect(kept.released).toEqual([fileId]);
  });
});

describe("a leitura e a prévia do arquivo (RN-IMPORT-004 a 007)", () => {
  it("um pedido de cada vez: a mudança durante a leitura espera o fim dela e refaz uma vez, com as últimas escolhas", async () => {
    const h = harness();
    await h.choose(chosen());
    await h.tick();
    expect(h.reads).toHaveLength(1);
    h.flow.setCsv({ header: false });
    h.flow.setCsv({ quote: "none" });
    expect(h.reads).toHaveLength(1);
    h.reads[0].answer.resolve({ ok: true, data: read() });
    await flush();
    expect(h.reads).toHaveLength(2);
    expect(h.reads[1].request.reader).toMatchObject({ header: false, quote: "none" });
  });

  it("a codificação automática achada vai nas leituras seguintes do mesmo arquivo; o separador automático vai como auto", async () => {
    const h = harness();
    await readyToMap(h, read({ encoding: { name: "windows-1252", bom: false }, delimiter: "," }));
    expect(h.flow.snapshot().detectedEncoding).toBe("windows-1252");
    h.flow.setCsv({ trim: true });
    expect(h.reads[1].request.reader).toMatchObject({ encoding: "windows-1252", delimiter: "auto", trim: true });
  });

  it("a recusa da leitura fica no lugar da prévia e segura o \"Avançar\"; o arquivo que sumiu leva de volta ao Arquivo", async () => {
    const h = harness();
    await h.choose(chosen());
    await h.tick();
    h.reads[0].answer.resolve(refusal("IMPORT_FILE_UNREADABLE", { detail: "A aspa aberta na linha 12 não fecha até o fim do arquivo." }));
    await flush();
    expect(h.flow.snapshot().read).toEqual({ status: "refused", message: "A aspa aberta na linha 12 não fecha até o fim do arquivo.", field: null });
    expect(importStepProblem(h.flow.snapshot(), "file")).toBe("A aspa aberta na linha 12 não fecha até o fim do arquivo.");

    h.flow.setCsv({ quote: "none" });
    h.reads[1].answer.resolve(refusal("IMPORT_FILE_MISSING"));
    await flush();
    expect(h.flow.snapshot().source).toEqual({ status: "none", problem: "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo." });
  });

  it("o texto do nulo com caractere de controle fica no campo e não vai à API", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.setCsv({ nullText: "a\tb" });
    expect(h.reads).toHaveLength(1);
    expect(importStepProblem(h.flow.snapshot(), "file")).toBe("O texto do nulo não pode ter caractere de controle.");
  });

  it("o arquivo sem linhas de dados não avança; o XLSX lê a planilha que a primeira leitura achou, e a troca de planilha lê de novo", async () => {
    const h = harness();
    await h.choose(chosen(fileId, "p.xlsx"));
    await h.tick();
    expect(h.reads[0].request.reader).toEqual({ header: true, skipEmptyLines: true });
    h.reads[0].answer.resolve({ ok: true, data: read({ encoding: null, delimiter: null, sheets: [{ name: "Pedidos", hidden: false }, { name: "Base", hidden: true }], sheet: "Pedidos", rows: [] }) });
    await flush();
    expect(h.flow.snapshot().sheet).toBe("Pedidos");
    expect(importStepProblem(h.flow.snapshot(), "file")).toBe("O arquivo não tem linhas para importar.");
    h.flow.setSheet("Base");
    expect(h.reads[1].request.reader).toEqual({ sheet: "Base", header: true, skipEmptyLines: true });
  });
});

describe("o Mapeamento e a prévia convertida (RN-IMPORT-009 a 011)", () => {
  it("ao entrar, a prévia vai sem mapeamento, com o que a leitura achou, e a resposta traz o automático; cada mudança refaz a prévia com o mapeamento", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    expect(h.previews[0].request).toEqual({
      fileID: fileId,
      format: "csv",
      reader: { encoding: "utf-8", delimiter: ";", header: true, quote: "double", nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true },
      values: { decimal: "point", thousandsDot: false, dates: "iso" },
      target: { connectionID: "c1", schema: "estoque", table: "pedido" },
    });
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBe("Lendo as colunas de estoque.pedido…");
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    expect(h.flow.snapshot().targets).toEqual(["id", "nome"]);
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBeNull();

    h.flow.setTarget(1, "id");
    expect(h.flow.snapshot().targets).toEqual([null, "id"]);
    expect(h.flow.snapshot().moved).toBe("id deixou de receber id.");
    expect(h.previews[1].request.mapping).toEqual([{ source: 1, target: "id" }]);
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBe("Atualizando a prévia…");
  });

  it("\"Não importar nenhuma\" segura o \"Avançar\" sem pedir prévia; \"Mapear pelo nome\" pede a prévia sem mapeamento e fica com o automático", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    h.flow.mapNone();
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBe("Escolha ao menos uma coluna da tabela para receber valores.");
    expect(h.previews).toHaveLength(1);
    h.flow.mapByName();
    expect(h.previews[1].request.mapping).toBeUndefined();
    h.previews[1].answer.resolve({ ok: true, data: preview({ mapping: [{ source: 1, target: "nome" }] }) });
    await flush();
    expect(h.flow.snapshot().targets).toEqual([null, "nome"]);
  });

  it("as recusas da tabela ficam na etapa; a falha do banco, com \"Tentar de novo\", pede a prévia de novo", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve(refusal("IMPORT_TABLE_NOT_FOUND", { status: 404 }));
    await flush();
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBe("A tabela estoque.pedido não existe mais.");
    h.flow.retryPreview();
    h.previews[1].answer.resolve(refusal("DATABASE_CONNECTION_FAILED", { detail: "password authentication failed", extensions: { sqlState: "28P01" } }));
    await flush();
    expect(h.flow.snapshot().preview).toMatchObject({ status: "refused", message: "password authentication failed (SQLSTATE 28P01)", retry: true });
  });

  it("a prévia que falha sem recusa (o 500, a rede) diz que não leu as colunas, com \"Tentar de novo\", em vez de esperar para sempre; voltar e avançar pede de novo", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.reject(new Error("500"));
    await flush();
    expect(h.flow.snapshot().preview).toEqual({ status: "refused", message: "Não foi possível ler as colunas de estoque.pedido.", retry: true, previous: null });
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBe("Não foi possível ler as colunas de estoque.pedido.");
    h.flow.retryPreview();
    expect(h.previews).toHaveLength(2);
    h.previews[1].answer.resolve({ ok: true, data: preview() });
    await flush();
    expect(importStepProblem(h.flow.snapshot(), "mapping")).toBeNull();

    // Com a lista na tela, a atualização que falha mantém a prévia de antes e diz que não atualizou.
    h.flow.setTarget(1, null);
    h.previews[2].answer.reject(new Error("rede"));
    await flush();
    expect(h.flow.snapshot().preview).toMatchObject({ status: "refused", message: "Não foi possível atualizar a prévia.", retry: true });
    h.flow.goTo("file");
    h.flow.advance();
    expect(h.previews).toHaveLength(4);
  });

  it("voltar ao Arquivo e mudar o leitor lê de novo; o mapeamento continua nas colunas que continuam, e a prévia é pedida de novo ao voltar", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    h.flow.goTo("file");
    h.flow.setCsv({ trim: true });
    h.reads[1].answer.resolve({ ok: true, data: read({ columns: ["nome", "obs"] }) });
    await flush();
    expect(h.flow.snapshot().targets).toEqual(["nome", null]);
    h.flow.advance();
    expect(h.previews[1].request.mapping).toEqual([{ source: 0, target: "nome" }]);
  });

  it("o mapeamento vai pelo nome com cabeçalho e no JSON, e pela posição sem cabeçalho", () => {
    const choices = defaultImportChoices();
    expect(mapsByName({ format: "csv", choices })).toBe(true);
    expect(mapsByName({ format: "csv", choices: { ...choices, csv: { ...choices.csv, header: false } } })).toBe(false);
    expect(mapsByName({ format: "json", choices })).toBe(true);
    expect(mapsByName({ format: "xlsx", choices: { ...choices, xlsx: { header: false, skipEmptyLines: true } } })).toBe(false);
  });
});

describe("a Carga, a Confirmação e o \"Importar\" (RN-IMPORT-012 e 013)", () => {
  async function atConfirmation(h: ReturnType<typeof harness>) {
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    h.flow.advance();
    h.flow.advance();
  }

  it("o N fora da faixa segura a Carga; com \"Esvaziar\", a caixa \"Entendo…\" começa desmarcada a cada abertura e segura o \"Importar\"", async () => {
    const h = harness();
    await readyToMap(h);
    h.flow.advance();
    h.previews[0].answer.resolve({ ok: true, data: preview() });
    await flush();
    h.flow.advance();
    h.flow.setLoad({ commitEvery: "0" });
    expect(importStepProblem(h.flow.snapshot(), "load")).toBe("Use de 1 a 1.000.000 linhas.");
    h.flow.advance();
    expect(h.flow.snapshot().step).toBe("load");
    h.flow.setLoad({ commitEvery: "500" });
    h.flow.setEmpty(true);
    h.flow.advance();
    expect(h.flow.snapshot().step).toBe("confirmation");
    expect(importStepProblem(h.flow.snapshot(), "confirmation")).toBe("Marque que entende que a tabela será esvaziada.");
    h.flow.setUnderstood(true);
    h.flow.goTo("load");
    h.flow.advance();
    expect(h.flow.snapshot().understood).toBe(false);
  });

  it("aceito o pedido (202), o acompanhamento recebe a importação, e o arquivo não é solto ao fechar: agora é do trabalho", async () => {
    const h = harness();
    await atConfirmation(h);
    await h.flow.submit();
    expect(h.starts[0]).toEqual({
      fileID: fileId,
      format: "csv",
      reader: { encoding: "utf-8", delimiter: ";", header: true, quote: "double", nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true },
      values: { decimal: "point", thousandsDot: false, dates: "iso" },
      target: { connectionID: "c1", schema: "estoque", table: "pedido" },
      mapping: [
        { source: 0, target: "id" },
        { source: 1, target: "nome" },
      ],
      load: { empty: false, commitEvery: 10_000, check: true },
      windowID: 1,
    });
    expect(h.started).toMatchObject([{ id: "job-1", fileName: "pedidos.csv", format: "csv", oneAtATime: false, empty: false, single: false }]);
    h.flow.close();
    expect(h.released).toEqual([]);
  });

  it("as recusas ficam no assistente: a de campo na etapa dela, as outras no alto da Confirmação; o arquivo que sumiu leva ao Arquivo", async () => {
    const h = harness();
    await atConfirmation(h);
    h.answerStart(refusal("IMPORT_OPTIONS_INVALID", { errors: { "load.commitEvery": ["Use de 1 a 1.000.000 linhas."] } }));
    await h.flow.submit();
    expect(h.flow.snapshot()).toMatchObject({ step: "load", refusals: [{ field: "load.commitEvery", message: "Use de 1 a 1.000.000 linhas." }], starting: false });

    h.flow.advance();
    h.answerStart(refusal("TRANSFER_LIMIT_REACHED", { status: 409 }));
    await h.flow.submit();
    expect(h.flow.snapshot()).toMatchObject({ step: "confirmation", refusals: [{ field: null, message: "Já há 3 transferências em andamento (exportações, importações ou cópias para outro banco). Espere uma terminar, ou cancele uma na barra de status." }] });

    h.answerStart(refusal("CONNECTION_CREDENTIALS_MISSING", { errors: { password: ["x"] } }));
    await h.flow.submit();
    expect(h.flow.snapshot().refusals).toEqual([{ field: null, message: "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e importe de novo." }]);

    h.answerStart(refusal("IMPORT_FILE_MISSING", { status: 404 }));
    await h.flow.submit();
    expect(h.flow.snapshot()).toMatchObject({ step: "file", source: { status: "none", problem: "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo." } });
  });

  it("a chamada que falha sem recusa (o aviso central já disse) deixa o assistente como estava; sem a janela do Electron, nada é pedido", async () => {
    const h = harness({
      start: async () => {
        throw new Error("Sem resposta da API.");
      },
    });
    await atConfirmation(h);
    await h.flow.submit();
    expect(h.flow.snapshot()).toMatchObject({ step: "confirmation", starting: false, refusals: [] });

    const outside = harness({ windowId: () => null });
    await atConfirmation(outside);
    await outside.flow.submit();
    expect(outside.starts).toEqual([]);
    expect(outside.flow.snapshot().refusals).toEqual([{ field: null, message: "Importar só funciona no app do Prism." }]);
  });
});
