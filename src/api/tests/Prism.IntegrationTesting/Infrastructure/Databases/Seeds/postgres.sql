-- Carga dos testes dos drivers (DatabaseClientContractTests) e do registro de sessões, no PostgreSQL.
-- Os testes só leem estas tabelas; o que um teste cria ou altera, ele mesmo desfaz.

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
    valor      NUMERIC(12, 2) NOT NULL,
    criado_em  TIMESTAMP      NOT NULL,
    observacao TEXT,
    CONSTRAINT pk_pedido PRIMARY KEY (id),
    CONSTRAINT fk_pedido_cliente FOREIGN KEY (cliente_id) REFERENCES loja.cliente (id)
);

CREATE UNIQUE INDEX uk_pedido_numero ON loja.pedido (numero);

-- Índice de duas colunas e não único: prova a ordem das colunas de um índice.
CREATE INDEX ix_pedido_cliente_data ON loja.pedido (cliente_id, criado_em);

CREATE VIEW loja.pedido_resumo AS
SELECT pedido.cliente_id,
       COUNT(*) AS pedidos,
       SUM(pedido.valor) AS total
  FROM loja.pedido
 GROUP BY pedido.cliente_id;

CREATE FUNCTION loja.dobro(valor INTEGER) RETURNS INTEGER LANGUAGE sql AS 'SELECT valor * 2';

-- Nome com aspa simples, aspas duplas e espaço: as consultas de catálogo o recebem como parâmetro.
CREATE TABLE loja."O'Brien ""x""" (
    id              INTEGER NOT NULL,
    "nome completo" VARCHAR(40),
    CONSTRAINT "pk_O'Brien" PRIMARY KEY (id)
);

-- Chave estrangeira entre tabelas particionadas: no catálogo ela se repete para cada partição da tabela referenciada, e a partição
-- da tabela que tem a chave a herda.
CREATE TABLE loja.regiao (
    id INTEGER NOT NULL,
    CONSTRAINT pk_regiao PRIMARY KEY (id)
) PARTITION BY LIST (id);

CREATE TABLE loja.regiao_sul PARTITION OF loja.regiao FOR VALUES IN (1);

CREATE TABLE loja.regiao_norte PARTITION OF loja.regiao FOR VALUES IN (2);

CREATE TABLE loja.entrega (
    id        INTEGER NOT NULL,
    regiao_id INTEGER NOT NULL,
    CONSTRAINT pk_entrega PRIMARY KEY (id),
    CONSTRAINT fk_entrega_regiao FOREIGN KEY (regiao_id) REFERENCES loja.regiao (id)
) PARTITION BY LIST (id);

CREATE TABLE loja.entrega_1 PARTITION OF loja.entrega FOR VALUES IN (1);

INSERT INTO loja.cliente (id, nome)
SELECT numero, 'Cliente ' || numero
  FROM generate_series(1, 10) AS numero;

INSERT INTO loja.pedido (id, numero, cliente_id, valor, criado_em, observacao)
SELECT numero,
       1000 + numero,
       1 + numero % 10,
       numero * 1.5,
       TIMESTAMP '2026-01-01 00:00:00' + numero * INTERVAL '1 minute',
       CASE WHEN numero % 7 = 0 THEN NULL ELSE 'Pedido ' || numero END
  FROM generate_series(1, 1000) AS numero;
