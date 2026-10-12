-- Carga dos testes dos drivers (DatabaseClientContractTests), no Db2. Equivale à do PostgreSQL (postgres.sql).
-- Roda dentro do contêiner, pelo processador de comandos do próprio Db2 (`db2 -tsf`), com `;` no fim de cada comando.
-- Os testes só leem estas tabelas; o que um teste cria ou altera, ele mesmo desfaz.
--
-- Os nomes sem aspas ficam em maiúsculas no catálogo (LOJA, PEDIDO, NUMERO): é como o Db2 guarda um identificador escrito
-- sem aspas, e é o que o driver devolve.

CONNECT TO prism;

CREATE SCHEMA loja;

CREATE TABLE loja.cliente (
    id   INTEGER     NOT NULL,
    nome VARCHAR(80) NOT NULL,
    CONSTRAINT pk_cliente PRIMARY KEY (id)
);

CREATE TABLE loja.pedido (
    id         INTEGER        NOT NULL,
    numero     INTEGER        NOT NULL,
    cliente_id INTEGER        NOT NULL,
    valor      DECIMAL(12, 2) NOT NULL,
    criado_em  TIMESTAMP      NOT NULL,
    observacao VARCHAR(200),
    CONSTRAINT pk_pedido PRIMARY KEY (id),
    CONSTRAINT fk_pedido_cliente FOREIGN KEY (cliente_id) REFERENCES loja.cliente (id)
);

CREATE UNIQUE INDEX loja.uk_pedido_numero ON loja.pedido (numero);

-- Índice de duas colunas e não único: prova a ordem das colunas de um índice.
CREATE INDEX loja.ix_pedido_cliente_data ON loja.pedido (cliente_id, criado_em);

CREATE VIEW loja.pedido_resumo AS
SELECT cliente_id,
       COUNT(*) AS pedidos,
       SUM(valor) AS total
  FROM loja.pedido
 GROUP BY cliente_id;

CREATE FUNCTION loja.dobro (valor INTEGER) RETURNS INTEGER RETURN valor * 2;

-- O contador de execuções da consulta contada (uma sequência não é tabela, visão nem rotina: não aparece na árvore).
CREATE SEQUENCE loja.execucoes;

-- Nome com aspa simples, aspas duplas e espaço, e em minúsculas: as consultas de catálogo o recebem como parâmetro. O Db2 dá
-- um nome gerado ao índice de uma chave primária; criado antes, com nome, o índice único é o que a chave passa a usar.
CREATE TABLE loja."O'Brien ""x""" (
    id              INTEGER NOT NULL,
    "nome completo" VARCHAR(40)
);

CREATE UNIQUE INDEX loja."pk_O'Brien" ON loja."O'Brien ""x""" (id);

ALTER TABLE loja."O'Brien ""x""" ADD CONSTRAINT "pk_O'Brien" PRIMARY KEY (id);

INSERT INTO loja.cliente (id, nome)
WITH numeros (numero) AS (SELECT 1 FROM SYSIBM.SYSDUMMY1 UNION ALL SELECT numero + 1 FROM numeros WHERE numero < 10)
SELECT numero, 'Cliente ' || numero
  FROM numeros;

INSERT INTO loja.pedido (id, numero, cliente_id, valor, criado_em, observacao)
WITH numeros (numero) AS (SELECT 1 FROM SYSIBM.SYSDUMMY1 UNION ALL SELECT numero + 1 FROM numeros WHERE numero < 1000)
SELECT numero,
       1000 + numero,
       1 + MOD(numero, 10),
       numero * 1.5,
       TIMESTAMP('2026-01-01-00.00.00') + numero MINUTES,
       CASE WHEN MOD(numero, 7) = 0 THEN NULL ELSE 'Pedido ' || numero END
  FROM numeros;

CONNECT RESET;
