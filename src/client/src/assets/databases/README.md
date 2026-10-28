# Logos dos bancos de dados

O diálogo de nova conexão começa por uma grade com os bancos do catálogo de drivers (RN-NAV-005, seção 20 da
especificação), cada um com a logo do fabricante, como no assistente do DBeaver. A Zanveri decidiu usar as logos mesmo
sem permissão escrita dos fabricantes e assume o risco (**Ruling 136**, 2026-10-12).

## Aviso

**As marcas e as logos são dos seus donos** (a tabela abaixo diz quem é o dono de cada uma). Elas aparecem no Prism só
para identificar o banco com que se conecta, **não estão sob a GPLv3** que cobre o código do Prism e
**não indicam apoio, patrocínio nem parceria** do dono da marca com o Prism ou com a Zanveri.

Um **pedido de retirada** de um fabricante é atendido: apaga-se o arquivo da logo desta pasta e a linha dela em
`database-logos.ts`, e a grade volta sozinha à ficha de hoje (a colorida nos bancos que o Prism conecta; o
desenho genérico de banco de dados nos "em breve"). O `NOTICE` da raiz traz este mesmo aviso.

## Como cada logo aparece

- **Sem alteração do desenho**: o arquivo é o da fonte (nos PNGs com fundo transparente para compor sobre os temas; o SHA-256 está na tabela, e o teste confere); só o
  tamanho muda (28 px na grade).
- As imagens coloridas (`postgresql.png`, `db2.png`, `informix.png`, `sql-server.png`, `oracle.png`, `firebird.png`) são desenhadas como estão. O glifo do Simple Icons é de uma cor só e não traz cor no
  arquivo: a grade o pinta na cor que o Simple Icons dá à marca (o campo `hex` dos dados dele), a mesma com que o próprio
  Simple Icons o mostra.
- **Onde a logo some no tema** (abaixo de 3:1 sobre a grade, o mínimo de um gráfico), ela vai sobre uma ficha: a clara
  (`#FFFFFF`) nos temas escuros e a escura (`#1B2027`) nos claros. O teste confere os seis temas e que a ficha só entra onde a
  logo some.
- As fontes, pela Ruling 136: a página de marca, imprensa ou arquivo oficial da marca; nos glifos monocromáticos, o Simple Icons
  (16.35.0, o pacote `simple-icons` do npm, conferido pela soma `sha512-TCfl/2+GTrx0nCo4pEWGvxhOb8c6NsqOU1OpwjtF4lwJAthB8IYVD0fuIMjLMg6JFuG1YBO0t1iETQqJLqkoJA==`
  que o registro publica). O Simple Icons é CC0 no desenho dos arquivos; o CC0 não cobre a marca, e os dados dele não trazem
  licença própria para estes sete.

## As logos

Conferidas em 2026-10-28.

| Banco | Arquivo | Dono da marca | Origem | Como aparece | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | `postgresql.png` | PostgreSQL Community Association of Canada | O Slonik que a página de marca mostra como forma aprovada (https://www.postgresql.org/about/policies/trademarks/, arquivo https://www.postgresql.org/media/img/about/press/elephant.png), baixado do repositório do site: https://raw.githubusercontent.com/postgres/pgweb/master/media/img/about/press/elephant.png (540x557, RGBA) | A imagem como está; contorno de fora preto, por isso a ficha clara nos temas escuros | `ff92fb5d12a7fa6b23c2eb403d2edf4fbc58ced802021e1f02c3583cb70957be` |
| Db2 | `db2.png` | IBM | A insígnia IBM DB2 vertical (https://dbdb.io/media/logos/ibm-db2-vertical.svg), exportada em PNG RGBA sem fundo branco (811x811, RGBA) | A imagem como está; metade superior preta (`#000000`), por isso a ficha clara nos temas escuros | `5412083a461d49e470cc933b73cb864dfa0e5b174bcbb8d1da30645a14a64568` |
| Informix | `informix.png` | IBM | O hexágono espiral do IBM Informix (https://media.securiti.ai/wp-content/uploads/2023/05/IBM-Informix-Logo-Large.png), em PNG RGBA sem fundo branco (790x787, RGBA) | A imagem como está; contorno vermelho (`#C33A32`), por isso a ficha clara nos temas escuros | `6f73056013a5a9b715e14088370c092ddb2de388c68ccf930a8193222db69f7a` |
| SQLite | `sqlite.svg` | Hipp, Wyrick & Company, Inc. | Simple Icons 16.35.0, `icons/sqlite.svg` (https://registry.npmjs.org/simple-icons/-/simple-icons-16.35.0.tgz); o Simple Icons cita como origem do desenho o `art/sqlite370.eps` do código do SQLite | Glifo em `#003B57`; ficha clara nos temas escuros | `71d4153bc9661dfe6b92dad70f737ec2b6c7c839311e502b4ca66fe664fe12b6` |
| MySQL | `mysql.svg` | Oracle Corporation | Simple Icons 16.35.0, `icons/mysql.svg` (o mesmo pacote); origem citada: https://www.mysql.com/about/legal/logos.html | Glifo em `#4479A1`; ficha clara nos temas escuros | `67c144cc3e44ad14062a3f20ebe29c5e7eeb2c2c9c0f43cf48d87fe6291a8b2d` |
| MariaDB | `mariadb.svg` | MariaDB Corporation Ab | Simple Icons 16.35.0, `icons/mariadb.svg` (o mesmo pacote); origem citada: https://mariadb.com/about-us/logos/ | Glifo em `#003545`; ficha clara nos temas escuros | `477435746bb2024048c7b71529f615fb70d7e679618f37bac49f78fd07e67dfe` |
| Microsoft SQL Server | `sql-server.png` | Microsoft Corporation | O logo do Microsoft SQL Server (https://www.dbacorp.com.br/wp-content/uploads/2017/07/microsoft-sql-server-logo.png), em PNG RGBA sem fundo branco (491x408, RGBA) | A imagem como está; letras em preto (`#000000`), por isso a ficha clara nos temas escuros | `7c053bcbf77e8b9da35b6bcd4b14debe80b3479302871950d8b4ec96de623982` |
| Oracle | `oracle.png` | Oracle Corporation | O logo do Oracle Database (https://upload.wikimedia.org/wikipedia/commons/d/d6/%D8%A6%DB%86%D8%B1%D8%A7%DA%A9%DA%B5.png), em PNG RGBA sem fundo branco (828x291, RGBA) | A imagem como está; letras inferiores escuras (`#1A1818`), por isso a ficha clara nos temas escuros | `471b8d04dd9f8c68ca74cf238dcb7ba5d1c8aec7c0fce1e4aa41c5265c78c7ac` |
| Firebird | `firebird.png` | Firebird Foundation | O emblema da fênix do Firebird (https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT-5IFDUoGmRaBzqHxBHgqlYncAQmYRFCrLjhLetLCq5ES_wEvE35YsnuM&s=10), em PNG RGBA sem fundo branco (443x447, RGBA) | A imagem como está; contorno externo preto (`#000000`), por isso a ficha clara nos temas escuros | `01db467896c5b7288b2f0f689528e92b339a5ee95207923e635f3c5d5b1a6a3b` |
| DuckDB | `duckdb.svg` | DuckDB Foundation | Simple Icons 16.35.0, `icons/duckdb.svg` (o mesmo pacote); origem citada: https://duckdb.org | Glifo em `#FFF000`; ficha escura nos temas claros | `2d53f8978d58ac12411fc618569a492922bb15e3e1798b56ba1511e72c62f826` |
| ClickHouse | `clickhouse.svg` | ClickHouse, Inc. | Simple Icons 16.35.0, `icons/clickhouse.svg` (o mesmo pacote); origem citada: o `website/images/logo-clickhouse.svg` do repositório do ClickHouse | Glifo em `#FFCC01`; ficha escura nos temas claros | `9fa7c12613763111ca26bbc1fe10994960028bc3da9faf47247de231a0b27589` |
| BigQuery | `bigquery.svg` | Google LLC | Simple Icons 16.35.0, `icons/googlebigquery.svg` (o mesmo pacote); origem citada: https://cloud.google.com/icons | Glifo em `#669DF6`; ficha escura nos temas claros | `9911daac258359ac5e73916bc8e97f6df03d5f5845b210bdb99c629f8caf0f84` |
| Databricks | `databricks.svg` | Databricks, Inc. | Simple Icons 16.35.0, `icons/databricks.svg` (o mesmo pacote); origem citada: https://www.databricks.com | Glifo em `#FF3621`; ficha clara nos temas escuros | `454aa3efdb318c655e3da2ea844e3577a9c47a20e24d20fff6489362176e5fe4` |

## A regra de uso que cada dono publica

Levantada antes da Ruling 136; nenhuma delas permite, sem permissão escrita, a logo numa tela de produto ao lado das de
outros bancos. É o risco que a Zanveri assumiu.

| Banco | Regra encontrada | Fonte |
| --- | --- | --- |
| PostgreSQL | Sem aprovação, só as palavras Postgres e PostgreSQL em declarações factuais. As marcas, inclusive o Slonik, "should not be modified in any way without prior approval" e "should not be presented with other trademarks or logos"; o Slonik tem de aparecer numa das formas aprovadas (o `postgresql.png` é uma delas). | https://www.postgresql.org/about/policies/trademarks/ |
| Db2 e Informix | A IBM só aceita, sem licença, referências em texto às marcas dela; logos só com permissão escrita. | https://www.ibm.com/legal/copyright-trademark |
| SQLite | Marca registrada; o site não publica regra de uso da logo, e o autor respondeu, no fórum do projeto, que depende do uso. | https://sqlite.org/forum/forumpost/8b24aa8189 |
| MySQL | A Oracle só libera sem permissão escrita os logos de "uso condicional" (o selo "Powered by MySQL"), em sites; o logo do MySQL é restrito a quem tem acordo escrito. | https://www.mysql.com/about/legal/trademark.html e https://www.mysql.com/about/legal/logos.html |
| MariaDB | O logo é protegido; a página de logos manda usar só as versões dela, e a de marcas pede consulta antes de material com a marca. | https://mariadb.com/about-us/logos/ e https://mariadb.com/trademarks/ |
| Microsoft SQL Server | Logos e ícones de produto pedem licença; sem ela, só referências factuais em texto. | https://www.microsoft.com/en-us/legal/intellectualproperty/permissions/default |
| Oracle | Terceiros não podem usar os logos da Oracle sem licença ou autorização escrita. | https://www.oracle.com/legal/logos/ e https://www.oracle.com/legal/trademarks/ |
| Firebird | Os logos são liberados para fins ligados ao próprio Firebird; o resto pede aprovação, caso a caso. | https://firebirdsql.org/en/branding-policy e https://firebirdsql.org/en/logos |
| DuckDB | O logo não pode ser combinado com outros logos, e "any use of DuckDB Marks in dashboards, menus, marketplace listings, or developer consoles requires written approval". | https://duckdb.org/trademark_guidelines |
| ClickHouse | A política de marca cobre o logo e não o libera para telas de produto de terceiros. | https://clickhouse.com/legal/trademark-policy |
| BigQuery | As diretrizes do Google exigem permissão escrita para o uso dos ícones de produtos do Google Cloud em produtos de terceiros. | https://about.google/brand-resource-center |
| Databricks | As diretrizes de marca da Databricks restringem o uso do logotipo sem autorização prévia. | https://brand.databricks.com/Styleguide/Guide/ |

## Para trocar ou acrescentar uma logo

1. Baixe o arquivo da página de marca ou de imprensa do fabricante; se não houver, o do Simple Icons.
2. Grave-o nesta pasta como `<chave>.svg` ou `<chave>.png`, e acrescente a linha em `database-logos.ts`, com a cor do
   contorno de fora (`edge`) e o esquema em que ela some (`chip`).
3. Anote aqui o dono da marca, a origem (endereço e data), como ela aparece e o SHA-256. O teste
   (`database-logos.test.ts`) confere a soma, os seis temas e que a ficha só entra onde a logo some.
