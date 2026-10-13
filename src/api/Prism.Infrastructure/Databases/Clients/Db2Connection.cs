#if PRISM_IBM_DRIVER
using Prism.Infrastructure.Databases.Models;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O que só o Db2 sabe: o catálogo em `SYSCAT`. Todo nome de esquema e de tabela vai como parâmetro (`?`), nunca dentro do SQL, e é
/// comparado como está: o Db2 guarda em maiúsculas o nome escrito sem aspas (`LOJA`, `PEDIDO`), e como foi escrito o que veio entre
/// aspas.
///
/// Nenhum comando do usuário consegue deixar a conexão dentro de uma transação: o auto-commit é do driver, que confirma depois de
/// cada comando, e `COMMIT`, `ROLLBACK` e `SAVEPOINT ... ON ROLLBACK RETAIN CURSORS` enviados assim não mudam isso (provado contra o
/// Db2 12.1). Por isso a sonda de transação fica no padrão da base, que não pergunta nada.
/// </summary>
internal sealed class Db2Connection(ConnectionSettings settings, ILogger logger) : IbmDatabaseConnection(settings, logger)
{
    /// <summary>As letras de `TYPE` do que a árvore mostra como tabela e como visão, e de `ROUTINETYPE` das rotinas.</summary>
    private const string TableTypes = "'T', 'U', 'G', 'N'";
    private const string ViewTypes = "'V', 'W', 'S'";
    private const string RoutineTypes = "'F', 'P'";

    protected override ESqlDialect Dialect => ESqlDialect.Db2;

    /// <summary>RN-CONN-013.</summary>
    protected override string PingSql => "SELECT 1 FROM SYSIBM.SYSDUMMY1";

    /// <summary>
    /// RN-ARVORE-004. O prefixo `SYS` é reservado aos esquemas do próprio Db2 (`SYSIBM`, `SYSCAT`, `SYSPROC`); `NULLID` e `SQLJ` também
    /// são dele. O catálogo completa com espaços, até oito caracteres, o nome de esquema mais curto que isso (`LOJA    `): o `RTRIM`
    /// os tira, e a comparação com o parâmetro das outras consultas não os enxerga (o Db2 compara texto completando o mais curto com
    /// espaços). RN-CAT-010: as contagens são das mesmas letras de `TYPE` e de `ROUTINETYPE` que a lista de objetos mostra, numa passada
    /// por `SYSCAT.TABLES` e outra por `SYSCAT.ROUTINES`, agrupadas.
    /// </summary>
    protected override string SchemasSql => $@"SELECT RTRIM(SYSCAT.SCHEMATA.SCHEMANAME) AS schema_name,
                                                      CASE WHEN SYSCAT.SCHEMATA.SCHEMANAME LIKE 'SYS%' OR SYSCAT.SCHEMATA.SCHEMANAME IN ('NULLID', 'SQLJ') THEN 1 ELSE 0 END AS is_system,
                                                      COALESCE(objects.tables, 0) AS tables,
                                                      COALESCE(objects.views, 0) AS views,
                                                      COALESCE(routines.routines, 0) AS routines
                                                 FROM SYSCAT.SCHEMATA
                                                 LEFT JOIN (SELECT TABSCHEMA,
                                                                   SUM(CASE WHEN TYPE IN ({TableTypes}) THEN 1 ELSE 0 END) AS tables,
                                                                   SUM(CASE WHEN TYPE IN ({ViewTypes}) THEN 1 ELSE 0 END) AS views
                                                              FROM SYSCAT.TABLES
                                                             GROUP BY TABSCHEMA) AS objects ON objects.TABSCHEMA = SYSCAT.SCHEMATA.SCHEMANAME
                                                 LEFT JOIN (SELECT ROUTINESCHEMA, COUNT(*) AS routines
                                                              FROM SYSCAT.ROUTINES
                                                             WHERE ROUTINETYPE IN ({RoutineTypes})
                                                             GROUP BY ROUTINESCHEMA) AS routines ON routines.ROUTINESCHEMA = SYSCAT.SCHEMATA.SCHEMANAME
                                                ORDER BY is_system, SYSCAT.SCHEMATA.SCHEMANAME";

    /// <summary>
    /// O tipo sai com o tamanho, como se escreve num `CREATE TABLE`: `VARCHAR(80)`, `DECIMAL(12,2)`, `TIMESTAMP(12)`. RN-CAT-001: o
    /// padrão é o texto de `DEFAULT`, como o Db2 o guarda (`'abc'`, `42`, `CURRENT TIMESTAMP`). `GENERATED` diz quem gera o valor: `A` é
    /// "sempre" (a identidade, a coluna calculada e a de data da última alteração da linha) e `D`, "por padrão". A expressão da coluna
    /// calculada está em `TEXT`, que começa por `AS (`: sai só a expressão, sem o `AS` e sem o parêntese que a envolve.
    /// </summary>
    protected override string ColumnsSql => $@"SELECT COLNAME AS column_name,
                                                      {ColumnType} AS column_type,
                                                      CASE NULLS WHEN 'Y' THEN 1 ELSE 0 END AS is_nullable,
                                                      CASE WHEN KEYSEQ IS NULL THEN 0 ELSE 1 END AS is_primary_key,
                                                      COLNO + 1 AS column_position,
                                                      CASE WHEN GENERATED = 'A' AND TEXT IS NOT NULL THEN TRIM(SUBSTR(TEXT, LOCATE('(', TEXT) + 1, LENGTH(RTRIM(TEXT)) - LOCATE('(', TEXT) - 1))
                                                           ELSE ""DEFAULT""
                                                       END AS default_value,
                                                      CASE GENERATED WHEN 'A' THEN '{ColumnGeneration.Always}' WHEN 'D' THEN '{ColumnGeneration.ByDefault}' END AS generated
                                                 FROM SYSCAT.COLUMNS
                                                WHERE TABSCHEMA = ?
                                                  AND TABNAME = ?
                                                ORDER BY COLNO";

    /// <summary>
    /// As colunas de `INCLUDE` de um índice único (`COLORDER` igual a `I`) ficam de fora, como no PostgreSQL. RN-CAT-003: o tipo é o de
    /// `INDEXTYPE`, na palavra da documentação do Db2 (`REG` é o índice "regular", `CLUS` o "clustering"...); o código que este Prism não
    /// conhece sai como veio.
    /// </summary>
    protected override string IndexesSql => @"SELECT SYSCAT.INDEXES.INDNAME AS index_name,
                                                     CASE WHEN SYSCAT.INDEXES.UNIQUERULE IN ('U', 'P') THEN 1 ELSE 0 END AS is_unique,
                                                     SYSCAT.INDEXCOLUSE.COLNAME AS column_name,
                                                     CASE RTRIM(SYSCAT.INDEXES.INDEXTYPE)
                                                          WHEN 'REG' THEN 'regular'
                                                          WHEN 'CLUS' THEN 'clustering'
                                                          WHEN 'BLOK' THEN 'block'
                                                          WHEN 'DIM' THEN 'dimension block'
                                                          WHEN 'CPMA' THEN 'page map'
                                                          WHEN 'RCT' THEN 'range-clustered key sequence'
                                                          WHEN 'TEXT' THEN 'text'
                                                          WHEN 'XPTH' THEN 'XML path'
                                                          WHEN 'XRGN' THEN 'XML region'
                                                          WHEN 'XVIL' THEN 'XML column (logical)'
                                                          WHEN 'XVIP' THEN 'XML column (physical)'
                                                          ELSE RTRIM(SYSCAT.INDEXES.INDEXTYPE)
                                                      END AS method
                                                FROM SYSCAT.INDEXES
                                                JOIN SYSCAT.INDEXCOLUSE ON SYSCAT.INDEXCOLUSE.INDSCHEMA = SYSCAT.INDEXES.INDSCHEMA AND SYSCAT.INDEXCOLUSE.INDNAME = SYSCAT.INDEXES.INDNAME
                                               WHERE SYSCAT.INDEXES.TABSCHEMA = ?
                                                 AND SYSCAT.INDEXES.TABNAME = ?
                                                 AND SYSCAT.INDEXCOLUSE.COLORDER <> 'I'
                                               ORDER BY SYSCAT.INDEXES.INDNAME, SYSCAT.INDEXCOLUSE.COLSEQ";

    /// <summary>
    /// RN-EDIT-003: a tabela sem esquema é a do esquema atual da sessão (`CURRENT SCHEMA`). `T` é a tabela comum, `V` a visão, `S` a
    /// tabela de consulta materializada e `N` o apelido federado (a tabela de outro servidor); o apelido de tabela (`A`) não é uma tabela.
    /// </summary>
    protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
        => ($@"SELECT RTRIM(TABSCHEMA),
                      TABNAME,
                      CASE TYPE WHEN 'T' THEN 'table' WHEN 'V' THEN 'view' WHEN 'S' THEN 'materializedView' WHEN 'N' THEN 'foreign' ELSE 'other' END,
                      CAST(NULL AS BIGINT),
                      0
                 FROM SYSCAT.TABLES
                WHERE TABSCHEMA = {(table.Schema is null ? "CURRENT SCHEMA" : "?")}
                  AND TABNAME = ?", table.Schema is null ? [table.Name] : [table.Schema, table.Name]);

    /// <summary>RN-EDIT-002: os índices da chave primária (`P`) e os únicos (`U`), que são também os das restrições únicas, sem as colunas de `INCLUDE`.</summary>
    protected override string EditKeysSql => @"SELECT SYSCAT.INDEXES.INDNAME,
                                                     CASE SYSCAT.INDEXES.UNIQUERULE WHEN 'P' THEN 1 ELSE 0 END,
                                                     SYSCAT.INDEXCOLUSE.COLNAME
                                                FROM SYSCAT.INDEXES
                                                JOIN SYSCAT.INDEXCOLUSE ON SYSCAT.INDEXCOLUSE.INDSCHEMA = SYSCAT.INDEXES.INDSCHEMA AND SYSCAT.INDEXCOLUSE.INDNAME = SYSCAT.INDEXES.INDNAME
                                               WHERE SYSCAT.INDEXES.TABSCHEMA = ?
                                                 AND SYSCAT.INDEXES.TABNAME = ?
                                                 AND SYSCAT.INDEXES.UNIQUERULE IN ('U', 'P')
                                                 AND SYSCAT.INDEXCOLUSE.COLORDER <> 'I'
                                               ORDER BY 2 DESC, 1, SYSCAT.INDEXCOLUSE.COLSEQ";

    protected override string LockTimeoutSql => "SET CURRENT LOCK TIMEOUT 5";

    protected override string ForeignKeysSql => ForeignKeyColumnsSql("SYSCAT.REFERENCES.TABSCHEMA = ? AND SYSCAT.REFERENCES.TABNAME = ?");

    /// <summary>RN-CAT-004: as chaves que apontam para a tabela, também a dela mesma.</summary>
    protected override string ReferencedBySql => ForeignKeyColumnsSql("SYSCAT.REFERENCES.REFTABSCHEMA = ? AND SYSCAT.REFERENCES.REFTABNAME = ?");

    /// <summary>
    /// RN-CAT-005: só `TYPE = 'C'`, a restrição de conferência que alguém escreveu. As outras linhas de `SYSCAT.CHECKS` são do próprio
    /// Db2: a de uma coluna calculada (`S`), a de uma dependência funcional (`F`) e a de propriedade de um objeto (`O`). `NOT NULL` não
    /// está nela. A condição é o `TEXT`, como o Db2 a guarda.
    /// </summary>
    protected override string ChecksSql => @"SELECT CONSTNAME AS check_name,
                                                    TEXT AS expression
                                               FROM SYSCAT.CHECKS
                                              WHERE TABSCHEMA = ?
                                                AND TABNAME = ?
                                                AND TYPE = 'C'
                                              ORDER BY CONSTNAME";

    /// <summary>RN-CAT-006: o Db2 guarda o comando inteiro com que a visão (ou a tabela de consulta materializada) foi criada, como foi escrito.</summary>
    protected override string ViewDefinitionSql => @"SELECT TEXT AS definition
                                                       FROM SYSCAT.VIEWS
                                                      WHERE VIEWSCHEMA = ?
                                                        AND VIEWNAME = ?";

    protected override string DiagramColumnsSql => $@"SELECT SYSCAT.COLUMNS.TABNAME AS table_name,
                                                             SYSCAT.COLUMNS.COLNAME AS column_name,
                                                             {ColumnType} AS column_type,
                                                             CASE SYSCAT.COLUMNS.NULLS WHEN 'Y' THEN 1 ELSE 0 END AS is_nullable,
                                                             CASE WHEN SYSCAT.COLUMNS.KEYSEQ IS NULL THEN 0 ELSE 1 END AS is_primary_key
                                                        FROM SYSCAT.TABLES
                                                        JOIN SYSCAT.COLUMNS ON SYSCAT.COLUMNS.TABSCHEMA = SYSCAT.TABLES.TABSCHEMA AND SYSCAT.COLUMNS.TABNAME = SYSCAT.TABLES.TABNAME
                                                       WHERE SYSCAT.TABLES.TABSCHEMA = ?
                                                         AND SYSCAT.TABLES.TYPE IN ({TableTypes})
                                                       ORDER BY SYSCAT.COLUMNS.TABNAME, SYSCAT.COLUMNS.COLNO";

    /// <summary>RN-CAT-008: só tabela tem chave estrangeira, e o esquema basta.</summary>
    protected override string DiagramForeignKeysSql => ForeignKeyColumnsSql("SYSCAT.REFERENCES.TABSCHEMA = ?");

    /// <summary>
    /// RN-ARVORE-006: o Db2 conecta num banco só por vez e não tem SQL que liste os outros bancos da instância, então a lista é o banco
    /// da sessão, com o nome que o servidor dá a ele (`CURRENT SERVER`, em maiúsculas).
    /// </summary>
    protected override string DatabasesSql => "SELECT CURRENT SERVER, 1 FROM SYSIBM.SYSDUMMY1";

    /// <summary>
    /// RN-CAT-010: a configuração do banco (`SYSIBMADM.DBCFG`), na partição em que a sessão está. Onde a conta não pode ler a visão de
    /// administração, a consulta é recusada e as propriedades não vêm.
    /// </summary>
    protected override IReadOnlyList<string> PropertiesSql => [@"SELECT CASE NAME WHEN 'codepage' THEN 'codePage' WHEN 'codeset' THEN 'codeSet' WHEN 'territory' THEN 'territory' ELSE 'collation' END AS property_name,
                                                                        VALUE AS property_value
                                                                   FROM SYSIBMADM.DBCFG
                                                                  WHERE NAME IN ('codepage', 'codeset', 'territory', 'db_collname')
                                                                    AND MEMBER = CURRENT MEMBER
                                                                  ORDER BY CASE NAME WHEN 'codepage' THEN 1 WHEN 'codeset' THEN 2 WHEN 'territory' THEN 3 ELSE 4 END"];

    /// <summary>
    /// Tabela tipada, temporária criada e apelido de tabela de outro servidor aparecem como tabela; visão tipada e tabela de consulta
    /// materializada, como visão. Os apelidos (`ALIAS`) ficam de fora: a árvore não tem lugar para eles. RN-CAT-009: a estimativa é o
    /// `CARD` que o `RUNSTATS` grava, e -1 é "sem estatística"; o comentário é o `REMARKS` do `COMMENT ON TABLE`.
    /// </summary>
    protected override string? ObjectsSql(string kind)
        => kind switch
        {
            "tables" => TablesSql(TableTypes, "table", "CASE WHEN CARD >= 0 THEN CARD END"),
            "views" => TablesSql(ViewTypes, "view", "CAST(NULL AS BIGINT)"),
            "routines" => $@"SELECT ROUTINENAME AS object_name,
                                    CASE ROUTINETYPE WHEN 'P' THEN 'procedure' ELSE 'function' END AS object_kind,
                                    CAST(NULL AS BIGINT) AS estimated_rows,
                                    CAST(NULL AS VARCHAR(254)) AS object_comment
                               FROM SYSCAT.ROUTINES
                              WHERE ROUTINESCHEMA = ?
                                AND ROUTINETYPE IN ({RoutineTypes})
                              ORDER BY ROUTINENAME, SPECIFICNAME",
            _ => null
        };

    /// <summary>O tipo da coluna de `SYSCAT.COLUMNS`, com o tamanho.</summary>
    private static string ColumnType => @"CASE WHEN SYSCAT.COLUMNS.TYPENAME IN ('CHARACTER', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC', 'BINARY', 'VARBINARY', 'CLOB', 'BLOB', 'DBCLOB') THEN SYSCAT.COLUMNS.TYPENAME || '(' || SYSCAT.COLUMNS.LENGTH || ')'
                                               WHEN SYSCAT.COLUMNS.TYPENAME = 'DECIMAL' THEN SYSCAT.COLUMNS.TYPENAME || '(' || SYSCAT.COLUMNS.LENGTH || ',' || SYSCAT.COLUMNS.SCALE || ')'
                                               WHEN SYSCAT.COLUMNS.TYPENAME = 'DECFLOAT' THEN SYSCAT.COLUMNS.TYPENAME || '(' || CASE SYSCAT.COLUMNS.LENGTH WHEN 8 THEN 16 ELSE 34 END || ')'
                                               WHEN SYSCAT.COLUMNS.TYPENAME = 'TIMESTAMP' AND SYSCAT.COLUMNS.SCALE <> 6 THEN SYSCAT.COLUMNS.TYPENAME || '(' || SYSCAT.COLUMNS.SCALE || ')'
                                               ELSE SYSCAT.COLUMNS.TYPENAME
                                           END";

    /// <summary>
    /// RN-CAT-002: a letra da regra de `SYSCAT.REFERENCES` na palavra da resposta. Ao excluir o Db2 tem `A` (sem ação), `C`, `N` e `R`;
    /// ao atualizar, só `A` e `R`. `SET DEFAULT` ele não tem.
    /// </summary>
    private static string Rule(string column)
        => $"CASE SYSCAT.REFERENCES.{column} WHEN 'A' THEN '{ForeignKeyRule.NoAction}' WHEN 'R' THEN '{ForeignKeyRule.Restrict}' WHEN 'C' THEN '{ForeignKeyRule.Cascade}' WHEN 'N' THEN '{ForeignKeyRule.SetNull}' END";

    /// <summary>
    /// As chaves estrangeiras que o filtro escolhe, um par de colunas por linha, nas colunas de uma linha de chave da base.
    /// `SYSCAT.KEYCOLUSE` tem as colunas das duas pontas: as da chave estrangeira e as da chave que ela referencia, casadas pela posição.
    /// O filtro é constante deste arquivo; o esquema e a tabela vão como parâmetro.
    /// </summary>
    private static string ForeignKeyColumnsSql(string filter)
        => $@"SELECT SYSCAT.REFERENCES.CONSTNAME AS foreign_key_name,
                     RTRIM(SYSCAT.REFERENCES.TABSCHEMA) AS referencing_schema,
                     SYSCAT.REFERENCES.TABNAME AS referencing_table,
                     child_column.COLNAME AS column_name,
                     RTRIM(SYSCAT.REFERENCES.REFTABSCHEMA) AS referenced_schema,
                     SYSCAT.REFERENCES.REFTABNAME AS referenced_table,
                     referenced_column.COLNAME AS referenced_column,
                     {Rule("DELETERULE")} AS on_delete,
                     {Rule("UPDATERULE")} AS on_update
                FROM SYSCAT.REFERENCES
                JOIN SYSCAT.KEYCOLUSE AS child_column ON child_column.CONSTNAME = SYSCAT.REFERENCES.CONSTNAME AND child_column.TABSCHEMA = SYSCAT.REFERENCES.TABSCHEMA AND child_column.TABNAME = SYSCAT.REFERENCES.TABNAME
                JOIN SYSCAT.KEYCOLUSE AS referenced_column ON referenced_column.CONSTNAME = SYSCAT.REFERENCES.REFKEYNAME AND referenced_column.TABSCHEMA = SYSCAT.REFERENCES.REFTABSCHEMA AND referenced_column.TABNAME = SYSCAT.REFERENCES.REFTABNAME AND referenced_column.COLSEQ = child_column.COLSEQ
               WHERE {filter}
               ORDER BY SYSCAT.REFERENCES.CONSTNAME, SYSCAT.REFERENCES.TABSCHEMA, SYSCAT.REFERENCES.TABNAME, child_column.COLSEQ";

    /// <summary>As letras de `TYPE`, o tipo e a expressão da estimativa são constantes deste arquivo, e não dado de fora: o esquema, que é, vai como parâmetro.</summary>
    private static string TablesSql(string tableTypes, string kind, string estimatedRows)
        => $@"SELECT TABNAME AS object_name,
                     '{kind}' AS object_kind,
                     {estimatedRows} AS estimated_rows,
                     REMARKS AS object_comment
                FROM SYSCAT.TABLES
               WHERE TABSCHEMA = ?
                 AND TYPE IN ({tableTypes})
               ORDER BY TABNAME";
}
#endif
