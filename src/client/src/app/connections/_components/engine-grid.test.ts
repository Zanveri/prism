import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A grade com os ganchos do React simulados (`createHookRuntime`): o foco itinerante é estado, e o vitest deste projeto não tem DOM.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import type { Engine } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import clickhouseLogo from "@/assets/databases/clickhouse.svg";
import duckdbLogo from "@/assets/databases/duckdb.svg";
import mariadbLogo from "@/assets/databases/mariadb.svg";
import mysqlLogo from "@/assets/databases/mysql.svg";
import postgresqlLogo from "@/assets/databases/postgresql.png";
import sqliteLogo from "@/assets/databases/sqlite.svg";

import { engineChoices } from "../_lib/engine-choices";
import { EngineGrid, EngineSummary } from "./engine-grid";

const license = { name: "Licença", url: "https://exemplo.local/licenca" };
const base: Driver = { id: "x", name: "x", vendor: "v", engines: [], state: "available", version: "1.0.0", sizeBytes: 1, license, platformNote: null, progress: null, error: null, restartRequired: false };
const catalog: Driver[] = [
  { ...base, id: "postgresql", name: "PostgreSQL", engines: [1], state: "bundled", license: null },
  { ...base, id: "ibm-data-server", name: "IBM Data Server", engines: [2, 3] },
  { ...base, id: "sqlite", name: "SQLite", state: "comingSoon", version: null, license: null },
  { ...base, id: "oracle", name: "Oracle", state: "comingSoon", version: null, license: null },
];
const choices = engineChoices(catalog);

const markupOf = (value: Engine | null, list = choices) => {
  rt.unmount();
  return rt.render(() => renderToStaticMarkup(createElement(EngineGrid, { choices: list, value, onChange: () => {}, onPick: () => {} })));
};

function drawn(value: Engine | null, handlers: { onChange?: (engine: Engine) => void; onPick?: (engine: Engine) => void } = {}) {
  const tree = rt.render(() => EngineGrid({ choices, value, onChange: handlers.onChange ?? (() => {}), onPick: handlers.onPick ?? (() => {}) }));
  const all = elementsOf(tree);
  return { grid: all.find((element) => element.props.role === "radiogroup") as Found, items: all.filter((element) => element.props.role === "radio") };
}

/** A tecla na grade, com o item `from` com o foco e a grade em `columns` colunas. */
function press(grid: Found, key: string, from: number, columns = 4) {
  const elements = choices.map(() => ({ focus: vi.fn() }));
  const preventDefault = vi.fn();
  (grid.props.onKeyDown as (event: unknown) => void)({ key, target: elements[from], currentTarget: { querySelectorAll: () => elements, ownerDocument: { defaultView: { getComputedStyle: () => ({ gridTemplateColumns: Array(columns).fill("150px").join(" ") }) } } }, preventDefault });
  return { elements, preventDefault };
}

describe("a grade de bancos do diálogo de nova conexão (RN-NAV-005)", () => {
  it("é um grupo de escolha única com nome, e cada banco do catálogo é uma opção com a marca, o nome e o estado do driver", () => {
    const markup = markupOf(null);

    expect(markup).toMatch(/<div[^>]*role="radiogroup"[^>]*aria-label="Banco de dados"/);
    expect([...markup.matchAll(/<div[^>]*role="radio"[^>]*>/g)]).toHaveLength(5);
    expect(markup).toMatch(new RegExp(`<img[^>]*src="${postgresqlLogo}"[^>]*>[\\s\\S]*?>PostgreSQL</span>[\\s\\S]*?>Driver embutido</span>`));
    for (const [tag, name, state] of [["DB2", "Db2", "Driver não instalado"], ["IFX", "Informix", "Driver não instalado"]]) {
      expect(markup).toMatch(new RegExp(`>${tag}</span>[\\s\\S]*?>${name}</span>[\\s\\S]*?>${state}</span>`));
    }
  });

  it("o 'em breve' e o sem driver para a plataforma aparecem desabilitados, com o motivo ligado como descrição", () => {
    const markup = markupOf(null);
    const sqlite = /<div[^>]*role="radio"[^>]*>(?=[\s\S]*?>SQLite<)/.exec(markup.slice(markup.indexOf("Informix")))?.[0] ?? "";

    expect(sqlite).toContain('aria-disabled="true"');
    const described = /aria-describedby="([^"]*)"/.exec(sqlite)?.[1] ?? "";
    expect(markup).toMatch(new RegExp(`id="${described}"[^>]*>[\\s\\S]*?O Prism ainda não conecta neste banco.`));
  });

  it("o escolhido vem marcado; uma parada de tabulação só: o escolhido, ou o primeiro que se pode escolher", () => {
    rt.unmount();
    expect(drawn(2).items.map((item) => [item.props["aria-checked"], item.props.tabIndex])).toEqual([
      [false, -1],
      [true, 0],
      [false, -1],
      [false, -1],
      [false, -1],
    ]);

    rt.unmount();
    expect(drawn(null).items.map((item) => item.props.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it("as setas andam nas duas direções e escolhem o banco em que param; o desabilitado recebe o foco (para o motivo ser lido), mas não é escolhido", () => {
    rt.unmount();
    const onChange = vi.fn();
    const { grid } = drawn(1, { onChange });

    const right = press(grid, "ArrowRight", 0);
    expect(right.preventDefault).toHaveBeenCalledOnce();
    expect(right.elements[1].focus).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(2);

    // Em 2 colunas: 0 1 / 2 3 / 4. Para baixo do Db2 (1) é o SQLite (3), desabilitado.
    const down = press(grid, "ArrowDown", 1, 2);
    expect(down.elements[3].focus).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Enter e o duplo clique escolhem e avançam; o Espaço só escolhe; no desabilitado, nada", () => {
    rt.unmount();
    const onChange = vi.fn();
    const onPick = vi.fn();
    const { grid, items } = drawn(null, { onChange, onPick });

    press(grid, "Enter", 2);
    expect(onPick).toHaveBeenLastCalledWith(3);

    press(grid, " ", 0);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onPick).toHaveBeenCalledOnce();

    (items[1].props.onDoubleClick as () => void)();
    expect(onPick).toHaveBeenLastCalledWith(2);

    press(grid, "Enter", 3);
    expect(items[4].props.onDoubleClick).toBeUndefined();
    expect(items[4].props.onClick).toBeUndefined();
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("o clique escolhe, sem avançar", () => {
    rt.unmount();
    const onChange = vi.fn();
    const onPick = vi.fn();
    const { items } = drawn(null, { onChange, onPick });

    (items[2].props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(3);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("outra tecla (o Tab, uma letra) não é da grade: segue para quem a trata", () => {
    rt.unmount();
    const { grid } = drawn(1);

    for (const key of ["Tab", "a", "Escape"]) expect(press(grid, key, 0).preventDefault).not.toHaveBeenCalled();
  });
});

describe("a marca de cada banco na grade (RN-NAV-005, Ruling 136): a logo do fabricante, ou a ficha de hoje onde não há logo", () => {
  const soon = (id: string, name: string): Driver => ({ ...base, id, name, state: "comingSoon", version: null, license: null });
  const everything = engineChoices([...catalog.slice(0, 2), soon("sqlite", "SQLite"), soon("mysql", "MySQL"), soon("mariadb", "MariaDB"), soon("sql-server", "Microsoft SQL Server"), soon("oracle", "Oracle"), soon("firebird", "Firebird"), soon("duckdb", "DuckDB"), soon("clickhouse", "ClickHouse")]);

  /** A marca de uma opção: o primeiro `<span aria-hidden>` dela, com o que tem dentro, até o nome. */
  function markOf(name: string) {
    const markup = markupOf(null, everything);
    const option = [...markup.matchAll(/<div[^>]*role="radio"[^>]*>([\s\S]*?)<\/div>/g)].map((match) => match[1]).find((inner) => inner.includes(`>${name}</span>`)) ?? "";
    return option.slice(0, option.indexOf(`>${name}</span>`));
  }
  const styleOf = (mark: string) => /<span[^>]*aria-hidden="true"[^>]*style="([^"]*)"/.exec(mark)?.[1] ?? "";

  it("o PostgreSQL mostra o arquivo do fabricante, sem nome alternativo (o nome está ao lado), e nos temas escuros fica sobre a ficha clara", () => {
    const mark = markOf("PostgreSQL");

    expect(mark).toMatch(new RegExp(`<img[^>]*src="${postgresqlLogo}"`));
    expect(mark).toMatch(/<img[^>]*alt=""/);
    expect(mark).not.toContain(">PG<");
    expect(styleOf(mark)).toContain("background-color:light-dark(transparent, #FFFFFF)");
  });

  it.each([
    ["SQLite", sqliteLogo, "#003B57", "light-dark(transparent, #FFFFFF)"],
    ["MySQL", mysqlLogo, "#4479A1", "light-dark(transparent, #FFFFFF)"],
    ["MariaDB", mariadbLogo, "#003545", "light-dark(transparent, #FFFFFF)"],
    ["DuckDB", duckdbLogo, "#FFF000", "light-dark(#1B2027, transparent)"],
    ["ClickHouse", clickhouseLogo, "#FFCC01", "light-dark(#1B2027, transparent)"],
  ])("%s: o glifo do arquivo, pintado na cor da marca, e a ficha onde ele some", (name, logo, color, chip) => {
    const mark = markOf(name);

    // O endereço do arquivo, como a marcação o escreve (o SVG pequeno vira `data:`, com as aspas simples escapadas).
    expect(mark).toContain(`mask-image:url(&quot;${logo.replaceAll("'", "&#x27;")}&quot;)`);
    expect(mark).toContain(`background-color:${color}`);
    expect(styleOf(mark)).toContain(`background-color:${chip}`);
    expect(mark).not.toContain("<img");
  });

  it("Db2 e Informix, sem logo em nenhuma das duas fontes, ficam com a ficha colorida de hoje (DB2, IFX)", () => {
    expect(markOf("Db2")).toContain(">DB2</span>");
    expect(markOf("Informix")).toContain(">IFX</span>");
    for (const name of ["Db2", "Informix"]) expect(markOf(name)).not.toMatch(/<img|mask-image/);
  });

  it("SQL Server, Oracle e Firebird, sem logo nas duas fontes, ficam com o desenho genérico de banco de dados de hoje", () => {
    for (const name of ["Microsoft SQL Server", "Oracle", "Firebird"]) {
      const mark = markOf(name);
      expect(mark).toContain("<svg");
      expect(mark).not.toMatch(/<img|mask-image|style=/);
    }
  });

  it("a marca é enfeite para o leitor de tela: o nome do banco é o texto da opção", () => {
    for (const name of ["PostgreSQL", "DuckDB", "Db2", "Oracle"]) expect(markOf(name)).toMatch(/^<span[^>]*aria-hidden="true"/);
  });

  it("o passo das configurações mostra a mesma marca do banco escolhido", () => {
    const postgres = everything.find((choice) => choice.engine === 1);
    const db2 = everything.find((choice) => choice.engine === 2);
    if (postgres === undefined || db2 === undefined) throw new Error("sem PostgreSQL ou Db2 na lista");

    expect(renderToStaticMarkup(createElement(EngineSummary, { choice: postgres }))).toContain(`src="${postgresqlLogo}"`);
    expect(renderToStaticMarkup(createElement(EngineSummary, { choice: db2 }))).toContain(">DB2</span>");
  });
});
