using Prism.Infrastructure.Databases.Models;
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Reflection;
using System.Runtime.Loader;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// Conexão ADO.NET para os motores com driver gerenciado sob demanda (SQLite, MySQL, MariaDB, SQL Server, Oracle, Firebird, DuckDB,
/// ClickHouse, BigQuery e Databricks). Carrega o tipo de <see cref="DbConnection"/> do assembly ativado pelo gerenciador de drivers,
/// traduz marcadores posicionais (`?`) para a sintaxe de parâmetro exigida pelo driver e expõe o catálogo de cada banco.
/// </summary>
internal sealed class ManagedEngineDatabaseConnection(EDatabaseEngine engine, ConnectionSettings settings, ILogger logger) : AdoDatabaseConnection(logger)
{
    private const int ConnectTimeoutSeconds = 15;

    protected override ESqlDialect QueryDialect => ReadOnlySql.DialectOf(engine);

    protected override string? BeginReadOnlySql => null;

    /// <summary>RN-TX-013: os motores analíticos não têm transação, e o driver deles recusa a do ADO.NET.</summary>
    protected override bool HasTransactions => engine is not (EDatabaseEngine.ClickHouse or EDatabaseEngine.BigQuery or EDatabaseEngine.Databricks);

    protected override string PingSql => engine switch
    {
        EDatabaseEngine.Oracle => "SELECT 1 FROM DUAL",
        EDatabaseEngine.Firebird => "SELECT 1 FROM RDB$DATABASE",
        _ => "SELECT 1"
    };

    protected override string LockTimeoutSql => engine switch
    {
        EDatabaseEngine.Sqlite => "PRAGMA busy_timeout = 5000",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => "SET SESSION innodb_lock_wait_timeout = 5",
        EDatabaseEngine.SqlServer => "SET LOCK_TIMEOUT 5000",
        _ => string.Empty
    };

    protected override string SchemasSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT 'main' AS schema_name,
                                           0 AS is_system,
                                           (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%') AS tables,
                                           (SELECT COUNT(*) FROM sqlite_master WHERE type = 'view') AS views,
                                           0 AS routines",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT s.SCHEMA_NAME AS schema_name,
                                                                     CASE WHEN LOWER(s.SCHEMA_NAME) IN ('information_schema', 'mysql', 'performance_schema', 'sys') THEN 1 ELSE 0 END AS is_system,
                                                                     COALESCE(t.tables, 0) AS tables,
                                                                     COALESCE(t.views, 0) AS views,
                                                                     COALESCE(r.routines, 0) AS routines
                                                                FROM information_schema.SCHEMATA AS s
                                                                LEFT JOIN (SELECT TABLE_SCHEMA,
                                                                                  SUM(CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 1 ELSE 0 END) AS tables,
                                                                                  SUM(CASE WHEN TABLE_TYPE = 'VIEW' THEN 1 ELSE 0 END) AS views
                                                                             FROM information_schema.TABLES
                                                                            GROUP BY TABLE_SCHEMA) AS t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
                                                                LEFT JOIN (SELECT ROUTINE_SCHEMA, COUNT(*) AS routines
                                                                             FROM information_schema.ROUTINES
                                                                            GROUP BY ROUTINE_SCHEMA) AS r ON r.ROUTINE_SCHEMA = s.SCHEMA_NAME
                                                               ORDER BY is_system, s.SCHEMA_NAME",
        EDatabaseEngine.SqlServer => @"SELECT s.name AS schema_name,
                                              CASE WHEN s.name IN ('sys', 'INFORMATION_SCHEMA', 'guest') OR s.name LIKE 'db_%' THEN 1 ELSE 0 END AS is_system,
                                              COALESCE(SUM(CASE WHEN o.type = 'U' THEN 1 ELSE 0 END), 0) AS tables,
                                              COALESCE(SUM(CASE WHEN o.type = 'V' THEN 1 ELSE 0 END), 0) AS views,
                                              COALESCE(SUM(CASE WHEN o.type IN ('P', 'FN', 'IF', 'TF') THEN 1 ELSE 0 END), 0) AS routines
                                         FROM sys.schemas AS s
                                         LEFT JOIN sys.objects AS o ON o.schema_id = s.schema_id AND o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF')
                                        GROUP BY s.name
                                        ORDER BY is_system, s.name",
        EDatabaseEngine.Oracle => @"SELECT u.USERNAME AS schema_name,
                                           CASE WHEN u.ORACLE_MAINTAINED = 'Y' THEN 1 ELSE 0 END AS is_system,
                                           COALESCE(t.tables, 0) AS tables,
                                           COALESCE(v.views, 0) AS views,
                                           COALESCE(r.routines, 0) AS routines
                                      FROM ALL_USERS u
                                      LEFT JOIN (SELECT OWNER, COUNT(*) AS tables FROM ALL_TABLES GROUP BY OWNER) t ON t.OWNER = u.USERNAME
                                      LEFT JOIN (SELECT OWNER, COUNT(*) AS views FROM ALL_VIEWS GROUP BY OWNER) v ON v.OWNER = u.USERNAME
                                      LEFT JOIN (SELECT OWNER, COUNT(*) AS routines FROM ALL_PROCEDURES WHERE OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION') GROUP BY OWNER) r ON r.OWNER = u.USERNAME
                                     ORDER BY is_system, u.USERNAME",
        EDatabaseEngine.Firebird => @"SELECT 'PUBLIC' AS schema_name,
                                             0 AS is_system,
                                             (SELECT COUNT(*) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL) AS tables,
                                             (SELECT COUNT(*) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NOT NULL) AS views,
                                             (SELECT COUNT(*) FROM RDB$PROCEDURES WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0) + (SELECT COUNT(*) FROM RDB$FUNCTIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0) AS routines
                                        FROM RDB$DATABASE",
        EDatabaseEngine.ClickHouse => @"SELECT d.name AS schema_name,
                                               CASE WHEN d.name IN ('system', 'information_schema', 'INFORMATION_SCHEMA') THEN 1 ELSE 0 END AS is_system,
                                               COALESCE(SUM(CASE WHEN t.engine NOT IN ('View', 'MaterializedView') AND t.name IS NOT NULL THEN 1 ELSE 0 END), 0) AS tables,
                                               COALESCE(SUM(CASE WHEN t.engine IN ('View', 'MaterializedView') THEN 1 ELSE 0 END), 0) AS views,
                                               0 AS routines
                                          FROM system.databases AS d
                                          LEFT JOIN system.tables AS t ON t.database = d.name
                                         GROUP BY d.name
                                         ORDER BY is_system, d.name",
        _ => @"SELECT s.schema_name AS schema_name,
                      CASE WHEN LOWER(s.schema_name) IN ('information_schema', 'pg_catalog', 'sys') THEN 1 ELSE 0 END AS is_system,
                      COALESCE(t.tables, 0) AS tables,
                      COALESCE(t.views, 0) AS views,
                      0 AS routines
                 FROM information_schema.schemata AS s
                 LEFT JOIN (SELECT table_schema,
                                   SUM(CASE WHEN table_type = 'BASE TABLE' THEN 1 ELSE 0 END) AS tables,
                                   SUM(CASE WHEN table_type = 'VIEW' THEN 1 ELSE 0 END) AS views
                              FROM information_schema.tables
                             GROUP BY table_schema) AS t ON t.table_schema = s.schema_name
                ORDER BY is_system, s.schema_name"
    };

    protected override string ColumnsSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT p.name AS column_name,
                                           COALESCE(NULLIF(p.type, ''), 'ANY') AS column_type,
                                           CASE WHEN p.""notnull"" = 0 THEN 1 ELSE 0 END AS is_nullable,
                                           CASE WHEN p.pk > 0 THEN 1 ELSE 0 END AS is_primary_key,
                                           p.cid + 1 AS column_position,
                                           p.dflt_value AS default_value,
                                           CAST(NULL AS TEXT) AS generated
                                      FROM pragma_table_info((SELECT name FROM sqlite_master WHERE 'main' = ? AND name = ?)) AS p
                                     ORDER BY p.cid",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => $@"SELECT COLUMN_NAME AS column_name,
                                                                      COLUMN_TYPE AS column_type,
                                                                      CASE IS_NULLABLE WHEN 'YES' THEN 1 ELSE 0 END AS is_nullable,
                                                                      CASE COLUMN_KEY WHEN 'PRI' THEN 1 ELSE 0 END AS is_primary_key,
                                                                      ORDINAL_POSITION AS column_position,
                                                                      COLUMN_DEFAULT AS default_value,
                                                                      CASE WHEN EXTRA LIKE '%GENERATED%' THEN '{ColumnGeneration.Always}'
                                                                           WHEN EXTRA LIKE '%auto_increment%' THEN '{ColumnGeneration.ByDefault}'
                                                                       END AS generated
                                                                 FROM information_schema.COLUMNS
                                                                WHERE TABLE_SCHEMA = ?
                                                                  AND TABLE_NAME = ?
                                                                ORDER BY ORDINAL_POSITION",
        EDatabaseEngine.SqlServer => $@"SELECT c.name AS column_name,
                                               t.name AS column_type,
                                               CAST(c.is_nullable AS INT) AS is_nullable,
                                               CASE WHEN EXISTS (SELECT 1
                                                                   FROM sys.indexes AS i
                                                                   JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                                                                  WHERE i.object_id = c.object_id AND i.is_primary_key = 1 AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS is_primary_key,
                                               c.column_id AS column_position,
                                               dc.definition AS default_value,
                                               CASE WHEN c.is_computed = 1 THEN '{ColumnGeneration.Always}'
                                                    WHEN c.is_identity = 1 THEN '{ColumnGeneration.ByDefault}'
                                                END AS generated
                                          FROM sys.columns AS c
                                          JOIN sys.objects AS o ON o.object_id = c.object_id
                                          JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                          JOIN sys.types AS t ON t.user_type_id = c.user_type_id
                                          LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
                                         WHERE s.name = ?
                                           AND o.name = ?
                                         ORDER BY c.column_id",
        EDatabaseEngine.Oracle => $@"SELECT c.COLUMN_NAME AS column_name,
                                            c.DATA_TYPE AS column_type,
                                            CASE c.NULLABLE WHEN 'Y' THEN 1 ELSE 0 END AS is_nullable,
                                            CASE WHEN EXISTS (SELECT 1
                                                                FROM ALL_CONSTRAINTS cons
                                                                JOIN ALL_CONS_COLUMNS cols ON cols.OWNER = cons.OWNER AND cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME
                                                               WHERE cons.OWNER = c.OWNER AND cons.TABLE_NAME = c.TABLE_NAME AND cons.CONSTRAINT_TYPE = 'P' AND cols.COLUMN_NAME = c.COLUMN_NAME) THEN 1 ELSE 0 END AS is_primary_key,
                                            c.COLUMN_ID AS column_position,
                                            CAST(NULL AS VARCHAR2(1)) AS default_value,
                                            CASE WHEN c.VIRTUAL_COLUMN = 'YES' THEN '{ColumnGeneration.Always}' END AS generated
                                       FROM ALL_TAB_COLUMNS c
                                      WHERE c.OWNER = ?
                                        AND c.TABLE_NAME = ?
                                      ORDER BY c.COLUMN_ID",
        EDatabaseEngine.Firebird => $@"SELECT TRIM(rf.RDB$FIELD_NAME) AS column_name,
                                              CASE f.RDB$FIELD_TYPE
                                                   WHEN 7 THEN 'SMALLINT'
                                                   WHEN 8 THEN 'INTEGER'
                                                   WHEN 10 THEN 'FLOAT'
                                                   WHEN 12 THEN 'DATE'
                                                   WHEN 13 THEN 'TIME'
                                                   WHEN 14 THEN 'CHAR(' || f.RDB$FIELD_LENGTH || ')'
                                                   WHEN 16 THEN 'BIGINT'
                                                   WHEN 23 THEN 'BOOLEAN'
                                                   WHEN 27 THEN 'DOUBLE PRECISION'
                                                   WHEN 35 THEN 'TIMESTAMP'
                                                   WHEN 37 THEN 'VARCHAR(' || f.RDB$FIELD_LENGTH || ')'
                                                   WHEN 261 THEN 'BLOB'
                                                   ELSE 'TEXT'
                                               END AS column_type,
                                              CASE WHEN COALESCE(rf.RDB$NULL_FLAG, 0) = 1 THEN 0 ELSE 1 END AS is_nullable,
                                              CASE WHEN EXISTS (SELECT 1
                                                                  FROM RDB$RELATION_CONSTRAINTS rc
                                                                  JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
                                                                 WHERE rc.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
                                                                   AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
                                                                   AND s.RDB$FIELD_NAME = rf.RDB$FIELD_NAME) THEN 1 ELSE 0 END AS is_primary_key,
                                              rf.RDB$FIELD_POSITION + 1 AS column_position,
                                              CAST(NULL AS VARCHAR(1)) AS default_value,
                                              CASE WHEN f.RDB$COMPUTED_BLR IS NOT NULL THEN '{ColumnGeneration.Always}'
                                                   WHEN rf.RDB$IDENTITY_TYPE IS NOT NULL THEN '{ColumnGeneration.ByDefault}'
                                               END AS generated
                                         FROM RDB$RELATION_FIELDS rf
                                         JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
                                        WHERE 'PUBLIC' = ?
                                          AND TRIM(rf.RDB$RELATION_NAME) = ?
                                        ORDER BY rf.RDB$FIELD_POSITION",
        EDatabaseEngine.ClickHouse => @"SELECT name AS column_name,
                                               type AS column_type,
                                               CASE WHEN type LIKE 'Nullable(%' THEN 1 ELSE 0 END AS is_nullable,
                                               is_in_primary_key AS is_primary_key,
                                               position AS column_position,
                                               NULLIF(default_expression, '') AS default_value,
                                               CAST(NULL AS Nullable(String)) AS generated
                                          FROM system.columns
                                         WHERE database = ?
                                           AND table = ?
                                         ORDER BY position",
        _ => @"SELECT column_name AS column_name,
                      data_type AS column_type,
                      CASE is_nullable WHEN 'YES' THEN 1 ELSE 0 END AS is_nullable,
                      0 AS is_primary_key,
                      ordinal_position AS column_position,
                      column_default AS default_value,
                      CAST(NULL AS VARCHAR) AS generated
                 FROM information_schema.columns
                WHERE table_schema = ?
                  AND table_name = ?
                ORDER BY ordinal_position"
    };

    protected override string IndexesSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT il.name AS index_name,
                                           il.""unique"" AS is_unique,
                                           ii.name AS column_name,
                                           'btree' AS method
                                      FROM pragma_index_list((SELECT name FROM sqlite_master WHERE 'main' = ? AND name = ?)) AS il
                                      JOIN pragma_index_info(il.name) AS ii
                                     ORDER BY il.name, ii.seqno",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT INDEX_NAME AS index_name,
                                                                     CASE NON_UNIQUE WHEN 0 THEN 1 ELSE 0 END AS is_unique,
                                                                     COLUMN_NAME AS column_name,
                                                                     LOWER(INDEX_TYPE) AS method
                                                                FROM information_schema.STATISTICS
                                                               WHERE TABLE_SCHEMA = ?
                                                                 AND TABLE_NAME = ?
                                                               ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        EDatabaseEngine.SqlServer => @"SELECT i.name AS index_name,
                                              CAST(i.is_unique AS INT) AS is_unique,
                                              c.name AS column_name,
                                              LOWER(i.type_desc) AS method
                                         FROM sys.indexes AS i
                                         JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                                         JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                                         JOIN sys.objects AS o ON o.object_id = i.object_id
                                         JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                        WHERE s.name = ?
                                          AND o.name = ?
                                          AND i.name IS NOT NULL
                                        ORDER BY i.name, ic.key_ordinal",
        EDatabaseEngine.Oracle => @"SELECT i.INDEX_NAME AS index_name,
                                           CASE i.UNIQUENESS WHEN 'UNIQUE' THEN 1 ELSE 0 END AS is_unique,
                                           ic.COLUMN_NAME AS column_name,
                                           LOWER(i.INDEX_TYPE) AS method
                                      FROM ALL_INDEXES i
                                      JOIN ALL_IND_COLUMNS ic ON ic.INDEX_OWNER = i.OWNER AND ic.INDEX_NAME = i.INDEX_NAME
                                     WHERE i.TABLE_OWNER = ?
                                       AND i.TABLE_NAME = ?
                                     ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION",
        EDatabaseEngine.Firebird => @"SELECT TRIM(i.RDB$INDEX_NAME) AS index_name,
                                             COALESCE(i.RDB$UNIQUE_FLAG, 0) AS is_unique,
                                             TRIM(s.RDB$FIELD_NAME) AS column_name,
                                             'btree' AS method
                                        FROM RDB$INDICES i
                                        JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME
                                       WHERE 'PUBLIC' = ?
                                         AND TRIM(i.RDB$RELATION_NAME) = ?
                                       ORDER BY i.RDB$INDEX_NAME, s.RDB$FIELD_POSITION",
        _ => "SELECT '' AS index_name, 0 AS is_unique, '' AS column_name, '' AS method WHERE 1 = 0 AND ? IS NOT NULL AND ? IS NOT NULL"
    };

    protected override string ForeignKeysSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT 'fk_' || fk.id AS foreign_key_name,
                                           'main' AS referencing_schema,
                                           m.name AS referencing_table,
                                           fk.""from"" AS column_name,
                                           'main' AS referenced_schema,
                                           fk.""table"" AS referenced_table,
                                           fk.""to"" AS referenced_column,
                                           LOWER(fk.on_delete) AS on_delete,
                                           LOWER(fk.on_update) AS on_update
                                      FROM sqlite_master AS m
                                      JOIN pragma_foreign_key_list(m.name) AS fk
                                     WHERE 'main' = ?
                                       AND m.name = ?
                                     ORDER BY fk.id, fk.seq",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT kcu.CONSTRAINT_NAME AS foreign_key_name,
                                                                     kcu.TABLE_SCHEMA AS referencing_schema,
                                                                     kcu.TABLE_NAME AS referencing_table,
                                                                     kcu.COLUMN_NAME AS column_name,
                                                                     kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
                                                                     kcu.REFERENCED_TABLE_NAME AS referenced_table,
                                                                     kcu.REFERENCED_COLUMN_NAME AS referenced_column,
                                                                     LOWER(rc.DELETE_RULE) AS on_delete,
                                                                     LOWER(rc.UPDATE_RULE) AS on_update
                                                                FROM information_schema.KEY_COLUMN_USAGE AS kcu
                                                                JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                                                                  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                                                                 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                                                               WHERE kcu.TABLE_SCHEMA = ?
                                                                 AND kcu.TABLE_NAME = ?
                                                                 AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
                                                               ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        _ => "SELECT '' AS foreign_key_name, '' AS referencing_schema, '' AS referencing_table, '' AS column_name, '' AS referenced_schema, '' AS referenced_table, '' AS referenced_column, NULL AS on_delete, NULL AS on_update WHERE 1 = 0 AND ? IS NOT NULL AND ? IS NOT NULL"
    };

    protected override string ReferencedBySql => engine switch
    {
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT kcu.CONSTRAINT_NAME AS foreign_key_name,
                                                                     kcu.TABLE_SCHEMA AS referencing_schema,
                                                                     kcu.TABLE_NAME AS referencing_table,
                                                                     kcu.COLUMN_NAME AS column_name,
                                                                     kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
                                                                     kcu.REFERENCED_TABLE_NAME AS referenced_table,
                                                                     kcu.REFERENCED_COLUMN_NAME AS referenced_column,
                                                                     LOWER(rc.DELETE_RULE) AS on_delete,
                                                                     LOWER(rc.UPDATE_RULE) AS on_update
                                                                FROM information_schema.KEY_COLUMN_USAGE AS kcu
                                                                JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                                                                  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                                                                 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                                                               WHERE kcu.REFERENCED_TABLE_SCHEMA = ?
                                                                 AND kcu.REFERENCED_TABLE_NAME = ?
                                                               ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        _ => "SELECT '' AS foreign_key_name, '' AS referencing_schema, '' AS referencing_table, '' AS column_name, '' AS referenced_schema, '' AS referenced_table, '' AS referenced_column, NULL AS on_delete, NULL AS on_update WHERE 1 = 0 AND ? IS NOT NULL AND ? IS NOT NULL"
    };

    protected override string ChecksSql => engine switch
    {
        EDatabaseEngine.SqlServer => @"SELECT cc.name AS check_name,
                                              cc.definition AS expression
                                         FROM sys.check_constraints AS cc
                                         JOIN sys.objects AS o ON o.object_id = cc.parent_object_id
                                         JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                        WHERE s.name = ?
                                          AND o.name = ?
                                        ORDER BY cc.name",
        _ => "SELECT '' AS check_name, '' AS expression WHERE 1 = 0 AND ? IS NOT NULL AND ? IS NOT NULL"
    };

    protected override string ViewDefinitionSql => engine switch
    {
        EDatabaseEngine.Sqlite => "SELECT sql AS definition FROM sqlite_master WHERE type = 'view' AND 'main' = ? AND name = ?",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        EDatabaseEngine.SqlServer => @"SELECT m.definition AS definition
                                         FROM sys.sql_modules AS m
                                         JOIN sys.objects AS o ON o.object_id = m.object_id
                                         JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                        WHERE s.name = ?
                                          AND o.name = ?",
        EDatabaseEngine.Oracle => "SELECT TEXT AS definition FROM ALL_VIEWS WHERE OWNER = ? AND VIEW_NAME = ?",
        EDatabaseEngine.Firebird => "SELECT RDB$VIEW_SOURCE AS definition FROM RDB$RELATIONS WHERE 'PUBLIC' = ? AND TRIM(RDB$RELATION_NAME) = ? AND RDB$VIEW_BLR IS NOT NULL",
        EDatabaseEngine.ClickHouse => "SELECT create_table_query AS definition FROM system.tables WHERE database = ? AND name = ?",
        _ => "SELECT view_definition AS definition FROM information_schema.views WHERE table_schema = ? AND table_name = ?"
    };

    protected override string DiagramColumnsSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT m.name AS table_name,
                                           p.name AS column_name,
                                           COALESCE(NULLIF(p.type, ''), 'ANY') AS column_type,
                                           CASE WHEN p.""notnull"" = 0 THEN 1 ELSE 0 END AS is_nullable,
                                           CASE WHEN p.pk > 0 THEN 1 ELSE 0 END AS is_primary_key
                                      FROM sqlite_master AS m
                                      JOIN pragma_table_info(m.name) AS p
                                     WHERE 'main' = ?
                                       AND m.type = 'table'
                                       AND m.name NOT LIKE 'sqlite_%'
                                     ORDER BY m.name, p.cid",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT c.TABLE_NAME AS table_name,
                                                                     c.COLUMN_NAME AS column_name,
                                                                     c.COLUMN_TYPE AS column_type,
                                                                     CASE c.IS_NULLABLE WHEN 'YES' THEN 1 ELSE 0 END AS is_nullable,
                                                                     CASE c.COLUMN_KEY WHEN 'PRI' THEN 1 ELSE 0 END AS is_primary_key
                                                                FROM information_schema.TABLES AS t
                                                                JOIN information_schema.COLUMNS AS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
                                                               WHERE t.TABLE_SCHEMA = ?
                                                                 AND t.TABLE_TYPE = 'BASE TABLE'
                                                               ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
        _ => "SELECT '' AS table_name, '' AS column_name, '' AS column_type, 1 AS is_nullable, 0 AS is_primary_key WHERE 1 = 0 AND ? IS NOT NULL"
    };

    protected override string DiagramForeignKeysSql => engine switch
    {
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT kcu.CONSTRAINT_NAME AS foreign_key_name,
                                                                     kcu.TABLE_SCHEMA AS referencing_schema,
                                                                     kcu.TABLE_NAME AS referencing_table,
                                                                     kcu.COLUMN_NAME AS column_name,
                                                                     kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
                                                                     kcu.REFERENCED_TABLE_NAME AS referenced_table,
                                                                     kcu.REFERENCED_COLUMN_NAME AS referenced_column,
                                                                     LOWER(rc.DELETE_RULE) AS on_delete,
                                                                     LOWER(rc.UPDATE_RULE) AS on_update
                                                                FROM information_schema.KEY_COLUMN_USAGE AS kcu
                                                                JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
                                                                  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                                                                 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                                                               WHERE kcu.TABLE_SCHEMA = ?
                                                                 AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
                                                               ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
        _ => "SELECT '' AS foreign_key_name, '' AS referencing_schema, '' AS referencing_table, '' AS column_name, '' AS referenced_schema, '' AS referenced_table, '' AS referenced_column, NULL AS on_delete, NULL AS on_update WHERE 1 = 0 AND ? IS NOT NULL"
    };

    protected override string DatabasesSql => engine switch
    {
        EDatabaseEngine.Sqlite => "SELECT 'main', 1",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => "SELECT SCHEMA_NAME, CASE WHEN SCHEMA_NAME = DATABASE() THEN 1 ELSE 0 END FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        EDatabaseEngine.SqlServer => "SELECT name, CASE WHEN name = DB_NAME() THEN 1 ELSE 0 END FROM sys.databases WHERE state = 0 ORDER BY name",
        EDatabaseEngine.Oracle => "SELECT SYS_CONTEXT('USERENV', 'DB_NAME'), 1 FROM DUAL",
        EDatabaseEngine.Firebird => "SELECT TRIM(MON$DATABASE_NAME), 1 FROM MON$DATABASE",
        EDatabaseEngine.DuckDb => "SELECT database_name, CASE WHEN database_name = current_database() THEN 1 ELSE 0 END FROM duckdb_databases() ORDER BY database_name",
        EDatabaseEngine.ClickHouse => "SELECT name, CASE WHEN name = currentDatabase() THEN 1 ELSE 0 END FROM system.databases ORDER BY name",
        _ => "SELECT 'default', 1"
    };

    protected override IReadOnlyList<string> PropertiesSql => [];

    protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
        => engine switch
        {
            EDatabaseEngine.Sqlite => (@"SELECT 'main',
                                                name,
                                                CASE type WHEN 'table' THEN 'table' WHEN 'view' THEN 'view' ELSE 'other' END,
                                                CAST(NULL AS INTEGER),
                                                0
                                           FROM sqlite_master
                                          WHERE type IN ('table', 'view')
                                            AND name = ?", [table.Name]),
            EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => ($@"SELECT TABLE_SCHEMA,
                                                                           TABLE_NAME,
                                                                           CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' ELSE 'other' END,
                                                                           CAST(NULL AS SIGNED),
                                                                           0
                                                                      FROM information_schema.TABLES
                                                                     WHERE TABLE_SCHEMA = {(table.Schema is null ? "DATABASE()" : "?")}
                                                                       AND TABLE_NAME = ?", table.Schema is null ? [table.Name] : [table.Schema, table.Name]),
            EDatabaseEngine.SqlServer => ($@"SELECT s.name,
                                                    o.name,
                                                    CASE o.type WHEN 'U' THEN 'table' WHEN 'V' THEN 'view' ELSE 'other' END,
                                                    CAST(NULL AS BIGINT),
                                                    0
                                               FROM sys.objects AS o
                                               JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                              WHERE s.name = {(table.Schema is null ? "SCHEMA_NAME()" : "?")}
                                                AND o.name = ?
                                                AND o.type IN ('U', 'V')", table.Schema is null ? [table.Name] : [table.Schema, table.Name]),
            EDatabaseEngine.Oracle => ($@"SELECT OWNER,
                                                 OBJECT_NAME,
                                                 CASE OBJECT_TYPE WHEN 'TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' WHEN 'MATERIALIZED VIEW' THEN 'materializedView' ELSE 'other' END,
                                                 CAST(NULL AS NUMBER(19)),
                                                 0
                                            FROM ALL_OBJECTS
                                           WHERE OWNER = {(table.Schema is null ? "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')" : "?")}
                                             AND OBJECT_NAME = ?
                                             AND OBJECT_TYPE IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')", table.Schema is null ? [table.Name] : [table.Schema, table.Name]),
            EDatabaseEngine.Firebird => (@"SELECT 'PUBLIC',
                                                  TRIM(RDB$RELATION_NAME),
                                                  CASE WHEN RDB$VIEW_BLR IS NULL THEN 'table' ELSE 'view' END,
                                                  CAST(NULL AS BIGINT),
                                                  0
                                             FROM RDB$RELATIONS
                                            WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                              AND TRIM(RDB$RELATION_NAME) = ?", [table.Name]),
            _ => ($@"SELECT table_schema,
                            table_name,
                            CASE table_type WHEN 'BASE TABLE' THEN 'table' WHEN 'VIEW' THEN 'view' ELSE 'other' END,
                            CAST(NULL AS BIGINT),
                            0
                       FROM information_schema.tables
                      WHERE {(table.Schema is null ? "1 = 1" : "table_schema = ?")}
                        AND table_name = ?", table.Schema is null ? [table.Name] : [table.Schema, table.Name])
        };

    protected override string EditKeysSql => engine switch
    {
        EDatabaseEngine.Sqlite => @"SELECT 'pk',
                                           1,
                                           p.name
                                      FROM pragma_table_info((SELECT name FROM sqlite_master WHERE 'main' = ? AND name = ?)) AS p
                                     WHERE p.pk > 0
                                     ORDER BY p.pk",
        EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => @"SELECT INDEX_NAME,
                                                                     CASE WHEN INDEX_NAME = 'PRIMARY' THEN 1 ELSE 0 END AS is_primary,
                                                                     COLUMN_NAME
                                                                FROM information_schema.STATISTICS
                                                               WHERE TABLE_SCHEMA = ?
                                                                 AND TABLE_NAME = ?
                                                                 AND NON_UNIQUE = 0
                                                               ORDER BY is_primary DESC, INDEX_NAME, SEQ_IN_INDEX",
        EDatabaseEngine.SqlServer => @"SELECT i.name,
                                              CAST(i.is_primary_key AS INT) AS is_primary,
                                              c.name
                                         FROM sys.indexes AS i
                                         JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                                         JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                                         JOIN sys.objects AS o ON o.object_id = i.object_id
                                         JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                        WHERE s.name = ?
                                          AND o.name = ?
                                          AND i.is_unique = 1
                                          AND i.has_filter = 0
                                        ORDER BY is_primary DESC, i.name, ic.key_ordinal",
        EDatabaseEngine.Oracle => @"SELECT cons.CONSTRAINT_NAME,
                                           CASE cons.CONSTRAINT_TYPE WHEN 'P' THEN 1 ELSE 0 END AS is_primary,
                                           cols.COLUMN_NAME
                                      FROM ALL_CONSTRAINTS cons
                                      JOIN ALL_CONS_COLUMNS cols ON cols.OWNER = cons.OWNER AND cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME
                                     WHERE cons.OWNER = ?
                                       AND cons.TABLE_NAME = ?
                                       AND cons.CONSTRAINT_TYPE IN ('P', 'U')
                                       AND cons.STATUS = 'ENABLED'
                                     ORDER BY is_primary DESC, cons.CONSTRAINT_NAME, cols.POSITION",
        EDatabaseEngine.Firebird => @"SELECT TRIM(rc.RDB$CONSTRAINT_NAME),
                                             CASE WHEN rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' THEN 1 ELSE 0 END AS is_primary,
                                             TRIM(s.RDB$FIELD_NAME)
                                        FROM RDB$RELATION_CONSTRAINTS rc
                                        JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
                                       WHERE 'PUBLIC' = ?
                                         AND TRIM(rc.RDB$RELATION_NAME) = ?
                                         AND rc.RDB$CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
                                       ORDER BY is_primary DESC, rc.RDB$CONSTRAINT_NAME, s.RDB$FIELD_POSITION",
        _ => "SELECT '' AS key_name, 0 AS is_primary, '' AS column_name WHERE 1 = 0 AND ? IS NOT NULL AND ? IS NOT NULL"
    };

    protected override string? ObjectsSql(string kind)
        => (engine, kind) switch
        {
            (EDatabaseEngine.Sqlite, "tables") => @"SELECT name AS object_name,
                                                           'table' AS object_kind,
                                                           CAST(NULL AS INTEGER) AS estimated_rows,
                                                           CAST(NULL AS TEXT) AS object_comment
                                                      FROM sqlite_master
                                                     WHERE 'main' = ?
                                                       AND type = 'table'
                                                       AND name NOT LIKE 'sqlite_%'
                                                     ORDER BY name",
            (EDatabaseEngine.Sqlite, "views") => @"SELECT name AS object_name,
                                                          'view' AS object_kind,
                                                          CAST(NULL AS INTEGER) AS estimated_rows,
                                                          CAST(NULL AS TEXT) AS object_comment
                                                     FROM sqlite_master
                                                    WHERE 'main' = ?
                                                      AND type = 'view'
                                                    ORDER BY name",
            (EDatabaseEngine.Sqlite, "routines") => "SELECT '' AS object_name, 'function' AS object_kind, CAST(NULL AS INTEGER) AS estimated_rows, CAST(NULL AS TEXT) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (EDatabaseEngine.Sqlite, "sequences") => "SELECT '' AS object_name, 'sequence' AS object_kind, CAST(NULL AS INTEGER) AS estimated_rows, CAST(NULL AS TEXT) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (EDatabaseEngine.MySql, "sequences") => "SELECT '' AS object_name, 'sequence' AS object_kind, CAST(NULL AS SIGNED) AS estimated_rows, CAST(NULL AS CHAR) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (EDatabaseEngine.MariaDb, "sequences") => @"SELECT TABLE_NAME AS object_name,
                                                               'sequence' AS object_kind,
                                                               CAST(NULL AS SIGNED) AS estimated_rows,
                                                               NULLIF(TABLE_COMMENT, '') AS object_comment
                                                          FROM information_schema.TABLES
                                                         WHERE TABLE_SCHEMA = ?
                                                           AND TABLE_TYPE = 'SEQUENCE'
                                                         ORDER BY TABLE_NAME",
            (EDatabaseEngine.SqlServer, "sequences") => @"SELECT o.name AS object_name,
                                                                 'sequence' AS object_kind,
                                                                 CAST(NULL AS BIGINT) AS estimated_rows,
                                                                 CAST(NULL AS NVARCHAR(1)) AS object_comment
                                                            FROM sys.objects AS o
                                                            JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                                           WHERE s.name = ?
                                                             AND o.type = 'SO'
                                                           ORDER BY o.name",
            (EDatabaseEngine.Oracle, "sequences") => @"SELECT SEQUENCE_NAME AS object_name,
                                                              'sequence' AS object_kind,
                                                              CAST(NULL AS NUMBER(19)) AS estimated_rows,
                                                              CAST(NULL AS VARCHAR2(1)) AS object_comment
                                                         FROM ALL_SEQUENCES
                                                        WHERE SEQUENCE_OWNER = ?
                                                        ORDER BY SEQUENCE_NAME",
            (EDatabaseEngine.Firebird, "sequences") => @"SELECT TRIM(RDB$GENERATOR_NAME) AS object_name,
                                                                'sequence' AS object_kind,
                                                                CAST(NULL AS BIGINT) AS estimated_rows,
                                                                TRIM(RDB$DESCRIPTION) AS object_comment
                                                           FROM RDB$GENERATORS
                                                          WHERE 'PUBLIC' = ?
                                                            AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                                          ORDER BY RDB$GENERATOR_NAME",
            (EDatabaseEngine.ClickHouse, "sequences") => "SELECT '' AS object_name, 'sequence' AS object_kind, CAST(NULL AS Nullable(Int64)) AS estimated_rows, CAST(NULL AS Nullable(String)) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (_, "sequences") => "SELECT '' AS object_name, 'sequence' AS object_kind, CAST(NULL AS BIGINT) AS estimated_rows, CAST(NULL AS VARCHAR) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (EDatabaseEngine.MySql or EDatabaseEngine.MariaDb, "tables") => @"SELECT TABLE_NAME AS object_name,
                                                                                     'table' AS object_kind,
                                                                                     TABLE_ROWS AS estimated_rows,
                                                                                     NULLIF(TABLE_COMMENT, '') AS object_comment
                                                                                FROM information_schema.TABLES
                                                                               WHERE TABLE_SCHEMA = ?
                                                                                 AND TABLE_TYPE = 'BASE TABLE'
                                                                               ORDER BY TABLE_NAME",
            (EDatabaseEngine.MySql or EDatabaseEngine.MariaDb, "views") => @"SELECT TABLE_NAME AS object_name,
                                                                                    'view' AS object_kind,
                                                                                    CAST(NULL AS SIGNED) AS estimated_rows,
                                                                                    CAST(NULL AS CHAR) AS object_comment
                                                                               FROM information_schema.TABLES
                                                                              WHERE TABLE_SCHEMA = ?
                                                                                AND TABLE_TYPE = 'VIEW'
                                                                              ORDER BY TABLE_NAME",
            (EDatabaseEngine.MySql or EDatabaseEngine.MariaDb, "routines") => @"SELECT ROUTINE_NAME AS object_name,
                                                                                       CASE ROUTINE_TYPE WHEN 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS object_kind,
                                                                                       CAST(NULL AS SIGNED) AS estimated_rows,
                                                                                       NULLIF(ROUTINE_COMMENT, '') AS object_comment
                                                                                  FROM information_schema.ROUTINES
                                                                                 WHERE ROUTINE_SCHEMA = ?
                                                                                 ORDER BY ROUTINE_NAME",
            (EDatabaseEngine.SqlServer, "tables") => @"SELECT o.name AS object_name,
                                                              'table' AS object_kind,
                                                              SUM(p.rows) AS estimated_rows,
                                                              CAST(NULL AS NVARCHAR(1)) AS object_comment
                                                         FROM sys.objects AS o
                                                         JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                                         LEFT JOIN sys.partitions AS p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
                                                        WHERE s.name = ?
                                                          AND o.type = 'U'
                                                        GROUP BY o.name
                                                        ORDER BY o.name",
            (EDatabaseEngine.SqlServer, "views") => @"SELECT o.name AS object_name,
                                                             'view' AS object_kind,
                                                             CAST(NULL AS BIGINT) AS estimated_rows,
                                                             CAST(NULL AS NVARCHAR(1)) AS object_comment
                                                        FROM sys.objects AS o
                                                        JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                                       WHERE s.name = ?
                                                         AND o.type = 'V'
                                                       ORDER BY o.name",
            (EDatabaseEngine.SqlServer, "routines") => @"SELECT o.name AS object_name,
                                                                CASE WHEN o.type = 'P' THEN 'procedure' ELSE 'function' END AS object_kind,
                                                                CAST(NULL AS BIGINT) AS estimated_rows,
                                                                CAST(NULL AS NVARCHAR(1)) AS object_comment
                                                           FROM sys.objects AS o
                                                           JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                                          WHERE s.name = ?
                                                            AND o.type IN ('P', 'FN', 'IF', 'TF')
                                                          ORDER BY o.name",
            (EDatabaseEngine.Oracle, "tables") => @"SELECT TABLE_NAME AS object_name,
                                                           'table' AS object_kind,
                                                           NUM_ROWS AS estimated_rows,
                                                           CAST(NULL AS VARCHAR2(1)) AS object_comment
                                                      FROM ALL_TABLES
                                                     WHERE OWNER = ?
                                                     ORDER BY TABLE_NAME",
            (EDatabaseEngine.Oracle, "views") => @"SELECT VIEW_NAME AS object_name,
                                                          'view' AS object_kind,
                                                          CAST(NULL AS NUMBER(19)) AS estimated_rows,
                                                          CAST(NULL AS VARCHAR2(1)) AS object_comment
                                                     FROM ALL_VIEWS
                                                    WHERE OWNER = ?
                                                    ORDER BY VIEW_NAME",
            (EDatabaseEngine.Oracle, "routines") => @"SELECT OBJECT_NAME AS object_name,
                                                             CASE OBJECT_TYPE WHEN 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS object_kind,
                                                             CAST(NULL AS NUMBER(19)) AS estimated_rows,
                                                             CAST(NULL AS VARCHAR2(1)) AS object_comment
                                                        FROM ALL_PROCEDURES
                                                       WHERE OWNER = ?
                                                         AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
                                                       ORDER BY OBJECT_NAME",
            (EDatabaseEngine.Firebird, "tables") => @"SELECT TRIM(RDB$RELATION_NAME) AS object_name,
                                                             'table' AS object_kind,
                                                             CAST(NULL AS BIGINT) AS estimated_rows,
                                                             TRIM(RDB$DESCRIPTION) AS object_comment
                                                        FROM RDB$RELATIONS
                                                       WHERE 'PUBLIC' = ?
                                                         AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                                         AND RDB$VIEW_BLR IS NULL
                                                       ORDER BY RDB$RELATION_NAME",
            (EDatabaseEngine.Firebird, "views") => @"SELECT TRIM(RDB$RELATION_NAME) AS object_name,
                                                            'view' AS object_kind,
                                                            CAST(NULL AS BIGINT) AS estimated_rows,
                                                            TRIM(RDB$DESCRIPTION) AS object_comment
                                                       FROM RDB$RELATIONS
                                                      WHERE 'PUBLIC' = ?
                                                        AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                                        AND RDB$VIEW_BLR IS NOT NULL
                                                      ORDER BY RDB$RELATION_NAME",
            (EDatabaseEngine.Firebird, "routines") => @"SELECT TRIM(RDB$PROCEDURE_NAME) AS object_name,
                                                               'procedure' AS object_kind,
                                                               CAST(NULL AS BIGINT) AS estimated_rows,
                                                               TRIM(RDB$DESCRIPTION) AS object_comment
                                                          FROM RDB$PROCEDURES
                                                         WHERE 'PUBLIC' = ?
                                                           AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                                         UNION ALL
                                                        SELECT TRIM(RDB$FUNCTION_NAME) AS object_name,
                                                               'function' AS object_kind,
                                                               CAST(NULL AS BIGINT) AS estimated_rows,
                                                               TRIM(RDB$DESCRIPTION) AS object_comment
                                                          FROM RDB$FUNCTIONS
                                                         WHERE 'PUBLIC' = ?
                                                           AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                                         ORDER BY 1",
            (EDatabaseEngine.ClickHouse, "tables") => @"SELECT name AS object_name,
                                                               'table' AS object_kind,
                                                               total_rows AS estimated_rows,
                                                               NULLIF(comment, '') AS object_comment
                                                          FROM system.tables
                                                         WHERE database = ?
                                                           AND engine NOT IN ('View', 'MaterializedView')
                                                         ORDER BY name",
            (EDatabaseEngine.ClickHouse, "views") => @"SELECT name AS object_name,
                                                              'view' AS object_kind,
                                                              CAST(NULL AS Nullable(Int64)) AS estimated_rows,
                                                              NULLIF(comment, '') AS object_comment
                                                         FROM system.tables
                                                        WHERE database = ?
                                                          AND engine IN ('View', 'MaterializedView')
                                                        ORDER BY name",
            (EDatabaseEngine.ClickHouse, "routines") => "SELECT '' AS object_name, 'function' AS object_kind, CAST(NULL AS Nullable(Int64)) AS estimated_rows, CAST(NULL AS Nullable(String)) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            (_, "tables") => @"SELECT table_name AS object_name,
                                      'table' AS object_kind,
                                      CAST(NULL AS BIGINT) AS estimated_rows,
                                      CAST(NULL AS VARCHAR) AS object_comment
                                 FROM information_schema.tables
                                WHERE table_schema = ?
                                  AND table_type = 'BASE TABLE'
                                ORDER BY table_name",
            (_, "views") => @"SELECT table_name AS object_name,
                                     'view' AS object_kind,
                                     CAST(NULL AS BIGINT) AS estimated_rows,
                                     CAST(NULL AS VARCHAR) AS object_comment
                                FROM information_schema.tables
                               WHERE table_schema = ?
                                 AND table_type = 'VIEW'
                               ORDER BY table_name",
            (_, "routines") => "SELECT '' AS object_name, 'function' AS object_kind, CAST(NULL AS BIGINT) AS estimated_rows, CAST(NULL AS VARCHAR) AS object_comment WHERE 1 = 0 AND ? IS NOT NULL",
            _ => null
        };

    protected override string ObjectNamesSql(int rows)
        => engine switch
        {
            EDatabaseEngine.Sqlite => $@"SELECT 'main' AS schema_name,
                                                0 AS is_system,
                                                name AS object_name,
                                                CASE type WHEN 'view' THEN 'view' ELSE 'table' END AS object_kind
                                           FROM sqlite_master
                                          WHERE type IN ('table', 'view')
                                            AND name NOT LIKE 'sqlite_%'
                                          ORDER BY name
                                          LIMIT {rows}",
            EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => $@"SELECT TABLE_SCHEMA AS schema_name,
                                                                          CASE WHEN LOWER(TABLE_SCHEMA) IN ('information_schema', 'mysql', 'performance_schema', 'sys') THEN 1 ELSE 0 END AS is_system,
                                                                          TABLE_NAME AS object_name,
                                                                          CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS object_kind
                                                                     FROM information_schema.TABLES
                                                                    WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
                                                                    ORDER BY is_system, TABLE_SCHEMA, TABLE_NAME
                                                                    LIMIT {rows}",
            EDatabaseEngine.SqlServer => $@"SELECT TOP ({rows})
                                                   s.name AS schema_name,
                                                   CASE WHEN s.name IN ('sys', 'INFORMATION_SCHEMA', 'guest') OR s.name LIKE 'db_%' THEN 1 ELSE 0 END AS is_system,
                                                   o.name AS object_name,
                                                   CASE WHEN o.type = 'V' THEN 'view' ELSE 'table' END AS object_kind
                                              FROM sys.objects AS o
                                              JOIN sys.schemas AS s ON s.schema_id = o.schema_id
                                             WHERE o.type IN ('U', 'V')
                                             ORDER BY is_system, s.name, o.name",
            EDatabaseEngine.Oracle => $@"SELECT o.OWNER AS schema_name,
                                                CASE WHEN u.ORACLE_MAINTAINED = 'Y' THEN 1 ELSE 0 END AS is_system,
                                                o.OBJECT_NAME AS object_name,
                                                CASE WHEN o.OBJECT_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS object_kind
                                           FROM ALL_OBJECTS o
                                           JOIN ALL_USERS u ON u.USERNAME = o.OWNER
                                          WHERE o.OBJECT_TYPE IN ('TABLE', 'VIEW')
                                          ORDER BY is_system, o.OWNER, o.OBJECT_NAME
                                          FETCH FIRST {rows} ROWS ONLY",
            EDatabaseEngine.Firebird => $@"SELECT FIRST {rows}
                                                  'PUBLIC' AS schema_name,
                                                  0 AS is_system,
                                                  TRIM(RDB$RELATION_NAME) AS object_name,
                                                  CASE WHEN RDB$VIEW_BLR IS NOT NULL THEN 'view' ELSE 'table' END AS object_kind
                                             FROM RDB$RELATIONS
                                            WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
                                            ORDER BY RDB$RELATION_NAME",
            EDatabaseEngine.ClickHouse => $@"SELECT database AS schema_name,
                                                    CASE WHEN database IN ('system', 'information_schema', 'INFORMATION_SCHEMA') THEN 1 ELSE 0 END AS is_system,
                                                    name AS object_name,
                                                    CASE WHEN engine IN ('View', 'MaterializedView') THEN 'view' ELSE 'table' END AS object_kind
                                               FROM system.tables
                                              ORDER BY is_system, database, name
                                              LIMIT {rows}",
            _ => $@"SELECT table_schema AS schema_name,
                           CASE WHEN LOWER(table_schema) IN ('information_schema', 'pg_catalog', 'sys') THEN 1 ELSE 0 END AS is_system,
                           table_name AS object_name,
                           CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS object_kind
                      FROM information_schema.tables
                     WHERE table_type IN ('BASE TABLE', 'VIEW')
                     ORDER BY is_system, table_schema, table_name
                     LIMIT {rows}"
        };

    protected override string CountSql(string sql)
        => $"SELECT COUNT(*) FROM (\n{SqlText.Statement(sql, QueryDialect)}\n) prism_total";

    protected override bool TriesAsRead(string sql)
        => SqlText.IsSingleRead(sql, QueryDialect);

    protected override bool IsTransactionControl(string sql)
        => SqlText.IsTransactionControl(sql, QueryDialect);

    protected override bool HasSeveralStatements(string sql)
        => SqlText.HasSeveralStatements(sql, QueryDialect);

    protected override bool MayBeCounted(string sql)
        => SqlText.IsSingleRead(sql, QueryDialect);

    protected override bool IsWriteRefusal(DatabaseFailure failure)
        => false;

    protected override void ConfigureUserCommand(DbCommand command)
        => command.CommandText = SqlText.RewriteDoubleQuotedLiterals(SqlText.Statement(command.CommandText, QueryDialect), QueryDialect);

    protected override string QuotedName(string name)
        => engine is EDatabaseEngine.MySql or EDatabaseEngine.MariaDb or EDatabaseEngine.ClickHouse or EDatabaseEngine.BigQuery or EDatabaseEngine.Databricks
            ? $"`{name.Replace("`", "``", StringComparison.Ordinal)}`"
            : base.QuotedName(name);

    protected override void BindQueryParameter(DbParameter parameter, BoundQueryParameter bound)
    {
        if (bound.DbType is { } type)
            parameter.DbType = type;

        if (bound.Ibm == EIbmParameterType.Decimal && bound.Value is string text && decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            parameter.Value = parsed;
            return;
        }

        parameter.Value = bound.Value ?? DBNull.Value;
    }

    protected override void PrepareCommand(DbCommand command)
    {
        if (command.Parameters.Count == 0)
            return;

        Func<ParameterMarker, string>? tokenOf = engine switch
        {
            EDatabaseEngine.Sqlite or EDatabaseEngine.DuckDb => static marker => $"${marker.Index + 1}",
            EDatabaseEngine.SqlServer or EDatabaseEngine.ClickHouse => static marker => $"@p{marker.Index + 1}",
            EDatabaseEngine.Oracle => static marker => $":p{marker.Index + 1}",
            _ => null
        };

        if (tokenOf is null)
            return;

        var markers = ParameterMarkers.Find(command.CommandText, QueryDialect);
        if (markers.Count > 0)
            command.CommandText = ParameterMarkers.Rewrite(command.CommandText, markers, tokenOf);

        for (var i = 0; i < command.Parameters.Count; i++)
        {
            command.Parameters[i].ParameterName = engine switch
            {
                EDatabaseEngine.Sqlite or EDatabaseEngine.DuckDb => $"${i + 1}",
                EDatabaseEngine.SqlServer => $"@p{i + 1}",
                EDatabaseEngine.Oracle or EDatabaseEngine.ClickHouse => $"p{i + 1}",
                _ => command.Parameters[i].ParameterName
            };
        }
    }

    protected override DbConnection CreateConnection()
    {
        var (assemblyName, typeName) = DriverTypeOf(engine);
        var connectionType = FindConnectionType(assemblyName, typeName)
            ?? throw new InvalidOperationException($"O driver de {engine} ({typeName}) não foi encontrado nos assemblies carregados.");

        return (DbConnection)Activator.CreateInstance(connectionType, BuildConnectionString())!;
    }

    protected override DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception)
    {
        var sqlState = (exception as DbException ?? exception.InnerException as DbException)?.SqlState is { Length: > 0 } state ? state : null;

        return new DatabaseFailure(kind, PostgresConnection.CauseText(exception), sqlState);
    }

    internal string BuildConnectionString()
    {
        var builder = new DbConnectionStringBuilder();
        var fileTarget = string.IsNullOrWhiteSpace(settings.Database) ? settings.Host : settings.Database;

        switch (engine)
        {
            case EDatabaseEngine.Sqlite:
                builder["Data Source"] = fileTarget;
                builder["Mode"] = "ReadWriteCreate";
                builder["Pooling"] = false;
                if (!string.IsNullOrEmpty(settings.Password))
                    builder["Password"] = settings.Password;
                break;

            case EDatabaseEngine.MySql:
            case EDatabaseEngine.MariaDb:
                builder["Server"] = settings.Host;
                builder["Port"] = settings.Port;
                builder["Database"] = settings.Database;
                builder["User ID"] = settings.UserName;
                builder["Password"] = settings.Password;
                builder["Pooling"] = false;
                builder["ConnectionTimeout"] = ConnectTimeoutSeconds;
                builder["AllowUserVariables"] = true;
                break;

            case EDatabaseEngine.SqlServer:
                builder["Data Source"] = $"{settings.Host},{settings.Port}";
                builder["Initial Catalog"] = settings.Database;
                builder["User ID"] = settings.UserName;
                builder["Password"] = settings.Password;
                builder["Pooling"] = false;
                builder["Connect Timeout"] = ConnectTimeoutSeconds;
                builder["TrustServerCertificate"] = true;
                break;

            case EDatabaseEngine.Oracle:
                builder["Data Source"] = $"//{settings.Host}:{settings.Port}/{settings.Database}";
                builder["User Id"] = settings.UserName;
                builder["Password"] = settings.Password;
                builder["Pooling"] = false;
                builder["Connection Timeout"] = ConnectTimeoutSeconds;
                break;

            case EDatabaseEngine.Firebird:
                builder["DataSource"] = settings.Host;
                builder["Port"] = settings.Port;
                builder["Database"] = settings.Database;
                builder["UserID"] = settings.UserName;
                builder["Password"] = settings.Password;
                builder["Pooling"] = false;
                builder["ConnectionTimeout"] = ConnectTimeoutSeconds;
                builder["Charset"] = "UTF8";
                break;

            case EDatabaseEngine.DuckDb:
                builder["Data Source"] = fileTarget;
                break;

            case EDatabaseEngine.ClickHouse:
                builder["Host"] = settings.Host;
                builder["Port"] = settings.Port;
                builder["Database"] = settings.Database;
                builder["Username"] = settings.UserName;
                builder["Password"] = settings.Password;
                break;

            case EDatabaseEngine.BigQuery:
                builder["Driver"] = "{Google BigQuery}";
                builder["Host"] = settings.Host;
                builder["Port"] = settings.Port;
                builder["Catalog"] = settings.Database;
                builder["UID"] = settings.UserName;
                builder["PWD"] = settings.Password;
                break;

            case EDatabaseEngine.Databricks:
                builder["Driver"] = "{Simba Spark ODBC Driver}";
                builder["Host"] = settings.Host;
                builder["Port"] = settings.Port;
                builder["Schema"] = settings.Database;
                builder["UID"] = settings.UserName;
                builder["PWD"] = settings.Password;
                builder["AuthMech"] = 3;
                builder["SSL"] = 1;
                builder["ThriftTransport"] = 2;
                break;
        }

        return builder.ConnectionString;
    }

    private static (string AssemblyName, string TypeName) DriverTypeOf(EDatabaseEngine engine)
        => engine switch
        {
            EDatabaseEngine.Sqlite => ("Microsoft.Data.Sqlite", "Microsoft.Data.Sqlite.SqliteConnection"),
            EDatabaseEngine.MySql or EDatabaseEngine.MariaDb => ("MySqlConnector", "MySqlConnector.MySqlConnection"),
            EDatabaseEngine.SqlServer => ("Microsoft.Data.SqlClient", "Microsoft.Data.SqlClient.SqlConnection"),
            EDatabaseEngine.Oracle => ("Oracle.ManagedDataAccess", "Oracle.ManagedDataAccess.Client.OracleConnection"),
            EDatabaseEngine.Firebird => ("FirebirdSql.Data.FirebirdClient", "FirebirdSql.Data.FirebirdClient.FbConnection"),
            EDatabaseEngine.DuckDb => ("DuckDB.NET.Data", "DuckDB.NET.Data.DuckDBConnection"),
            EDatabaseEngine.ClickHouse => ("ClickHouse.Driver", "ClickHouse.Driver.ADO.ClickHouseConnection"),
            EDatabaseEngine.BigQuery => ("Google.Cloud.BigQuery.V2", "System.Data.Odbc.OdbcConnection"),
            EDatabaseEngine.Databricks => ("System.Data.Odbc", "System.Data.Odbc.OdbcConnection"),
            _ => throw new ArgumentOutOfRangeException(nameof(engine), engine, null)
        };

    private static Type? FindConnectionType(string assemblyName, string typeName)
    {
        foreach (var assembly in AssemblyLoadContext.Default.Assemblies)
        {
            if (assembly.GetType(typeName, throwOnError: false) is { } found)
                return found;
        }

        var loaded = AssemblyLoadContext.Default.LoadFromAssemblyName(new AssemblyName(assemblyName));
        if (loaded.GetType(typeName, throwOnError: false) is { } loadedType)
            return loadedType;

        return loaded.GetExportedTypes().FirstOrDefault(type => !type.IsAbstract && typeof(DbConnection).IsAssignableFrom(type));
    }
}
