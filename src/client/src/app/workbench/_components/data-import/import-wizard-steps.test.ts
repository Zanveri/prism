import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultImportChoices } from "../../_lib/data-import/import-choices";
import type { ImportPreview, ImportRead, ImportTable } from "../../_lib/data-import/imports.schema";
import { ConvertedPreview, FileField, FilePreview, FileStep, LoadStep, MappingStep, targetOptions } from "./import-wizard-steps";

const noop = () => {};
const markup = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

const read: ImportRead = {
  encoding: { name: "utf-8", bom: true },
  delimiter: ";",
  listKey: null,
  sheets: null,
  sheet: null,
  columns: ["id", "nome", "obs"],
  shownColumns: 2,
  rows: [
    { line: 2, values: ["1", "São Paulo", null], short: false },
    { line: 3, values: ["2", null, null], short: true },
  ],
};

const table: ImportTable = {
  schema: "estoque",
  name: "pedido",
  oneAtATime: false,
  columns: [
    { name: "id", type: "integer", nullable: false, defaultValue: null, generated: null, class: "number", importable: true, reason: null },
    { name: "soma", type: "integer", nullable: true, defaultValue: null, generated: "always", class: "number", importable: true, reason: null },
    { name: "preco", type: "money", nullable: true, defaultValue: null, generated: null, class: "other", importable: true, reason: null },
  ],
  referencedBy: [],
};

describe("o campo do arquivo (RN-IMPORT-003)", () => {
  it("a cópia: \"Copiando pedidos.csv… 45%\", com o nome isolado, a barra de progresso e \"Cancelar\"", () => {
    const html = markup(createElement(FileField, { source: { status: "copying", fileId: "x", fileName: "pedidos.csv", size: 100, copied: 45 }, onChoose: noop, onCancelCopy: noop }));
    expect(html).toContain("Copiando <bdi>pedidos.csv</bdi>… 45%");
    expect(html).toMatch(/role="progressbar" aria-label="Cópia de pedidos.csv" aria-valuemin="0" aria-valuemax="100" aria-valuenow="45"/);
    expect(html).toContain(">Cancelar<");
  });

  it("pronto: o nome com o tamanho e \"Trocar arquivo…\"; a recusa fica no campo, ligada ao botão", () => {
    expect(markup(createElement(FileField, { source: { status: "ready", fileId: "x", fileName: "pedidos.csv", size: 1258291, copied: 0 } as never, onChoose: noop, onCancelCopy: noop }))).toContain("<bdi>pedidos.csv</bdi> · 1,2 MB");
    const refused = markup(createElement(FileField, { source: { status: "none", problem: "O arquivo tem 2,4 GB, e o Prism importa até 2 GB." }, onChoose: noop, onCancelCopy: noop }));
    expect(refused).toContain("Escolher arquivo…");
    expect(refused).toContain("O arquivo tem 2,4 GB, e o Prism importa até 2 GB.");
    expect(refused).toMatch(/aria-describedby="[^"]+"/);
  });

  it("o que segura o \"Avançar\" fica à vista no campo: escolher o arquivo e esperar a cópia (RN-IMPORT-002)", () => {
    const none = markup(createElement(FileField, { source: { status: "none", problem: null }, onChoose: noop, onCancelCopy: noop }));
    expect(none).toContain("Escolha o arquivo a importar.");
    expect(none).toMatch(/aria-describedby="[^"]+"/);
    const copying = markup(createElement(FileField, { source: { status: "copying", fileId: "x", fileName: "pedidos.csv", size: 100, copied: 45 }, onChoose: noop, onCancelCopy: noop }));
    expect(copying).toContain("Espere a cópia do arquivo terminar.");
  });

  it("com o diálogo do sistema aberto, o campo continua o de antes, com o botão em aria-disabled (o mesmo botão, que não perde o foco)", () => {
    const html = markup(
      createElement(FileField, { source: { status: "choosing", before: { status: "ready", fileId: "x", fileName: "pedidos.csv", size: 1258291 } }, onChoose: noop, onCancelCopy: noop }),
    );
    expect(html).toContain("<bdi>pedidos.csv</bdi> · 1,2 MB");
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>.*Trocar arquivo…/);
    expect(html).not.toContain(" disabled=");
    const first = markup(createElement(FileField, { source: { status: "choosing", before: { status: "none", problem: null } }, onChoose: noop, onCancelCopy: noop }));
    expect(first).toMatch(/<button[^>]*aria-disabled="true"[^>]*>.*Escolher arquivo…/);
  });
});

describe("a etapa Arquivo e a prévia do arquivo (RN-IMPORT-004 a 007)", () => {
  const props = {
    source: { status: "ready" as const, fileId: "x", fileName: "pedidos.csv", size: 10 },
    format: "csv" as const,
    choices: defaultImportChoices(),
    sheet: null,
    read: { status: "done" as const, read },
    shown: read,
    problems: {},
    nullText: "NULL",
    onChoose: noop,
    onCancelCopy: noop,
    onFormat: noop,
    onCsv: noop,
    onTsv: noop,
    onXlsx: noop,
    onSheet: noop,
    onValues: noop,
    onRetryRead: noop,
  };

  it("o formato numa escolha de uma, o que a leitura achou ao lado do campo e as opções do CSV, com o apóstrofo da proteção ligado e a dica dele", () => {
    const html = markup(createElement(FileStep, props));
    expect(html).toMatch(/aria-pressed="true"[^>]*>CSV</);
    expect(html).toContain("Detectada: UTF-8 com BOM");
    expect(html).toContain("Detectado: ponto e vírgula");
    expect(html).toContain("Tirar o apóstrofo da proteção contra fórmula");
    expect(html).toContain("O Exportar CSV do Prism põe um apóstrofo");
    expect(html).toContain("UTF-8 com BOM · ponto e vírgula · 3 colunas");
    // "Aceitar o ponto como separador de milhar" só aparece com a vírgula decimal.
    expect(html).not.toContain("Aceitar o ponto como separador de milhar");
    const comma = markup(createElement(FileStep, { ...props, choices: { ...props.choices, values: { decimal: "comma", thousandsDot: false, dates: "iso" } } }));
    expect(comma).toContain("Aceitar o ponto como separador de milhar");
  });

  it("a prévia: a linha do arquivo à esquerda, o nulo como o da grade, as colunas que não cabem ditas embaixo, a linha completada no tom de atenção", () => {
    const html = markup(createElement(FilePreview, { format: "csv", read, header: true, nullText: "[NULL]" }));
    expect(html).toContain(">2<");
    expect(html).toContain("São Paulo");
    expect(html).toContain("[NULL]");
    expect(html).toContain("A outra coluna não aparece na prévia.");
    expect(html).toContain("A linha 3 tem 1 valor, e o cabeçalho tem 3: os que faltam vão como nulo.");
    expect(html).toContain("bg-accent/10");
  });

  it("a recusa da leitura fica no lugar da prévia", () => {
    const html = markup(createElement(FileStep, { ...props, read: { status: "refused" as const, message: "O JSON não é UTF-8 válido: erro na linha 3 do arquivo.", field: null }, shown: null }));
    expect(html).toContain("O JSON não é UTF-8 válido: erro na linha 3 do arquivo.");
    expect(html).toContain('role="alert"');
  });
});

describe("o Mapeamento (RN-IMPORT-009 a 011)", () => {
  const mappingProps = {
    copy: false,
    place: { schema: "estoque", table: "pedido" },
    engine: 1 as const,
    table,
    sources: [
      { name: "Id", first: "1" },
      { name: "NOME", first: null },
    ],
    targets: ["id", null],
    ambiguous: new Set<number>(),
    loading: null,
    refusal: null,
    moved: null,
    busy: false,
    warnings: [],
    problem: null,
    onTarget: noop,
    onByName: noop,
    onNone: noop,
    onRetry: noop,
  };

  it("os títulos da lista (a coluna do arquivo, ou da origem na cópia, a coluna da tabela e o tipo), e cada linha fora da vista não é desenhada", () => {
    const html = markup(createElement(MappingStep, mappingProps));
    expect(html).toContain(">Coluna do arquivo<");
    expect(html).toContain(">Coluna da tabela<");
    expect(html).toContain(">Tipo<");
    expect(html.match(/<li class="[^"]*\[content-visibility:auto\]/g)).toHaveLength(2);
    expect(markup(createElement(MappingStep, { ...mappingProps, copy: true }))).toContain(">Coluna da origem<");
  });

  it("o que a etapa espera vai à linha de estado, e não no tom de erro; embaixo da lista, só a recusa do mapeamento", () => {
    const waiting = markup(createElement(MappingStep, { ...mappingProps, loading: "Atualizando a prévia…" }));
    expect(waiting).toMatch(/role="status"[^>]*>Atualizando a prévia…</);
    expect(waiting).not.toContain("text-danger");
    const none = markup(createElement(MappingStep, { ...mappingProps, targets: [null, null], problem: "Escolha ao menos uma coluna da tabela para receber valores." }));
    expect(none).toMatch(/class="text-xs text-danger"[^>]*>Escolha ao menos uma coluna da tabela para receber valores.</);
  });

  it("ocupada (o automático a caminho), os botões e as escolhas ficam em aria-disabled, sem perder o foco", () => {
    const html = markup(createElement(MappingStep, { ...mappingProps, busy: true }));
    expect(html).toMatch(/aria-disabled="true"[^>]*>Mapear pelo nome</);
    expect(html).toMatch(/aria-disabled="true"[^>]*>Não importar nenhuma</);
    expect(html.match(/role="combobox"[^>]*aria-disabled="true"/g)).toHaveLength(2);
    expect(html).not.toMatch(/ disabled=""/);
  });

  it("as escolhas: \"Não importar\" e as colunas da tabela com o tipo e a marca; a calculada e a de tipo que não se importa desabilitadas com o motivo; a nota do money", () => {
    const options = targetOptions(table, 1);
    expect(options.map((option) => option.label)).toEqual(["Não importar", "id", "soma", "preco"]);
    expect(options[1]).toMatchObject({ disabled: false, hint: "integer · obrigatória" });
    expect(options[2]).toMatchObject({ disabled: true, hint: "integer · calculada pelo banco — O banco calcula esta coluna e não aceita valor." });
    expect(options[3].hint).toBe("money — O banco lê este valor no formato de moeda do servidor.");
  });

  it("a lista: o nome de cada coluna do arquivo com o primeiro valor, a escolha com o nome acessível, o que fica com o padrão e os avisos", () => {
    const html = markup(
      createElement(MappingStep, {
        copy: false,
        place: { schema: "estoque", table: "pedido" },
        engine: 1,
        table,
        sources: [
          { name: "Id", first: "1" },
          { name: "NOME", first: null },
        ],
        targets: ["id", null],
        ambiguous: new Set([1]),
        loading: null,
        refusal: null,
        moved: "id deixou de receber Código.",
        busy: false,
        warnings: ["um aviso"],
        problem: null,
        onTarget: noop,
        onByName: noop,
        onNone: noop,
        onRetry: noop,
      }),
    );
    expect(html).toContain('aria-label="Coluna da tabela para Id"');
    expect(html).toContain("Mais de uma coluna da tabela casa com este nome.");
    expect(html).toContain("id deixou de receber Código.");
    expect(html).toContain("Ficam com o padrão da tabela:");
    expect(html).toContain("calculada pelo banco");
    expect(html).toContain("um aviso");
    expect(html).toContain("Mapear pelo nome");
    expect(html).toContain("Não importar nenhuma");
  });

  it("a recusa da tabela no lugar da lista, com \"Tentar de novo\" na falha do banco", () => {
    const html = markup(
      createElement(MappingStep, {
        copy: false,
        place: { schema: "estoque", table: "pedido" },
        engine: 1,
        table: null,
        sources: [],
        targets: null,
        ambiguous: new Set<number>(),
        loading: null,
        refusal: { message: "password authentication failed (SQLSTATE 28P01)", retry: true },
        moved: null,
        busy: false,
        warnings: [],
        problem: null,
        onTarget: noop,
        onByName: noop,
        onNone: noop,
        onRetry: noop,
      }),
    );
    expect(html).toContain("password authentication failed (SQLSTATE 28P01)");
    expect(html).toContain("Tentar de novo");
  });

  it("a prévia convertida: o resumo, o que ela confere, a célula que não converte no tom de erro com o motivo, e a linha com problema marcada inteira", () => {
    const preview: ImportPreview = {
      table,
      columns: ["id"],
      mapping: [{ source: 0, target: "id" }],
      shownColumns: 1,
      rows: [
        { line: 2, problem: null, short: false, cells: [{ value: "1", problem: null }] },
        { line: 3, problem: null, short: false, cells: [{ value: "12a", problem: "«12a» não é um número inteiro." }] },
        { line: 4, problem: "A linha 4 tem 7 valores, e o cabeçalho tem 5.", short: false, cells: [{ value: null, problem: null }] },
      ],
    };
    const html = markup(createElement(ConvertedPreview, { preview, engine: 2, nullText: "NULL", loading: false }));
    expect(html).toContain("2 valores das 3 primeiras linhas não convertem: a importação vai parar na linha 3 do arquivo.");
    expect(html).toContain("A prévia confere a conversão dos valores. O tamanho, as restrições e as chaves, o banco confere ao gravar.");
    expect(html).toContain('title="«12a» não é um número inteiro."');
    expect(html).toContain("Problema da linha: A linha 4 tem 7 valores, e o cabeçalho tem 5.");
  });
});

describe("a etapa Carga (RN-IMPORT-012 e 025)", () => {
  const base = { copy: false, table, engine: 1 as const, empty: false, commit: { commit: "every" as const, commitEvery: "10000" }, check: true, problem: null, onEmpty: noop, onCommit: noop, onCheck: noop };

  it("\"Esvaziar\" com a dica, o \"Commit\" com o N, a conferência do arquivo e o que acontece quando uma linha falha", () => {
    const html = markup(createElement(LoadStep, base));
    expect(html).toContain("Esvaziar a tabela antes de importar");
    expect(html).toContain("com um DELETE sem WHERE");
    expect(html).toContain('value="10000"');
    expect(html).toContain("Tudo numa transação só");
    expect(html).toContain("Conferir o arquivo inteiro antes de gravar");
    expect(html).toContain("A importação para na primeira linha que falhar");
  });

  it("na cópia, sem a conferência; no Informix sem log, o \"Commit\" desabilitado e a frase; no Informix, a nota de uma linha por comando", () => {
    const html = markup(createElement(LoadStep, { ...base, copy: true, check: null, engine: 3, table: { ...table, oneAtATime: true } }));
    expect(html).toContain("Esvaziar a tabela antes de copiar");
    expect(html).not.toContain("Conferir o arquivo inteiro antes de gravar");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain("Este banco não tem log de transação");
    expect(html).toContain("No Informix cada linha vai num comando");
  });
});
