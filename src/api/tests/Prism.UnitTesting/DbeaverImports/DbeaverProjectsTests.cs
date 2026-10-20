using Prism.Application.DbeaverImports.Models;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.TestingCore.Fakers.Dbeaver;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>RN-DBEAVER-007 e 008: a leitura de cada projeto da cópia, com os arquivos do DBeaver SINTÉTICO (o `credentials-config` cifrado no teste).</summary>
public sealed class DbeaverProjectsTests : IDisposable
{
    private readonly DbeaverImportFixtures _fixtures = new();

    public void Dispose()
        => _fixtures.Dispose();

    private DbeaverRead Read(Guid sourceId)
        => DbeaverSources.Read(_fixtures.Source, sourceId, onlyProject: null).Value;

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o General: as conexões lidas, as pastas com os pais e a forma antiga, e a conexão de fonte externa fora")]
    public void Read_General()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var general = Read(sourceId).Projects[0];

        //Assert
        Assert.True(general.Included);
        Assert.True(general.IsGeneral);
        Assert.Equal(14, general.Connections.Count);
        Assert.DoesNotContain(general.Connections, connection => connection.ID == DbeaverWorkspace.External);
        Assert.Equal(["Antiga", "Pasta com um nome muito comprido, bem mais do que sessenta caracteres no total", "Producao", "Producao/Antiga", "Producao/Informix", "Vazia"], general.FolderPaths);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o usuário e a senha vêm do credentials-config cifrado com o IV zero, e o configuration por cima")]
    public void Read_Credentials()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var connections = Read(sourceId).Projects[0].Connections.ToDictionary(connection => connection.ID);

        //Assert
        Assert.Equal(("usuario-pg", DbeaverWorkspace.PgPassword), (connections[DbeaverWorkspace.PgFields].UserName.Text, connections[DbeaverWorkspace.PgFields].Password.Text));
        Assert.Equal(("usuario-inline", DbeaverWorkspace.InlinePassword), (connections[DbeaverWorkspace.Inline].UserName.Text, connections[DbeaverWorkspace.Inline].Password.Text));
        Assert.Equal("usuario-pgpass", connections[DbeaverWorkspace.PgPass].UserName.Text);
        Assert.True(connections[DbeaverWorkspace.PgPass].Password.IsMissing);
        Assert.True(connections[DbeaverWorkspace.SavedPasswordMissing].Password.IsMissing);
        Assert.True(connections[DbeaverWorkspace.SavedPasswordMissing].SavePassword);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK a cópia em memória do credentials-config é zerada depois de lida")]
    public void Read_ZeroesTheCredentialsFileBuffer()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var opened = _fixtures.Source.Open(sourceId).Value;
        var general = opened.Projects[0];

        //Act
        var model = DbeaverProjects.Read(_fixtures.Source, general);

        //Assert
        Assert.NotEmpty(model.Connections);
        Assert.All(general.Files.Where(file => file.Name == "credentials-config.json"), file => Assert.All(file.Content!, value => Assert.Equal(0, value)));
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o data-sources-2 usa o credentials-config-2, e o ID repetido vale o do data-sources.json, com o outro de fora")]
    public void Read_Vendas()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var sales = Read(sourceId).Projects[1];

        //Assert
        Assert.Equal(4, sales.Connections.Count);
        var byID = sales.Connections.ToDictionary(connection => $"{connection.ID}|{connection.Name.Text}");
        Assert.Equal(("usuario-vendas", DbeaverWorkspace.SalesPassword), (byID[$"{DbeaverWorkspace.SalesMain}|Vendas Principal"].UserName.Text, byID[$"{DbeaverWorkspace.SalesMain}|Vendas Principal"].Password.Text));
        Assert.Equal(("usuario-extra", "senha-extra-fictícia"), (byID[$"{DbeaverWorkspace.SalesSecond}|Vendas Extra"].UserName.Text, byID[$"{DbeaverWorkspace.SalesSecond}|Vendas Extra"].Password.Text));
        Assert.Null(byID["backup-duplicate-id|No arquivo principal"].Refusal);
        Assert.Equal(DbeaverProjects.DuplicatedIDMessage, byID["backup-duplicate-id|No backup esquecido"].Refusal);
        Assert.Equal(["Relatorios", "Relatorios/Extras"], sales.FolderPaths);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o credentials-config de 0 byte não é erro nem aviso")]
    public void Read_EmptyCredentials_IsSilent()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var legacy = Read(sourceId).Projects[2];

        //Assert
        Assert.True(legacy.Included);
        Assert.False(legacy.CredentialsUnreadable);
        Assert.False(legacy.CredentialsProtected);
        Assert.True(Assert.Single(legacy.Connections).Password.IsMissing);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK sem credentials-config as conexões vêm só com o usuário do data-sources, quando ele tem um")]
    public void Read_WithoutCredentialsFile()
    {
        //Arrange
        var builder = _fixtures.Builder().Project("General", project => project.DataSources("""{"connections":{"a":{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"host":"h.exemplo.invalid","user":"so-o-usuario"}}}}"""));
        var sourceId = builder.Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.False(model.CredentialsUnreadable);
        Assert.Equal("so-o-usuario", Assert.Single(model.Connections).UserName.Text);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK secureProject: o projeto não é lido; só useProjectPassword: as conexões vêm sem senha, com o aviso")]
    public void Read_ProtectedProjects()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var projects = Read(sourceId).Projects;
        var secure = projects[3];
        var password = projects[4];

        //Assert
        Assert.True(secure.Protected);
        Assert.False(secure.Included);
        Assert.Empty(secure.Connections);
        Assert.True(password.Included);
        Assert.True(password.CredentialsProtected);
        Assert.True(Assert.Single(password.Connections).Password.IsMissing);
        Assert.False(password.CredentialsUnreadable);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o project-settings que não é um JSON é ignorado")]
    public void Read_BrokenProjectSettings_IsIgnored()
    {
        //Arrange
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources("{}").Settings("não é json")).Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.True(model.Included);
        Assert.False(model.Protected);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o credentials-config que não decifra, não é um JSON nessa forma ou passa de 5 MiB marca as senhas como não lidas, e a conexão fica com o usuário")]
    public void Read_UnreadableCredentials()
    {
        //Arrange
        const string connections = """{"connections":{"a":{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"host":"h.exemplo.invalid","user":"do-data-sources"}}}}""";
        var garbage = _fixtures.Builder().Project("General", project => project.DataSources(connections).Add("credentials-config.json", new byte[48].Select((_, index) => (byte)(index * 13 + 1)).ToArray())).Build();
        var notJson = _fixtures.Builder().Project("General", project => project.DataSources(connections).Credentials("[1,2,3]")).Build();
        var oversized = _fixtures.Builder().Project("General", project => project.DataSources(connections).Add("credentials-config.json", new byte[5 * 1024 * 1024 + 16])).Build();
        var shortFile = _fixtures.Builder().Project("General", project => project.DataSources(connections).Add("credentials-config.json", new byte[20])).Build();

        //Act and Assert
        foreach (var sourceId in new[] { garbage, notJson, oversized, shortFile })
        {
            var model = Read(sourceId).Projects[0];
            Assert.True(model.CredentialsUnreadable);
            Assert.True(model.Included);
            Assert.Equal("do-data-sources", Assert.Single(model.Connections).UserName.Text);
        }
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o data-sources que não é um objeto JSON deixa de fora só aquele arquivo; sem nenhum legível, o projeto fica de fora")]
    public void Read_MalformedDataSources()
    {
        //Arrange
        const string good = """{"connections":{"a":{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"host":"h.exemplo.invalid"}}}}""";
        var someRead = _fixtures.Builder().Project("General", project => project.DataSources(good).DataSources("[1]", "-2").DataSources("{ quebrado", "-3")).Build();
        var noneRead = _fixtures.Builder().Project("General", project => project.DataSources("não é json").DataSources("\"texto\"", "-2")).Build();

        //Act
        var some = Read(someRead).Projects[0];
        var none = Read(noneRead).Projects[0];

        //Assert
        Assert.True(some.Included);
        Assert.Equal(2, some.UnreadableFiles);
        Assert.Single(some.Connections);
        Assert.False(none.Readable);
        Assert.False(none.Included);
        Assert.Equal(2, none.UnreadableFiles);
    }

    [Trait("DbeaverProjects", "Read")]
    [Theory(DisplayName = "OK o nome de projeto que o Prism não aceita deixa as conexões de fora, e a tela o mostra como Projeto N")]
    [InlineData("Vendas‮X")]
    [InlineData("Linha\nquebrada\u0001")]
    public void Read_InvalidProjectName(string name)
    {
        //Arrange
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources("{}")).Project(name, project => project.DataSources("""{"connections":{"a":{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"host":"h.exemplo.invalid"}}}}""")).Build();

        //Act
        var model = Read(sourceId).Projects[1];

        //Assert
        Assert.True(model.NameInvalid);
        Assert.Equal("Projeto 2", model.DisplayName);
        Assert.Empty(model.Connections);
        Assert.False(model.Included);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o nome do projeto com mais de 255 caracteres não serve (a origem guarda o nome inteiro)")]
    public void Read_ProjectNameTooLong()
        => Assert.True(DbeaverProjects.NameIsInvalid(new string('p', 256)));

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o caminho de pastas sem as partes vazias, e os pais criados")]
    public void Read_FolderPaths()
    {
        //Arrange
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources("""
            {"folders":{"a//b":{}},"connections":{"x":{"provider":"postgresql","driver":"postgres-jdbc","name":"X","folder":"/c/d//e/","configuration":{"host":"h.exemplo.invalid"}}}}
            """)).Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.Equal(["a", "a/b", "c", "c/d", "c/d/e"], model.FolderPaths);
        Assert.Equal("c/d/e", model.Connections[0].FolderPath);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK o caminho de pastas com 100 mil níveis não é aberto em pais: o projeto passa dos limites e a conexão fica sem pasta e sem importar")]
    public void Read_HostileFolderPath()
    {
        //Arrange
        var path = string.Join('/', Enumerable.Repeat("a", 100_000));
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources(
            "{\"folders\":{\"" + path + "\":{}},\"connections\":{\"x\":{\"provider\":\"postgresql\",\"driver\":\"postgres-jdbc\",\"name\":\"X\",\"folder\":\"" + path + "\",\"configuration\":{\"host\":\"h.exemplo.invalid\"}}}}")).Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.True(model.PathsOverLimit);
        Assert.Empty(model.FolderPaths);
        var connection = Assert.Single(model.Connections);
        Assert.Equal(string.Empty, connection.FolderPath);
        Assert.Equal(DbeaverProjects.PathTooDeepMessage, connection.Refusal);
    }

    [Trait("DbeaverProjects", "Read")]
    [Theory(DisplayName = "OK 64 níveis ainda são abertos em pais, e 65 níveis ou mais de 4.096 caracteres, não")]
    [InlineData(64, 1, false)]
    [InlineData(65, 1, true)]
    [InlineData(10, 500, true)]
    public void Read_FolderPathBounds(int levels, int nameLength, bool overLimit)
    {
        //Arrange
        var path = string.Join('/', Enumerable.Repeat(new string('n', nameLength), levels));
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources("{\"folders\":{\"" + path + "\":{}}}")).Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.Equal(overLimit, model.PathsOverLimit);
        Assert.Equal(overLimit ? 0 : levels, model.FolderPaths.Count);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK passadas as 2.000 pastas o conjunto deixa de crescer, e o projeto passa dos limites")]
    public void Read_FolderSetStopsGrowing()
    {
        //Arrange
        var folders = string.Join(',', Enumerable.Range(0, 5000).Select(index => "\"pasta " + index + "\":{}"));
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources("{\"folders\":{" + folders + "}}")).Build();

        //Act
        var model = Read(sourceId).Projects[0];

        //Assert
        Assert.True(model.PathsOverLimit);
        Assert.Equal(2001, model.FolderPaths.Count);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK só os connection-types do próprio arquivo valem para as conexões dele")]
    public void Read_TypesOfTheFile()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var connections = Read(sourceId).Projects[0].Connections.ToDictionary(connection => connection.ID);

        //Assert
        Assert.Equal(("Produção", "#FACFCF", "all"), (connections[DbeaverWorkspace.Db2Fields].EnvironmentName.Text, connections[DbeaverWorkspace.Db2Fields].EnvironmentColor.Text, connections[DbeaverWorkspace.Db2Fields].ConfirmCommands.Text));
        Assert.Equal(("QA Homologação", "#6496C8"), (connections[DbeaverWorkspace.InformixFields].EnvironmentName.Text, connections[DbeaverWorkspace.InformixFields].EnvironmentColor.Text));
        Assert.Equal(("Teste", "#D6FACF"), (connections[DbeaverWorkspace.PgUrl].EnvironmentName.Text, connections[DbeaverWorkspace.PgUrl].EnvironmentColor.Text));
        Assert.Equal((true, "Restrito"), (connections[DbeaverWorkspace.Restricted].ReadOnly.Boolean, connections[DbeaverWorkspace.Restricted].EnvironmentName.Text));
        Assert.Contains("permissions", connections[DbeaverWorkspace.Restricted].LeftOut);
        Assert.Contains("sshTunnel", connections[DbeaverWorkspace.InformixFields].LeftOut);
        Assert.Empty(connections[DbeaverWorkspace.PgFields].LeftOut);
    }

    [Trait("DbeaverProjects", "Read")]
    [Fact(DisplayName = "OK a conexão cujo nome é branco ou a variável ou a URL que não casa trazem o motivo do DBeaver")]
    public void Read_Refusals()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var connections = Read(sourceId).Projects[0].Connections.ToDictionary(connection => connection.ID);

        //Assert
        Assert.Equal("O Prism ainda não tem este banco (MySQL).", connections[DbeaverWorkspace.MySql].Refusal);
        Assert.Equal("A conexão usa variáveis do DBeaver (${…}), que o Prism não tem.", connections[DbeaverWorkspace.Variable].Refusal);
        Assert.Equal("Não foi possível ler a URL JDBC desta conexão (jdbc:informix-sqli:…).", connections[DbeaverWorkspace.BadUrl].Refusal);
        Assert.DoesNotContain(DbeaverWorkspace.Mark, connections[DbeaverWorkspace.BadUrl].Refusal);
    }
}
