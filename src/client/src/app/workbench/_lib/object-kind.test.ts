import { describe, expect, it } from "vitest";

import type { NavNode } from "./navigator-model";
import { objectKindOf } from "./object-kind";

const node = (kind: NavNode["kind"], label: string): NavNode => ({ key: `${kind}:${label}`, kind, label, depth: 0, hasChildren: kind === "table" });

const tables = [node("table", "apontamento"), node("table", "Notas Fiscais")];
const views = [node("view", "v_producao_dia"), node("view", "Visão Estranha")];

describe("objectKindOf: tabela ou visão, pelo que a árvore da conexão já carregou (sem consulta)", () => {
  it("o nome que está no grupo das tabelas é tabela, e o que está no das visões é visão", () => {
    expect(objectKindOf("apontamento", { tables, views })).toBe("table");
    expect(objectKindOf("v_producao_dia", { tables, views })).toBe("view");
  });

  it("basta um dos grupos ter chegado: a visão é achada sem o grupo das tabelas, e a tabela sem o das visões", () => {
    expect(objectKindOf("v_producao_dia", { tables: undefined, views })).toBe("view");
    expect(objectKindOf("apontamento", { tables, views: undefined })).toBe("table");
  });

  it("o nome fica como o catálogo o diz: a caixa e os espaços contam", () => {
    expect(objectKindOf("Notas Fiscais", { tables, views })).toBe("table");
    expect(objectKindOf("notas fiscais", { tables, views })).toBe("unknown");
    expect(objectKindOf("Visão Estranha", { tables, views })).toBe("view");
  });

  it("sem saber (os grupos não chegaram, ou o nome não está em nenhum deles) é desconhecido, e não tabela", () => {
    expect(objectKindOf("apontamento", { tables: undefined, views: undefined })).toBe("unknown");
    // O grupo das visões chegou e o nome não está nele: não é visão, mas também não se sabe que é tabela.
    expect(objectKindOf("apontamento", { tables: undefined, views })).toBe("unknown");
    expect(objectKindOf("sumiu", { tables, views })).toBe("unknown");
  });

  it("só conta o que é do tipo do grupo: uma rotina ou uma coluna de mesmo nome não faz o nome virar tabela nem visão", () => {
    expect(objectKindOf("calcula", { tables: [node("routine", "calcula")], views: [node("column", "calcula")] })).toBe("unknown");
  });
});
