using CSharpFunctionalExtensions;
using Prism.Application.DbeaverImports.Features.ImportFromDbeaver;
using Prism.Application.DbeaverImports.Features.PreviewDbeaverImport;
using Prism.Application.DbeaverImports.Features.ScanDbeaver;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Dbeaver;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// RN-DBEAVER-016 a 018: a importação do DBeaver e a reimportação que sobrescreve, contra um cofre que roda a função da gravação sobre o documento mais recente. Os dados
/// são os do DBeaver SINTÉTICO.
/// </summary>
public sealed class DbeaverImportTests : IDisposable
{
    private readonly DbeaverImportFixtures _fixtures = new();

    public void Dispose()
        => _fixtures.Dispose();

    private static VaultConnectionRecord ByName(VaultDocument document, string name)
        => document.Connections.Single(connection => connection.Name == name);

    private async Task<(Guid SourceId, DbeaverPreviewDto Preview)> ImportEverythingAsync(IReadOnlyList<DbeaverDrdaPortDto?>? drda = null)
    {
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, drdaPorts: drda)).Value;
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), drdaPorts: drda);
        Assert.True(imported.IsSuccess, imported.IsFailure ? imported.Error.Type : null);

        return (sourceId, preview);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK importa tudo o que a prévia marcou: as pastas, as conexões com as senhas, o ambiente e as proteções, numa gravação só, e apaga a cópia")]
    public async Task Import_Everything()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId)).Value;

        //Act
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview));

        //Assert
        Assert.True(imported.IsSuccess);
        Assert.Equal(1, _fixtures.Saves);
        var document = _fixtures.Document;
        Assert.Equal(imported.Value.ConnectionIDs.Order(), document.Connections.Select(connection => connection.ID).Order());
        Assert.Equal(imported.Value.FolderIDs.Order(), document.Folders.Select(folder => folder.ID).Order());
        Assert.Empty(imported.Value.UpdatedIDs);
        Assert.Equal(DbeaverImportFixtures.Importable(preview).Count(key => key!.StartsWith('c')), document.Connections.Count);

        var pg = ByName(document, "Pedidos PG");
        Assert.Equal(("pg-dev.exemplo.invalid", 5432, "pedidos", "usuario-pg", DbeaverWorkspace.PgPassword, "Desenvolvimento"), (pg.Host, pg.Port, pg.Database, pg.UserName, pg.Password, pg.EnvironmentName));
        var db2 = ByName(document, "Cadastro Db2");
        Assert.Equal((EDatabaseEngine.Db2, "all", "Produção", "#FACFCF"), (db2.Engine, db2.ConfirmCommands, db2.EnvironmentName, db2.EnvironmentColor));
        Assert.Equal((true, "Restrito"), (ByName(document, "Restrita").ReadOnly, ByName(document, "Restrita").EnvironmentName));
        Assert.Equal(true, ByName(document, "Com credenciais no arquivo").ReadOnly);
        Assert.Equal(("usuario-inline", DbeaverWorkspace.InlinePassword), (ByName(document, "Com credenciais no arquivo").UserName, ByName(document, "Com credenciais no arquivo").Password));
        Assert.Equal(("usuario-pgpass", string.Empty), (ByName(document, "Com pgpass").UserName, ByName(document, "Com pgpass").Password));
        Assert.Equal(("usuario-nosave", string.Empty), (ByName(document, "Sem salvar senha").UserName, ByName(document, "Sem salvar senha").Password));
        Assert.DoesNotContain(document.Connections, connection => connection.Name is "Legado MySQL" or "Com variável" or "URL que não casa" or "No backup esquecido");

        // A pasta de cada projeto que não é o General, e a conexão do General na raiz.
        var vendas = document.Folders.Single(folder => folder.Name == "Vendas");
        Assert.Null(vendas.ParentID);
        Assert.Equal(vendas.ID, document.Folders.Single(folder => folder.Name == "Relatorios").ParentID);
        Assert.Equal(document.Folders.Single(folder => folder.Name == "Relatorios").ID, ByName(document, "Vendas Principal").FolderID);
        Assert.Equal(document.Folders.Single(folder => folder.Name == "Senha").ID, ByName(document, "Protegida PG").FolderID);
        Assert.Null(ByName(document, "Com credenciais no arquivo").FolderID);

        Assert.False(_fixtures.CopyExists(sourceId));
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK cada conexão criada guarda a origem (o projeto inteiro e o ID do DBeaver), o cofre guarda a data da importação e o convite feito")]
    public async Task Import_SavesTheOriginAndTheState()
    {
        //Arrange and Act
        await ImportEverythingAsync();

        //Assert
        var document = _fixtures.Document;
        Assert.All(document.Connections, connection => Assert.Equal("dbeaver", connection.Origin!.Source));
        Assert.Equal(new VaultConnectionOrigin("dbeaver", "General", DbeaverWorkspace.PgFields), ByName(document, "Pedidos PG").Origin);
        Assert.Equal(new VaultConnectionOrigin("dbeaver", "Vendas", DbeaverWorkspace.SalesSecond), ByName(document, "Vendas Extra").Origin);
        Assert.Equal(new VaultDbeaverRecord(DbeaverImportFixtures.Now, DbeaverImportFixtures.Now), document.Dbeaver);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK o convite já feito continua com a data dele, e a última importação é a nova")]
    public async Task Import_KeepsTheEarlierInvitation()
    {
        //Arrange
        var invited = DbeaverImportFixtures.Now.AddDays(-9);
        _fixtures.Document = _fixtures.Document with { Dbeaver = new VaultDbeaverRecord(invited, invited) };

        //Act
        await ImportEverythingAsync();

        //Assert
        Assert.Equal(new VaultDbeaverRecord(invited, DbeaverImportFixtures.Now), _fixtures.Document.Dbeaver);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK o Informix vem com a porta SQLI do DBeaver e o servidor não é gravado; com a porta DRDA do servidor preenchida, vem com ela")]
    public async Task Import_InformixPort()
    {
        //Arrange
        DbeaverDrdaPortDto[] drda = [new() { Host = "central.exemplo.invalid", Port = 55080, Server = "far_ewm_001_dev_tcp", DrdaPort = 9089 }];

        //Act
        await ImportEverythingAsync(drda);

        //Assert
        var document = _fixtures.Document;
        Assert.Equal((9089, "central.exemplo.invalid", "tramon"), (ByName(document, "USER MIGRATION STOCK MANAGER").Port, ByName(document, "USER MIGRATION STOCK MANAGER").Host, ByName(document, "USER MIGRATION STOCK MANAGER").Database));
        Assert.Equal(55081, ByName(document, "Estoque por URL").Port);
        Assert.DoesNotContain("far_ewm", JsonSerializer.Serialize(document));
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK sem a porta DRDA o Informix vem com a porta do DBeaver, como está")]
    public async Task Import_InformixPort_WithoutDrda()
    {
        //Arrange and Act
        await ImportEverythingAsync();

        //Assert
        Assert.Equal(55080, ByName(_fixtures.Document, "USER MIGRATION STOCK MANAGER").Port);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK \"Levar as senhas\" desligado grava só o usuário")]
    public async Task Import_WithoutPasswords()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, withPasswords: false)).Value;

        //Act
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), withPasswords: false);

        //Assert
        Assert.True(imported.IsSuccess);
        Assert.All(_fixtures.Document.Connections, connection => Assert.Equal(string.Empty, connection.Password));
        Assert.Equal("usuario-pg", ByName(_fixtures.Document, "Pedidos PG").UserName);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK um projeto só, no lugar escolhido, com o nome tomado indo com outro nome ou ficando de fora")]
    public async Task Import_OneProject_InAFolder_WithConflicts()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var target = new VaultFolderRecord(Guid.CreateVersion7(), null, "Destino", DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        var legado = new VaultFolderRecord(Guid.CreateVersion7(), target.ID, "legado", DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        var taken = new VaultConnectionRecord(Guid.CreateVersion7(), legado.ID, "Legado PG", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "p", null, null, DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        _fixtures.Document = _fixtures.Document with { Folders = [target, legado], Connections = [taken] };
        var preview = (await _fixtures.Preview(sourceId, project: "Legado", target: target.ID)).Value;

        //Act
        var renamed = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), project: "Legado", target: target.ID);

        //Assert
        Assert.True(renamed.IsSuccess);
        Assert.Equal(1, renamed.Value.Renamed);
        // A pasta do projeto entra na que já existe no lugar (sem diferenciar maiúsculas), e a conexão de nome tomado vai com outro nome.
        Assert.Equal(1, renamed.Value.MergedFolders);
        Assert.Equal(legado.ID, ByName(_fixtures.Document, "Legado PG (cópia)").FolderID);
        Assert.Equal(2, _fixtures.Document.Folders.Count);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK \"Não importar\" deixa de fora a conexão de nome tomado e conta")]
    public async Task Import_Skip()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var taken = new VaultConnectionRecord(Guid.CreateVersion7(), null, "Com credenciais no arquivo", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "p", null, null, DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        _fixtures.Document = _fixtures.Document with { Connections = [taken] };
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;

        //Act
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), project: "General", onConflict: "skip");

        //Assert
        Assert.Equal(1, imported.Value.Skipped);
        Assert.Single(_fixtures.Document.Connections, connection => connection.Name == "Com credenciais no arquivo");
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "OK a pasta marcada e a conexão de uma pasta que não está marcada: as pastas do caminho vão sozinhas")]
    public async Task Import_PathFoldersGoAlone()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var informix = DbeaverImportFixtures.Connection(preview, "USER MIGRATION STOCK MANAGER");

        //Act
        var imported = await _fixtures.Import(sourceId, [informix.Key], project: "General");

        //Assert
        Assert.Equal(2, imported.Value.FolderIDs.Count);
        Assert.Equal(["Producao", "Informix"], _fixtures.Document.Folders.Select(folder => folder.Name));
        Assert.Single(_fixtures.Document.Connections);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK reimportar: \"Sobrescrever todas\" atualiza as conexões que já existem, mantém o ID, a pasta, a verificação e a origem, e conta as atualizadas")]
    public async Task Reimport_OverwritesAll_KeepingTheIdAndTheFolder()
    {
        //Arrange
        await ImportEverythingAsync();
        var before = ByName(_fixtures.Document, "Pedidos PG");
        var moved = Guid.CreateVersion7();
        _fixtures.Document = _fixtures.Document with
        {
            Folders = [.. _fixtures.Document.Folders, new VaultFolderRecord(moved, null, "Movida", DbeaverImportFixtures.Now, DbeaverImportFixtures.Now)],
            Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == before.ID ? connection with { FolderID = moved, Host = "velho.exemplo.invalid", UserName = "usuario-antigo", Password = "senha-antiga", Name = "Meu nome", VerificationEnabled = false, VerificationInterval = 60, EnvironmentName = "Outro" } : connection)]
        };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId)).Value;
        var existing = preview.Connections.Where(connection => connection.Existing is not null).Select(connection => connection.Key).ToList();

        //Act
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), overwrite: existing);

        //Assert
        Assert.True(imported.IsSuccess);
        Assert.Empty(imported.Value.ConnectionIDs);
        Assert.Equal(existing.Count, imported.Value.UpdatedIDs.Count);
        var after = _fixtures.Document.Connections.Single(connection => connection.ID == before.ID);
        Assert.Equal(("Pedidos PG", "pg-dev.exemplo.invalid", "usuario-pg", DbeaverWorkspace.PgPassword, "Desenvolvimento"), (after.Name, after.Host, after.UserName, after.Password, after.EnvironmentName));
        Assert.Equal((moved, false, 60, before.CreatedAt, before.Origin), (after.FolderID, after.VerificationEnabled, after.VerificationInterval, after.CreatedAt, after.Origin));
        Assert.Equal(DbeaverImportFixtures.Now, after.UpdatedAt);
        Assert.Equal(_fixtures.Document.Connections.Count, _fixtures.Document.Connections.Select(connection => connection.ID).Distinct().Count());
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK a conexão que já existe e não está em overwrite não é importada nem tocada, e nada criado nem atualizado não regrava o cofre")]
    public async Task Reimport_NotOverwritten_IsUntouched()
    {
        //Arrange
        await ImportEverythingAsync();
        var snapshot = _fixtures.Document;
        var saves = _fixtures.Saves;
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var existing = preview.Connections.Where(connection => connection.Existing is not null).Select(connection => (string?)connection.Key).ToList();

        //Act
        var imported = await _fixtures.Import(sourceId, existing, project: "General", overwrite: []);

        //Assert
        Assert.True(imported.IsSuccess);
        Assert.Empty(imported.Value.ConnectionIDs);
        Assert.Empty(imported.Value.UpdatedIDs);
        Assert.Same(snapshot, _fixtures.Document);
        Assert.True(_fixtures.LastSaveKeptTheDocument);
        Assert.Equal(saves + 1, _fixtures.Saves);
        Assert.False(_fixtures.CopyExists(sourceId));
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK a reimportação cria só as novas: as marcadas que já existem não duplicam nem viram \"(cópia)\"")]
    public async Task Reimport_CreatesOnlyTheNewOnes()
    {
        //Arrange
        await ImportEverythingAsync();
        var count = _fixtures.Document.Connections.Count;
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Where(connection => connection.Name != "Cadastro Db2")] };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId)).Value;

        //Act
        var imported = await _fixtures.Import(sourceId, DbeaverImportFixtures.Importable(preview), overwrite: []);

        //Assert
        Assert.Single(imported.Value.ConnectionIDs);
        Assert.Equal(0, imported.Value.Renamed);
        Assert.Equal(count, _fixtures.Document.Connections.Count);
        Assert.DoesNotContain(_fixtures.Document.Connections, connection => connection.Name.Contains("(cópia"));
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK no Informix a porta do Prism fica; com a porta DRDA preenchida, a nova vale")]
    public async Task Reimport_InformixPort()
    {
        //Arrange
        await ImportEverythingAsync();
        var informix = ByName(_fixtures.Document, "USER MIGRATION STOCK MANAGER");
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == informix.ID ? connection with { Port = 9089 } : connection)] };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var key = DbeaverImportFixtures.Connection(preview, "USER MIGRATION STOCK MANAGER").Key;
        DbeaverDrdaPortDto[] drda = [new() { Host = "central.exemplo.invalid", Port = 55080, Server = "far_ewm_001_dev_tcp", DrdaPort = 9091 }];

        //Act
        await _fixtures.Import(sourceId, [key], project: "General", overwrite: [key]);
        var kept = ByName(_fixtures.Document, "USER MIGRATION STOCK MANAGER").Port;
        var (second, _) = _fixtures.Workspace();
        var secondPreview = (await _fixtures.Preview(second, project: "General", drdaPorts: drda)).Value;
        var secondKey = DbeaverImportFixtures.Connection(secondPreview, "USER MIGRATION STOCK MANAGER").Key;
        await _fixtures.Import(second, [secondKey], project: "General", overwrite: [secondKey], drdaPorts: drda);

        //Assert
        Assert.Equal(9089, kept);
        Assert.Equal(9091, ByName(_fixtures.Document, "USER MIGRATION STOCK MANAGER").Port);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK o usuário trocado sem senha nova deixa a conexão sem senha, e o host trocado também (RN-CONN-004)")]
    public async Task Reimport_ChangedUserWithoutPassword_DropsThePassword()
    {
        //Arrange
        await ImportEverythingAsync();
        var target = ByName(_fixtures.Document, "Sem salvar senha");
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == target.ID ? connection with { UserName = "outro-usuario", Password = "senha-do-prism" } : connection)] };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var key = DbeaverImportFixtures.Connection(preview, "Sem salvar senha").Key;

        //Act
        await _fixtures.Import(sourceId, [key], project: "General", overwrite: [key]);

        //Assert
        var after = _fixtures.Document.Connections.Single(connection => connection.ID == target.ID);
        Assert.Equal(("usuario-nosave", string.Empty), (after.UserName, after.Password));
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK a senha do Prism continua quando o servidor e o usuário não mudam e o DBeaver não traz senha")]
    public async Task Reimport_SameServerAndUser_KeepsThePrismPassword()
    {
        //Arrange
        await ImportEverythingAsync();
        var target = ByName(_fixtures.Document, "Sem salvar senha");
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == target.ID ? connection with { Password = "senha-do-prism" } : connection)] };
        var (sourceId, _) = _fixtures.Workspace();
        var key = DbeaverImportFixtures.Connection((await _fixtures.Preview(sourceId, project: "General")).Value, "Sem salvar senha").Key;

        //Act
        await _fixtures.Import(sourceId, [key], project: "General", overwrite: [key]);

        //Assert
        Assert.Equal("senha-do-prism", _fixtures.Document.Connections.Single(connection => connection.ID == target.ID).Password);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK as proteções nunca ficam mais fracas: o somente leitura e a confirmação do Prism ficam, e as do DBeaver entram")]
    public async Task Reimport_ProtectionsNeverWeaker()
    {
        //Arrange
        await ImportEverythingAsync();
        var pg = ByName(_fixtures.Document, "Pedidos PG");
        var db2 = ByName(_fixtures.Document, "Cadastro Db2");
        _fixtures.Document = _fixtures.Document with
        {
            Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == pg.ID ? connection with { ReadOnly = true, ConfirmCommands = "irreversible" } : connection.ID == db2.ID ? connection with { ConfirmCommands = null } : connection)]
        };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var keys = new[] { DbeaverImportFixtures.Connection(preview, "Pedidos PG").Key, DbeaverImportFixtures.Connection(preview, "Cadastro Db2").Key };

        //Act
        await _fixtures.Import(sourceId, keys, project: "General", overwrite: keys);

        //Assert
        var afterPg = _fixtures.Document.Connections.Single(connection => connection.ID == pg.ID);
        Assert.Equal((true, "irreversible"), (afterPg.ReadOnly, afterPg.ConfirmCommands));
        Assert.Equal("all", _fixtures.Document.Connections.Single(connection => connection.ID == db2.ID).ConfirmCommands);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK o nome novo tomado por outra conexão da pasta não muda o nome")]
    public async Task Reimport_TakenNameIsKept()
    {
        //Arrange
        await ImportEverythingAsync();
        var target = ByName(_fixtures.Document, "Pedidos PG");
        var other = new VaultConnectionRecord(Guid.CreateVersion7(), target.FolderID, "pedidos pg", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "p", null, null, DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Select(connection => connection.ID == target.ID ? connection with { Name = "Meu nome" } : connection), other] };
        var (sourceId, _) = _fixtures.Workspace();
        var key = DbeaverImportFixtures.Connection((await _fixtures.Preview(sourceId, project: "General")).Value, "Pedidos PG").Key;

        //Act
        await _fixtures.Import(sourceId, [key], project: "General", overwrite: [key]);

        //Assert
        Assert.Equal("Meu nome", _fixtures.Document.Connections.Single(connection => connection.ID == target.ID).Name);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK a chave de overwrite de uma conexão que outra janela excluiu entra como conexão nova")]
    public async Task Reimport_DeletedMeanwhile_BecomesNew()
    {
        //Arrange
        await ImportEverythingAsync();
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var key = DbeaverImportFixtures.Connection(preview, "Cadastro Db2").Key;
        var existing = ByName(_fixtures.Document, "Cadastro Db2");
        _fixtures.Document = _fixtures.Document with { Connections = [.. _fixtures.Document.Connections.Where(connection => connection.ID != existing.ID)] };

        //Act
        var imported = await _fixtures.Import(sourceId, [key], project: "General", overwrite: [key]);

        //Assert
        Assert.Single(imported.Value.ConnectionIDs);
        Assert.Empty(imported.Value.UpdatedIDs);
        Assert.NotEqual(existing.ID, imported.Value.ConnectionIDs[0]);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK a conexão feita à mão com o mesmo nome (sem origem) é conflito de nome e nunca é sobrescrita")]
    public async Task Reimport_HandMadeConnection_IsNeverOverwritten()
    {
        //Arrange
        var handMade = new VaultConnectionRecord(Guid.CreateVersion7(), null, "Com credenciais no arquivo", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "senha-minha", null, null, DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        _fixtures.Document = _fixtures.Document with { Connections = [handMade] };
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var inline = DbeaverImportFixtures.Connection(preview, "Com credenciais no arquivo");

        //Act
        var imported = await _fixtures.Import(sourceId, [inline.Key], project: "General", overwrite: [inline.Key]);

        //Assert
        Assert.Null(inline.Existing);
        Assert.True(inline.Conflict);
        Assert.Empty(imported.Value.UpdatedIDs);
        Assert.Equal(("u", "senha-minha"), (_fixtures.Document.Connections.Single(connection => connection.ID == handMade.ID).UserName, _fixtures.Document.Connections.Single(connection => connection.ID == handMade.ID).Password));
        Assert.Equal(1, imported.Value.Renamed);
    }

    [Trait("DbeaverReimport", "Handle")]
    [Fact(DisplayName = "OK com mais de uma conexão de mesma origem vale a primeira na ordem da árvore")]
    public async Task Reimport_SeveralWithTheSameOrigin_TheFirstInTheTree()
    {
        //Arrange
        var origin = new VaultConnectionOrigin("dbeaver", "General", DbeaverWorkspace.PgFields);
        var folderA = new VaultFolderRecord(Guid.CreateVersion7(), null, "A", DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        var folderB = new VaultFolderRecord(Guid.CreateVersion7(), null, "B", DbeaverImportFixtures.Now, DbeaverImportFixtures.Now);
        var inB = new VaultConnectionRecord(Guid.CreateVersion7(), folderB.ID, "Zeta", EDatabaseEngine.PostgreSql, "x.exemplo.invalid", 5432, "x", "u", "p", null, null, DbeaverImportFixtures.Now, DbeaverImportFixtures.Now, Origin: origin);
        var inA = inB with { ID = Guid.CreateVersion7(), FolderID = folderA.ID, Name = "Alfa" };
        _fixtures.Document = _fixtures.Document with { Folders = [folderB, folderA], Connections = [inB, inA] };
        var (sourceId, _) = _fixtures.Workspace();

        //Act
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;

        //Assert
        Assert.Equal(inA.ID, DbeaverImportFixtures.Connection(preview, "Pedidos PG").Existing!.ConnectionID);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "ERRO a recusa da importação (o lugar que sumiu, a chave desconhecida, a de overwrite fora das marcadas) deixa a cópia e não grava")]
    public async Task Import_Refusals_KeepTheCopy()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var key = DbeaverImportFixtures.Connection(preview, "Pedidos PG").Key;

        //Act
        var missingTarget = await _fixtures.Import(sourceId, [key], project: "General", target: Guid.NewGuid());
        var unknownItem = await _fixtures.Import(sourceId, ["c999"], project: "General");
        var nullItem = await _fixtures.Import(sourceId, [null], project: "General");
        var unknownOverwrite = await _fixtures.Import(sourceId, [key], project: "General", overwrite: ["c999"]);
        var overwriteNotMarked = await _fixtures.Import(sourceId, [key], project: "General", overwrite: [DbeaverImportFixtures.Connection(preview, "Cadastro Db2").Key]);
        var folderInOverwrite = await _fixtures.Import(sourceId, [key, preview.Folders[0].Key], project: "General", overwrite: [preview.Folders[0].Key]);
        var noProject = await _fixtures.Import(sourceId, [key], project: "Inexistente");

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", missingTarget.Error.Type);
        Assert.Equal("IMPORT_INVALID", unknownItem.Error.Type);
        Assert.Equal("IMPORT_INVALID", nullItem.Error.Type);
        Assert.Equal("IMPORT_INVALID", unknownOverwrite.Error.Type);
        Assert.Equal("IMPORT_INVALID", overwriteNotMarked.Error.Type);
        Assert.Equal("IMPORT_INVALID", folderInOverwrite.Error.Type);
        Assert.Equal("DBEAVER_PROJECT_NOT_FOUND", noProject.Error.Type);
        Assert.True(_fixtures.CopyExists(sourceId));
        Assert.Empty(_fixtures.Document.Connections);
        Assert.True(_fixtures.LastSaveKeptTheDocument);
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "ERRO o cofre que mudou antes da gravação é 401 VAULT_LOCKED, não grava e apaga a cópia")]
    public async Task Import_VaultChanged_DeletesTheCopy()
    {
        //Arrange
        var (sourceId, _) = _fixtures.Workspace();
        var preview = (await _fixtures.Preview(sourceId, project: "General")).Value;
        var key = DbeaverImportFixtures.Connection(preview, "Pedidos PG").Key;
        var reads = 0;
        _fixtures.Vault.Setup(v => v.Generation).Returns(() => reads++ == 0 ? 1 : 2);

        //Act
        var imported = await _fixtures.Import(sourceId, [key], project: "General");

        //Assert
        Assert.Equal("VAULT_LOCKED", imported.Error.Type);
        Assert.Empty(_fixtures.Document.Connections);
        Assert.False(_fixtures.CopyExists(sourceId));
    }

    [Trait("DbeaverImport", "Handle")]
    [Fact(DisplayName = "ERRO a cópia que não existe mais é 404 DBEAVER_SOURCE_MISSING")]
    public async Task Import_MissingCopy()
    {
        //Act
        var imported = await _fixtures.Import(Guid.NewGuid(), ["c1"]);

        //Assert
        Assert.Equal("DBEAVER_SOURCE_MISSING", imported.Error.Type);
    }

    [Trait("DbeaverImport", "Validators")]
    [Fact(DisplayName = "ERRO o sourceId fora do formato, \"Levar as senhas\" que não é booleano, as portas DRDA mal formadas e as chaves repetidas ou demais são IMPORT_INVALID; sem chave, IMPORT_EMPTY")]
    public void Validators_Refuse()
    {
        //Arrange
        var import = new ImportFromDbeaverValidator();
        var preview = new PreviewDbeaverImportValidator();
        var scan = new ScanDbeaverValidator();
        var valid = new ImportFromDbeaverCommand { SourceId = Guid.NewGuid().ToString("D"), Items = ["c1"] };
        static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();
        DbeaverDrdaPortDto Port(string host = "h.exemplo.invalid", int port = 1, string? server = null, int drda = 9089) => new() { Host = host, Port = port, Server = server, DrdaPort = drda };

        //Act and Assert
        Assert.True(import.Validate(valid).IsValid);
        Assert.True(import.Validate(valid with { WithPasswords = Json("true"), DrdaPorts = [Port(), Port(port: 2)], OnConflict = "skip", Overwrite = ["c1"] }).IsValid);
        Assert.True(import.Validate(valid with { WithPasswords = Json("null") }).IsValid);
        Assert.Equal("IMPORT_EMPTY", import.Validate(valid with { Items = [] }).Errors[0].ErrorCode);
        Assert.Equal("IMPORT_EMPTY", import.Validate(valid with { Items = null }).Errors[0].ErrorCode);
        foreach (var bad in new[] { "", "ABC", Guid.NewGuid().ToString("D").ToUpperInvariant(), Guid.NewGuid().ToString("N"), $"../{Guid.NewGuid():D}", $"{Guid.NewGuid():D}\n" })
        {
            Assert.Equal("SourceId", import.Validate(valid with { SourceId = bad }).Errors.Single().PropertyName);
            Assert.False(preview.Validate(new PreviewDbeaverImportCommand { SourceId = bad }).IsValid);
            Assert.False(scan.Validate(new ScanDbeaverCommand { SourceId = bad }).IsValid);
        }

        Assert.False(scan.Validate(new ScanDbeaverCommand { SourceId = null }).IsValid);
        Assert.Equal("WithPasswords", import.Validate(valid with { WithPasswords = Json("\"sim\"") }).Errors.Single().PropertyName);
        Assert.False(preview.Validate(new PreviewDbeaverImportCommand { SourceId = valid.SourceId, WithPasswords = Json("1") }).IsValid);
        Assert.Equal("DrdaPorts", import.Validate(valid with { DrdaPorts = [Port(drda: 0)] }).Errors.Single().PropertyName);
        Assert.False(import.Validate(valid with { DrdaPorts = [Port(drda: 65536)] }).IsValid);
        Assert.False(import.Validate(valid with { DrdaPorts = [Port(port: 0)] }).IsValid);
        Assert.False(import.Validate(valid with { DrdaPorts = [Port(host: " ")] }).IsValid);
        Assert.False(import.Validate(valid with { DrdaPorts = [Port(), Port(drda: 9090)] }).IsValid);
        Assert.False(import.Validate(valid with { DrdaPorts = [Port(server: "x"), Port(server: " x ")] }).IsValid);
        Assert.False(import.Validate(valid with { DrdaPorts = [null] }).IsValid);
        Assert.False(preview.Validate(new PreviewDbeaverImportCommand { SourceId = valid.SourceId, DrdaPorts = [.. Enumerable.Range(0, 2001).Select(index => Port(host: $"h{index}.exemplo.invalid"))] }).IsValid);
        Assert.Equal("IMPORT_INVALID", import.Validate(valid with { Items = ["c1", "c1"] }).Errors[0].ErrorCode);
        Assert.Equal("IMPORT_INVALID", import.Validate(valid with { Items = [.. Enumerable.Range(0, 4001).Select(index => (string?)$"c{index}")] }).Errors[0].ErrorCode);
        Assert.Equal("IMPORT_INVALID", import.Validate(valid with { OnConflict = "overwrite" }).Errors[0].ErrorCode);
        Assert.Equal("Overwrite", import.Validate(valid with { Overwrite = ["c1", "c1"] }).Errors.Single().PropertyName);
        Assert.False(import.Validate(valid with { Overwrite = [null] }).IsValid);
        Assert.False(import.Validate(valid with { Overwrite = [.. Enumerable.Range(0, 2001).Select(index => (string?)$"c{index}")] }).IsValid);
    }

    [Trait("DbeaverImport", "ToString")]
    [Fact(DisplayName = "OK os comandos, as portas DRDA e os resultados escrevem só o nome do tipo no ToString (RN-LOG-001)")]
    public void ToString_WritesOnlyTheTypeName()
    {
        //Arrange
        var drda = new DbeaverDrdaPortDto { Host = "central.exemplo.invalid", Port = 1, Server = "servidor", DrdaPort = 2 };
        var text = string.Concat(drda, new ImportFromDbeaverCommand { SourceId = "segredo", Project = "projeto-secreto" }, new PreviewDbeaverImportCommand { Project = "projeto-secreto" }, new ScanDbeaverCommand { SourceId = "segredo" });

        //Assert
        Assert.DoesNotContain("central", text);
        Assert.DoesNotContain("segredo", text);
        Assert.DoesNotContain("projeto-secreto", text);
    }
}
