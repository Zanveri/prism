import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseNotes, ReleaseNotes } from "./release-notes";

const render = (text: string) => renderToStaticMarkup(createElement(ReleaseNotes, { text }));

/** Os nomes de todas as tags do HTML gerado. Texto escapado (`&lt;script&gt;`) não é tag. */
const tagsOf = (markup: string) => new Set([...markup.matchAll(/<([a-z][a-z0-9]*)/gi)].map((match) => match[1].toLowerCase()));
/** Os nomes de todos os atributos de todas as tags (os valores, entre aspas, saem antes de os nomes serem lidos). */
const attributesOf = (markup: string) => new Set((markup.match(/<[a-z][^>]*>/gi) ?? []).flatMap((tag) => [...tag.replace(/="[^"]*"/g, "").matchAll(/\s([a-z:-]+)/gi)].map((attribute) => attribute[1].toLowerCase())));

const allowedTags = ["div", "h3", "h4", "ul", "li", "p", "strong", "em", "code", "pre"];

describe("parseNotes: título, lista, parágrafo, ênfase e código (RN-ATUALIZA-004)", () => {
  it("lê as notas como o changelog as escreve", () => {
    const text = ["PostgreSQL funciona. Db2 e Informix", "ainda não.", "", "### Adicionado", "", "- Cofre **cifrado** por usuário (`Argon2id`),", "  com as pastas e as conexões.", "- Árvore de *objetos*.", "", "### Segurança", "", "- A API só escuta em `127.0.0.1`."].join("\n");

    expect(parseNotes(text)).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "PostgreSQL funciona. Db2 e Informix ainda não." }] },
      { kind: "heading", level: 3, content: [{ kind: "text", text: "Adicionado" }] },
      {
        kind: "list",
        items: [
          [{ kind: "text", text: "Cofre " }, { kind: "strong", text: "cifrado" }, { kind: "text", text: " por usuário (" }, { kind: "code", text: "Argon2id" }, { kind: "text", text: "), com as pastas e as conexões." }],
          [{ kind: "text", text: "Árvore de " }, { kind: "em", text: "objetos" }, { kind: "text", text: "." }],
        ],
      },
      { kind: "heading", level: 3, content: [{ kind: "text", text: "Segurança" }] },
      { kind: "list", items: [[{ kind: "text", text: "A API só escuta em " }, { kind: "code", text: "127.0.0.1" }, { kind: "text", text: "." }]] },
    ]);
  });

  it("bloco de código entre cercas fica como veio, sem ênfase dentro", () => {
    expect(parseNotes("```\nSELECT **tudo** FROM `t`;\n  recuado\n```\ndepois")).toEqual([
      { kind: "code", text: "SELECT **tudo** FROM `t`;\n  recuado" },
      { kind: "paragraph", content: [{ kind: "text", text: "depois" }] },
    ]);
  });

  it("cerca que não fecha vale até o fim", () => {
    expect(parseNotes("```sql\nSELECT 1;")).toEqual([{ kind: "code", text: "SELECT 1;" }]);
  });

  it("lista com asterisco e com recuo vira a mesma lista, sem aninhar", () => {
    expect(parseNotes("* um\n  - dois\n      - três")).toEqual([{ kind: "list", items: [[{ kind: "text", text: "um" }], [{ kind: "text", text: "dois" }], [{ kind: "text", text: "três" }]] }]);
  });

  it("os níveis de título viram dois: o da categoria e o de dentro dela", () => {
    expect(parseNotes("# a\n## b\n### c\n#### d\n###### e").map((block) => block.kind === "heading" && block.level)).toEqual([3, 3, 3, 4, 4]);
    expect(parseNotes("#semespaço\n####### sete")).toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "#semespaço ####### sete" }] }]);
  });

  it("marca que não fecha fica como texto", () => {
    expect(parseNotes("2 * 3 e `aberto e **metade")).toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "2 * 3 e `aberto e **metade" }] }]);
  });

  it("texto vazio, só espaços, ou o que não é texto: nada", () => {
    expect(parseNotes("")).toEqual([]);
    expect(parseNotes(" \n\n\t\n")).toEqual([]);
    for (const value of [null, undefined, 42, {}, []]) expect(parseNotes(value as never)).toEqual([]);
  });
});

describe("ReleaseNotes: o que vem da rede é desenhado como texto", () => {
  it("só usa as tags do interpretador, sem atributo que não seja classe", () => {
    const markup = render("Abertura.\n\n### Adicionado\n\n#### Detalhe\n\n- Um `código` e **forte** e *ênfase*.\n\n```\nbloco\n```\n");

    expect([...tagsOf(markup)].sort()).toEqual([...allowedTags].sort());
    expect([...attributesOf(markup)]).toEqual(["class"]);
    expect(markup).toContain("<strong");
    expect(markup).toContain(">forte<");
  });

  const hostile = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<img src="https://evil.example.invalid/pixel.png">',
    '<a href="https://evil.example.invalid">clique</a>',
    '<iframe src="https://evil.example.invalid"></iframe>',
    '<div onclick="alert(1)" style="position:fixed">x</div>',
    "<svg onload=alert(1)>",
    "[clique](javascript:alert(1))",
    "[clique](https://evil.example.invalid)",
    "![imagem](https://evil.example.invalid/a.png)",
    "<https://evil.example.invalid>",
    "https://evil.example.invalid/solto",
    "[ref]: https://evil.example.invalid",
    "- <script>alert(1)</script> na lista",
    "### <img src=x onerror=alert(1)> no título",
    "`<script>alert(1)</script>`",
    '**<a href="javascript:alert(1)">x</a>**',
    "```\n<script>alert(1)</script>\n```",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "<!-- comentário --><style>*{display:none}</style>",
  ];

  it.each(hostile)("%s vira texto", (text) => {
    const markup = render(text);

    for (const tag of tagsOf(markup)) expect(allowedTags).toContain(tag);
    for (const attribute of attributesOf(markup)) expect(attribute).toBe("class");
    // O texto escapado (`&lt;a href=…`) não é tag: só o que está entre `<` e `>` de verdade conta.
    expect(markup).not.toMatch(/<(script|img|a|iframe|svg|style|link|object|embed|form|input|button|video|audio)\b/i);
    for (const tag of markup.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/\s(href|src|srcset|style|on[a-z]+|action|formaction|xlink:href)=/i);
  });

  it("o texto hostil aparece inteiro, escapado, para quem lê", () => {
    expect(render("<script>alert(1)</script>")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(render("[clique](javascript:alert(1))")).toContain("[clique](javascript:alert(1))");
    expect(render("![imagem](https://evil.example.invalid/a.png)")).toContain("![imagem](https://evil.example.invalid/a.png)");
  });
});

describe("entrada enorme ou maliciosa não trava nem estoura a pilha", () => {
  const within = (milliseconds: number, work: () => void) => {
    const started = performance.now();
    work();
    expect(performance.now() - started).toBeLessThan(milliseconds);
  };

  const deep = {
    "citação dentro de citação": "> ".repeat(50_000) + "fundo",
    "lista dentro de lista": Array.from({ length: 20_000 }, (_, depth) => `${" ".repeat(depth % 200)}- item`).join("\n"),
    "itens na mesma linha": "- ".repeat(100_000),
    "asteriscos": "*".repeat(200_000),
    "asteriscos que nunca fecham": "*a ".repeat(100_000),
    "negritos que nunca fecham": "**a ".repeat(100_000),
    "crases": "`".repeat(200_001),
    "crases que nunca fecham": "` a".repeat(100_000) + "`",
    "colchetes e parênteses": "[".repeat(100_000) + "](".repeat(50_000) + ")".repeat(100_000),
    "tags abertas": "<div>".repeat(100_000),
    "cercas": "```\n".repeat(100_001),
    "títulos": "#".repeat(200_000) + " x",
    "uma linha só": "a".repeat(3_000_000),
    "linhas em branco": "\n".repeat(1_000_000),
  };

  it.each(Object.entries(deep))("%s", (_, text) => {
    within(3000, () => expect(Array.isArray(parseNotes(text))).toBe(true));
  });

  // A forma exata que a revisão achou: a linha de título (ou de item) com muito espaço e muito texto, e no meio dela um
  // caractere que o `.` de uma expressão regular não casa. O separador vem seguido de uma letra, porque o `trim` da linha
  // tiraria um que estivesse no fim.
  const separators = { "U+2028": " ", "U+2029": " ", "CR solto": "\r" };
  const hostileLine = (mark: string, separator: string) => `${mark}${" ".repeat(50_000)}${"a".repeat(50_000)}${separator}a`;

  it.each(Object.entries(separators))("título com 50 mil espaços, 50 mil letras e %s na linha", (_, separator) => {
    within(300, () => expect(parseNotes(hostileLine("#", separator))).toHaveLength(1));
  });

  it.each(Object.entries(separators))("item de lista com 50 mil espaços, 50 mil letras e %s na linha", (_, separator) => {
    within(300, () => expect(parseNotes(hostileLine("-", separator))).toHaveLength(1));
  });

  it("vinte versões no teto de tamanho, todas com essa linha: o diálogo inteiro não passa de um segundo", () => {
    const notes = hostileLine("#", " ");

    within(1000, () => {
      for (let version = 0; version < 20; version += 1) parseNotes(notes);
    });
  });

  it("o separador fica no texto do título, como o caractere que é", () => {
    expect(parseNotes("# antes depois")).toEqual([{ kind: "heading", level: 3, content: [{ kind: "text", text: "antes depois" }] }]);
    expect(parseNotes("- antes\rdepois")).toEqual([{ kind: "list", items: [[{ kind: "text", text: "antes\rdepois" }]] }]);
  });

  it("vários megabytes de notas misturadas", () => {
    const chunk = "### Título\n\nParágrafo com **negrito**, *ênfase*, `código` e <b>html</b>.\n\n- item um\n- item [dois](https://evil.example.invalid)\n\n```\ncódigo\n```\n\n";
    const text = chunk.repeat(Math.ceil(4_000_000 / chunk.length));

    within(5000, () => expect(parseNotes(text).length).toBeGreaterThan(1000));
  });

  it("desenhar um aninhamento fundo também não estoura", () => {
    within(5000, () => expect(render("> ".repeat(20_000) + "fundo\n" + "- ".repeat(20_000))).toContain("fundo"));
  });
});
