using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using System.Net;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-003, 005 e 006: o que vai no arquivo, a partir de um documento do cofre. As pastas do caminho de cada item vão sozinhas (marcadas ou não, cada
/// uma uma vez, cada uma antes do que está dentro dela), o que foi marcado e não existe mais é 404, os limites são os da importação (os níveis contados da
/// raiz do navegador), e de cada conexão vai o que a escolha diz e o que ela tem gravado. A senha do Prism só é pedida quando uma senha de banco vai.
/// </summary>
public sealed class ExportPlannerTests
{
    private static ExportChoice Choice(VaultConnectionRecord connection, ETransferCredentials credentials = ETransferCredentials.None)
        => new(connection.ID, credentials);

    private static (ExportPlan Plan, ExportBuild Build) PlanAndBuild(VaultDocument document, IReadOnlyList<Guid> folderIDs, IReadOnlyList<ExportChoice> choices)
    {
        var planned = ExportPlanner.Plan(document, folderIDs, choices);
        Assert.True(planned.IsSuccess, planned.IsFailure ? planned.Error.Type : null);

        return (planned.Value, ExportPlanner.Build(document, planned.Value));
    }

    /// <summary>A conexão marcada leva TODAS as pastas do caminho até a raiz, e a pasta marcada vazia vai com as dela; cada pasta vai uma vez, antes do que está dentro.</summary>
    [Trait("ExportPlanner", "Plan")]
    [Fact(DisplayName = "OK as pastas do caminho vão sozinhas, uma vez cada, na ordem da árvore")]
    public void Plan_ShouldBeOK_AncestorsGoAlong()
    {
        //Arrange
        var stock = Folder("Estoque");
        var production = Folder("Production PRD", stock.ID);
        var development = Folder("Desenvolvimento DEV", stock.ID);
        var empty = Folder("Vazia", development.ID);
        var other = Folder("Outro sistema");
        var dataFix = Connection("DATA FIX", production.ID);
        var nominal = Connection("NOMINAL", production.ID);
        var document = Document([other, empty, production, development, stock], [nominal, dataFix]);

        //Act
        var (plan, build) = PlanAndBuild(document, [empty.ID], [Choice(dataFix), Choice(nominal)]);

        //Assert
        Assert.Equal(["Estoque", "Desenvolvimento DEV", "Vazia", "Production PRD"], plan.Folders.Select(folder => folder.Name));
        Assert.Equal(["f1", "f2", "f3", "f4"], build.Content.Folders.Select(folder => folder.Key));
        Assert.Equal([null, "f1", "f2", "f1"], build.Content.Folders.Select(folder => folder.ParentKey));
        Assert.Equal(["DATA FIX", "NOMINAL"], build.Content.Connections.Select(connection => connection.Name));
        Assert.All(build.Content.Connections, connection => Assert.Equal("f4", connection.FolderKey));
        Assert.Equal(["c1", "c2"], build.Content.Connections.Select(connection => connection.Key));
        Assert.Equal(4, build.Folders);
        Assert.Equal(2, build.Connections);
        Assert.Equal([stock.ID, development.ID, empty.ID, production.ID], build.FolderIDs);
    }

    /// <summary>RN-TRANSF-008: o que foi marcado e não existe mais (outra janela o excluiu) é 404, e não é pulado em silêncio.</summary>
    [Trait("ExportPlanner", "Plan")]
    [Fact(DisplayName = "Erro pasta ou conexão marcada que não existe mais")]
    public void Plan_ShouldBeError_MarkedItemNoLongerExists()
    {
        //Arrange
        var folder = Folder("Estoque");
        var connection = Connection("DATA FIX", folder.ID);
        var document = Document([folder], [connection]);

        //Act
        var missingFolder = ExportPlanner.Plan(document, [folder.ID, Guid.CreateVersion7()], [Choice(connection)]);
        var missingConnection = ExportPlanner.Plan(document, [folder.ID], [Choice(connection), new ExportChoice(Guid.CreateVersion7(), ETransferCredentials.None)]);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", missingFolder.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, missingFolder.Error.StatusCode);
        Assert.Equal("CONNECTION_NOT_FOUND", missingConnection.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, missingConnection.Error.StatusCode);
    }

    /// <summary>
    /// RN-TRANSF-003 e RN-SCRIPT-007: a pasta de scripts é da seção Scripts, e não uma pasta de conexões: o ID dela marcado como pasta é 404, como o de uma
    /// pasta que não existe, mesmo com uma pasta de conexões de mesmo nome no cofre.
    /// </summary>
    [Trait("ExportPlanner", "Plan")]
    [Fact(DisplayName = "Erro pasta de scripts marcada como pasta de conexões")]
    public void Plan_ShouldBeError_ScriptFolderIsNotAConnectionFolder()
    {
        //Arrange
        var scriptFolder = ScriptFolder("Estoque");
        var document = Document([Folder("Estoque")]) with { ScriptFolders = [scriptFolder] };

        //Act
        var planned = ExportPlanner.Plan(document, [scriptFolder.ID], []);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", planned.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, planned.Error.StatusCode);
    }

    /// <summary>
    /// RN-TRANSF-006: os níveis contam da raiz do navegador, porque o caminho inteiro vai no arquivo: a conexão a 32 níveis sai, e a que está a 33 não sai
    /// nem sozinha (o cofre não limita a profundidade, RN-PASTA-001).
    /// </summary>
    [Trait("ExportPlanner", "Plan")]
    [Fact(DisplayName = "Erro mais de 32 níveis de pastas a partir da raiz")]
    public void Plan_ShouldBeError_DeeperThan32Levels()
    {
        //Arrange
        var chain = new List<VaultFolderRecord>();
        for (var level = 1; level <= 33; level++)
            chain.Add(Folder($"Nível {level}", chain.LastOrDefault()?.ID));
        var at32 = Connection("Na 32", chain[31].ID);
        var at33 = Connection("Na 33", chain[32].ID);
        var document = Document(chain, [at32, at33]);

        //Act
        var fits = ExportPlanner.Plan(document, [], [Choice(at32)]);
        var deep = ExportPlanner.Plan(document, [], [Choice(at33)]);
        var deepFolder = ExportPlanner.Plan(document, [chain[32].ID], []);

        //Assert
        Assert.True(fits.IsSuccess);
        Assert.Equal(32, fits.Value.Folders.Count);
        Assert.Equal("EXPORT_LIMITS_EXCEEDED", deep.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, deep.Error.StatusCode);
        Assert.Equal("EXPORT_LIMITS_EXCEEDED", deepFolder.Error.Type);
    }

    /// <summary>RN-TRANSF-006: as pastas do caminho contam nas 2.000.</summary>
    [Trait("ExportPlanner", "Plan")]
    [Fact(DisplayName = "Erro mais de 2.000 pastas no arquivo, contando as do caminho")]
    public void Plan_ShouldBeError_MoreThan2000Folders()
    {
        //Arrange
        var parent = Folder("Raiz");
        var children = Enumerable.Range(1, 2000).Select(index => Folder($"Pasta {index}", parent.ID)).ToList();
        var document = Document([parent, .. children]);

        //Act
        var exactly = ExportPlanner.Plan(document, [.. children.Take(1999).Select(folder => folder.ID)], []);
        var tooMany = ExportPlanner.Plan(document, [.. children.Select(folder => folder.ID)], []);

        //Assert
        Assert.True(exactly.IsSuccess);
        Assert.Equal(2000, exactly.Value.Folders.Count);
        Assert.Equal("EXPORT_LIMITS_EXCEEDED", tooMany.Error.Type);
    }

    /// <summary>
    /// RN-TRANSF-003: "Sem usuário e senha" não leva nenhum dos dois, "Só o usuário" leva o usuário, e "Usuário e senha" leva os dois; a escolha só leva o
    /// que a conexão tem gravado (sem senha, só o usuário; sem usuário, nada), e isso não é erro. A senha do Prism só é pedida quando uma senha de banco vai.
    /// </summary>
    [Trait("ExportPlanner", "Build")]
    [Theory(DisplayName = "OK cada conexão leva o que a escolha diz e o que ela tem gravado")]
    [InlineData("none", "datafix", "senha", null, null, false)]
    [InlineData(null, "datafix", "senha", null, null, false)]
    [InlineData("user", "datafix", "senha", "datafix", null, false)]
    [InlineData("userAndPassword", "datafix", "senha", "datafix", "senha", true)]
    [InlineData("userAndPassword", "datafix", "", "datafix", null, false)]
    [InlineData("userAndPassword", "", "", null, null, false)]
    [InlineData("user", "", "", null, null, false)]
    public void Build_ShouldBeOK_Credentials(string? credentials, string userName, string password, string? expectedUser, string? expectedPassword, bool needsUserPassword)
    {
        //Arrange
        var connection = Connection("DATA FIX", userName: userName, password: password);
        var document = Document(connections: [connection]);

        //Act
        var (plan, build) = PlanAndBuild(document, [], [Choice(connection, TransferRules.CredentialsOf(credentials))]);
        var exported = Assert.Single(build.Content.Connections);

        //Assert
        Assert.Equal(needsUserPassword, plan.NeedsUserPassword);
        Assert.Equal(expectedUser, exported.UserName);
        Assert.Equal(expectedPassword, exported.Password);
        Assert.Equal(expectedUser is null ? 0 : 1, build.WithUser);
        Assert.Equal(expectedPassword is null ? 0 : 1, build.WithPassword);
    }

    /// <summary>
    /// RN-TRANSF-006 e 007: da pasta, o nome, a cor, o ambiente dela, as proteções dela e as que valem nela; da conexão, o banco pelo nome, o servidor, as
    /// proteções e a verificação dela (nula é o padrão: ligada, 30 segundos, a consulta do banco) e o que vale nela na origem: o somente leitura e a
    /// confirmação das pastas acima, e o ambiente herdado da pasta mais próxima que tem um.
    /// </summary>
    [Trait("ExportPlanner", "Build")]
    [Fact(DisplayName = "OK a pasta e a conexão levam o que é delas e o que vale nelas")]
    public void Build_ShouldBeOK_OwnAndEffective()
    {
        //Arrange
        var stock = Folder("Estoque", color: "#2f6fdf", readOnly: true);
        var production = Folder("Production PRD", stock.ID, environmentName: "Production", environmentColor: "#d64545", confirmCommands: "irreversible");
        var inner = Folder("Interna", production.ID, confirmCommands: "none");
        var connection = Connection("DATA FIX", inner.ID, engine: EDatabaseEngine.Db2, host: "db2-prd.exemplo.invalid", port: 50000, database: "estoque", confirmCommands: "all");
        var custom = Connection("Própria", inner.ID, environmentName: "Teste", environmentColor: "#2e9e5b", verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1");
        var document = Document([stock, production, inner], [connection, custom]);

        //Act
        var (_, build) = PlanAndBuild(document, [], [Choice(connection), Choice(custom)]);
        var folders = build.Content.Folders.ToDictionary(folder => folder.Name);
        var exported = build.Content.Connections.Single(item => item.Name == "DATA FIX");
        var own = build.Content.Connections.Single(item => item.Name == "Própria");

        //Assert
        Assert.Equal("#2f6fdf", folders["Estoque"].Color);
        Assert.True(folders["Estoque"].ReadOnly);
        Assert.Equal(new TransferFolderEffective(true, null), folders["Estoque"].Effective);
        Assert.Equal("Production", folders["Production PRD"].EnvironmentName);
        Assert.Equal("#d64545", folders["Production PRD"].EnvironmentColor);
        Assert.Equal("irreversible", folders["Production PRD"].ConfirmCommands);
        Assert.False(folders["Production PRD"].ReadOnly);
        Assert.Equal(new TransferFolderEffective(true, "irreversible"), folders["Production PRD"].Effective);
        Assert.Null(folders["Interna"].ConfirmCommands);
        Assert.Equal(new TransferFolderEffective(true, "irreversible"), folders["Interna"].Effective);

        Assert.Equal("Db2", exported.Engine);
        Assert.Equal("db2-prd.exemplo.invalid", exported.Host);
        Assert.Equal(50000, exported.Port);
        Assert.Equal("all", exported.ConfirmCommands);
        Assert.False(exported.ReadOnly);
        Assert.Null(exported.EnvironmentName);
        Assert.True(exported.VerificationEnabled);
        Assert.Equal(30, exported.VerificationInterval);
        Assert.Null(exported.VerificationQuery);
        Assert.Equal(new TransferConnectionEffective(true, "all", "Production", "#d64545"), exported.Effective);

        Assert.Equal("Informix", own.Engine);
        Assert.False(own.VerificationEnabled);
        Assert.Equal(120, own.VerificationInterval);
        Assert.Equal("SELECT 1 FROM systables WHERE tabid = 1", own.VerificationQuery);
        Assert.Equal(new TransferConnectionEffective(true, "irreversible", "Teste", "#2e9e5b"), own.Effective);
    }

    /// <summary>
    /// RN-TRANSF-006: não vão os IDs do cofre, as datas, os scripts e as pastas de scripts (RN-SCRIPT-007; exportá-los fica para depois), o nome do usuário do
    /// Prism: o conteúdo tem só as chaves próprias do arquivo.
    /// </summary>
    [Trait("ExportPlanner", "Build")]
    [Fact(DisplayName = "OK o conteúdo não leva IDs do cofre, datas, scripts nem o usuário do Prism")]
    public void Build_ShouldBeOK_NoVaultIDsDatesNorUser()
    {
        //Arrange
        var folder = Folder("Estoque");
        var connection = Connection("DATA FIX", folder.ID);
        var scriptFolder = ScriptFolder("Consultas do estoque");
        var script = Script("Saldo por deposito", "SELECT deposito FROM saldo_ficticio", scriptFolder.ID, connection.ID);
        var document = Document([folder], [connection]) with { Scripts = [script], ScriptFolders = [scriptFolder] };

        //Act
        var (_, build) = PlanAndBuild(document, [folder.ID], [Choice(connection)]);
        var json = System.Text.Json.JsonSerializer.Serialize(build.Content, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        //Assert
        Assert.DoesNotContain(folder.ID.ToString(), json);
        Assert.DoesNotContain(connection.ID.ToString(), json);
        Assert.DoesNotContain("2026-10-16", json);
        Assert.DoesNotContain("marina.costa", json);
        Assert.DoesNotContain(scriptFolder.ID.ToString(), json);
        Assert.DoesNotContain(script.ID.ToString(), json);
        Assert.DoesNotContain("Consultas do estoque", json);
        Assert.DoesNotContain("Saldo por deposito", json);
        Assert.DoesNotContain("saldo_ficticio", json);
        Assert.DoesNotContain("\"userName\"", json);
        Assert.DoesNotContain("\"password\"", json);
        Assert.Equal(nameof(TransferFileContent), build.Content.ToString());
        Assert.Equal(nameof(TransferFileConnection), build.Content.Connections[0].ToString());
    }
}
