-- Carga dos testes dos drivers (DatabaseClientContractTests), no Informix. Equivale à do PostgreSQL (postgres.sql).
-- Roda dentro do contêiner, pelo `dbaccess`, com DELIMIDENT ligado (aspas duplas são identificador, como na sessão do driver).
-- Os testes só leem estas tabelas; o que um teste cria ou altera, ele mesmo desfaz.
--
-- No Informix "esquema" é o dono do objeto (RN-ARVORE-004): `loja` é o dono de tudo aqui, criado por quem administra o banco.
-- O banco tem log: sem ele não há transação. Os nomes sem aspas ficam em minúsculas no catálogo.

CREATE DATABASE prism WITH LOG;

CREATE TABLE loja.cliente (
    id   INTEGER     NOT NULL,
    nome VARCHAR(80) NOT NULL,
    PRIMARY KEY (id) CONSTRAINT pk_cliente
);

CREATE TABLE loja.pedido (
    id         INTEGER                 NOT NULL,
    numero     INTEGER                 NOT NULL,
    cliente_id INTEGER                 NOT NULL,
    valor      DECIMAL(12, 2)          NOT NULL,
    criado_em  DATETIME YEAR TO SECOND NOT NULL,
    observacao VARCHAR(200),
    PRIMARY KEY (id) CONSTRAINT pk_pedido,
    FOREIGN KEY (cliente_id) REFERENCES loja.cliente (id) CONSTRAINT fk_pedido_cliente
);

CREATE UNIQUE INDEX loja.uk_pedido_numero ON loja.pedido (numero);

-- Índice de duas colunas e não único: prova a ordem das colunas de um índice.
CREATE INDEX loja.ix_pedido_cliente_data ON loja.pedido (cliente_id, criado_em);

CREATE VIEW loja.pedido_resumo (cliente_id, pedidos, total) AS
SELECT pedido.cliente_id,
       COUNT(*),
       SUM(pedido.valor)
  FROM loja.pedido
 GROUP BY pedido.cliente_id;

CREATE FUNCTION loja.dobro (valor INTEGER) RETURNING INTEGER;
    RETURN valor * 2;
END FUNCTION;

-- O contador de execuções da consulta contada (uma sequência não é tabela, visão nem rotina: não aparece na árvore).
CREATE SEQUENCE loja.execucoes;

-- Nome com aspa simples, aspas duplas e espaço: as consultas de catálogo o recebem como parâmetro. O Informix dá um nome
-- gerado ao índice de uma chave primária; criado antes, com nome, o índice único é o que a chave passa a usar.
CREATE TABLE loja."O'Brien ""x""" (
    id              INTEGER NOT NULL,
    "nome completo" VARCHAR(40)
);

CREATE UNIQUE INDEX loja."pk_O'Brien" ON loja."O'Brien ""x""" (id);

ALTER TABLE loja."O'Brien ""x""" ADD CONSTRAINT PRIMARY KEY (id);

-- As dez primeiras tabelas do catálogo têm os identificadores de 1 a 10: servem de fonte de números.
INSERT INTO loja.cliente (id, nome)
SELECT tabid, 'Cliente ' || tabid
  FROM systables
 WHERE tabid <= 10;

INSERT INTO loja.pedido (id, numero, cliente_id, valor, criado_em, observacao)
SELECT numeros.numero,
       1000 + numeros.numero,
       1 + MOD(numeros.numero, 10),
       numeros.numero * 1.5,
       DATETIME (2026-01-01 00:00:00) YEAR TO SECOND + numeros.numero UNITS MINUTE,
       CASE WHEN MOD(numeros.numero, 7) = 0 THEN NULL ELSE 'Pedido ' || numeros.numero END
  FROM (SELECT (centenas.tabid - 1) * 100 + (dezenas.tabid - 1) * 10 + unidades.tabid AS numero
          FROM systables AS centenas, systables AS dezenas, systables AS unidades
         WHERE centenas.tabid <= 10 AND dezenas.tabid <= 10 AND unidades.tabid <= 10) AS numeros;

-- O Informix não tem comando que grave e devolva linhas (`RETURNING`, `FINAL TABLE`): o que há é a função, chamada por
-- `EXECUTE FUNCTION`. Esta grava `versao = 1` em todas as linhas da tabela recebida e devolve o `numero` de cada uma. O dono é
-- outro (`teste`), para a lista de rotinas de `loja` continuar só com `dobro`.
CREATE FUNCTION teste.grava_versao (tabela VARCHAR(128)) RETURNING INTEGER AS numero;
    DEFINE lido INTEGER;

    EXECUTE IMMEDIATE 'UPDATE ' || tabela || ' SET versao = 1';
    PREPARE leitura FROM 'SELECT numero FROM ' || tabela;
    DECLARE linhas CURSOR FOR leitura;
    OPEN linhas;

    WHILE 1 = 1
        FETCH linhas INTO lido;
        IF SQLCODE != 0 THEN
            EXIT WHILE;
        END IF;

        RETURN lido WITH RESUME;
    END WHILE;

    CLOSE linhas;
    FREE linhas;
    FREE leitura;
END FUNCTION;

-- Uma rotina que abre transação por dentro e não a fecha: é a forma de `BEGIN WORK` que a recusa por texto não vê, e que a
-- sonda de transação do driver tem de pegar (RN-SESSAO-005).
CREATE PROCEDURE teste.abre_transacao ();
    BEGIN WORK;
END PROCEDURE;

CREATE FUNCTION teste.abre_transacao_e_devolve () RETURNING INTEGER AS aberta;
    BEGIN WORK;

    RETURN 1;
END FUNCTION;

CLOSE DATABASE;

-- Um banco sem log: nele não existe transação, e `BEGIN WORK`, `COMMIT WORK` e `ROLLBACK WORK` são erro (-256). O driver tem de
-- ler, paginar e gravar nele sem mandar nenhum dos três.
CREATE DATABASE prism_sem_log;

CREATE TABLE numero (
    valor INTEGER NOT NULL
);

INSERT INTO numero (valor)
SELECT (centenas.tabid - 1) * 100 + (dezenas.tabid - 1) * 10 + unidades.tabid
  FROM systables AS centenas, systables AS dezenas, systables AS unidades
 WHERE centenas.tabid <= 10 AND dezenas.tabid <= 10 AND unidades.tabid <= 10;
