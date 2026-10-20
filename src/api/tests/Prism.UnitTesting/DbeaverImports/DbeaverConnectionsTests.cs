using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// RN-DBEAVER-009 a 013: a conexão do `data-sources.json` do DBeaver traduzida para a forma do arquivo do Prism: o banco pelo provedor e pelo driver, o host, a porta,
/// o banco de dados e o servidor pelos campos ou pela URL, o usuário e a senha (com o `configuration` por cima do `credentials-config`), o ambiente e as proteções pelo
/// tipo de conexão, e o que ficou de fora. Os dados são inventados: hosts `.invalid` e senhas fictícias.
/// </summary>
public sealed class DbeaverConnectionsTests
{
    private static readonly IReadOnlyDictionary<string, DbeaverType> NoTypes = new Dictionary<string, DbeaverType>();

    private static DbeaverConnectionModel Map(string json, IReadOnlyDictionary<string, DbeaverType>? types = null, DbeaverLogin? login = null, string folder = "")
    {
        using var document = JsonDocument.Parse(json);

        return DbeaverConnections.Map("conexao-1", document.RootElement, folder, types ?? NoTypes, login)!;
    }

    private const string Postgres = """{"provider":"postgresql","driver":"postgres-jdbc","name":"Pedidos","configuration":{"host":"pg-dev.exemplo.invalid","port":"5432","database":"pedidos"}}""";

    [Trait("DbeaverConnections", "Map")]
    [Theory(DisplayName = "ERRO o ID da conexão vazio, com mais de 128 caracteres ou com caractere de controle não é gravado na origem: a conexão não é importável")]
    [InlineData("", true)]
    [InlineData("128", false)]
    [InlineData("129", true)]
    [InlineData("a\u0007b", true)]
    [InlineData("a\u202eb", true)]
    public void Map_ConnectionIDLimits(string id, bool refused)
    {
        //Arrange
        var length = id is "128" or "129" ? int.Parse(id, System.Globalization.CultureInfo.InvariantCulture) : 0;
        var value = length > 0 ? new string('i', length) : id;
        using var document = JsonDocument.Parse(Postgres);

        //Act
        var model = DbeaverConnections.Map(value, document.RootElement, string.Empty, NoTypes, null)!;

        //Assert
        Assert.Equal(refused ? DbeaverConnections.IDInvalidMessage : null, model.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o PostgreSQL por campos: nome, host, porta e banco de dados, com o ambiente padrão Desenvolvimento")]
    public void Map_PostgreSqlByFields()
    {
        //Act
        var model = Map(Postgres);

        //Assert
        Assert.Null(model.Refusal);
        Assert.Equal(EDatabaseEngine.PostgreSql, model.Engine);
        Assert.Equal("PostgreSql", model.EngineValue.Text);
        Assert.Equal(("Pedidos", "pg-dev.exemplo.invalid", "5432", "pedidos"), (model.Name.Text, model.Host.Text, model.Port.Text, model.Database.Text));
        Assert.Equal(JsonValueKind.Number, model.Port.Kind);
        Assert.Equal("Desenvolvimento", model.EnvironmentName.Text);
        Assert.True(model.EnvironmentColor.IsMissing);
        Assert.True(model.ConfirmCommands.IsMissing);
        Assert.Equal(false, model.ReadOnly.Boolean);
        Assert.Empty(model.LeftOut);
    }

    [Trait("DbeaverConnections", "Map")]
    [Theory(DisplayName = "OK o banco pelo provider e pelo driver, nunca pelo começo do ID")]
    [InlineData("postgresql", "postgres-jdbc", EDatabaseEngine.PostgreSql)]
    [InlineData("postgresql", "postgresql", EDatabaseEngine.PostgreSql)]
    [InlineData("db2", "db2", EDatabaseEngine.Db2)]
    [InlineData("generic", "informix", EDatabaseEngine.Informix)]
    public void Map_Engine(string provider, string driver, EDatabaseEngine engine)
    {
        //Act
        var model = Map("""{"provider":"@P","driver":"@D","name":"X","configuration":{"host":"h.exemplo.invalid","port":"1","database":"d","server":"s"}}""".Replace("@P", provider).Replace("@D", driver));

        //Assert
        Assert.Equal(engine, model.Engine);
        Assert.Null(model.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Theory(DisplayName = "ERRO o banco que o Prism não tem fica de fora, com o nome dele")]
    [InlineData("mysql", "mysql8", "MySQL")]
    [InlineData("mariadb", "mariaDB", "MariaDB")]
    [InlineData("oracle", "oracle_thin", "Oracle")]
    [InlineData("mssql", "microsoft", "SQL Server")]
    [InlineData("sqlite", "sqlite_jdbc", "SQLite")]
    [InlineData("db2_zos", "db2_zos", "Db2 for z/OS")]
    [InlineData("db2_i", "db2_iseries", "Db2 for IBM i")]
    [InlineData("postgresql", "greenplum", "Greenplum")]
    [InlineData("postgresql", "redshift", "Redshift")]
    [InlineData("postgresql", "cockroachdb", "CockroachDB")]
    [InlineData("postgresql", "timescale-db-driver-qualquer", "TimescaleDB")]
    [InlineData("generic", "banco-desconhecido", "banco-desconhecido")]
    public void Map_UnsupportedEngine(string provider, string driver, string shown)
    {
        //Act
        var model = Map("""{"provider":"@P","driver":"@D","name":"X","configuration":{"host":"h.exemplo.invalid","port":"3306","database":"d"}}""".Replace("@P", provider).Replace("@D", driver));

        //Assert
        Assert.Null(model.Engine);
        Assert.Equal($"O Prism ainda não tem este banco ({shown}).", model.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o driver desconhecido é cortado em 60 caracteres, sem caractere de controle")]
    public void Map_UnsupportedEngine_CutsTheDriverName()
    {
        //Act
        var model = Map("""{"provider":"generic","driver":"@D\u202e\u0007","name":"X","configuration":{"host":"h.exemplo.invalid"}}""".Replace("@D", new string('x', 100)));

        //Assert
        Assert.Equal($"O Prism ainda não tem este banco ({new string('x', 60)}).", model.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Theory(DisplayName = "OK a porta ausente é a padrão do banco, o banco de dados ausente é postgres no PostgreSQL")]
    [InlineData("postgresql", "postgres-jdbc", "5432", "postgres")]
    public void Map_Defaults(string provider, string driver, string port, string database)
    {
        //Act
        var model = Map("""{"provider":"@P","driver":"@D","name":"X","configuration":{"host":"h.exemplo.invalid"}}""".Replace("@P", provider).Replace("@D", driver));

        //Assert
        Assert.Null(model.Refusal);
        Assert.Equal((port, database), (model.Port.Text, model.Database.Text));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK a porta ausente do Db2 é 50000, e o banco de dados ausente do Db2 deixa a conexão de fora")]
    public void Map_Db2_DefaultPortAndMissingDatabase()
    {
        //Act
        var withDatabase = Map("""{"provider":"db2","driver":"db2","name":"X","configuration":{"host":"h.exemplo.invalid","database":"sample"}}""");
        var without = Map("""{"provider":"db2","driver":"db2","name":"X","configuration":{"host":"h.exemplo.invalid","port":50000}}""");

        //Assert
        Assert.Equal("50000", withDatabase.Port.Text);
        Assert.Equal("A conexão não tem banco de dados: o Prism precisa de um.", without.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "ERRO o Informix sem porta ou sem banco de dados fica de fora")]
    public void Map_Informix_MissingPortOrDatabase()
    {
        //Act
        var withoutPort = Map("""{"provider":"generic","driver":"informix","name":"X","configuration":{"host":"h.exemplo.invalid","database":"estoque","server":"s"}}""");
        var withoutDatabase = Map("""{"provider":"generic","driver":"informix","name":"X","configuration":{"host":"h.exemplo.invalid","port":"55080","server":"s"}}""");

        //Assert
        Assert.Equal("A conexão não tem porta.", withoutPort.Refusal);
        Assert.Equal("A conexão não tem banco de dados: o Prism precisa de um.", withoutDatabase.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o Informix: a porta SQLI e o servidor ficam no modelo, e o servidor vai para o que ficou de fora")]
    public void Map_Informix()
    {
        //Act
        var model = Map("""{"provider":"generic","driver":"informix","name":"USER MIGRATION STOCK MANAGER","configuration":{"host":"central.exemplo.invalid","port":"55080","server":"far_ewm_001_dev_tcp","database":"tramon"}}""");

        //Assert
        Assert.Null(model.Refusal);
        Assert.Equal((55080, "far_ewm_001_dev_tcp"), (model.SqliPort, model.Server));
        Assert.Equal(["informixServer"], model.LeftOut);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK com host, porta, servidor e banco vazios e a URL preenchida, vale a URL; com MANUAL e o campo preenchido, a URL é ignorada")]
    public void Map_UrlOnlyWhenTheFieldsAreEmpty()
    {
        //Act
        var urlOnly = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"url":"jdbc:postgresql://pg-url.exemplo.invalid:6543/faturas"}}""");
        var manual = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"configurationType":"MANUAL","host":"pg-campo.exemplo.invalid","url":"jdbc:postgresql://pg-url.exemplo.invalid:6543/faturas"}}""");

        //Assert
        Assert.Equal(("pg-url.exemplo.invalid", "6543", "faturas"), (urlOnly.Host.Text, urlOnly.Port.Text, urlOnly.Database.Text));
        Assert.Equal(("pg-campo.exemplo.invalid", "5432", "postgres"), (manual.Host.Text, manual.Port.Text, manual.Database.Text));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK com URL, vale a URL dos três bancos, inclusive o servidor Informix")]
    public void Map_UrlMode()
    {
        //Act
        var pg = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"configurationType":"URL","host":"velho.exemplo.invalid","url":"jdbc:postgresql://[2001:db8::7]:6543/faturas?ssl=true"}}""");
        var db2 = Map("""{"provider":"db2","driver":"db2","name":"B","configuration":{"configurationType":"URL","url":"jdbc:db2://db2-url.exemplo.invalid:50001/cadastro:currentSchema=APP;"}}""");
        var ifx = Map("""{"provider":"generic","driver":"informix","name":"C","configuration":{"configurationType":"URL","url":"jdbc:informix-sqli://ifx-url.exemplo.invalid:55081/tramon:INFORMIXSERVER=ifx_url_tcp"}}""");

        //Assert
        Assert.Equal(("2001:db8::7", "6543", "faturas"), (pg.Host.Text, pg.Port.Text, pg.Database.Text));
        Assert.Equal(("db2-url.exemplo.invalid", "50001", "cadastro"), (db2.Host.Text, db2.Port.Text, db2.Database.Text));
        Assert.Equal(("ifx-url.exemplo.invalid", "55081", "tramon", "ifx_url_tcp", 55081), (ifx.Host.Text, ifx.Port.Text, ifx.Database.Text, ifx.Server, ifx.SqliPort));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "ERRO a URL que não casa deixa a conexão de fora e mostra só o começo, sem a senha que estava nela")]
    public void Map_UnparsableUrl_ShowsOnlyTheBeginning()
    {
        //Act
        var informix = Map("""{"provider":"generic","driver":"informix","name":"X","configuration":{"configurationType":"URL","url":"jdbc:informix-sqli:INFORMIXSERVER=ifx_dev_tcp;user=fulano;password=senha-inventada-na-url"}}""");
        var postgres = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"Y","configuration":{"configurationType":"URL","url":"jdbc:postgresql://pg.exemplo.invalid:5432;password=senha-inventada-na-url"}}""");

        //Assert
        Assert.Equal("Não foi possível ler a URL JDBC desta conexão (jdbc:informix-sqli:…).", informix.Refusal);
        Assert.Equal("jdbc:postgresql://pg.exemplo.invalid:5432", Assert.Single(System.Text.RegularExpressions.Regex.Matches(postgres.Refusal!, @"jdbc:postgresql://pg\.exemplo\.invalid:5432")).Value);
        Assert.DoesNotContain("senha-inventada", informix.Refusal);
        Assert.DoesNotContain("senha-inventada", postgres.Refusal);
    }

    [Trait("DbeaverConnections", "Map")]
    [Theory(DisplayName = "ERRO a variável do DBeaver no host, na porta, no banco de dados ou no usuário deixa a conexão de fora")]
    [InlineData("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"${host_do_ambiente}","database":"d"}}""")]
    [InlineData("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","port":"${porta}","database":"d"}}""")]
    [InlineData("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","database":"${banco}"}}""")]
    [InlineData("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","database":"d","user":"${dbeaver.default-user}"}}""")]
    public void Map_Variables(string json)
        => Assert.Equal("A conexão usa variáveis do DBeaver (${…}), que o Prism não tem.", Map(json).Refusal);

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "ERRO sem host ou sem nome a conexão fica de fora com a frase do DBeaver")]
    public void Map_MissingHostOrName()
    {
        //Act
        var withoutHost = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"database":"d"}}""");
        var withoutName = Map("""{"provider":"postgresql","driver":"postgres-jdbc","configuration":{"host":"h.exemplo.invalid"}}""");

        //Assert
        Assert.Equal("A conexão não tem host.", withoutHost.Refusal);
        Assert.True(withoutName.Name.IsMissing);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK a conexão com origin (fonte externa) não entra nem aparece")]
    public void Map_Origin_IsSkipped()
    {
        //Arrange
        using var document = JsonDocument.Parse("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","origin":{"type":"externo"},"configuration":{"host":"h.exemplo.invalid"}}""");

        //Act
        var model = DbeaverConnections.Map("id", document.RootElement, "", NoTypes, null);

        //Assert
        Assert.Null(model);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o usuário e a senha do credentials-config, e o configuration não vazio por cima, como no DBeaver")]
    public void Map_Credentials_InlineWinsOverTheEncryptedFile()
    {
        //Act
        var fromFile = Map(Postgres, login: new DbeaverLogin("fulano", "senha-do-arquivo"));
        var inline = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","user":"beltrano","password":"senha-inline"}}""", login: new DbeaverLogin("fulano", "senha-do-arquivo"));
        var emptyInline = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","user":"","password":""}}""", login: new DbeaverLogin("fulano", "senha-do-arquivo"));
        var onlyInline = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","user":"beltrano","password":"senha-inline"}}""");

        //Assert
        Assert.Equal(("fulano", "senha-do-arquivo", true), (fromFile.UserName.Text, fromFile.Password.Text, fromFile.PasswordFound));
        Assert.Equal(("beltrano", "senha-inline"), (inline.UserName.Text, inline.Password.Text));
        Assert.Equal(("fulano", "senha-do-arquivo"), (emptyInline.UserName.Text, emptyInline.Password.Text));
        Assert.Equal(("beltrano", "senha-inline", true), (onlyInline.UserName.Text, onlyInline.Password.Text, onlyInline.PasswordFound));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK a senha vazia é sem senha, a senha sem usuário não vem e a senha não é aparada")]
    public void Map_Password_Rules()
    {
        //Act
        var empty = Map(Postgres, login: new DbeaverLogin("fulano", ""));
        var withoutUser = Map(Postgres, login: new DbeaverLogin(null, "senha-sem-usuario"));
        var spaces = Map(Postgres, login: new DbeaverLogin("fulano", "  senha com espaços  "));

        //Assert
        Assert.False(empty.PasswordFound);
        Assert.True(empty.Password.IsMissing);
        Assert.True(withoutUser.Password.IsMissing);
        Assert.False(withoutUser.PasswordFound);
        Assert.Equal("  senha com espaços  ", spaces.Password.Text);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o auth-model que não é native não traz usuário nem senha, e o postgres_pgpass traz o usuário sem a senha")]
    public void Map_AuthModel()
    {
        //Act
        var kerberos = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","auth-model":"postgres_kerberos"}}""", login: new DbeaverLogin("fulano", "senha-do-arquivo"));
        var pgpass = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","auth-model":"postgres_pgpass"}}""", login: new DbeaverLogin("fulano", "senha-do-arquivo"));
        var native = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","auth-model":"native"}}""", login: new DbeaverLogin("fulano", "senha-do-arquivo"));

        //Assert
        Assert.True(kerberos.UserName.IsMissing);
        Assert.True(kerberos.Password.IsMissing);
        Assert.Equal("postgres_kerberos", kerberos.AuthModel);
        Assert.Equal(["authModel"], kerberos.LeftOut);
        Assert.Equal("fulano", pgpass.UserName.Text);
        Assert.True(pgpass.Password.IsMissing);
        Assert.Equal("postgres_pgpass", pgpass.AuthModel);
        Assert.Equal(("fulano", "senha-do-arquivo", (string?)null), (native.UserName.Text, native.Password.Text, native.AuthModel));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o que o Prism não grava vai para o que ficou de fora, na ordem da especificação")]
    public void Map_LeftOut_InTheOrderOfTheSpecification()
    {
        //Act
        var model = Map("""
            {"provider":"generic","driver":"informix","name":"X","navigator-hide-schemas":true,"filters":[{"type":"x"}],"configuration":{"host":"h.exemplo.invalid","port":"55080","database":"d","server":"srv",
              "handlers":{"ssh_tunnel":{"type":"TUNNEL","enabled":true},"socks":{"type":"PROXY","enabled":true}},
              "properties":{"ifxIFXHOST":"x"},
              "bootstrap":{"autocommit":false,"defaultSchema":"app","query":["SET x"]},
              "events":{"BEFORE_CONNECT":{"enabled":true}}}}
            """);

        //Assert
        Assert.Equal(["informixServer", "sshTunnel", "proxy", "driverProperties", "bootstrap", "autocommitOff", "events", "navigatorFilters"], model.LeftOut);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o que o DBeaver grava sem importância não é listado: provider-properties só com @dbeaver-, handler desligado, navigator falso, bootstrap vazio")]
    public void Map_LeftOut_IgnoresWhatDoesNotMatter()
    {
        //Act
        var model = Map("""
            {"provider":"postgresql","driver":"postgres-jdbc","name":"X","navigator-hide-schemas":false,"lockPassword":"abc","keepAlive":30,"tags":["a"],"custom-properties":{"x":"y"},"filters":[],
              "configuration":{"host":"h.exemplo.invalid","home":"/opt/x","virtual-model-id":"z","provider-properties":{"@dbeaver-show-non-default-db@":"true","@dbeaver-show-template-db@":"false"},
              "handlers":{"ssh_tunnel":{"type":"TUNNEL","enabled":false}},"properties":{},"bootstrap":{"autocommit":true,"query":[]},"events":{}}}
            """);

        //Assert
        Assert.Empty(model.LeftOut);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o provider-properties com alguma chave que não é do DBeaver conta como propriedades do driver")]
    public void Map_LeftOut_ProviderPropertiesWithAForeignKey()
    {
        //Act
        var model = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","configuration":{"host":"h.exemplo.invalid","provider-properties":{"@dbeaver-x@":"1","sslMode":"require"}}}""");

        //Assert
        Assert.Equal(["driverProperties"], model.LeftOut);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o save-password do DBeaver fica no modelo, com ou sem a senha")]
    public void Map_SavePassword()
    {
        //Act
        var saved = Map("""{"provider":"postgresql","driver":"postgres-jdbc","name":"X","save-password":true,"configuration":{"host":"h.exemplo.invalid"}}""", login: new DbeaverLogin("fulano", null));
        var notSaved = Map(Postgres, login: new DbeaverLogin("fulano", null));

        //Assert
        Assert.True(saved.SavePassword);
        Assert.False(saved.PasswordFound);
        Assert.False(notSaved.SavePassword);
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK a pasta do DBeaver e o ID ficam no modelo")]
    public void Map_FolderAndID()
    {
        //Act
        var model = Map(Postgres, folder: "Producao/Informix");

        //Assert
        Assert.Equal(("conexao-1", "Producao/Informix"), (model.ID, model.FolderPath));
    }

    [Trait("DbeaverConnections", "Map")]
    [Fact(DisplayName = "OK o ToString não imprime o usuário, a senha nem o host")]
    public void Map_ToString_DoesNotPrintSecrets()
    {
        //Act
        var model = Map(Postgres, login: new DbeaverLogin("fulano", "senha-do-arquivo"));

        //Assert
        Assert.Equal(nameof(DbeaverConnectionModel), model.ToString());
        Assert.DoesNotContain("senha-do-arquivo", model.ToString());
    }
}
