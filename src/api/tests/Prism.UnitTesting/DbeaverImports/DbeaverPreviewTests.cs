using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Dbeaver;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// RN-DBEAVER-007 a 015: a contagem e a prévia do "Importar do DBeaver", com a cópia do DBeaver SINTÉTICO: o que vira o quê, o que fica de fora, os avisos, a senha que
/// nunca vai à resposta e a URL cortada.
/// </summary>
public sealed class DbeaverPreviewTests : IDisposable
{
    private readonly DbeaverImportFixtures _fixtures = new();

    public void Dispose()
        => _fixtures.Dispose();

    [Trait("DbeaverScan", "Handle")]
    [Fact(DisplayName = "OK a contagem de cada projeto: as conexões, as que o Prism importa, as com senha, e os avisos")]
    public async Task Scan_CountsEachProject()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var scan = await _fixtures.Scan(sourceId);

        //Assert
        Assert.True(scan.IsSuccess);
        Assert.Equal("standard", scan.Value.Where);
        var projects = scan.Value.Projects.ToDictionary(project => project.Name);
        Assert.Equal(["General", "Vendas", "Legado", "Seguro", "Senha"], scan.Value.Projects.Select(project => project.Name));
        Assert.Equal((14, 11, 6), (projects["General"].Connections, projects["General"].Importable, projects["General"].WithPassword));
        Assert.Equal((4, 3, 2), (projects["Vendas"].Connections, projects["Vendas"].Importable, projects["Vendas"].WithPassword));
        Assert.Equal((1, 1, 0), (projects["Legado"].Connections, projects["Legado"].Importable, projects["Legado"].WithPassword));
        Assert.Equal((0, 0, true), (projects["Seguro"].Connections, projects["Seguro"].Importable, projects["Seguro"].Protected));
        Assert.Equal((1, 1, 0, true), (projects["Senha"].Connections, projects["Senha"].Importable, projects["Senha"].WithPassword, projects["Senha"].CredentialsProtected));
        Assert.All(scan.Value.Projects, project => Assert.False(project.CredentialsUnreadable));
    }

    [Trait("DbeaverScan", "Handle")]
    [Fact(DisplayName = "OK a contagem não confere os limites: o projeto com 2.001 conexões é contado")]
    public async Task Scan_DoesNotCheckTheLimits()
    {
        //Arrange
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources(ManyConnections(2001))).Build();

        //Act
        var scan = await _fixtures.Scan(sourceId);

        //Assert
        Assert.Equal((2001, 2001), (scan.Value.Projects[0].Connections, scan.Value.Projects[0].Importable));
    }

    [Trait("DbeaverScan", "Handle")]
    [Fact(DisplayName = "OK a contagem de um caminho de pastas hostil termina, conta a conexão e não a dá como importável, e a prévia o recusa como além dos limites")]
    public async Task Scan_HostileFolderPath()
    {
        //Arrange
        var path = string.Join('/', Enumerable.Repeat("a", 100_000));
        var connection = "\"provider\":\"postgresql\",\"driver\":\"postgres-jdbc\",\"configuration\":{\"host\":\"h.exemplo.invalid\"}";
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources(
            "{\"folders\":{\"" + path + "\":{}},\"connections\":{\"fundo\":{\"name\":\"Fundo\",\"folder\":\"" + path + "\"," + connection + "},\"raiz\":{\"name\":\"Raiz\"," + connection + "}}}")).Build();

        //Act
        var scan = await _fixtures.Scan(sourceId);
        var preview = await _fixtures.Preview(sourceId);

        //Assert
        Assert.Equal((2, 1), (scan.Value.Projects[0].Connections, scan.Value.Projects[0].Importable));
        Assert.Equal("DBEAVER_LIMITS_EXCEEDED", preview.Error.Type);
    }

    [Trait("DbeaverScan", "Handle")]
    [Fact(DisplayName = "ERRO a cópia que não existe é 404 DBEAVER_SOURCE_MISSING, e sem nenhum projeto lido é 422 DBEAVER_SOURCE_INVALID")]
    public async Task Scan_Refusals()
    {
        //Arrange
        var onlyProtected = _fixtures.Builder().Project("Seguro", project => project.DataSources("x").Settings("""{"secureProject":true}""")).Project("Quebrado", project => project.DataSources("não é json")).Build();

        //Act
        var missing = await _fixtures.Scan(Guid.NewGuid());
        var invalid = await _fixtures.Scan(onlyProtected);

        //Assert
        Assert.Equal("DBEAVER_SOURCE_MISSING", missing.Error.Type);
        Assert.Equal("DBEAVER_SOURCE_INVALID", invalid.Error.Type);
        Assert.True(_fixtures.CopyExists(onlyProtected));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a prévia de todos os projetos: a árvore com as pastas dos projetos que não são o General, as dos projetos e as do DBeaver")]
    public async Task Preview_AllProjects_Tree()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = await _fixtures.Preview(sourceId);

        //Assert
        Assert.True(preview.IsSuccess);
        var folders = preview.Value.Folders;
        Assert.Equal("p2", folders.Single(folder => folder.Name == "Vendas").Key);
        Assert.Equal("p3", folders.Single(folder => folder.Name == "Legado").Key);
        Assert.Equal("p5", folders.Single(folder => folder.Name == "Senha").Key);
        Assert.DoesNotContain(folders, folder => folder.Name is "General" or "Seguro");

        // As do General ficam na raiz do lugar escolhido; as dos outros projetos, dentro da pasta do projeto.
        var general = folders.Where(folder => folder.Key.StartsWith('f')).Take(6).ToList();
        // Os do primeiro nível primeiro (a ordem da árvore: cada pasta depois da pasta dela), e os do segundo nível depois.
        Assert.Equal(["Antiga", DbeaverWorkspace.LongFolderName[..60], "Producao", "Vazia", "Antiga", "Informix"], general.Select(folder => folder.Name));
        Assert.All(general.Where(folder => folder.Name != "Informix" && !(folder.Name == "Antiga" && folder.ParentKey is not null)), folder => Assert.Null(folder.ParentKey));
        Assert.Equal("Producao", folders.Single(folder => folder.Key == folders.Single(candidate => candidate.Name == "Informix").ParentKey).Name);
        Assert.Equal("Producao", folders.Single(folder => folder.Key == folders.First(candidate => candidate.Name == "Antiga" && candidate.ParentKey is not null).ParentKey).Name);
        var sales = folders.Single(folder => folder.Name == "Relatorios");
        Assert.Equal("p2", sales.ParentKey);
        Assert.Equal(sales.Key, folders.Single(folder => folder.Name == "Extras").ParentKey);

        var cut = Assert.Single(folders, folder => folder.NameCut);
        Assert.Equal(60, cut.Name!.Length);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK as chaves de um projeto são as mesmas em Todos os projetos e com ele escolhido, para as marcas continuarem ao trocar o projeto")]
    public async Task Preview_KeysDoNotDependOnTheOtherProjects()
    {
        //Arrange
        const string sales = """{"folders":{"Relatorios":{}},"connections":{"v1":{"provider":"postgresql","driver":"postgres-jdbc","name":"Vendas 1","folder":"Relatorios","configuration":{"host":"h.exemplo.invalid"}},"v2":{"provider":"postgresql","driver":"postgres-jdbc","name":"Vendas 2","configuration":{"host":"h.exemplo.invalid"}}}}""";
        const string general = """{"folders":{"Producao":{}},"connections":{"g1":{"provider":"postgresql","driver":"postgres-jdbc","name":"Geral 1","folder":"Producao","configuration":{"host":"h.exemplo.invalid"}}}}""";
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources(general)).Project("Vendas", project => project.DataSources(sales)).Build();

        //Act
        var all = (await _fixtures.Preview(sourceId)).Value;
        var chosen = (await _fixtures.Preview(sourceId, project: "Vendas")).Value;

        //Assert
        string[] KeysOf(Prism.Application.DbeaverImports.Models.Dtos.DbeaverPreviewDto preview)
            => [.. preview.Folders.Where(folder => folder.Name is "Vendas" or "Relatorios").Select(folder => folder.Key), .. preview.Connections.Where(connection => connection.Name!.StartsWith("Vendas ", StringComparison.Ordinal)).Select(connection => connection.Key)];

        Assert.Equal(4, KeysOf(all).Length);
        Assert.Equal(KeysOf(all).Order(), KeysOf(chosen).Order());
        Assert.Equal(all.Connections.Count + all.Folders.Count, all.Connections.Select(connection => connection.Key).Concat(all.Folders.Select(folder => folder.Key)).Distinct().Count());
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a prévia: banco, servidor, ambiente, proteções, porta SQLI e o que ficou de fora de cada conexão")]
    public async Task Preview_Connections()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var pg = DbeaverImportFixtures.Connection(preview, "Pedidos PG");
        var db2 = DbeaverImportFixtures.Connection(preview, "Cadastro Db2");
        var informix = DbeaverImportFixtures.Connection(preview, "USER MIGRATION STOCK MANAGER");
        var restricted = DbeaverImportFixtures.Connection(preview, "Restrita");
        var inline = DbeaverImportFixtures.Connection(preview, "Com credenciais no arquivo");

        //Assert
        Assert.Equal((EDatabaseEngine.PostgreSql, "pg-dev.exemplo.invalid", 5432, "pedidos", "usuario-pg", true), (pg.Engine, pg.Host, pg.Port, pg.Database, pg.UserName, pg.HasPassword));
        Assert.Equal(("Desenvolvimento", null), (pg.Effective!.EnvironmentName, pg.Effective.EnvironmentColor));
        Assert.Empty(pg.LeftOut);
        Assert.Equal((EDatabaseEngine.Db2, 50000, "all", "Produção", "#FACFCF", "Production"), (db2.Engine, db2.Port, db2.Effective!.ConfirmCommands, db2.Effective.EnvironmentName, db2.Effective.EnvironmentColor, db2.DbeaverType));
        Assert.Equal((EDatabaseEngine.Informix, 55080, 55080, "far_ewm_001_dev_tcp", (int?)null), (informix.Engine, informix.Port, informix.DbeaverPort, informix.Server, informix.DrdaPort));
        Assert.Equal(["informixServer", "sshTunnel", "confirmDataChange"], informix.LeftOut);
        Assert.Equal(("QA Homologação", "#6496C8"), (informix.Effective!.EnvironmentName, informix.Effective.EnvironmentColor));
        Assert.Equal((true, "Restrito"), (restricted.Effective!.ReadOnly, restricted.Effective.EnvironmentName));
        Assert.Equal(["permissions"], restricted.LeftOut);
        Assert.Equal(("usuario-inline", true, true), (inline.UserName, inline.HasPassword, inline.Effective!.ReadOnly));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a prévia: os que o Prism não importa vêm com o motivo, e a URL que não casa só com o começo")]
    public async Task Preview_NotImportable()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;

        //Assert
        Assert.Equal("O Prism ainda não tem este banco (MySQL).", DbeaverImportFixtures.Connection(preview, "Legado MySQL").Invalid);
        Assert.Equal("A conexão usa variáveis do DBeaver (${…}), que o Prism não tem.", DbeaverImportFixtures.Connection(preview, "Com variável").Invalid);
        Assert.Equal("Não foi possível ler a URL JDBC desta conexão (jdbc:informix-sqli:…).", DbeaverImportFixtures.Connection(preview, "URL que não casa").Invalid);
        Assert.Equal(DbeaverProjects.DuplicatedIDMessage, preview.Connections.Single(connection => connection.Name == "No backup esquecido").Invalid);
        Assert.DoesNotContain(preview.Connections, connection => connection.Name == "De fonte externa");
        Assert.All(preview.Connections.Where(connection => connection.Invalid is not null), connection => Assert.Empty(connection.LeftOut));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a prévia nunca leva uma senha, nem a marca do teste, nem o que vinha depois do corte da URL")]
    public async Task Preview_NeverCarriesAPassword()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var json = JsonSerializer.Serialize(preview, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        //Assert
        Assert.DoesNotContain(DbeaverWorkspace.Mark, json);
        Assert.DoesNotContain("senha-", json);
        Assert.DoesNotContain("\"password\"", json);
        Assert.Equal(nameof(DbeaverPreviewDto), preview.ToString());
        Assert.Equal(nameof(DbeaverPreviewConnectionDto), preview.Connections[0].ToString());
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK os avisos: o projeto protegido, as senhas protegidas e as contagens sem Salvar senha e com Salvar senha sem a senha")]
    public async Task Preview_Notes()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var notes = (await _fixtures.Preview(sourceId)).Value.Notes;

        //Assert
        Assert.Equal(["Seguro"], notes.ProtectedProjects);
        Assert.Equal(["Senha"], notes.CredentialsProtected);
        Assert.Empty(notes.CredentialsUnreadable);
        Assert.Empty(notes.UnreadableFiles);
        Assert.Equal(3, notes.WithoutSavedPassword);
        Assert.Equal(3, notes.SavedPasswordMissing);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK um projeto só: a pasta dele, o aviso do protegido não aparece e o arquivo ilegível é dito")]
    public async Task Preview_OneProject()
    {
        //Arrange
        var sourceId = _fixtures.Builder()
            .Project("General", project => project.DataSources("""{"connections":{"a":{"provider":"postgresql","driver":"postgres-jdbc","name":"A","configuration":{"host":"h.exemplo.invalid"}}}}"""))
            .Project("Vendas", project => project.DataSources("""{"connections":{"b":{"provider":"postgresql","driver":"postgres-jdbc","name":"B","configuration":{"host":"h.exemplo.invalid"}}}}""").DataSources("quebrado", "-2"))
            .Project("Quebrado", project => project.DataSources("quebrado"))
            .Project("Seguro", project => project.DataSources("x").Settings("""{"secureProject":true}""")).Build();

        //Act
        var all = (await _fixtures.Preview(sourceId)).Value;
        var one = (await _fixtures.Preview(sourceId, project: "Vendas")).Value;

        //Assert
        Assert.Equal(["Vendas"], one.Folders.Select(folder => folder.Name));
        Assert.Equal(["B"], one.Connections.Select(connection => connection.Name));
        Assert.Empty(one.Notes.ProtectedProjects);
        Assert.Equal(["Vendas"], one.Notes.UnreadableFiles);
        Assert.Empty(one.Notes.UnreadableProjects);
        Assert.Equal(["Seguro"], all.Notes.ProtectedProjects);
        Assert.Equal(["Vendas", "Quebrado"], all.Notes.UnreadableFiles);
        Assert.Equal(["Quebrado"], all.Notes.UnreadableProjects);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Theory(DisplayName = "ERRO o projeto que não está na cópia, o protegido e o de nome que não serve são 404 DBEAVER_PROJECT_NOT_FOUND")]
    [InlineData("Inexistente")]
    [InlineData("Seguro")]
    [InlineData("vendas")]
    [InlineData("")]
    public async Task Preview_ProjectNotFound(string project)
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = await _fixtures.Preview(sourceId, project);

        //Assert
        Assert.Equal("DBEAVER_PROJECT_NOT_FOUND", preview.Error.Type);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "ERRO o lugar que não existe é 404 FOLDER_NOT_FOUND, e o cofre fechado é 401 VAULT_LOCKED")]
    public async Task Preview_TargetAndVault()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        _fixtures.Vault.Setup(v => v.Read()).Returns(CSharpFunctionalExtensions.Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var locked = await _fixtures.Preview(sourceId);
        _fixtures.Vault.Setup(v => v.Read()).Returns(CSharpFunctionalExtensions.Result.Success<VaultDocument, EVaultError>(_fixtures.Document));
        var target = await _fixtures.Preview(sourceId, target: Guid.NewGuid());

        //Assert
        Assert.Equal("VAULT_LOCKED", locked.Error.Type);
        Assert.Equal("FOLDER_NOT_FOUND", target.Error.Type);
        Assert.True(_fixtures.CopyExists(sourceId));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a prévia não apaga a cópia: cada pedido lê de novo e dá o mesmo")]
    public async Task Preview_KeepsTheCopy_AndIsStable()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var first = (await _fixtures.Preview(sourceId)).Value;
        var second = (await _fixtures.Preview(sourceId)).Value;

        //Assert
        Assert.True(_fixtures.CopyExists(sourceId));
        Assert.Equal(first.Connections.Select(connection => (connection.Key, connection.Name)), second.Connections.Select(connection => (connection.Key, connection.Name)));
        Assert.Equal(first.Folders.Select(folder => folder.Key), second.Folders.Select(folder => folder.Key));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK \"Levar as senhas\" desligado: as conexões vêm só com o usuário")]
    public async Task Preview_WithoutPasswords()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = (await _fixtures.Preview(sourceId, withPasswords: false)).Value;

        //Assert
        Assert.All(preview.Connections, connection => Assert.False(connection.HasPassword));
        Assert.Equal("usuario-pg", DbeaverImportFixtures.Connection(preview, "Pedidos PG").UserName);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a porta DRDA preenchida vira a porta das conexões Informix daquele servidor, e a marca some")]
    public async Task Preview_DrdaPorts()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        DbeaverDrdaPortDto[] drda = [new() { Host = "central.exemplo.invalid", Port = 55080, Server = "far_ewm_001_dev_tcp", DrdaPort = 9089 }, new() { Host = "outro.exemplo.invalid", Port = 1, Server = null, DrdaPort = 9090 }];

        //Act
        var preview = (await _fixtures.Preview(sourceId, drdaPorts: drda)).Value;
        var informix = DbeaverImportFixtures.Connection(preview, "USER MIGRATION STOCK MANAGER");
        var other = DbeaverImportFixtures.Connection(preview, "Estoque por URL");

        //Assert
        Assert.Equal((9089, 55080, 9089), (informix.Port, informix.DbeaverPort, informix.DrdaPort));
        Assert.Equal((55081, 55081, (int?)null, "ifx_url_tcp"), (other.Port, other.DbeaverPort, other.DrdaPort, other.Server));
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a pasta de mesmo nome que já existe é juntada, e a conexão de nome tomado no lugar é um conflito de nome")]
    public async Task Preview_ConflictsAndMergedFolders()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var producao = new VaultFolderRecord(Guid.CreateVersion7(), null, "producao", Now(), Now());
        var handMade = new VaultConnectionRecord(Guid.CreateVersion7(), producao.ID, "Pedidos PG", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "p", null, null, Now(), Now());
        _fixtures.Document = _fixtures.Document with { Folders = [producao], Connections = [handMade] };

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var pg = DbeaverImportFixtures.Connection(preview, "Pedidos PG");

        //Assert
        Assert.True(preview.Folders.Single(folder => folder.Name == "Producao").Existing);
        Assert.Equal((true, "Pedidos PG (cópia)"), (pg.Conflict, pg.CopyName));
        Assert.Null(pg.Existing);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK a conexão cuja origem já está no cofre \"já existe\": sem conflito de nome, com onde está, se está conectada e o que sobrescrever mudaria")]
    public async Task Preview_ExistingConnection()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var stock = new VaultFolderRecord(Guid.CreateVersion7(), null, "Estoque", Now(), Now());
        var production = new VaultFolderRecord(Guid.CreateVersion7(), stock.ID, "Production PRD", Now(), Now());
        var existing = new VaultConnectionRecord(Guid.CreateVersion7(), production.ID, "DATA FIX", EDatabaseEngine.PostgreSql, "velho.exemplo.invalid", 5432, "pedidos", "usuario-antigo", "senha-do-prism", "Teste", "#D6FACF", Now(), Now(),
            Origin: new VaultConnectionOrigin("dbeaver", "general", DbeaverWorkspace.PgFields));
        _fixtures.Document = _fixtures.Document with { Folders = [stock, production], Connections = [existing] };
        _fixtures.Sessions.Setup(sessions => sessions.HasSession(existing.ID, 1)).Returns(true);

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var pg = DbeaverImportFixtures.Connection(preview, "Pedidos PG");

        //Assert
        Assert.Equal(new DbeaverExistingDto { ConnectionID = existing.ID, Name = "DATA FIX", Path = "Estoque / Production PRD", Connected = true, Host = "velho.exemplo.invalid", Port = 5432, Database = "pedidos", UserName = "usuario-antigo", EnvironmentName = "Teste" }, pg.Existing);
        Assert.False(pg.Conflict);
        Assert.Null(pg.CopyName);
        Assert.Equal(new DbeaverOverwriteDto { Name = true, Engine = false, Host = true, Port = false, Database = false, UserName = true, Password = true, Environment = true, KeepsName = false, DropsPassword = false }, pg.Overwrite);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK o que sobrescrever mudaria: o nome tomado fica, o usuário trocado sem senha nova deixa a conexão sem senha, e o Informix mantém a porta do Prism")]
    public async Task Preview_OverwriteFlags()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var folder = Guid.CreateVersion7();
        var informix = new VaultConnectionRecord(Guid.CreateVersion7(), folder, "Estoque antigo", EDatabaseEngine.Informix, "central.exemplo.invalid", 9089, "tramon", "usuario-ifx", "senha-do-prism", null, null, Now(), Now(),
            Origin: new VaultConnectionOrigin("dbeaver", "General", DbeaverWorkspace.InformixFields));
        var taker = new VaultConnectionRecord(Guid.CreateVersion7(), folder, "uSER migration STOCK manager", EDatabaseEngine.Informix, "x.exemplo.invalid", 1, "x", "u", "p", null, null, Now(), Now());
        var changedUser = new VaultConnectionRecord(Guid.CreateVersion7(), folder, "Sem salvar senha", EDatabaseEngine.PostgreSql, "pg-nosave.exemplo.invalid", 5432, "x", "outro-usuario", "senha-do-prism", null, null, Now(), Now(),
            Origin: new VaultConnectionOrigin("dbeaver", "General", DbeaverWorkspace.NoSavedPassword));
        _fixtures.Document = _fixtures.Document with { Folders = [new VaultFolderRecord(folder, null, "Pasta", Now(), Now())], Connections = [informix, taker, changedUser] };

        //Act
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var ifx = preview.Connections.Single(connection => connection.Key == preview.Connections.Single(c => c.Name == "USER MIGRATION STOCK MANAGER").Key);
        var noSave = DbeaverImportFixtures.Connection(preview, "Sem salvar senha");

        //Assert
        Assert.True(ifx.Overwrite!.KeepsName);
        Assert.False(ifx.Overwrite.Name);
        Assert.False(ifx.Overwrite.Port);
        Assert.True(ifx.Overwrite.Password);
        Assert.False(ifx.Overwrite.DropsPassword);
        Assert.True(noSave.Overwrite!.UserName);
        Assert.True(noSave.Overwrite.DropsPassword);
        Assert.False(noSave.Overwrite.Password);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK com a porta DRDA preenchida, o Informix que já existe muda a porta, e isso conta para a senha")]
    public async Task Preview_OverwriteFlags_WithDrda()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var informix = new VaultConnectionRecord(Guid.CreateVersion7(), null, "Estoque", EDatabaseEngine.Informix, "central.exemplo.invalid", 9089, "tramon", "usuario-ifx", "senha-do-prism", null, null, Now(), Now(),
            Origin: new VaultConnectionOrigin("dbeaver", "General", DbeaverWorkspace.InformixFields));
        _fixtures.Document = _fixtures.Document with { Connections = [informix] };
        DbeaverDrdaPortDto[] drda = [new() { Host = "central.exemplo.invalid", Port = 55080, Server = "far_ewm_001_dev_tcp", DrdaPort = 9090 }];

        //Act
        var preview = (await _fixtures.Preview(sourceId, withPasswords: false, drdaPorts: drda)).Value;
        var ifx = DbeaverImportFixtures.Connection(preview, "USER MIGRATION STOCK MANAGER");

        //Assert
        Assert.True(ifx.Overwrite!.Port);
        Assert.True(ifx.Overwrite.DropsPassword);
        Assert.Equal(9090, ifx.Port);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "ERRO acima de 2.000 conexões, de 2.000 pastas ou de 32 níveis é DBEAVER_LIMITS_EXCEEDED, e com vários projetos pede para escolher um")]
    public async Task Preview_Limits()
    {
        //Arrange
        var tooMany = _fixtures.Builder().Project("General", project => project.DataSources(ManyConnections(2001))).Build();
        var tooManyFolders = _fixtures.Builder().Project("General", project => project.DataSources(ManyFolders(2001))).Build();
        var tooDeep = _fixtures.Builder().Project("General", project => project.DataSources(DeepFolder(33))).Build();
        var tooDeepWithProjectFolder = _fixtures.Builder().Project("Vendas", project => project.DataSources(DeepFolder(32))).Build();
        var twoProjects = _fixtures.Builder().Project("General", project => project.DataSources(ManyConnections(2001))).Project("Vendas", project => project.DataSources("{}")).Build();

        //Act
        var connectionsError = await _fixtures.Preview(tooMany);
        var foldersError = await _fixtures.Preview(tooManyFolders);
        var depthError = await _fixtures.Preview(tooDeep);
        var depthWithProject = await _fixtures.Preview(tooDeepWithProjectFolder);
        var manyProjects = await _fixtures.Preview(twoProjects);
        var chosen = await _fixtures.Preview(twoProjects, project: "General");

        //Assert
        Assert.Equal(("DBEAVER_LIMITS_EXCEEDED", "O DBeaver tem mais do que o Prism importa de uma vez: até 2.000 conexões, 2.000 pastas e 32 níveis de pastas."), (connectionsError.Error.Type, connectionsError.Error.Detail));
        Assert.Equal("DBEAVER_LIMITS_EXCEEDED", foldersError.Error.Type);
        Assert.Equal("DBEAVER_LIMITS_EXCEEDED", depthError.Error.Type);
        Assert.Equal("DBEAVER_LIMITS_EXCEEDED", depthWithProject.Error.Type);
        Assert.EndsWith(" Escolha um projeto só.", manyProjects.Error.Detail);
        Assert.DoesNotContain("Escolha um projeto", chosen.Error.Detail);
    }

    [Trait("DbeaverPreview", "Handle")]
    [Fact(DisplayName = "OK 32 níveis exatos passam, contados do lugar escolhido")]
    public async Task Preview_ThirtyTwoLevels_Pass()
    {
        //Arrange
        var sourceId = _fixtures.Builder().Project("General", project => project.DataSources(DeepFolder(32))).Build();

        //Act
        var preview = await _fixtures.Preview(sourceId);

        //Assert
        Assert.True(preview.IsSuccess);
        Assert.Equal(32, preview.Value.Folders.Count);
    }

    /// <summary>Um `data-sources.json` com <paramref name="count"/> conexões PostgreSQL.</summary>
    private static string ManyConnections(int count)
        => "{\"connections\":{" + string.Join(',', Enumerable.Range(0, count).Select(index => "\"c" + index + "\":{\"provider\":\"postgresql\",\"driver\":\"postgres-jdbc\",\"name\":\"Conexão " + index + "\",\"configuration\":{\"host\":\"h" + index + ".exemplo.invalid\"}}")) + "}}";

    private static string ManyFolders(int count)
        => "{\"folders\":{" + string.Join(',', Enumerable.Range(0, count).Select(index => "\"pasta " + index + "\":{}")) + "}}";

    /// <summary>Uma pasta de <paramref name="levels"/> níveis (`n1/n2/…`).</summary>
    private static string DeepFolder(int levels)
        => "{\"folders\":{\"" + string.Join('/', Enumerable.Range(1, levels).Select(level => "n" + level)) + "\":{}}}";

    private static DateTime Now()
        => DbeaverImportFixtures.Now.AddDays(-30);
}
