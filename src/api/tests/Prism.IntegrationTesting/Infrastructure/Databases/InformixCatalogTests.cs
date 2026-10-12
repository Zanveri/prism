using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O catálogo estendido no Informix 14.10, pela porta DRDA. "Esquema" aqui é o dono: a classe cria as tabelas com um dono sorteado, que
/// só ela usa, e as apaga no fim.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Informix")]
public sealed class InformixCatalogTests : CatalogContractTests
{
    private readonly string _owner = $"cat_{Guid.NewGuid():N}"[..16];

    /// <summary>
    /// RN-CAT-006: as colunas de uma visão comprida, de mais de 2.000 caracteres no texto que o banco guarda, com acento e, dentro do
    /// texto, quebra de linha (que o Informix só aceita com `IFX_ALLOW_NEWLINE` ligado na sessão). Só caracteres do Latin-1: o banco
    /// `prism` é `en_US.819`.
    /// </summary>
    private static readonly string[] LongTexts = [.. Enumerable.Range(0, 45).Select(line => $"linha {line:00}: ação, coração e pão,\nfim da {line:00}")];

    /// <summary>O outro dono, de onde uma tabela aponta para a deste e para onde uma deste aponta.</summary>
    private string Other => $"{_owner}_b";

    protected override EDatabaseEngine Engine => EDatabaseEngine.Informix;

    protected override string Schema => _owner;

    protected override IEnumerable<string> Setup =>
    [
        $@"CREATE TABLE {_owner}.padroes (
               texto VARCHAR(20) DEFAULT 'it''s',
               numero INTEGER DEFAULT 42,
               valor DECIMAL(10, 2) DEFAULT 3.5,
               data DATE DEFAULT '01/02/2026',
               agora DATETIME YEAR TO SECOND DEFAULT CURRENT YEAR TO SECOND,
               usuario VARCHAR(32) DEFAULT USER,
               sem_padrao INTEGER,
               serie SERIAL,
               hoje DATE DEFAULT TODAY,
               momento DATETIME YEAR TO DAY DEFAULT DATETIME (2026-03-04) YEAR TO DAY,
               flag BOOLEAN DEFAULT 't',
               grande BIGSERIAL,
               negativo SMALLINT DEFAULT -7,
               prazo INTERVAL DAY(3) TO SECOND DEFAULT INTERVAL (1 02:03:04) DAY(3) TO SECOND,
               servidor VARCHAR(40) DEFAULT DBSERVERNAME,
               nulo CHAR(5) DEFAULT NULL)",
        $"CREATE INDEX {_owner}.ix_padroes_numero ON {_owner}.padroes (numero)",
        $"CREATE CLUSTER INDEX {_owner}.ix_padroes_data ON {_owner}.padroes (data)",
        $"CREATE TABLE {_owner}.pai (id INTEGER NOT NULL, codigo INTEGER NOT NULL, superior INTEGER, PRIMARY KEY (id) CONSTRAINT pk_pai, UNIQUE (id, codigo) CONSTRAINT uq_pai)",
        $"ALTER TABLE {_owner}.pai ADD CONSTRAINT FOREIGN KEY (superior) REFERENCES {_owner}.pai (id) CONSTRAINT fk_pai_superior",
        $@"CREATE TABLE {_owner}.filho (
               id INTEGER NOT NULL,
               pai_id INTEGER,
               pai_codigo INTEGER,
               PRIMARY KEY (id) CONSTRAINT pk_filho,
               FOREIGN KEY (pai_id) REFERENCES {_owner}.pai (id) ON DELETE CASCADE CONSTRAINT fk_cascata,
               FOREIGN KEY (pai_id, pai_codigo) REFERENCES {_owner}.pai (id, codigo) CONSTRAINT fk_composta)",
        $"CREATE VIEW {_owner}.resumo (id) AS SELECT id FROM {_owner}.pai",
        $"CREATE TABLE {_owner}.nunca_analisada (id INTEGER)",
        $"INSERT INTO {_owner}.nunca_analisada SELECT tabid FROM systables WHERE tabid <= 3",
        $"CREATE TABLE {_owner}.analisada (id INTEGER)",
        $"INSERT INTO {_owner}.analisada SELECT (centenas.tabid - 1) * 100 + (dezenas.tabid - 1) * 10 + unidades.tabid FROM systables AS centenas, systables AS dezenas, systables AS unidades WHERE centenas.tabid <= 3 AND dezenas.tabid <= 10 AND unidades.tabid <= 10",
        $"UPDATE STATISTICS LOW FOR TABLE {_owner}.analisada",
        // O nome de rotina é único no banco inteiro, e não por dono.
        $"CREATE FUNCTION {_owner}.{_owner}_dobro (valor INTEGER) RETURNING INTEGER; RETURN valor * 2; END FUNCTION",
        $"CREATE TABLE {Other}.de_fora (id INTEGER NOT NULL, pai_id INTEGER, PRIMARY KEY (id) CONSTRAINT pk_de_fora, FOREIGN KEY (pai_id) REFERENCES {_owner}.pai (id) ON DELETE CASCADE CONSTRAINT fk_de_fora)",
        $"CREATE TABLE {Other}.alvo (id INTEGER NOT NULL, PRIMARY KEY (id) CONSTRAINT pk_alvo)",
        $"CREATE TABLE {_owner}.aponta_fora (alvo_id INTEGER, FOREIGN KEY (alvo_id) REFERENCES {Other}.alvo (id) CONSTRAINT fk_aponta_fora)",
        $"CREATE TABLE {_owner}.conferida (preco DECIMAL(10, 2) NOT NULL, quantidade INTEGER, CHECK (preco > 0) CONSTRAINT ck_preco_positivo, CHECK (quantidade < 1000))",
        "EXECUTE PROCEDURE IFX_ALLOW_NEWLINE('t')",
        $"CREATE VIEW {_owner}.longa ({string.Join(", ", LongTexts.Select((_, column) => $"c{column:00}"))}) AS SELECT {string.Join(", ", LongTexts.Select(text => $"'{text}'"))} FROM {_owner}.pai"
    ];

    protected override IEnumerable<string> Teardown =>
    [
        $"DROP FUNCTION {_owner}.{_owner}_dobro",
        $"DROP VIEW {_owner}.resumo",
        $"DROP VIEW {_owner}.longa",
        $"DROP TABLE {Other}.de_fora",
        $"DROP TABLE {_owner}.aponta_fora",
        $"DROP TABLE {Other}.alvo",
        $"DROP TABLE {_owner}.conferida",
        $"DROP TABLE {_owner}.filho",
        $"DROP TABLE {_owner}.pai",
        $"DROP TABLE {_owner}.padroes",
        $"DROP TABLE {_owner}.nunca_analisada",
        $"DROP TABLE {_owner}.analisada"
    ];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => InformixSingleton.GetSettingsAsync();

    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    /// <summary>
    /// RN-CAT-001: o padrão como se escreve num `CREATE TABLE`. O valor de número, data e hora o Informix guarda numa codificação dele
    /// seguida do valor legível (`AAAAKg 42`): sai só o legível, a data entre aspas e a hora e o intervalo com o qualificador. O que ele
    /// preenche sozinho é o `SERIAL` e o `BIGSERIAL`, "por padrão"; identidade e coluna calculada ele não tem.
    /// </summary>
    [Test]
    public async Task Columns_ReportTheDefaultAndWhoGeneratesTheValue()
    {
        await using var connection = await OpenAsync();

        var columns = Value(await connection.GetColumnsAsync(_owner, "padroes", CancellationToken.None));

        Assert.That(columns.Select(column => (column.Name, column.DefaultValue, column.Generated)), Is.EqualTo(new (string, string?, string?)[]
        {
            ("texto", "'it''s'", null),
            ("numero", "42", null),
            ("valor", "3.50", null),
            ("data", "'01/02/2026'", null),
            ("agora", "CURRENT YEAR TO SECOND", null),
            ("usuario", "USER", null),
            ("sem_padrao", null, null),
            ("serie", null, "byDefault"),
            ("hoje", "TODAY", null),
            ("momento", "DATETIME (2026-03-04) YEAR TO DAY", null),
            ("flag", "'t'", null),
            ("grande", null, "byDefault"),
            ("negativo", "-7", null),
            ("prazo", "INTERVAL (1 02:03:04) DAY TO SECOND", null),
            ("servidor", "DBSERVERNAME", null),
            ("nulo", "NULL", null)
        }));
    }

    /// <summary>RN-CAT-002: o Informix só tem `ON DELETE CASCADE`; o resto é "restrict", ao excluir e ao atualizar. A chave composta e a que aponta para a própria tabela.</summary>
    [Test]
    public async Task ForeignKeys_ReportBothRules()
    {
        await using var connection = await OpenAsync();

        var children = Value(await connection.GetForeignKeysAsync(_owner, "filho", CancellationToken.None));
        var parent = Value(await connection.GetForeignKeysAsync(_owner, "pai", CancellationToken.None));

        Assert.That(children.Select(key => (key.Name, string.Join(",", key.Columns), key.ReferencedSchema, key.ReferencedTable, string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)), Is.EqualTo(new[]
        {
            ("fk_cascata", "pai_id", _owner, "pai", "id", "cascade", "restrict"),
            ("fk_composta", "pai_id,pai_codigo", _owner, "pai", "id,codigo", "restrict", "restrict")
        }));
        Assert.That(parent.Select(key => (key.Name, string.Join(",", key.Columns), key.ReferencedTable, string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)), Is.EqualTo(new[] { ("fk_pai_superior", "superior", "pai", "id", "restrict", "restrict") }));
    }

    /// <summary>
    /// RN-CAT-003: o método de acesso (`btree`, de `sysams`) e, no índice que ordena a tabela fisicamente, o `cluster`. Os outros métodos
    /// do servidor (`rtree`, `bts`) pedem um DataBlade ou um espaço próprio que o contêiner não tem.
    /// </summary>
    [Test]
    public async Task Indexes_ReportTheAccessMethod()
    {
        await using var connection = await OpenAsync();

        var indexes = Value(await connection.GetIndexesAsync(_owner, "padroes", CancellationToken.None));

        Assert.That(indexes.Select(index => (index.Name, index.Method)), Is.EqualTo(new[] { ("ix_padroes_data", "btree (cluster)"), ("ix_padroes_numero", "btree") }));
    }

    /// <summary>
    /// RN-CAT-009: a estimativa é o `nrows` do `UPDATE STATISTICS`, e a tabela sem estatística nenhuma (`ustlowts` nula) tem estimativa
    /// nula, e não zero. O Informix não tem comentário de tabela.
    /// </summary>
    [Test]
    public async Task Objects_ReportTheEstimateFromStatistics_AndNoComment()
    {
        await using var connection = await OpenAsync();

        var tables = Value(await connection.GetObjectsAsync(_owner, "tables", CancellationToken.None));
        var views = Value(await connection.GetObjectsAsync(_owner, "views", CancellationToken.None));
        var routines = Value(await connection.GetObjectsAsync(_owner, "routines", CancellationToken.None));

        Assert.That(tables.Single(table => table.Name == "nunca_analisada").EstimatedRows, Is.Null);
        Assert.That(tables.Single(table => table.Name == "analisada").EstimatedRows, Is.EqualTo(300));
        Assert.That(tables.Select(table => table.Comment), Is.All.Null);
        Assert.That(views, Is.EqualTo(new[] { new DatabaseObjectInfo("longa", "view", null, null), new DatabaseObjectInfo("resumo", "view", null, null) }));
        Assert.That(routines, Is.EqualTo(new[] { new DatabaseObjectInfo($"{_owner}_dobro", "function", null, null) }));
    }

    /// <summary>
    /// RN-CAT-004: as chaves que apontam para `pai`, vistas dele: as de `filho`, a de uma tabela de outro dono e a dele mesmo, que
    /// aparece também nas chaves estrangeiras dele. Pelo nome da chave.
    /// </summary>
    [Test]
    public async Task ReferencedBy_ListsTheKeysOfEveryTableThatPointsToIt()
    {
        await using var connection = await OpenAsync();

        var keys = Value(await connection.GetReferencingForeignKeysAsync(_owner, "pai", CancellationToken.None));
        var target = Value(await connection.GetReferencingForeignKeysAsync(Other, "alvo", CancellationToken.None));

        Assert.That(keys.Select(key => (key.Name, key.ReferencingSchema, key.ReferencingTable, string.Join(",", key.Columns), string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)), Is.EqualTo(new[]
        {
            ("fk_cascata", _owner, "filho", "pai_id", "id", "cascade", "restrict"),
            ("fk_composta", _owner, "filho", "pai_id,pai_codigo", "id,codigo", "restrict", "restrict"),
            ("fk_de_fora", Other, "de_fora", "pai_id", "id", "cascade", "restrict"),
            ("fk_pai_superior", _owner, "pai", "superior", "id", "restrict", "restrict")
        }));
        Assert.That(target.Select(key => (key.Name, key.ReferencingSchema, key.ReferencingTable)), Is.EqualTo(new[] { ("fk_aponta_fora", _owner, "aponta_fora") }));
    }

    /// <summary>
    /// RN-CAT-005: a restrição de nome dado e a de nome que o banco gera (`c` + o número da tabela e o da restrição), com a condição como
    /// o Informix a reescreve. O `NOT NULL` (restrição `N`) não entra, e a tabela sem conferência responde lista vazia.
    /// </summary>
    [Test]
    public async Task Checks_ListOnlyTheCheckConstraints()
    {
        await using var connection = await OpenAsync();

        var checks = Value(await connection.GetChecksAsync(_owner, "conferida", CancellationToken.None));
        var none = Value(await connection.GetChecksAsync(_owner, "pai", CancellationToken.None));

        Assert.That(checks, Has.Count.EqualTo(2));
        Assert.That(checks[0].Name, Does.Match(@"^c\d+_\d+$"));
        Assert.That(checks[0].Expression, Is.EqualTo("(quantidade < 1000 )"));
        Assert.That(checks[1], Is.EqualTo(new CheckConstraintInfo("ck_preco_positivo", "(preco > 0 )")));
        Assert.That(none, Is.Empty);
    }

    /// <summary>
    /// RN-CAT-006: o Informix guarda o `CREATE VIEW` reescrito por ele (palavras em minúsculas, o dono entre aspas, o apelido
    /// `x0`, um espaço antes da vírgula), em pedaços de linha fixa: o texto volta inteiro, com o acento e a quebra de linha de dentro
    /// dos textos, sem o enchimento do último pedaço. A visão que não existe é nula.
    /// </summary>
    [Test]
    public async Task ViewDefinition_ReturnsTheTextTheDatabaseKeeps()
    {
        await using var connection = await OpenAsync();

        var shortView = Value(await connection.GetViewDefinitionAsync(_owner, "resumo", CancellationToken.None));
        var longView = Value(await connection.GetViewDefinitionAsync(_owner, "longa", CancellationToken.None));
        var missing = Value(await connection.GetViewDefinitionAsync(_owner, "nao_existe", CancellationToken.None));
        var expected = $"create view \"{_owner}\".longa ({string.Join(",", LongTexts.Select((_, column) => $"c{column:00}"))}) as select {string.Join(" ,", LongTexts.Select(text => $"'{text}'"))} from \"{_owner}\".pai x0 ;";

        Assert.That(shortView.Definition, Is.EqualTo($"create view \"{_owner}\".resumo (id) as select x0.id from \"{_owner}\".pai x0 ;"));
        Assert.That(expected, Has.Length.GreaterThan(2000));
        Assert.That(longView.Definition, Is.EqualTo(expected));
        Assert.That(missing.Definition, Is.Null);
    }

    /// <summary>
    /// RN-CAT-006, num banco em UTF-8: os pedaços do texto da visão são contados em bytes, e o caractere de dois bytes que não cabe no
    /// fim de um pedaço vai inteiro para o seguinte, com um byte nulo no lugar dele. O texto volta sem o byte nulo e sem caractere
    /// partido.
    /// </summary>
    [Test]
    public async Task ViewDefinition_InAUtf8Database_DoesNotBreakTheCharactersAtTheChunkBorders()
    {
        string[] texts = [.. Enumerable.Range(0, 80).Select(column => $"çãé{column:00}ü")];
        await using var connection = await OpenAsync(Settings with { Database = InformixSingleton.Utf8Database });
        await RunAsync(connection, $"CREATE TABLE {_owner}.base (id INTEGER)", $"CREATE VIEW {_owner}.acentos ({string.Join(", ", texts.Select((_, column) => $"c{column:00}"))}) AS SELECT {string.Join(", ", texts.Select(text => $"'{text}'"))} FROM {_owner}.base");

        var view = Value(await connection.GetViewDefinitionAsync(_owner, "acentos", CancellationToken.None));
        var chunks = await connection.ExecuteAsync($"SELECT COUNT(*) FROM sysviews, systables WHERE sysviews.tabid = systables.tabid AND systables.owner = '{_owner}' AND systables.tabname = 'acentos'", CancellationToken.None);
        await RunAsync(connection, $"DROP VIEW {_owner}.acentos", $"DROP TABLE {_owner}.base");

        Assert.That(int.Parse(chunks.Value.Page!.Rows[0][0]!), Is.GreaterThan(4));
        Assert.That(view.Definition, Is.EqualTo($"create view \"{_owner}\".acentos ({string.Join(",", texts.Select((_, column) => $"c{column:00}"))}) as select {string.Join(" ,", texts.Select(text => $"'{text}'"))} from \"{_owner}\".base x0 ;"));
    }

    /// <summary>RN-CAT-008: só as tabelas do dono, com as colunas na ordem; as chaves que saem delas, também a que aponta para outro dono.</summary>
    [Test]
    public async Task Diagram_HasTheTablesOfTheSchemaAndTheKeysThatLeaveThem()
    {
        await using var connection = await OpenAsync();

        var diagram = Value(await connection.GetDiagramAsync(_owner, CancellationToken.None));

        Assert.That(diagram.Tables.Select(table => table.Name), Is.EqualTo(new[] { "analisada", "aponta_fora", "conferida", "filho", "nunca_analisada", "padroes", "pai" }));
        Assert.That(diagram.Tables.Single(table => table.Name == "pai").Columns, Is.EqualTo(new[] { new DiagramColumnInfo("id", "INTEGER", false, true), new DiagramColumnInfo("codigo", "INTEGER", false, false), new DiagramColumnInfo("superior", "INTEGER", true, false) }));
        Assert.That(diagram.ForeignKeys.Select(key => (key.Name, key.ReferencingTable, string.Join(",", key.Columns), key.ReferencedSchema, key.ReferencedTable, string.Join(",", key.ReferencedColumns), key.OnDelete, key.OnUpdate)), Is.EqualTo(new[]
        {
            ("fk_aponta_fora", "aponta_fora", "alvo_id", Other, "alvo", "id", "restrict", "restrict"),
            ("fk_cascata", "filho", "pai_id", _owner, "pai", "id", "cascade", "restrict"),
            ("fk_composta", "filho", "pai_id,pai_codigo", _owner, "pai", "id,codigo", "restrict", "restrict"),
            ("fk_pai_superior", "pai", "superior", _owner, "pai", "id", "restrict", "restrict")
        }));
    }

    /// <summary>RN-CAT-010: o modo de log (que decide se há transação), a localidade, o dono e o espaço do banco conectado, nos três bancos da carga.</summary>
    [Test]
    public async Task Properties_ReportTheLoggingModeAndTheLocale()
    {
        var logged = await PropertiesOfAsync(Settings);
        var unlogged = await PropertiesOfAsync(Settings with { Database = InformixSingleton.UnloggedDatabase });
        var utf8 = await PropertiesOfAsync(Settings with { Database = InformixSingleton.Utf8Database });

        Assert.That(logged.Select(property => property.Name), Is.EqualTo(new[] { "loggingMode", "locale", "owner", "dbspace" }));
        Assert.That(logged.Take(3).Select(property => property.Value), Is.EqualTo(new[] { "unbufferedLogging", "en_US.819", "informix" }));
        Assert.That(logged[3].Value, Is.Not.Empty);
        Assert.That(unlogged[0], Is.EqualTo(new DatabasePropertyInfo("loggingMode", "noLogging")));
        Assert.That(utf8[1], Is.EqualTo(new DatabasePropertyInfo("locale", "en_US.57372")));
    }

    /// <summary>
    /// Nomes com maiúsculas e minúsculas, espaço e aspas, no dono, na tabela, na coluna e nas restrições, e outra tabela de mesmo nome a
    /// não ser pelas maiúsculas: cada consulta acha a tabela certa, e nada quebra.
    /// </summary>
    [Test]
    public async Task Catalog_OfNamesWithCaseSpacesAndQuotes_FindsTheRightObjects()
    {
        const string owner = "Dono \"M\" 'x'";
        const string table = "Tab \"Q\" 'y'";
        const string twin = "tab \"q\" 'y'";
        const string column = "Col \"C\" 'z'";
        await using var connection = await OpenAsync();
        await RunAsync(connection,
            $"CREATE TABLE {Quote(owner)}.{Quote(table)} ({Quote(column)} INTEGER NOT NULL DEFAULT 7, PRIMARY KEY ({Quote(column)}) CONSTRAINT {Quote("Pk \"P\" 'p'")}, CHECK ({Quote(column)} > 0) CONSTRAINT {Quote("Ck \"K\" 'w'")})",
            $"CREATE TABLE {Quote(owner)}.{Quote(twin)} (outra INTEGER, ref INTEGER, FOREIGN KEY (ref) REFERENCES {Quote(owner)}.{Quote(table)} ({Quote(column)}) ON DELETE CASCADE CONSTRAINT {Quote("Fk \"F\" 'v'")})",
            $"CREATE VIEW {Quote(owner)}.{Quote("Vis \"V\" 'u'")} ({Quote(column)}) AS SELECT {Quote(column)} FROM {Quote(owner)}.{Quote(table)}");
        try
        {
            var columns = Value(await connection.GetColumnsAsync(owner, table, CancellationToken.None));
            var twinColumns = Value(await connection.GetColumnsAsync(owner, twin, CancellationToken.None));
            var checks = Value(await connection.GetChecksAsync(owner, table, CancellationToken.None));
            var twinChecks = Value(await connection.GetChecksAsync(owner, twin, CancellationToken.None));
            var referencedBy = Value(await connection.GetReferencingForeignKeysAsync(owner, table, CancellationToken.None));
            var foreignKeys = Value(await connection.GetForeignKeysAsync(owner, twin, CancellationToken.None));
            var view = Value(await connection.GetViewDefinitionAsync(owner, "Vis \"V\" 'u'", CancellationToken.None));
            var diagram = Value(await connection.GetDiagramAsync(owner, CancellationToken.None));
            var schemas = Value(await connection.GetSchemasAsync(CancellationToken.None));
            await TestContext.Out.WriteLineAsync($"{checks.SingleOrDefault()?.Expression} | {view.Definition}");

            Assert.That(columns, Is.EqualTo(new[] { new ColumnInfo(column, "INTEGER", false, true, 1, "7", null) }));
            Assert.That(twinColumns.Select(item => item.Name), Is.EqualTo(new[] { "outra", "ref" }));
            Assert.That(checks.Select(check => check.Name), Is.EqualTo(new[] { "Ck \"K\" 'w'" }));
            Assert.That(checks.Single().Expression, Does.Contain("> 0"));
            Assert.That(twinChecks, Is.Empty);
            Assert.That(referencedBy.Select(key => (key.Name, key.ReferencingSchema, key.ReferencingTable, key.ReferencedColumns.Single(), key.OnDelete)), Is.EqualTo(new[] { ("Fk \"F\" 'v'", owner, twin, column, "cascade") }));
            Assert.That(foreignKeys.Select(key => (key.Name, key.ReferencedSchema, key.ReferencedTable)), Is.EqualTo(new[] { ("Fk \"F\" 'v'", owner, table) }));
            Assert.That(view.Definition, Does.StartWith("create view ").And.EndWith(" ;"));
            Assert.That(diagram.Tables.Select(item => item.Name), Is.EqualTo(new[] { table, twin }));
            Assert.That(schemas.Single(item => item.Name == owner).Tables, Is.EqualTo(2));
        }
        finally
        {
            foreach (var sql in new[] { $"DROP VIEW {Quote(owner)}.{Quote("Vis \"V\" 'u'")}", $"DROP TABLE {Quote(owner)}.{Quote(twin)}", $"DROP TABLE {Quote(owner)}.{Quote(table)}" })
                await connection.ExecuteAsync(sql, CancellationToken.None);
        }
    }

    /// <summary>Com o dono e o nome sorteados para não esbarrar nos de outro teste: o nome de uma restrição é único no banco inteiro.</summary>
    protected override async Task<string> CreateLargeSchemaAsync()
    {
        var owner = $"dg_{Guid.NewGuid():N}"[..13];
        await using var connection = await OpenAsync();
        await RunAsync(connection, $@"CREATE PROCEDURE {owner}.monta_diagrama ()
                                          DEFINE i INTEGER;

                                          FOR i = 1 TO 300
                                              EXECUTE IMMEDIATE 'CREATE TABLE {owner}.t' || i || ' (id INTEGER NOT NULL, nome VARCHAR(40), ref_a INTEGER, ref_b INTEGER, PRIMARY KEY (id) CONSTRAINT {owner}_pk' || i || ')';
                                          END FOR;

                                          FOR i = 2 TO 300
                                              EXECUTE IMMEDIATE 'ALTER TABLE {owner}.t' || i || ' ADD CONSTRAINT FOREIGN KEY (ref_a) REFERENCES {owner}.t' || (i - 1) || ' (id) CONSTRAINT {owner}_fa' || i;
                                          END FOR;

                                          FOR i = 101 TO 201
                                              EXECUTE IMMEDIATE 'ALTER TABLE {owner}.t' || i || ' ADD CONSTRAINT FOREIGN KEY (ref_b) REFERENCES {owner}.t' || (i - 100) || ' (id) CONSTRAINT {owner}_fb' || i;
                                          END FOR;
                                      END PROCEDURE", $"EXECUTE PROCEDURE {owner}.monta_diagrama()", $"DROP PROCEDURE {owner}.monta_diagrama");

        return owner;
    }

    protected override async Task DropLargeSchemaAsync(string schema)
    {
        await using var connection = await OpenAsync();
        await RunAsync(connection, $@"CREATE PROCEDURE {schema}.apaga_diagrama ()
                                          DEFINE i INTEGER;

                                          FOR i = 300 TO 1 STEP -1
                                              EXECUTE IMMEDIATE 'DROP TABLE {schema}.t' || i;
                                          END FOR;
                                      END PROCEDURE", $"EXECUTE PROCEDURE {schema}.apaga_diagrama()", $"DROP PROCEDURE {schema}.apaga_diagrama");
    }

    private async Task<IReadOnlyList<DatabasePropertyInfo>> PropertiesOfAsync(ConnectionSettings settings)
    {
        await using var connection = await OpenAsync(settings);

        return Value(await connection.GetPropertiesAsync(CancellationToken.None));
    }

    private static string Quote(string identifier)
        => $"\"{identifier.Replace("\"", "\"\"")}\"";
}
