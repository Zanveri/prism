import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { isInsideComment } from "./sql-statements";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

/** `§` marca o caractere que se pergunta: o texto é o que está escrito, sem a marca. */
function inside(marked: string, engine?: Engine): boolean {
  const index = marked.indexOf("§");
  return isInsideComment(marked.replace("§", ""), index, engine);
}

describe("isInsideComment: o caractere está dentro de um comentário, pelas regras do banco da aba (RN-SQL-002)", () => {
  describe("Informix: { ... } também é comentário", () => {
    it("dentro das chaves está dentro; antes e depois delas, não", () => {
      expect(inside("{ do §not select * from x }", informix)).toBe(true);
      expect(inside("{ a } §select", informix)).toBe(false);
      expect(inside("§select { a }", informix)).toBe(false);
      expect(inside("{ a } { b §c }", informix)).toBe(true);
    });

    it("o fim é a primeira chave que fecha, e sem fecho o comentário vai até o fim do texto", () => {
      expect(inside("{ a { b } §select }", informix)).toBe(false);
      expect(inside("{ sem fecho §select", informix)).toBe(true);
    });

    it("a chave dentro de texto entre aspas, de nome entre aspas duplas ou de outro comentário não abre comentário", () => {
      expect(inside("select '{' §from t", informix)).toBe(false);
      expect(inside('select "{" §from t', informix)).toBe(false);
      expect(inside("select 'it''s {' §from t", informix)).toBe(false);
      expect(inside("-- { aberta\n§select", informix)).toBe(false);
      expect(inside("/* { */ §select }", informix)).toBe(false);
    });

    it("o comentário de bloco não aceita outro dentro dele: o primeiro fecho o encerra", () => {
      expect(inside("/* a /* b */ §select */", informix)).toBe(false);
      expect(inside("/* a §b */", informix)).toBe(true);
    });

    it("dentro das chaves a barra-asterisco é texto do comentário: a primeira chave que fecha o encerra", () => {
      expect(inside("{ /* } §select */ }", informix)).toBe(false);
    });
  });

  describe("PostgreSQL e Db2: a chave é um caractere qualquer", () => {
    it.each([
      ["PostgreSQL", postgres],
      ["Db2", db2],
      ["sem banco (vale o PostgreSQL)", undefined],
    ])("%s", (_name, engine) => {
      expect(inside("{ do §not select }", engine)).toBe(false);
      expect(inside("select '{' §from t", engine)).toBe(false);
    });
  });

  describe("o comentário de bloco aceita outro dentro dele no PostgreSQL e no Db2", () => {
    it.each([
      ["PostgreSQL", postgres],
      ["Db2", db2],
      ["sem banco (vale o PostgreSQL)", undefined],
    ])("%s", (_name, engine) => {
      expect(inside("/* a /* b */ §select */ select", engine)).toBe(true);
      expect(inside("/* a /* b */ select */ §select", engine)).toBe(false);
      expect(inside("/* sem fecho §select", engine)).toBe(true);
      expect(inside("select /* a */ §from t", engine)).toBe(false);
    });
  });

  describe("comentário de linha", () => {
    it.each([
      ["PostgreSQL", postgres],
      ["Db2", db2],
      ["Informix", informix],
    ])("%s: vai até o fim da linha, e a linha seguinte é texto", (_name, engine) => {
      expect(inside("-- a §b\nselect", engine)).toBe(true);
      expect(inside("-- a b\n§select", engine)).toBe(false);
      expect(inside("select 1 -- §x", engine)).toBe(true);
      expect(inside("select 1 - §x", engine)).toBe(false);
    });

    it("o retorno de carro acaba o comentário só no PostgreSQL", () => {
      expect(inside("-- a b\r§select", postgres)).toBe(false);
      expect(inside("-- a b\r§select", db2)).toBe(true);
      expect(inside("-- a b\r§select", informix)).toBe(true);
    });
  });

  describe("o que parece comentário e não é", () => {
    it.each([
      ["PostgreSQL", postgres],
      ["Db2", db2],
      ["Informix", informix],
    ])("%s: dentro de texto entre aspas simples ou de nome entre aspas duplas, `--` e a barra-asterisco não abrem nada", (_name, engine) => {
      expect(inside("select '-- §x' from t", engine)).toBe(false);
      expect(inside("select '/* §x' from t", engine)).toBe(false);
      expect(inside('select "-- §x" from t', engine)).toBe(false);
      expect(inside("select 'a' -- §x", engine)).toBe(true);
    });

    it("no PostgreSQL, o corpo $tag$ ... $tag$ é texto: o `--` e a chave dentro dele não abrem comentário; no Db2 o `$` é um caractere qualquer", () => {
      expect(inside("select $q$ -- §x $q$ from t", postgres)).toBe(false);
      expect(inside("select $q$ /* §x $q$ from t", postgres)).toBe(false);
      expect(inside("select $q$ a $q$ -- §x", postgres)).toBe(true);
      expect(inside("select $q$ -- §x $q$ from t", db2)).toBe(true);
    });
  });

  describe("limites", () => {
    it("texto vazio, posição no começo e posição depois do fim não são comentário", () => {
      expect(isInsideComment("", 0, informix)).toBe(false);
      expect(inside("§select", informix)).toBe(false);
      expect(isInsideComment("select", 6, informix)).toBe(false);
      expect(isInsideComment("select", 60, informix)).toBe(false);
    });

    it("o comentário que começa logo depois de um texto entre aspas, de um nome entre aspas duplas ou de um bloco $tag$ vale desde o primeiro caractere", () => {
      expect(inside("select 'a'§-- x", informix)).toBe(true);
      expect(inside("select 'a'§{ x }", informix)).toBe(true);
      expect(inside('select "a"§{ x }', informix)).toBe(true);
      expect(inside("select 'a'§ from t", informix)).toBe(false);
      expect(inside("select $q$ a $q$§-- x", postgres)).toBe(true);
    });

    it("a chave que abre é do comentário; a que fecha também; o caractere logo depois, não", () => {
      expect(inside("§{ a }", informix)).toBe(true);
      expect(inside("{ a §}", informix)).toBe(true);
      expect(inside("{ a }§ select", informix)).toBe(false);
    });
  });
});
