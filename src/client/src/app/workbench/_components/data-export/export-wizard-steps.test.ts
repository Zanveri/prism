import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultOptions } from "../../_lib/data-export/export-options";
import { ConfirmationStep, ExportConnection, ExtractionStep, FormatStep, FormattingStep, OutputStep } from "./export-wizard-steps";

const noop = () => {};
const markup = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("a etapa Formato (RN-EXPORT-004)", () => {
  const html = markup(createElement(FormatStep, { format: "json", idPrefix: "fmt", onChoose: noop, onAdvance: noop }));

  it("uma lista de escolha única com os dez formatos na ordem, o escolhido marcado e o único no Tab", () => {
    expect(html).toContain('role="listbox"');
    const names = [...html.matchAll(/<span class="font-medium text-ink">([^<]+)/g)].map((match) => match[1].trim());
    expect(names).toEqual(["CSV", "Código fonte", "DbUnit", "HTML", "JSON", "Markdown", "SQL", "TXT", "XLSX", "XML", "Banco de dados"]);
    expect(html).toMatch(/id="fmt-json" role="option" aria-selected="true" tabindex="0"/);
    expect(html).toMatch(/id="fmt-csv" role="option" aria-selected="false" tabindex="-1"/);
  });

  it("\"Banco de dados\" vem separado por uma linha e se escolhe como os outros (RN-IMPORT-022); escolhido, ele é o único no Tab", () => {
    expect(html).toContain('role="separator"');
    expect(html).toMatch(/id="fmt-database" role="option" aria-selected="false" tabindex="-1"/);
    expect(html).not.toContain("Em breve");
    expect(html).not.toContain("aria-disabled");

    const database = markup(createElement(FormatStep, { format: "json", database: true, idPrefix: "fmt", onChoose: noop, onAdvance: noop }));
    expect(database).toMatch(/id="fmt-database" role="option" aria-selected="true" tabindex="0"/);
    expect(database).toMatch(/id="fmt-json" role="option" aria-selected="false" tabindex="-1"/);
    expect(database).toContain("Copiar as linhas para uma tabela que já existe, nesta ou em outra conexão.");
  });
});

describe("a etapa Extração (RN-EXPORT-005)", () => {
  it("as colunas com o nome e o tipo, todas marcadas ao abrir; o nome repetido aparece repetido; a origem só para ver", () => {
    const html = markup(
      createElement(ExtractionStep, {
        origin: { kind: "records", schema: "estoque", name: "pedido", sql: "SELECT …", filter: "id > 1" },
        columns: [
          { name: "id", type: "integer" },
          { name: "id", type: "integer" },
        ],
        loadError: null,
        onRetry: noop,
        checked: [true, true],
        onToggle: noop,
        onAll: noop,
        count: true,
        onCount: noop,
        problem: null,
      }),
    );
    expect(html.match(/checked=""/g)).toHaveLength(3);
    expect(html.match(/>id</g)).toHaveLength(2);
    expect(html).toContain("Filtro e ordem da aba:");
    expect(html).toContain("id &gt; 1");
    expect(html).toContain("A origem é lida duas vezes: uma para contar, outra para exportar.");
  });

  it("na cópia de Db2 ou de Informix no mesmo banco (RN-IMPORT-023), \"Contar as linhas antes\" fica ligada e travada, com o motivo no lugar da dica", () => {
    const base = { origin: { kind: "table" as const, view: false, schema: "estoque", name: "pedido" }, columns: [{ name: "id", type: "INTEGER" }], loadError: null, checked: [true], onRetry: noop, onToggle: noop, onAll: noop, onCount: noop, problem: null };
    const locked = markup(createElement(ExtractionStep, { ...base, count: false, countLocked: "A origem e o destino estão no mesmo banco: a contagem é obrigatória." }));
    expect(locked).toMatch(/<input type="checkbox" disabled=""[^>]*checked=""\/><span>Contar as linhas antes/);
    expect(locked).toContain("A origem e o destino estão no mesmo banco: a contagem é obrigatória.");
    expect(locked).not.toContain("A origem é lida duas vezes");

    const free = markup(createElement(ExtractionStep, { ...base, count: false }));
    expect(free).not.toContain('disabled=""');
  });

  it("na tabela pelo navegador: lendo as colunas, e a falha com a mensagem do banco e \"Tentar de novo\"", () => {
    const base = { origin: { kind: "table" as const, view: false, schema: "estoque", name: "pedido" }, onRetry: noop, onToggle: noop, onAll: noop, count: true, onCount: noop, problem: null };
    expect(markup(createElement(ExtractionStep, { ...base, columns: null, loadError: null, checked: null }))).toContain("Lendo as colunas…");
    const failed = markup(createElement(ExtractionStep, { ...base, columns: null, loadError: 'permission denied for table "pedido"', checked: null }));
    expect(failed).toContain("permission denied for table &quot;pedido&quot;");
    expect(failed).toContain("Tentar de novo");
  });

  it("sem nenhuma coluna marcada, \"Marque ao menos uma coluna.\" aparece na etapa e descreve cada caixa: o \"Avançar\" desabilitado não recebe o foco", () => {
    const html = markup(
      createElement(ExtractionStep, {
        origin: { kind: "table", view: false, schema: "estoque", name: "pedido" },
        columns: [
          { name: "id", type: "integer" },
          { name: "cliente", type: "text" },
        ],
        loadError: null,
        onRetry: noop,
        checked: [false, false],
        onToggle: noop,
        onAll: noop,
        count: true,
        onCount: noop,
        problem: "Marque ao menos uma coluna.",
      }),
    );
    const id = /<p class="text-xs text-danger" id="([^"]+)">Marque ao menos uma coluna\.<\/p>/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html.match(new RegExp(`type="checkbox"[^>]*aria-describedby="${id}"`, "g"))).toHaveLength(2);
  });
});

describe("a etapa Formatação (RN-EXPORT-006 a 013)", () => {
  it("no Informix, as linhas por comando ficam em 1, desabilitadas, com o motivo", () => {
    const html = markup(createElement(FormattingStep, { format: "sql", options: defaultOptions({ schema: "s", table: "t" }), onChange: noop, problems: {}, informix: true, showGenerated: true, onReset: noop }));
    expect(html).toMatch(/disabled="" inputMode="numeric"[^>]*value="1"/);
    expect(html).toContain("O Informix não aceita várias linhas num INSERT.");
    expect(html).toContain("Incluir as colunas que o banco calcula");
  });

  it("no resultado de uma consulta, \"Incluir as colunas que o banco calcula\" não aparece; a recusa fica no campo", () => {
    const html = markup(createElement(FormattingStep, { format: "sql", options: defaultOptions({ schema: "", table: "" }), onChange: noop, problems: { "options.table": "Informe a tabela de destino." }, informix: false, showGenerated: false, onReset: noop }));
    expect(html).not.toContain("Incluir as colunas que o banco calcula");
    expect(html).toContain("Informe a tabela de destino.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("nos Registros, sem saber quais colunas o banco calcula, o motivo fica em \"Incluir as colunas que o banco calcula\", com \"Tentar de novo\" quando a leitura falhou", () => {
    const base = { format: "sql" as const, options: defaultOptions({ schema: "s", table: "t" }), onChange: noop, informix: false, showGenerated: true, onReset: noop };
    const failed = markup(createElement(FormattingStep, { ...base, problems: { "options.includeGenerated": 'permission denied for table "pedido"' }, onRetryGenerated: noop }));
    const id = /<p class="text-xs text-danger" id="([^"]+)">permission denied for table &quot;pedido&quot;<\/p>/.exec(failed)?.[1];
    expect(id).toBeDefined();
    expect(failed).toMatch(new RegExp(`type="checkbox"[^>]*aria-describedby="${id}"`));
    expect(failed).toContain("Tentar de novo");

    const loading = markup(createElement(FormattingStep, { ...base, problems: { "options.includeGenerated": "Lendo as colunas…" } }));
    expect(loading).toContain("Lendo as colunas…");
    expect(loading).not.toContain("Tentar de novo");
  });

  it("todo formato menos o SQL tem o \"Binário\", e todos têm \"Voltar aos padrões\"", () => {
    for (const format of ["csv", "txt", "html", "markdown", "json", "sourceCode", "xml", "dbUnit", "xlsx"] as const) {
      const html = markup(createElement(FormattingStep, { format, options: defaultOptions({ schema: "s", table: "t" }), onChange: noop, problems: {}, informix: false, showGenerated: false, onReset: noop }));
      expect(html, format).toContain("Binário");
      expect(html, format).toContain("Voltar aos padrões");
    }
  });
});

describe("a etapa Saída (RN-EXPORT-014)", () => {
  const output = { pattern: "${tabela}_${data}_${hora}", bom: true, zip: false, reveal: false, clipboard: false };

  it("o nome que sairia agora, embaixo do campo, e a codificação UTF-8", () => {
    const html = markup(createElement(OutputStep, { format: "csv", choices: output, onChange: noop, preview: "pedido_2026-10-16_143005.csv", problem: null }));
    expect(html).toContain("Sai como pedido_2026-10-16_143005.csv");
    expect(html).toContain("UTF-8");
  });

  it("no XLSX, o BOM, o .zip e a área de transferência ficam desabilitados, com os motivos", () => {
    const html = markup(createElement(OutputStep, { format: "xlsx", choices: { ...output, clipboard: true }, onChange: noop, preview: "pedido.xlsx", problem: null }));
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("O XLSX já é um arquivo compactado.");
    expect(html).toContain("O XLSX não é texto: não vai para a área de transferência.");
  });

  it("com a área de transferência, o nome, o BOM, o .zip e o \"Mostrar na pasta\" ficam desabilitados", () => {
    const html = markup(createElement(OutputStep, { format: "csv", choices: { ...output, clipboard: true }, onChange: noop, preview: "x", problem: null }));
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).not.toContain("Sai como");
  });
});

describe("a etapa Confirmação (RN-EXPORT-015)", () => {
  it("as recusas no alto (um alerta), o resumo em rótulo e valor, e os avisos", () => {
    const html = markup(
      createElement(ConfirmationStep, {
        refusals: [{ field: null, message: "A conexão não existe mais." }],
        lines: [
          { label: "Origem", value: "Todas as linhas de estoque.pedido" },
          { label: "Formato", value: "CSV · ponto e vírgula" },
        ],
        warnings: ["As linhas são lidas de novo, numa conexão à parte: o arquivo traz o que o banco tem agora, e não o que a grade mostra."],
      }),
    );
    expect(html.indexOf("A conexão não existe mais.")).toBeLessThan(html.indexOf("Origem"));
    expect(html).toContain('role="alert"');
    expect(html).toContain("<dt");
    expect(html).toContain("As linhas são lidas de novo");
  });

  it("a linha \"Conexão\" tem a etiqueta do banco, o nome e o banco de dados, o ambiente e o cadeado do somente leitura, como o cabeçalho", () => {
    const connection = createElement(ExportConnection, { engine: 1, name: "Produção ERP", database: "erp", environment: { name: "Produção", color: "red", folder: null }, readOnlyHint: "Somente leitura pela pasta Clientes." });
    const html = markup(createElement(ConfirmationStep, { refusals: [], lines: [{ label: "Conexão", value: connection }], warnings: [] }));
    const row = html.slice(html.indexOf("<dd"));
    expect(row).toContain("PG");
    expect(row).toContain("Produção ERP");
    expect(row).toContain("· erp");
    expect(row).toContain("Produção</");
    expect(row).toContain('title="Somente leitura pela pasta Clientes."');
    expect(row).toContain("Somente leitura</span>");

    const plain = markup(createElement(ExportConnection, { engine: 1, name: "Local", database: "loja", environment: null, readOnlyHint: null }));
    expect(plain).not.toContain("Somente leitura");
  });
});
