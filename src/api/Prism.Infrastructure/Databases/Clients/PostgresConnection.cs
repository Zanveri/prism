using Npgsql;
using NpgsqlTypes;
using Prism.Infrastructure.Databases.Models;
using System.Data.Common;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O que só o PostgreSQL sabe: a conexão do Npgsql, o catálogo em `pg_catalog` e a leitura da `PostgresException`. Todo nome de esquema e
/// de tabela vai como parâmetro (`$1`, `$2`), nunca dentro do SQL.
///
/// O resultado de um comando do usuário vem do servidor em formato de texto, como no psql (`AllResultTypesAreUnknown`), e não nos tipos
/// do C#. Com os tipos, o Npgsql recusa o resultado inteiro quando uma célula não cabe neles ou ele não a conhece: `numeric` acima de 28
/// dígitos ou NaN, `interval` com meses (o `age()`), data antes de Cristo, e `aclitem[]`, `regproc` e `pg_node_tree`, que estão em
/// `pg_class`, `pg_proc`, `pg_attribute`, `pg_type`, `pg_constraint` e `pg_index`: um `SELECT * FROM pg_class` não abria. Em texto todo
/// tipo aparece, sem perder precisão (RN-SQL-011), e a primeira página não ficou mais lenta. As consultas de catálogo do Prism
/// continuam nos tipos do C#: são colunas que ele mesmo escolheu.
///
/// Quem diz se um comando grava é o próprio banco (RN-SQL-013): a tentativa paginada roda em `BEGIN TRANSACTION READ ONLY`, e ele a
/// recusa com 25006 se o comando grava, inclusive por um `WITH`, por `SELECT ... INTO`, por `FOR UPDATE` ou por uma função chamada no
/// meio. O que essa transação não segura é pouco e fica só na conexão: gravação em tabela temporária e `set_config`.
/// </summary>
internal sealed class PostgresConnection(ConnectionSettings settings, ILogger logger) : AdoDatabaseConnection(logger)
{
    /// <summary>As letras de `relkind` do que a árvore mostra como tabela (a comum, a particionada e a estrangeira) e como visão (a comum e a materializada).</summary>
    private const string TableKinds = "'r', 'p', 'f'";
    private const string ViewKinds = "'v', 'm'";

    /// <summary>Os tipos que a tela alinha de outro jeito, pelo nome que o servidor dá. O resto, inclusive vetores e intervalos, é texto.</summary>
    private static readonly Dictionary<string, string> Kinds = new()
    {
        ["boolean"] = "boolean",
        ["bytea"] = "binary",
        ["smallint"] = "number",
        ["integer"] = "number",
        ["bigint"] = "number",
        ["numeric"] = "number",
        ["real"] = "number",
        ["double precision"] = "number",
        ["money"] = "number",
        ["oid"] = "number",
        ["date"] = "datetime",
        ["time without time zone"] = "datetime",
        ["time with time zone"] = "datetime",
        ["timestamp without time zone"] = "datetime",
        ["timestamp with time zone"] = "datetime"
    };

    /// <summary>Uma por conexão, descartada com ela: `new NpgsqlConnection(texto)` guardaria a string de conexão, com a senha, num registro estático do driver até o processo acabar.</summary>
    private NpgsqlDataSource? _dataSource;

    /// <summary>
    /// RN-SQL-003: o driver deixa de dividir o texto pelo `;` e de reescrevê-lo, e o comando vai ao banco como o usuário escreveu. Mais
    /// de um comando por envio passa a ser recusa do próprio PostgreSQL, que não executa nenhum (dividido pelo driver, um `UPDATE` antes
    /// de um `SELECT` grande era desfeito quando o cursor fechava). O driver lê a chave uma vez, no primeiro comando do processo: por isso
    /// ela é ligada aqui, antes de existir a primeira conexão.
    /// </summary>
    static PostgresConnection()
        => AppContext.SetSwitch("Npgsql.EnableSqlRewriting", false);

    /// <summary>RN-CONN-013.</summary>
    protected override string PingSql => "SELECT 1";

    /// <summary>
    /// RN-ARVORE-004. O prefixo `pg_` é reservado aos esquemas do próprio PostgreSQL (`pg_catalog`, `pg_toast`, os temporários): ninguém
    /// cria um esquema com ele. RN-CAT-010: as contagens são das mesmas letras de `relkind` e das mesmas rotinas que a lista de objetos
    /// mostra, numa passada por `pg_class` e outra por `pg_proc`, agrupadas.
    /// </summary>
    protected override string SchemasSql => $@"SELECT pg_namespace.nspname AS name,
                                                      (LEFT(pg_namespace.nspname, 3) = 'pg_' OR pg_namespace.nspname = 'information_schema') AS is_system,
                                                      COALESCE(relations.tables, 0) AS tables,
                                                      COALESCE(relations.views, 0) AS views,
                                                      COALESCE(routines.routines, 0) AS routines
                                                 FROM pg_catalog.pg_namespace
                                                 LEFT JOIN (SELECT pg_class.relnamespace,
                                                                   COUNT(*) FILTER (WHERE pg_class.relkind IN ({TableKinds})) AS tables,
                                                                   COUNT(*) FILTER (WHERE pg_class.relkind IN ({ViewKinds})) AS views
                                                              FROM pg_catalog.pg_class
                                                             GROUP BY pg_class.relnamespace) AS relations ON relations.relnamespace = pg_namespace.oid
                                                 LEFT JOIN (SELECT pg_proc.pronamespace, COUNT(*) AS routines
                                                              FROM pg_catalog.pg_proc
                                                             GROUP BY pg_proc.pronamespace) AS routines ON routines.pronamespace = pg_namespace.oid
                                                ORDER BY is_system, pg_namespace.nspname";

    /// <summary>
    /// RN-CAT-001. O padrão e a expressão da coluna calculada (`attgenerated`, do 12 em diante) estão em `pg_attrdef`, e saem como o
    /// `psql` os mostra (`pg_get_expr` legível). A identidade (`attidentity`, do 10 em diante) não tem padrão: o valor vem da sequência
    /// dela. O `serial` é só um padrão (`nextval(...)`), e não é coluna gerada.
    /// </summary>
    protected override string ColumnsSql => $@"SELECT pg_attribute.attname AS name,
                                                     pg_catalog.format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS type,
                                                     NOT pg_attribute.attnotnull AS is_nullable,
                                                     COALESCE(pg_attribute.attnum = ANY (pg_index.indkey), FALSE) AS is_primary_key,
                                                     pg_attribute.attnum AS position,
                                                     pg_catalog.pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid, TRUE) AS default_value,
                                                     CASE WHEN pg_attribute.attidentity = 'a' OR pg_attribute.attgenerated IN ('s', 'v') THEN '{ColumnGeneration.Always}'
                                                          WHEN pg_attribute.attidentity = 'd' THEN '{ColumnGeneration.ByDefault}'
                                                      END AS generated
                                                FROM pg_catalog.pg_attribute
                                                JOIN pg_catalog.pg_class ON pg_class.oid = pg_attribute.attrelid
                                                JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                                                LEFT JOIN pg_catalog.pg_index ON pg_index.indrelid = pg_class.oid AND pg_index.indisprimary
                                                LEFT JOIN pg_catalog.pg_attrdef ON pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
                                               WHERE pg_namespace.nspname = $1
                                                 AND pg_class.relname = $2
                                                 AND pg_attribute.attnum > 0
                                                 AND NOT pg_attribute.attisdropped
                                               ORDER BY pg_attribute.attnum";

    /// <summary>
    /// O `pg_get_indexdef` escreve a coluna do índice como o banco a mostra, inclusive quando ela é uma expressão. As colunas de `INCLUDE`
    /// ficam de fora. RN-CAT-003: o método é o nome do método de acesso (`btree`, `hash`, `gist`, `gin`, `brin`...).
    /// </summary>
    protected override string IndexesSql => @"SELECT index_class.relname AS index_name,
                                                     pg_index.indisunique AS is_unique,
                                                     pg_catalog.pg_get_indexdef(pg_index.indexrelid, key_position.ordinal, TRUE) AS column_name,
                                                     pg_am.amname AS method
                                                FROM pg_catalog.pg_index
                                                JOIN pg_catalog.pg_class AS table_class ON table_class.oid = pg_index.indrelid
                                                JOIN pg_catalog.pg_namespace ON pg_namespace.oid = table_class.relnamespace
                                                JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
                                                JOIN pg_catalog.pg_am ON pg_am.oid = index_class.relam
                                               CROSS JOIN LATERAL generate_series(1, pg_index.indnkeyatts) AS key_position (ordinal)
                                               WHERE pg_namespace.nspname = $1
                                                 AND table_class.relname = $2
                                               ORDER BY index_class.relname, key_position.ordinal";

    protected override string ForeignKeysSql => ForeignKeyColumnsSql("child_namespace.nspname = $1 AND child_class.relname = $2");

    /// <summary>RN-CAT-004: as chaves que apontam para a tabela, também a dela mesma.</summary>
    protected override string ReferencedBySql => ForeignKeyColumnsSql("referenced_namespace.nspname = $1 AND referenced_class.relname = $2");

    /// <summary>
    /// RN-CAT-005: só `contype = 'c'`. A partir do 18 o `NOT NULL` também tem linha em `pg_constraint` (`contype = 'n'`), e fica de fora.
    /// A condição sai como o `psql` a mostra, sem a palavra `CHECK`.
    /// </summary>
    protected override string ChecksSql => @"SELECT pg_constraint.conname AS check_name,
                                                    pg_catalog.pg_get_expr(pg_constraint.conbin, pg_constraint.conrelid, TRUE) AS expression
                                               FROM pg_catalog.pg_constraint
                                               JOIN pg_catalog.pg_class ON pg_class.oid = pg_constraint.conrelid
                                               JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                                              WHERE pg_constraint.contype = 'c'
                                                AND pg_namespace.nspname = $1
                                                AND pg_class.relname = $2
                                              ORDER BY pg_constraint.conname";

    /// <summary>
    /// RN-CAT-006: o PostgreSQL não guarda o texto com que a visão foi criada, e sim a consulta já interpretada; o `pg_get_viewdef` a
    /// escreve de volta (o `SELECT`, sem o `CREATE VIEW`), como o `psql` mostra. Vale para a visão materializada.
    /// </summary>
    protected override string ViewDefinitionSql => $@"SELECT pg_catalog.pg_get_viewdef(pg_class.oid, TRUE) AS definition
                                                        FROM pg_catalog.pg_class
                                                        JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                                                       WHERE pg_namespace.nspname = $1
                                                         AND pg_class.relname = $2
                                                         AND pg_class.relkind IN ({ViewKinds})";

    /// <summary>RN-CAT-008. A tabela sem coluna (`CREATE TABLE t ()`) aparece com a coluna nula: as colunas entram pelo `LEFT JOIN`.</summary>
    protected override string DiagramColumnsSql => $@"SELECT pg_class.relname AS table_name,
                                                             pg_attribute.attname AS column_name,
                                                             pg_catalog.format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS type,
                                                             NOT pg_attribute.attnotnull AS is_nullable,
                                                             COALESCE(pg_attribute.attnum = ANY (pg_index.indkey), FALSE) AS is_primary_key
                                                        FROM pg_catalog.pg_class
                                                        JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                                                        LEFT JOIN pg_catalog.pg_attribute ON pg_attribute.attrelid = pg_class.oid AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
                                                        LEFT JOIN pg_catalog.pg_index ON pg_index.indrelid = pg_class.oid AND pg_index.indisprimary
                                                       WHERE pg_namespace.nspname = $1
                                                         AND pg_class.relkind IN ({TableKinds})
                                                       ORDER BY pg_class.relname, pg_attribute.attnum";

    /// <summary>RN-CAT-008: só tabela tem chave estrangeira, e o esquema basta.</summary>
    protected override string DiagramForeignKeysSql => ForeignKeyColumnsSql("child_namespace.nspname = $1");

    /// <summary>
    /// RN-CAT-010: o que `pg_database` diz do banco conectado. O tamanho só para quem pode conectar nele (é o que o `pg_database_size`
    /// pede): sem o privilégio ele lançaria, e assim só não vem. `datcollate` é `name` até o 14 e `text` depois: a conversão serve aos dois.
    /// </summary>
    protected override IReadOnlyList<string> PropertiesSql => [@"SELECT property.name, property.value
                                                                   FROM pg_catalog.pg_database
                                                                  CROSS JOIN LATERAL (VALUES (1, 'encoding', pg_catalog.pg_encoding_to_char(pg_database.encoding)),
                                                                                             (2, 'collation', pg_database.datcollate::text),
                                                                                             (3, 'ctype', pg_database.datctype::text),
                                                                                             (4, 'sizeBytes', CASE WHEN pg_catalog.has_database_privilege(pg_database.oid, 'CONNECT') THEN pg_catalog.pg_database_size(pg_database.oid)::text END),
                                                                                             (5, 'owner', pg_catalog.pg_get_userbyid(pg_database.datdba)::text),
                                                                                             (6, 'tablespace', (SELECT pg_tablespace.spcname::text FROM pg_catalog.pg_tablespace WHERE pg_tablespace.oid = pg_database.dattablespace)),
                                                                                             (7, 'connectionLimit', pg_database.datconnlimit::text)) AS property (position, name, value)
                                                                  WHERE pg_database.datname = pg_catalog.current_database()
                                                                  ORDER BY property.position"];


    /// <summary>
    /// RN-ARVORE-006: os de `pg_database` que aceitam conexão, sem os de modelo e só os em que a conta tem `CONNECT` (superusuário tem
    /// em todos). O `name` ordena byte a byte, pela colação `C` do tipo.
    /// </summary>
    protected override string DatabasesSql => @"SELECT pg_database.datname, pg_database.datname = pg_catalog.current_database()
                                                  FROM pg_catalog.pg_database
                                                 WHERE pg_database.datallowconn
                                                   AND NOT pg_database.datistemplate
                                                   AND pg_catalog.has_database_privilege(pg_database.oid, 'CONNECT')
                                                 ORDER BY pg_database.datname";

    protected override string BeginReadOnlySql => "BEGIN TRANSACTION READ ONLY";

    /// <summary>`TABLE`, `SHOW` e `EXPLAIN` também devolvem linhas sem gravar; um `EXPLAIN ANALYZE` de um comando que grava é recusado na tentativa, como o próprio comando.</summary>
    protected override bool MayBeRead(string firstWord)
        => base.MayBeRead(firstWord) || firstWord is "TABLE" or "SHOW" or "EXPLAIN";

    /// <summary>25006: o comando tentou gravar numa transação só de leitura. 25001: o comando não roda dentro de transação.</summary>
    protected override bool IsWriteRefusal(DatabaseFailure failure)
        => failure.SqlState is "25006" or "25001";

    /// <summary>
    /// O Npgsql interrompe o comando pela fonte de cancelamento, com um pedido só. Um segundo pedido, pelo `Cancel` do comando, chegaria
    /// ao banco depois de o comando já ter parado, e poderia interromper o `ROLLBACK` da limpeza ou o comando seguinte.
    /// </summary>
    protected override void CancelCommand(DbCommand command)
    {
    }

    /// <summary>
    /// RN-SESSAO-005. O Npgsql não mostra o estado de transação da conexão, mas o `BeginTransactionAsync` público o consulta: quando a
    /// resposta do servidor ao último comando disse que há uma transação aberta, ele lança, sem enviar nada. Sem transação ele só anota
    /// o pedido, e o `RollbackAsync` envia `BEGIN` e `ROLLBACK` numa ida só, sem aviso nem erro no log do servidor. O aviso 25P01 de um
    /// `ROLLBACK` solto não serve de sonda: `SET client_min_messages = error`, que o usuário pode executar na sessão, o esconde.
    ///
    /// O que diz "há transação" é só a recusa do `BeginTransactionAsync`, que acontece antes de qualquer envio: o ponto em que a exceção
    /// sai, e não o texto dela, que muda com a versão e o idioma do driver. Dali em diante é a ida e volta da própria sonda, e o que
    /// falhar nela (a conexão que cai, o servidor que recusa esse `BEGIN` ou esse `ROLLBACK`) não diz nada sobre o comando do usuário,
    /// que o servidor já confirmou. O `RollbackAsync` vem antes do descarte porque ele lança e o descarte não: é assim que a base fica
    /// sabendo que a conexão pode ter ficado dentro da transação da sonda, e a limpa pelo fim comum (`ROLLBACK`, ou a conexão fechada).
    ///
    /// O `BeginTransactionAsync` recusa, com a mesma `InvalidOperationException`, também a conexão fechada ou descartada (quem separa
    /// esse caso é a base, pela conexão que não está mais aberta) e a conexão com um leitor aberto, que aqui não existe: a base só
    /// pergunta depois de fechar o cursor do comando.
    /// </summary>
    protected override async Task<ETransactionProbe> ProbeTransactionAsync(DbConnection connection)
    {
        var began = false;
        var passed = await TryAsync(nameof(ProbeTransactionAsync), async () =>
        {
            await using var probe = await ((NpgsqlConnection)connection).BeginTransactionAsync();
            began = true;
            await probe.RollbackAsync();
        });

        if (passed)
            return ETransactionProbe.Idle;

        return began ? ETransactionProbe.Failed : ETransactionProbe.InTransaction;
    }

    protected override void ConfigureUserCommand(DbCommand command)
        => ((NpgsqlCommand)command).AllResultTypesAreUnknown = true;

    /// <summary>
    /// RN-EDIT-003: o banco diz, na descrição das linhas, de que tabela (`TableOID`) e de que coluna dela (o número, `attnum`) vem cada
    /// coluna do resultado, e zero na calculada. Sem `CommandBehavior.KeyInfo` o driver lê isso da própria resposta, sem consultar o
    /// catálogo (com ele, abriria outra conexão para buscar o resto).
    /// </summary>
    protected override IReadOnlyList<ColumnOrigin?> ColumnOrigins(DbDataReader reader)
        => [.. ((NpgsqlDataReader)reader).GetColumnSchema().Select(column => column.TableOID == 0 ? null : new ColumnOrigin(column.TableOID, column.ColumnAttributeNumber ?? 0))];

    /// <summary>
    /// RN-EDIT-006: quem converte é o banco. O texto vai num parâmetro sem tipo, e o servidor o lê pelo tipo da coluna, como leria um
    /// literal escrito na sessão (com o formato de data e o fuso dela).
    /// </summary>
    protected override void BindEditParameter(DbParameter parameter, EditParameter value)
    {
        ((NpgsqlParameter)parameter).NpgsqlDbType = NpgsqlDbType.Unknown;
        parameter.Value = value.Value ?? DBNull.Value;
    }

    /// <summary>
    /// RN-EDIT-003: a tabela pelo nome entre aspas, como o banco o resolve (`to_regclass`, que usa o caminho de busca quando não há
    /// esquema). A tabela comum e a particionada se editam; a visão, a materializada e a estrangeira, não.
    /// </summary>
    protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
        => (@"SELECT pg_namespace.nspname,
                     pg_class.relname,
                     CASE WHEN pg_class.relkind IN ('r', 'p') THEN 'table'
                          WHEN pg_class.relkind = 'v' THEN 'view'
                          WHEN pg_class.relkind = 'm' THEN 'materializedView'
                          WHEN pg_class.relkind = 'f' THEN 'foreign'
                          ELSE 'other'
                      END,
                     pg_class.oid::bigint,
                     FALSE
                FROM pg_catalog.pg_class
                JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
               WHERE pg_class.oid = pg_catalog.to_regclass($1)", [table.Written]);

    /// <summary>RN-EDIT-002: os índices únicos válidos, sem condição (`indpred`) e sem expressão (`indexprs`); a chave primária e as restrições únicas são índices assim.</summary>
    protected override string EditKeysSql => @"SELECT index_class.relname,
                                                     pg_index.indisprimary,
                                                     pg_attribute.attname
                                                FROM pg_catalog.pg_index
                                                JOIN pg_catalog.pg_class AS table_class ON table_class.oid = pg_index.indrelid
                                                JOIN pg_catalog.pg_namespace ON pg_namespace.oid = table_class.relnamespace
                                                JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
                                               CROSS JOIN LATERAL generate_series(1, pg_index.indnkeyatts) AS key_position (ordinal)
                                                JOIN pg_catalog.pg_attribute ON pg_attribute.attrelid = table_class.oid AND pg_attribute.attnum = pg_index.indkey[key_position.ordinal - 1]
                                               WHERE pg_namespace.nspname = $1
                                                 AND table_class.relname = $2
                                                 AND pg_index.indisunique
                                                 AND pg_index.indisvalid
                                                 AND pg_index.indpred IS NULL
                                                 AND pg_index.indexprs IS NULL
                                               ORDER BY pg_index.indisprimary DESC, index_class.relname, key_position.ordinal";

    protected override string LockTimeoutSql => "SET lock_timeout = '5s'";

    /// <summary>O nome vem com o modificador (`numeric(12,2)`, `timestamp(3) without time zone`), que sai antes da consulta à tabela.</summary>
    protected override string ColumnKind(DbDataReader reader, int ordinal)
    {
        var type = reader.GetDataTypeName(ordinal);
        var open = type.IndexOf('(');
        var close = type.IndexOf(')');

        return Kinds.GetValueOrDefault(open < 0 || close < open ? type : type.Remove(open, close - open + 1), "text");
    }

    /// <summary>
    /// O servidor escreve booleano como `t` e `f` e binário como `\x` e os dígitos hexadecimais: os dois voltam ao valor, para sair como
    /// nos outros bancos (`true`, `0x…` cortado). Do binário só se converte o que cabe na tela e um byte a mais, que é o que marca o corte.
    /// O resto é o texto do servidor, que segue como veio.
    /// </summary>
    protected override object ReadCell(DbDataReader reader, int ordinal, string kind)
        => (kind, reader.GetValue(ordinal)) switch
        {
            ("boolean", "t") => true,
            ("boolean", "f") => false,
            ("binary", string hex) when hex.StartsWith(@"\x", StringComparison.Ordinal) => Convert.FromHexString(hex.AsSpan(2, Math.Min(hex.Length - 2, 2 * (CellFormatter.MaxBinaryBytes + 1)))),
            var (_, value) => value
        };

    /// <summary>
    /// A string de conexão sai do construtor do driver, nunca de concatenação: host, banco, usuário e senha são texto de quem cadastrou a
    /// conexão. Sem pool: cada sessão é dona da própria conexão, e fechar a sessão fecha a conexão no banco. Com `IncludeErrorDetail`: o
    /// detalhe do erro (qual chave se repetiu, qual linha violou a regra) faz parte da mensagem que a tela mostra (RN-SQL-009), e nenhuma
    /// exceção do driver vai para o log.
    /// </summary>
    protected override DbConnection CreateConnection()
    {
        _dataSource = NpgsqlDataSource.Create(new NpgsqlConnectionStringBuilder { Host = settings.Host, Port = settings.Port, Database = settings.Database, Username = settings.UserName, Password = settings.Password, Pooling = false, IncludeErrorDetail = true }.ConnectionString);

        return _dataSource.CreateConnection();
    }

    protected override async ValueTask DisposeDriverAsync()
    {
        if (_dataSource is not null)
            await _dataSource.DisposeAsync();
    }

    /// <summary>
    /// Tabela particionada e tabela estrangeira aparecem como tabela; visão materializada, como visão; função de agregação e de janela, como
    /// função. RN-CAT-009: a estimativa é o `reltuples` que o `ANALYZE` e o `VACUUM` gravam, sem contar nada. Do 14 em diante a tabela
    /// nunca analisada tem -1; no 12 e no 13 ela tem 0, como a vazia, e quem as separa é a estatística da tabela, que nunca foi coletada.
    /// </summary>
    protected override string? ObjectsSql(string kind)
        => kind switch
        {
            "tables" => RelationsSql(TableKinds, "table", @"CASE WHEN pg_class.reltuples < 0 THEN NULL
                                                                 WHEN pg_catalog.current_setting('server_version_num')::integer < 140000 AND pg_class.reltuples = 0 AND pg_class.relpages = 0
                                                                      AND (SELECT COALESCE(statistics.last_vacuum, statistics.last_autovacuum, statistics.last_analyze, statistics.last_autoanalyze)
                                                                             FROM pg_catalog.pg_stat_all_tables AS statistics
                                                                            WHERE statistics.relid = pg_class.oid) IS NULL THEN NULL
                                                                 ELSE pg_class.reltuples::bigint
                                                             END"),
            "views" => RelationsSql(ViewKinds, "view", "NULL::bigint"),
            "routines" => @"SELECT pg_proc.proname AS name,
                                   CASE pg_proc.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
                                   NULL::bigint AS estimated_rows,
                                   NULL::text AS comment
                              FROM pg_catalog.pg_proc
                              JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
                             WHERE pg_namespace.nspname = $1
                             ORDER BY pg_proc.proname, pg_proc.oid",
            _ => null
        };

    /// <summary>
    /// RN-SQL-006. O `;` do fim sai porque dentro do parêntese ele é erro de sintaxe; as quebras de linha fazem um comentário `--` no fim
    /// do comando acabar antes do fecho da subconsulta.
    /// </summary>
    protected override string CountSql(string sql)
        => $"SELECT COUNT(*) FROM (\n{sql.TrimEnd().TrimEnd(';')}\n) AS prism_total";

    /// <summary>
    /// RN-SQL-009: a mensagem do servidor, e o detalhe e a dica quando ele os manda, cada um na sua linha e com o rótulo que o
    /// PostgreSQL usa. A `Message` da exceção não serve: leva o SQLSTATE na frente e junta tudo num formato do driver. O cancelamento
    /// chega embrulhado, com a `PostgresException` por dentro. O que não veio do servidor (host que não responde, conexão que caiu) tem a
    /// causa na exceção interna.
    /// </summary>
    protected override DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception)
    {
        if ((exception as PostgresException ?? exception.InnerException as PostgresException) is not { } postgres)
            return new DatabaseFailure(kind, exception.InnerException is null ? exception.Message : $"{exception.Message}: {exception.InnerException.Message}");

        var message = postgres.MessageText;
        if (postgres.Detail is { Length: > 0 } detail)
            message += $"\nDETAIL: {detail}";

        if (postgres.Hint is { Length: > 0 } hint)
            message += $"\nHINT: {hint}";

        return new DatabaseFailure(kind, message, postgres.SqlState, postgres.Position > 0 ? postgres.Position : null);
    }

    /// <summary>
    /// RN-CAT-002: a letra da regra de `pg_constraint` (`confdeltype`, `confupdtype`) na palavra da resposta. O PostgreSQL tem as cinco.
    /// </summary>
    private static string Rule(string column)
        => $"CASE pg_constraint.{column} WHEN 'a' THEN '{ForeignKeyRule.NoAction}' WHEN 'r' THEN '{ForeignKeyRule.Restrict}' WHEN 'c' THEN '{ForeignKeyRule.Cascade}' WHEN 'n' THEN '{ForeignKeyRule.SetNull}' WHEN 'd' THEN '{ForeignKeyRule.SetDefault}' END";

    /// <summary>
    /// As chaves estrangeiras que o filtro escolhe, um par de colunas por linha, nas colunas de uma linha de chave da base. Deixa de fora
    /// as cópias que o catálogo cria para cada partição da tabela referenciada (a restrição cujo pai é da mesma tabela), e mantém a que a
    /// partição herda da tabela dela. O filtro é constante deste arquivo; o esquema e a tabela vão como parâmetro.
    /// </summary>
    private static string ForeignKeyColumnsSql(string filter)
        => $@"SELECT pg_constraint.conname AS foreign_key_name,
                     child_namespace.nspname AS referencing_schema,
                     child_class.relname AS referencing_table,
                     child_attribute.attname AS column_name,
                     referenced_namespace.nspname AS referenced_schema,
                     referenced_class.relname AS referenced_table,
                     referenced_attribute.attname AS referenced_column,
                     {Rule("confdeltype")} AS on_delete,
                     {Rule("confupdtype")} AS on_update
                FROM pg_catalog.pg_constraint
                JOIN pg_catalog.pg_class AS child_class ON child_class.oid = pg_constraint.conrelid
                JOIN pg_catalog.pg_namespace AS child_namespace ON child_namespace.oid = child_class.relnamespace
                JOIN pg_catalog.pg_class AS referenced_class ON referenced_class.oid = pg_constraint.confrelid
                JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_class.relnamespace
               CROSS JOIN LATERAL UNNEST(pg_constraint.conkey, pg_constraint.confkey) WITH ORDINALITY AS key_pair (child_number, referenced_number, ordinal)
                JOIN pg_catalog.pg_attribute AS child_attribute ON child_attribute.attrelid = pg_constraint.conrelid AND child_attribute.attnum = key_pair.child_number
                JOIN pg_catalog.pg_attribute AS referenced_attribute ON referenced_attribute.attrelid = pg_constraint.confrelid AND referenced_attribute.attnum = key_pair.referenced_number
               WHERE pg_constraint.contype = 'f'
                 AND {filter}
                 AND NOT EXISTS (SELECT 1
                                   FROM pg_catalog.pg_constraint AS declared_constraint
                                  WHERE declared_constraint.oid = pg_constraint.conparentid
                                    AND declared_constraint.conrelid = pg_constraint.conrelid)
               ORDER BY pg_constraint.conname, child_namespace.nspname, child_class.relname, key_pair.ordinal";

    /// <summary>
    /// As letras de `relkind`, o tipo e a expressão da estimativa são constantes deste arquivo, e não dado de fora: o esquema, que é, vai
    /// como parâmetro. RN-CAT-009: o comentário é o do `COMMENT ON TABLE` e do `COMMENT ON VIEW`.
    /// </summary>
    private static string RelationsSql(string relationKinds, string kind, string estimatedRows)
        => $@"SELECT pg_class.relname AS name,
                     '{kind}' AS kind,
                     {estimatedRows} AS estimated_rows,
                     pg_catalog.obj_description(pg_class.oid, 'pg_class') AS comment
                FROM pg_catalog.pg_class
                JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
               WHERE pg_namespace.nspname = $1
                 AND pg_class.relkind IN ({relationKinds})
               ORDER BY pg_class.relname";
}
