#if PRISM_IBM_DRIVER
using IBM.Data.Db2;
using Prism.Infrastructure.Databases.Models;
using System.Data.Common;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O que só o Informix sabe: o catálogo (`systables`, `syscolumns`, `sysindexes`, `sysconstraints`, `sysreferences`,
/// `sysprocedures`) e a sonda de transação. Todo nome vai como parâmetro (`?`), nunca dentro do SQL. "Esquema" aqui é o dono do objeto
/// (RN-ARVORE-004), e o nome escrito sem aspas fica em minúsculas no catálogo.
///
/// Ao contrário do Db2, um comando consegue deixar a conexão dentro de uma transação, mesmo com o driver em auto-commit: `BEGIN WORK`
/// abre uma que só acaba no `COMMIT` ou no `ROLLBACK`, e o que for gravado depois dele some quando a sessão fecha. A recusa da
/// RN-SQL-003 pega o comando escrito assim, e a da RN-SQL-001 o que vem depois de outro comando no mesmo envio; a rotina que abre a
/// transação por dentro (`EXECUTE PROCEDURE`), e o que mais escapar das duas, quem pega é a sonda.
/// </summary>
internal sealed class InformixConnection(ConnectionSettings settings, ILogger logger) : IbmDatabaseConnection(settings, logger)
{
    /// <summary>Os números nativos do Informix que a sonda de transação lê: "Already in transaction" e "Transaction not available" (banco sem log).</summary>
    private const int AlreadyInTransaction = -535;
    private const int TransactionNotAvailable = -256;

    /// <summary>"Statement interrupted by user": o número nativo com que o Informix diz que interrompeu o comando a pedido (RN-SQL-010).</summary>
    private const int StatementInterrupted = -213;

    /// <summary>A ida e volta da sonda é um `BEGIN WORK` e um `ROLLBACK WORK`: se o banco não responde nesse prazo, ela falhou.</summary>
    private const int ProbeTimeoutSeconds = 5;

    /// <summary>
    /// O texto que o driver da IBM manda como `CLOB` quando o parâmetro não tem tipo: o de mais caracteres que isso. E o tamanho do `LONG VARCHAR` do driver,
    /// em bytes de UTF-8, que é como ele manda o texto (<see cref="BindEditParameter"/>).
    /// </summary>
    private const int UntypedTextCharacters = 16_350;
    private const int LongVarCharBytes = 32_767;

    /// <summary>Um índice do Informix guarda até dezesseis colunas, em `part1` a `part16`; o número negativo é coluna em ordem decrescente.</summary>
    private static readonly IEnumerable<int> IndexParts = Enumerable.Range(1, 16);

    /// <summary>As posições de 1 a 16, como tabela (`slots`): é o que transforma as dezesseis colunas `partN` em linhas, na ordem do índice.</summary>
    private static readonly string Positions = string.Join(" UNION ALL ", IndexParts.Select(part => $"SELECT {part} AS slot FROM systables WHERE tabid = 1"));

    /// <summary>
    /// O número nativo do último erro que o driver devolveu nesta conexão. A sonda de transação decide por ele, e não pelo texto da
    /// mensagem: o SQLSTATE do Informix é `IX000` para quase tudo, e a recusa que sai da base não carrega o número.
    /// </summary>
    private int _lastNativeError;

    /// <summary>As letras de `tabtype` do que a árvore mostra como tabela (a comum e a externa) e como visão, e os `mode` das rotinas do usuário.</summary>
    private const string TableTypes = "'T', 'E'";
    private const string ViewTypes = "'V'";
    private const string RoutineModes = "'D', 'O', 'P', 'R', 'T'";

    protected override ESqlDialect Dialect => ESqlDialect.Informix;

    /// <summary>RN-CONN-013.</summary>
    protected override string PingSql => "SELECT 1 FROM systables WHERE tabid = 1";

    /// <summary>
    /// RN-ARVORE-004: os donos do que a árvore mostra, que são tabelas, visões e rotinas (o catálogo também tem linhas sem dono, que
    /// não são objeto, e donos só de rotinas internas do servidor, que a árvore não lista). De sistema é o `informix`, dono do
    /// catálogo em todo banco; as tabelas que alguém criou com esse usuário aparecem nele, antes das do catálogo. RN-CAT-010: as
    /// contagens são das mesmas letras de `tabtype` e dos mesmos `mode` que a lista de objetos mostra, agrupadas pelo dono.
    /// </summary>
    protected override string SchemasSql => $@"SELECT TRIM(owners.owner) AS schema_name,
                                                      CASE WHEN owners.owner = 'informix' THEN 1 ELSE 0 END AS is_system,
                                                      NVL(objects.tables, 0) AS tables,
                                                      NVL(objects.views, 0) AS views,
                                                      NVL(routines.routines, 0) AS routines
                                                 FROM (SELECT owner FROM systables WHERE tabtype IN ({TableTypes}, {ViewTypes})
                                                        UNION
                                                       SELECT owner FROM sysprocedures WHERE mode IN ({RoutineModes})) AS owners
                                                 LEFT JOIN (SELECT owner,
                                                                   SUM(CASE WHEN tabtype IN ({TableTypes}) THEN 1 ELSE 0 END) AS tables,
                                                                   SUM(CASE WHEN tabtype IN ({ViewTypes}) THEN 1 ELSE 0 END) AS views
                                                              FROM systables
                                                             GROUP BY owner) AS objects ON objects.owner = owners.owner
                                                 LEFT JOIN (SELECT owner, COUNT(*) AS routines
                                                              FROM sysprocedures
                                                             WHERE mode IN ({RoutineModes})
                                                             GROUP BY owner) AS routines ON routines.owner = owners.owner
                                                ORDER BY 2, 1";

    /// <summary>
    /// RN-CAT-001. O Informix não tem identidade nem coluna calculada: o que ele preenche sozinho é o `SERIAL`, o `SERIAL8` e o
    /// `BIGSERIAL`, "por padrão". O padrão é o de `sysdefaults` (<see cref="DefaultValue"/>).
    /// </summary>
    protected override string ColumnsSql => $@"SELECT syscolumns.colname AS column_name,
                                                      {ColumnType} AS column_type,
                                                      CASE WHEN BITAND(syscolumns.coltype, 256) = 256 THEN 0 ELSE 1 END AS is_nullable,
                                                      {IsPrimaryKey} AS is_primary_key,
                                                      syscolumns.colno AS column_position,
                                                      {DefaultValue} AS default_value,
                                                      CASE WHEN MOD(syscolumns.coltype, 256) IN (6, 18, 53) THEN '{ColumnGeneration.ByDefault}' END AS generated
                                                 FROM systables
                                                 JOIN syscolumns ON syscolumns.tabid = systables.tabid
                                                 LEFT JOIN sysdefaults ON sysdefaults.tabid = syscolumns.tabid AND sysdefaults.colno = syscolumns.colno AND sysdefaults.class = 'T'
                                                WHERE systables.owner = ?
                                                  AND systables.tabname = ?
                                                ORDER BY syscolumns.colno";

    /// <summary>
    /// O índice que o Informix cria para uma chave tem nome gerado, que começa por um espaço (` 101_4`): sai como o banco o guarda.
    /// RN-CAT-003: o método é o nome do método de acesso (`sysams`: `btree`, `rtree`...), e o índice que ordena a tabela fisicamente
    /// (`CREATE CLUSTER INDEX`) diz isso depois dele: `btree (cluster)`.
    /// </summary>
    protected override string IndexesSql => $@"SELECT sysindexes.idxname AS index_name,
                                                      CASE sysindexes.idxtype WHEN 'U' THEN 1 ELSE 0 END AS is_unique,
                                                      syscolumns.colname AS column_name,
                                                      TRIM(TRIM(sysams.am_name) || CASE WHEN sysindices.clustered = 'C' THEN ' (cluster)' ELSE '' END) AS method
                                                 FROM systables
                                                 JOIN sysindexes ON sysindexes.tabid = systables.tabid
                                                 JOIN ({Positions}) AS slots ON slots.slot <= 16
                                                 JOIN syscolumns ON syscolumns.tabid = sysindexes.tabid AND syscolumns.colno = ABS({Part("sysindexes")})
                                                 LEFT JOIN sysindices ON sysindices.tabid = sysindexes.tabid AND sysindices.idxname = sysindexes.idxname
                                                 LEFT JOIN sysams ON sysams.am_id = sysindices.amid
                                                WHERE systables.owner = ?
                                                  AND systables.tabname = ?
                                                ORDER BY sysindexes.idxname, slots.slot";

    /// <summary>
    /// RN-EDIT-003 e 012: a tabela sem dono é a que o banco resolveria, a do usuário da sessão antes das outras (num banco que não é ANSI
    /// o nome é único no banco inteiro). `T` é tabela e `V` visão; o sinônimo (`S`, `P`) não é uma tabela. O banco sem log de transação
    /// (`is_logging` zero no `sysmaster`) grava uma alteração por vez.
    /// </summary>
    protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
        => ($@"SELECT FIRST 1 TRIM(systables.owner),
                      TRIM(systables.tabname),
                      CASE systables.tabtype WHEN 'T' THEN 'table' WHEN 'V' THEN 'view' ELSE 'other' END,
                      systables.tabid,
                      (SELECT CASE WHEN is_logging = 0 THEN 1 ELSE 0 END FROM sysmaster:sysdatabases WHERE name = DBINFO('dbname')),
                      CASE WHEN systables.owner = USER THEN 0 ELSE 1 END AS preference
                 FROM systables
                WHERE systables.tabname = ?{(table.Schema is null ? string.Empty : " AND systables.owner = ?")}
                ORDER BY 6", table.Schema is null ? [table.Name] : [table.Name, table.Schema]);

    /// <summary>RN-EDIT-002: os índices únicos (`U`), que são também os da chave primária (a restrição `P`) e das restrições únicas, com as colunas na ordem do índice.</summary>
    protected override string EditKeysSql => $@"SELECT sysindexes.idxname,
                                                      CASE WHEN EXISTS (SELECT 1
                                                                          FROM sysconstraints
                                                                         WHERE sysconstraints.tabid = sysindexes.tabid
                                                                           AND sysconstraints.idxname = sysindexes.idxname
                                                                           AND sysconstraints.constrtype = 'P') THEN 1 ELSE 0 END AS is_primary,
                                                      syscolumns.colname,
                                                      slots.slot
                                                 FROM systables
                                                 JOIN sysindexes ON sysindexes.tabid = systables.tabid
                                                 JOIN ({Positions}) AS slots ON slots.slot <= 16
                                                 JOIN syscolumns ON syscolumns.tabid = sysindexes.tabid AND syscolumns.colno = ABS({Part("sysindexes")})
                                                WHERE systables.owner = ?
                                                  AND systables.tabname = ?
                                                  AND sysindexes.idxtype = 'U'
                                                ORDER BY 2 DESC, 1, 4";

    protected override string LockTimeoutSql => "SET LOCK MODE TO WAIT 5";

    /// <summary>RN-IMPORT-015 e RN-EXPORT-011: o Informix não aceita várias linhas num `INSERT … VALUES`: a carga vai uma linha por comando, preparado uma vez.</summary>
    protected override int RowsPerLoadCommand(int columns)
        => 1;

    /// <summary>
    /// RN-EDIT-006, e a importação por ele (RN-IMPORT-010 e 015): o texto de mais de 16.350 caracteres, que o driver mandaria como `CLOB`, vai como `LONG
    /// VARCHAR` enquanto cabe nos 32.767 bytes dele: o Informix não converte `CLOB` nem `TEXT` em `LVARCHAR` ("No cast from text to lvarchar"), e o `LONG
    /// VARCHAR` entra no `LVARCHAR`, no `TEXT` e no `CLOB`. O maior que isso segue como o driver o manda, e só o `TEXT` e o `CLOB` o guardam. O texto menor
    /// fica sem tipo, como sempre.
    /// </summary>
    protected override void BindEditParameter(DbParameter parameter, EditParameter value)
    {
        base.BindEditParameter(parameter, value);
        if (value.Value is string { Length: > UntypedTextCharacters } text && Encoding.UTF8.GetByteCount(text) <= LongVarCharBytes)
            ((DB2Parameter)parameter).DB2Type = DB2Type.LongVarChar;
    }

    protected override string ForeignKeysSql => ForeignKeyColumnsSql("child_table.owner = ? AND child_table.tabname = ?");

    /// <summary>RN-CAT-004: as chaves que apontam para a tabela, também a dela mesma.</summary>
    protected override string ReferencedBySql => ForeignKeyColumnsSql("referenced_table.owner = ? AND referenced_table.tabname = ?");

    /// <summary>
    /// RN-CAT-005: só `constrtype = 'C'` (o `NOT NULL` é `N`), com o texto da condição (`syschecks.type = 'T'`; o `B` é a forma
    /// compilada). O Informix guarda a condição como ele mesmo a reescreve, entre parênteses (`(preco > 0. )`), em pedaços de linha
    /// fixa (<see cref="JoinChunks"/>).
    /// </summary>
    protected override string ChecksSql => @"SELECT sysconstraints.constrname AS check_name,
                                                    syschecks.checktext AS expression
                                               FROM systables
                                               JOIN sysconstraints ON sysconstraints.tabid = systables.tabid AND sysconstraints.constrtype = 'C'
                                               JOIN syschecks ON syschecks.constrid = sysconstraints.constrid AND syschecks.type = 'T'
                                              WHERE systables.owner = ?
                                                AND systables.tabname = ?
                                              ORDER BY sysconstraints.constrname, syschecks.seqno";

    /// <summary>
    /// RN-CAT-006: o `CREATE VIEW` que o Informix guarda, que não é o que foi escrito: ele o reescreve (as palavras em minúsculas, o
    /// dono entre aspas, os apelidos `x0`, sem as quebras de linha de fora dos textos), em pedaços de linha fixa
    /// (<see cref="JoinChunks"/>).
    /// </summary>
    protected override string ViewDefinitionSql => $@"SELECT sysviews.viewtext AS definition
                                                        FROM systables
                                                        JOIN sysviews ON sysviews.tabid = systables.tabid
                                                       WHERE systables.owner = ?
                                                         AND systables.tabname = ?
                                                         AND systables.tabtype IN ({ViewTypes})
                                                       ORDER BY sysviews.seqno";

    protected override string DiagramColumnsSql => $@"SELECT systables.tabname AS table_name,
                                                             syscolumns.colname AS column_name,
                                                             {ColumnType} AS column_type,
                                                             CASE WHEN BITAND(syscolumns.coltype, 256) = 256 THEN 0 ELSE 1 END AS is_nullable,
                                                             {IsPrimaryKey} AS is_primary_key
                                                        FROM systables
                                                        JOIN syscolumns ON syscolumns.tabid = systables.tabid
                                                       WHERE systables.owner = ?
                                                         AND systables.tabtype IN ({TableTypes})
                                                       ORDER BY systables.tabname, syscolumns.colno";

    /// <summary>RN-CAT-008: só tabela tem chave estrangeira, e o dono basta.</summary>
    protected override string DiagramForeignKeysSql => ForeignKeyColumnsSql("child_table.owner = ?");

    /// <summary>
    /// RN-ARVORE-006: os bancos do servidor, de `sysmaster:sysdatabases`. O nome é `CHAR` e vem completado com espaços (`TRIM`); o da
    /// sessão é o de `DBINFO('dbname')`, que a comparação de `CHAR` acha sem os espaços.
    /// </summary>
    protected override string DatabasesSql => @"SELECT TRIM(name) AS database_name, CASE WHEN name = DBINFO('dbname') THEN 1 ELSE 0 END AS is_current
                                                  FROM sysmaster:sysdatabases
                                                 ORDER BY 1";

    /// <summary>
    /// RN-CAT-010: o que o `sysmaster` diz do banco conectado (`DBINFO('dbname')`), que toda conta pode ler. O modo de log decide se há
    /// transação: sem log (`noLogging`), com log (`unbufferedLogging`), com log em buffer (`bufferedLogging`) ou ANSI (`ansi`). O `TRIM`
    /// de fora tira o espaço com que o Informix completa o texto mais curto da união.
    /// </summary>
    protected override IReadOnlyList<string> PropertiesSql => [@"SELECT TRIM(properties.property_name) AS property_name, properties.property_value
                                                                   FROM (SELECT 1 AS position, 'loggingMode' AS property_name, TRIM(CASE WHEN is_ansi = 1 THEN 'ansi' WHEN is_buff_log = 1 THEN 'bufferedLogging' WHEN is_logging = 1 THEN 'unbufferedLogging' ELSE 'noLogging' END) AS property_value
                                                                           FROM sysmaster:sysdatabases
                                                                          WHERE name = DBINFO('dbname')
                                                                          UNION ALL
                                                                         SELECT 2, 'locale', TRIM(dbs_collate)
                                                                           FROM sysmaster:sysdbslocale
                                                                          WHERE dbs_dbsname = DBINFO('dbname')
                                                                          UNION ALL
                                                                         SELECT 3, 'owner', TRIM(owner)
                                                                           FROM sysmaster:sysdatabases
                                                                          WHERE name = DBINFO('dbname')
                                                                          UNION ALL
                                                                         SELECT 4, 'dbspace', TRIM(DBINFO('dbspace', partnum))
                                                                           FROM sysmaster:sysdatabases
                                                                          WHERE name = DBINFO('dbname')) AS properties
                                                                  ORDER BY properties.position"];

    /// <summary>
    /// O tipo da coluna, como se escreve num `CREATE TABLE`. O catálogo guarda um número em `coltype` e o tamanho codificado em
    /// `collength`: precisão e escala de `DECIMAL` e `MONEY` (escala 255 é ponto flutuante), o máximo de `VARCHAR` e as pontas do
    /// qualificador de `DATETIME` e `INTERVAL`. Os tipos estendidos (`LVARCHAR`, `BOOLEAN`, `BLOB`, `CLOB`) têm o nome em `sysxtdtypes`.
    /// </summary>
    private static string ColumnType => $@"CASE MOD(syscolumns.coltype, 256)
                                               WHEN 0 THEN 'CHAR(' || syscolumns.collength || ')'
                                               WHEN 1 THEN 'SMALLINT'
                                               WHEN 2 THEN 'INTEGER'
                                               WHEN 3 THEN 'FLOAT'
                                               WHEN 4 THEN 'SMALLFLOAT'
                                               WHEN 5 THEN 'DECIMAL' || {PrecisionAndScale}
                                               WHEN 6 THEN 'SERIAL'
                                               WHEN 7 THEN 'DATE'
                                               WHEN 8 THEN 'MONEY' || {PrecisionAndScale}
                                               WHEN 10 THEN 'DATETIME ' || {Qualifier}
                                               WHEN 11 THEN 'BYTE'
                                               WHEN 12 THEN 'TEXT'
                                               WHEN 13 THEN 'VARCHAR(' || MOD(syscolumns.collength, 256) || ')'
                                               WHEN 14 THEN 'INTERVAL ' || {Qualifier}
                                               WHEN 15 THEN 'NCHAR(' || syscolumns.collength || ')'
                                               WHEN 16 THEN 'NVARCHAR(' || MOD(syscolumns.collength, 256) || ')'
                                               WHEN 17 THEN 'INT8'
                                               WHEN 18 THEN 'SERIAL8'
                                               WHEN 19 THEN 'SET'
                                               WHEN 20 THEN 'MULTISET'
                                               WHEN 21 THEN 'LIST'
                                               WHEN 22 THEN 'ROW'
                                               WHEN 23 THEN 'COLLECTION'
                                               WHEN 43 THEN 'LVARCHAR(' || syscolumns.collength || ')'
                                               WHEN 45 THEN 'BOOLEAN'
                                               WHEN 52 THEN 'BIGINT'
                                               WHEN 53 THEN 'BIGSERIAL'
                                               ELSE NVL((SELECT CASE WHEN sysxtdtypes.name = 'lvarchar' THEN 'LVARCHAR(' || syscolumns.collength || ')' ELSE UPPER(TRIM(sysxtdtypes.name)) END
                                                           FROM sysxtdtypes
                                                          WHERE sysxtdtypes.extended_id = syscolumns.extended_id), 'TYPE ' || MOD(syscolumns.coltype, 256))
                                           END";

    /// <summary>Se a coluna de `syscolumns` faz parte da chave primária: está entre as dezesseis do índice da restrição `P` da tabela.</summary>
    private static string IsPrimaryKey => $@"CASE WHEN EXISTS (SELECT 1
                                                                 FROM sysconstraints
                                                                 JOIN sysindexes ON sysindexes.tabid = sysconstraints.tabid AND sysindexes.idxname = sysconstraints.idxname
                                                                WHERE sysconstraints.tabid = syscolumns.tabid
                                                                  AND sysconstraints.constrtype = 'P'
                                                                  AND syscolumns.colno IN ({string.Join(", ", IndexParts.Select(part => $"ABS(sysindexes.part{part})"))})) THEN 1 ELSE 0 END";

    /// <summary>
    /// RN-CAT-001: o padrão de `sysdefaults`, escrito como se escreve num `CREATE TABLE`. O tipo do padrão diz o que ele é: `L` é um
    /// valor, `C` é `CURRENT` (com o qualificador da coluna), `U` é `USER`, `T` é `TODAY`, `S` é `DBSERVERNAME` (de que `SITENAME` é
    /// sinônimo), `N` é `NULL`, `R` é `CURRENT_ROLE` e `D` é `DEFAULT_ROLE`. O valor de uma coluna de número, data, hora ou intervalo
    /// fica guardado como uma codificação própria do Informix, um espaço e o valor legível (`AAAAKg 42`): sai o que vem depois do
    /// espaço, a data entre aspas e a hora e o intervalo com o qualificador da coluna. O de texto (e o de `BOOLEAN`, `t` ou `f`)
    /// fica como foi escrito, e sai entre aspas, com a aspa de dentro dobrada. O `TRIM` de fora tira o espaço com que o Informix
    /// completa o texto mais curto de um `CASE`.
    /// </summary>
    private static string DefaultValue => $@"TRIM(CASE sysdefaults.type
                                                    WHEN 'L' THEN CASE WHEN MOD(syscolumns.coltype, 256) IN (1, 2, 3, 4, 5, 6, 8, 17, 18, 52, 53) THEN {DefaultDisplay}
                                                                       WHEN MOD(syscolumns.coltype, 256) = 7 THEN '''' || {DefaultDisplay} || ''''
                                                                       WHEN MOD(syscolumns.coltype, 256) = 10 THEN 'DATETIME (' || {DefaultDisplay} || ') ' || {Qualifier}
                                                                       WHEN MOD(syscolumns.coltype, 256) = 14 THEN 'INTERVAL (' || {DefaultDisplay} || ') ' || {Qualifier}
                                                                       ELSE '''' || REPLACE(TRIM(TRAILING FROM sysdefaults.default), '''', '''''') || ''''
                                                                   END
                                                    WHEN 'C' THEN 'CURRENT ' || {Qualifier}
                                                    WHEN 'U' THEN 'USER'
                                                    WHEN 'T' THEN 'TODAY'
                                                    WHEN 'S' THEN 'DBSERVERNAME'
                                                    WHEN 'N' THEN 'NULL'
                                                    WHEN 'R' THEN 'CURRENT_ROLE'
                                                    WHEN 'D' THEN 'DEFAULT_ROLE'
                                                END)";

    /// <summary>O valor legível de um padrão de número, data, hora ou intervalo: o que vem depois do primeiro espaço.</summary>
    private static string DefaultDisplay => "TRIM(SUBSTR(sysdefaults.default, INSTR(sysdefaults.default, ' ') + 1))";

    private static string PrecisionAndScale => @"CASE MOD(syscolumns.collength, 256)
                                                     WHEN 255 THEN '(' || TRUNC(syscolumns.collength / 256)::INTEGER || ')'
                                                     ELSE '(' || TRUNC(syscolumns.collength / 256)::INTEGER || ',' || MOD(syscolumns.collength, 256) || ')'
                                                 END";

    private static string Qualifier => $"{QualifierField("TRUNC(MOD(syscolumns.collength, 256) / 16)::INTEGER")} || ' TO ' || {QualifierField("MOD(syscolumns.collength, 16)")}";

    /// <summary>
    /// RN-SESSAO-005: a sonda roda depois de todo comando executado até o fim, venha ele com linhas, com contagem de linhas ou sem
    /// nada. Uma rotina abre transação por dentro e devolve linhas, e um `BEGIN WORK` que chegasse ao banco depois de um `UPDATE`,
    /// num envio que a recusa de mais de um comando não reconhecesse, voltaria com a contagem do `UPDATE`. Custa duas idas ao banco
    /// por comando (cerca de 1 ms a mais num banco na mesma máquina).
    /// </summary>
    protected override bool MayHaveOpenedATransaction(bool returnedRows, int recordsAffected)
        => true;

    /// <summary>
    /// RN-SESSAO-005: a sonda roda também depois do comando executado até o fim que falhou, ou que foi cancelado enquanto devolvia
    /// as linhas. Uma função que faz `BEGIN WORK`, grava, devolve linhas e lança deixa a transação aberta: a leitura seguinte na
    /// mesma sessão mostraria a linha não confirmada, as outras conexões ficariam presas na trava, e a gravação seguinte cairia
    /// dentro dela. Lançar sem ter devolvido linhas e ser interrompido na execução não deixam transação. A leitura que falha na
    /// primeira linha (uma divisão por zero, uma linha travada) também não deixa, mas o servidor fica respondendo "já há uma
    /// transação" até o comando seguinte: quem separa os dois casos é a sonda. Ela custa as mesmas duas idas ao banco.
    /// </summary>
    protected override bool MayLeaveATransactionOpenWhenItFails => true;

    /// <summary>
    /// RN-LOG-001: as duas respostas que a sonda procura, "já há uma transação" (-535) e "transação não existe" (-256), são rotina.
    /// Num banco sem log a segunda vem depois de cada comando, e cada uma somava ao log uma linha de informação.
    /// </summary>
    protected override bool IsRoutineRefusal => _lastNativeError is AlreadyInTransaction or TransactionNotAvailable;

    /// <summary>
    /// RN-SESSAO-005. O driver não sabe da transação que um comando abriu no servidor, e o catálogo de monitoração (`sysmaster`) só a
    /// mostra depois da primeira gravação. Quem sabe é o banco: `BEGIN WORK` só passa quando não há transação aberta, e aí a sonda
    /// desfaz a que ela mesma abriu. Quando ele recusa, o número do erro diz por quê: -535 é "já há uma transação" (a resposta
    /// procurada), -256 é o banco sem log, em que transação não existe; qualquer outro é a sonda que falhou (a conexão caiu, o prazo
    /// passou), e não diz nada sobre o comando, que o banco já confirmou.
    ///
    /// O -535 é perguntado duas vezes. Depois de uma leitura que falhou na primeira linha o servidor também responde -535, sem
    /// transação nenhuma: o cursor dela ficou aberto do lado dele, e o comando seguinte, qualquer um, o fecha. A leitura de
    /// verificação vai no meio das duas perguntas, e só a transação de verdade responde -535 de novo. Se a leitura do meio falha,
    /// a sonda falhou.
    /// </summary>
    protected override async Task<ETransactionProbe> ProbeTransactionAsync(DbConnection connection)
    {
        var answer = await AskAsync(connection);
        if (answer != ETransactionProbe.InTransaction)
            return answer;

        return await TryAsync(nameof(ProbeTransactionAsync), () => ProbeAsync(connection, PingSql)) ? await AskAsync(connection) : ETransactionProbe.Failed;
    }

    /// <summary>Uma pergunta da sonda: o `BEGIN WORK`, e o `ROLLBACK WORK` da transação que ele abriu quando passou.</summary>
    private async Task<ETransactionProbe> AskAsync(DbConnection connection)
    {
        if (await TryAsync(nameof(ProbeTransactionAsync), () => ProbeAsync(connection, "BEGIN WORK")))
            return await TryAsync(nameof(ProbeTransactionAsync), () => ProbeAsync(connection, "ROLLBACK WORK")) ? ETransactionProbe.Idle : ETransactionProbe.Failed;

        return _lastNativeError switch
        {
            AlreadyInTransaction => ETransactionProbe.InTransaction,
            TransactionNotAvailable => ETransactionProbe.Idle,
            _ => ETransactionProbe.Failed
        };
    }

    /// <summary>
    /// RN-CAT-005 e 006: o texto da visão e o da condição vêm em pedaços de tamanho fixo (`CHAR`), contados em bytes. Num banco de
    /// caracteres de mais de um byte (UTF-8) o caractere que não cabe no fim de um pedaço vai inteiro para o seguinte, e o byte que
    /// sobrou fica nulo: ele sai. O último pedaço vem completado com espaços, que também saem. Os espaços do fim de um pedaço do meio são
    /// do texto, e ficam.
    /// </summary>
    protected override string JoinChunks(IReadOnlyList<string> chunks)
        => string.Concat(chunks.Select(chunk => chunk.TrimEnd('\0'))).TrimEnd(' ');

    protected override DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception)
    {
        _lastNativeError = exception is DB2Exception { Errors.Count: > 0 } refusal ? refusal.Errors[0].NativeError : 0;

        return base.ToFailure(kind, exception);
    }

    /// <summary>
    /// RN-SQL-010: o Informix diz que interrompeu o comando pelo erro nativo -213, e não pelo SQLSTATE, que para ele é `IX000` em quase
    /// tudo. O número não vai na mensagem nem na resposta: só a API o vê, na exceção do driver.
    /// </summary>
    protected override bool IsInterruption(Exception exception, DatabaseFailure failure)
        => exception is DB2Exception { Errors.Count: > 0 } refusal && refusal.Errors[0].NativeError == StatementInterrupted;

    /// <summary>
    /// As tabelas que alguém criou (`tabid` a partir de 100) vêm antes das do catálogo, que só o `informix` tem. Tabela externa
    /// aparece como tabela. As rotinas internas do servidor (`mode` em minúsculas) ficam de fora. O `TRIM` no tipo da rotina tira o
    /// espaço com que o Informix completa o texto mais curto de um `CASE`. RN-CAT-009: a estimativa é o `nrows` que o `UPDATE
    /// STATISTICS` grava; ele vale 0 até a primeira estatística, e quem diz se ela existe é a hora da última (`ustlowts`, nula antes
    /// dela). O Informix não tem comentário de tabela nem de visão: é sempre nulo.
    /// </summary>
    protected override string? ObjectsSql(string kind)
        => kind switch
        {
            "tables" => TablesSql(TableTypes, "table", "CASE WHEN ustlowts IS NULL THEN NULL ELSE nrows::INT8 END"),
            "views" => TablesSql(ViewTypes, "view", "CAST(NULL AS INT8)"),
            "routines" => $@"SELECT procname AS object_name,
                                    TRIM(CASE WHEN isproc = 't' THEN 'procedure' ELSE 'function' END) AS object_kind,
                                    CAST(NULL AS INT8) AS estimated_rows,
                                    CAST(NULL AS VARCHAR(1)) AS object_comment
                               FROM sysprocedures
                              WHERE owner = ?
                                AND mode IN ({RoutineModes})
                              ORDER BY procname, procid",
            _ => null
        };

    /// <summary>As letras de `tabtype`, o tipo e a expressão da estimativa são constantes deste arquivo, e não dado de fora: o dono, que é, vai como parâmetro.</summary>
    private static string TablesSql(string tableTypes, string kind, string estimatedRows)
        => $@"SELECT tabname AS object_name,
                     '{kind}' AS object_kind,
                     {estimatedRows} AS estimated_rows,
                     CAST(NULL AS VARCHAR(1)) AS object_comment
                FROM systables
               WHERE owner = ?
                 AND tabtype IN ({tableTypes})
               ORDER BY CASE WHEN tabid >= 100 THEN 0 ELSE 1 END, tabname";

    /// <summary>
    /// RN-CAT-002: o Informix só tem `ON DELETE CASCADE`; o resto é `R` ("restrict", o padrão), ao excluir e ao atualizar. O `TRIM` tira o
    /// espaço com que ele completa o texto mais curto de um `CASE`.
    /// </summary>
    private static string Rule(string column)
        => $"TRIM(CASE sysreferences.{column} WHEN 'C' THEN '{ForeignKeyRule.Cascade}' WHEN 'R' THEN '{ForeignKeyRule.Restrict}' END)";

    /// <summary>
    /// As chaves estrangeiras que o filtro escolhe, um par de colunas por linha, nas colunas de uma linha de chave da base. A chave
    /// estrangeira e a chave que ela referencia têm cada uma o seu índice: as colunas das duas pontas se casam pela posição nos dois
    /// índices. Os pares saem primeiro, numa tabela derivada, com o número das duas colunas; só depois entram os nomes, pelo índice de
    /// `syscolumns`: casar as colunas pela expressão da posição, direto, levava três vezes mais (1,8 s contra 0,6 s nas 400 chaves de
    /// um esquema de 300 tabelas). O filtro é constante deste arquivo; o dono e a tabela vão como parâmetro.
    /// </summary>
    private static string ForeignKeyColumnsSql(string filter)
        => $@"SELECT pairs.foreign_key_name,
                     pairs.referencing_schema,
                     pairs.referencing_table,
                     child_column.colname AS column_name,
                     pairs.referenced_schema,
                     pairs.referenced_table,
                     referenced_column.colname AS referenced_column,
                     pairs.on_delete,
                     pairs.on_update
                FROM (SELECT foreign_key.constrname AS foreign_key_name,
                             TRIM(child_table.owner) AS referencing_schema,
                             child_table.tabname AS referencing_table,
                             child_table.tabid AS referencing_tabid,
                             TRIM(referenced_table.owner) AS referenced_schema,
                             referenced_table.tabname AS referenced_table,
                             referenced_table.tabid AS referenced_tabid,
                             {Rule("delrule")} AS on_delete,
                             {Rule("updrule")} AS on_update,
                             slots.slot,
                             ABS({Part("child_index")}) AS child_colno,
                             ABS({Part("referenced_index")}) AS referenced_colno
                        FROM systables AS child_table
                        JOIN sysconstraints AS foreign_key ON foreign_key.tabid = child_table.tabid AND foreign_key.constrtype = 'R'
                        JOIN sysreferences ON sysreferences.constrid = foreign_key.constrid
                        JOIN sysconstraints AS referenced_key ON referenced_key.constrid = sysreferences.primary
                        JOIN systables AS referenced_table ON referenced_table.tabid = sysreferences.ptabid
                        JOIN sysindexes AS child_index ON child_index.tabid = foreign_key.tabid AND child_index.idxname = foreign_key.idxname
                        JOIN sysindexes AS referenced_index ON referenced_index.tabid = referenced_key.tabid AND referenced_index.idxname = referenced_key.idxname
                        JOIN ({Positions}) AS slots ON slots.slot <= 16
                       WHERE {filter}) AS pairs
                JOIN syscolumns AS child_column ON child_column.tabid = pairs.referencing_tabid AND child_column.colno = pairs.child_colno
                JOIN syscolumns AS referenced_column ON referenced_column.tabid = pairs.referenced_tabid AND referenced_column.colno = pairs.referenced_colno
               ORDER BY pairs.foreign_key_name, pairs.referencing_schema, pairs.referencing_table, pairs.slot";

    /// <summary>A coluna do índice na posição da linha de `slots`: `part1` na posição 1, e assim por diante.</summary>
    private static string Part(string index)
        => $"CASE slots.slot {string.Join(" ", IndexParts.Select(part => $"WHEN {part} THEN {index}.part{part}"))} END";

    /// <summary>O nome de uma ponta do qualificador de `DATETIME` e de `INTERVAL`, pelo código que o catálogo guarda.</summary>
    private static string QualifierField(string code)
        => $"CASE {code} WHEN 0 THEN 'YEAR' WHEN 2 THEN 'MONTH' WHEN 4 THEN 'DAY' WHEN 6 THEN 'HOUR' WHEN 8 THEN 'MINUTE' WHEN 10 THEN 'SECOND' ELSE 'FRACTION(' || ({code} - 10) || ')' END";

    private static async Task ProbeAsync(DbConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.CommandTimeout = ProbeTimeoutSeconds;
        await command.ExecuteNonQueryAsync();
    }
}
#endif
