using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.Vault.Models;
using System.Text.Json.Nodes;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-012 a 014: onde o que vem do arquivo fica, contra um documento do cofre. O que está na raiz do arquivo vai para o lugar escolhido; a pasta de
/// mesmo nome no mesmo lugar é a que existe (e ela não muda); a conexão de nome tomado vai com o nome da cópia ou fica de fora; nada que existe é mudado; e
/// nenhum item fica mais fraco que na origem (as proteções e o ambiente gravados nele quando o lugar daria menos). Todos os IDs são novos.
/// </summary>
public sealed class ImportPlacementTests
{
    private static readonly DateTime Now = new(2026, 10, 17, 9, 30, 0, DateTimeKind.Utc);

    private static ImportAnalysis Analyze(JsonNode content)
    {
        var read = ImportedFile.Read(Parse(content));
        var analysis = ImportAnalysis.Analyze(read.File!);
        Assert.True(analysis.IsSuccess);

        return analysis.Value;
    }

    private static HashSet<string> All(ImportAnalysis analysis)
        => [.. analysis.Folders.Where(folder => folder.Candidate is not null).Select(folder => folder.Key).Concat(analysis.Connections.Where(connection => connection.Candidate is not null).Select(connection => connection.Key))];

    private static ImportPlacementResult Place(VaultDocument document, JsonNode content, Guid? target = null, IReadOnlySet<string>? selected = null, EImportConflict onConflict = EImportConflict.Rename, bool keep = false)
    {
        var analysis = Analyze(content);

        return ImportPlacement.Place(document, target, analysis, selected ?? All(analysis), onConflict, keep, Now);
    }

    private static VaultConnectionRecord Created(ImportPlacementResult result, string key)
        => result.Document.Connections.Single(connection => connection.ID == result.Connections[key].ID);

    private static VaultFolderRecord CreatedFolder(ImportPlacementResult result, string key)
        => result.Document.Folders.Single(folder => folder.ID == result.Folders[key].ID);

    /// <summary>
    /// RN-TRANSF-012 e 014: o que está na raiz do arquivo vai para o lugar escolhido, com a estrutura embaixo; IDs novos, as datas da importação, o que existia
    /// fica igual, e cada pasta vem antes do que está dentro dela. O usuário e a senha que não vieram ficam vazios (RN-TRANSF-015).
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK cria a estrutura do arquivo no lugar escolhido, com IDs novos")]
    public void Place_ShouldBeOK_CreatesUnderTheTarget()
    {
        //Arrange
        var target = Folder("Squad");
        var existing = Connection("Outra", target.ID);
        var document = Document([target], [existing]);
        var content = FileContent(
            [FileFolder("f1", null, "Estoque"), FileFolder("f2", "f1", "Production PRD")],
            [FileConnection("c1", "f2", "DATA FIX"), FileConnection("c2", "f2", "NOMINAL", userName: null, password: null), FileConnection("c3", null, "Na raiz do arquivo", userName: "leitor", password: null)]);

        //Act
        var result = Place(document, content, target.ID);
        var stock = CreatedFolder(result, "f1");
        var production = CreatedFolder(result, "f2");

        //Assert
        Assert.Equal(target.ID, stock.ParentID);
        Assert.Equal(stock.ID, production.ParentID);
        Assert.Equal(Now, stock.CreatedAt);
        Assert.Equal([target, stock, production], result.Document.Folders);
        Assert.Equal(existing, result.Document.Connections[0]);
        Assert.Equal(production.ID, Created(result, "c1").FolderID);
        Assert.Equal("senha-ficticia-do-banco", Created(result, "c1").Password);
        Assert.Equal(string.Empty, Created(result, "c2").UserName);
        Assert.Equal(string.Empty, Created(result, "c2").Password);
        Assert.Equal(("leitor", string.Empty), (Created(result, "c3").UserName, Created(result, "c3").Password));
        Assert.Equal(target.ID, Created(result, "c3").FolderID);
        Assert.Equal(Now, Created(result, "c3").CreatedAt);
        Assert.Equal([stock.ID, production.ID], result.CreatedFolderIDs);
        Assert.Equal(3, result.CreatedConnectionIDs.Count);
        Assert.Equal(0, result.MergedFolders);
    }

    /// <summary>
    /// RN-TRANSF-012: a pasta do arquivo com o mesmo nome de uma que existe no mesmo lugar (sem diferenciar maiúsculas, com o nome normalizado) é essa pasta:
    /// o que vem dentro entra nela, e ela fica como está, com a cor, o ambiente e as proteções dela. Duas irmãs de mesmo nome no arquivo viram uma só.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK pasta de mesmo nome no lugar é a que existe, e não muda")]
    public void Place_ShouldBeOK_MergesFolders()
    {
        //Arrange
        var stock = Folder("Estoque", color: "#2f6fdf");
        var document = Document([stock]);
        var content = FileContent(
            [FileFolder("f1", null, "  ESTOQUE ", color: "#000000", confirmCommands: "all"), FileFolder("f2", "f1", "Production PRD"), FileFolder("f3", "f1", "production prd")],
            [FileConnection("c1", "f2", "DATA FIX"), FileConnection("c2", "f3", "NOMINAL")]);

        //Act
        var result = Place(document, content);

        //Assert
        Assert.Equal(stock.ID, result.Folders["f1"].ID);
        Assert.True(result.Folders["f1"].Merged);
        Assert.Equal(stock, result.Document.Folders[0]);
        Assert.Equal(result.Folders["f2"].ID, result.Folders["f3"].ID);
        Assert.Equal(2, result.MergedFolders);
        Assert.Equal(2, result.Document.Folders.Count);
        Assert.Equal(result.Folders["f2"].ID, Created(result, "c2").FolderID);
    }

    /// <summary>
    /// RN-TRANSF-012 e RN-SCRIPT-007: a importação só cria pastas de conexões e conexões. A pasta de scripts de mesmo nome no lugar não é a pasta do arquivo
    /// (ela é da seção Scripts, e a do arquivo é criada), e os scripts e as pastas de scripts ficam como estão.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK pasta de scripts de mesmo nome não é a do arquivo, e os scripts não mudam")]
    public void Place_ShouldBeOK_KeepsScriptsAndScriptFolders()
    {
        //Arrange
        var scriptFolder = ScriptFolder("Estoque");
        var script = Script("Saldo por deposito", "SELECT 1", scriptFolder.ID);
        var document = Document() with { Scripts = [script], ScriptFolders = [scriptFolder] };
        var content = FileContent([FileFolder("f1", null, "Estoque")], [FileConnection("c1", "f1", "DATA FIX")]);

        //Act
        var result = Place(document, content);
        var stock = CreatedFolder(result, "f1");

        //Assert
        Assert.False(result.Folders["f1"].Merged);
        Assert.NotEqual(scriptFolder.ID, stock.ID);
        Assert.Null(stock.ParentID);
        Assert.Equal(0, result.MergedFolders);
        Assert.Equal(stock.ID, Created(result, "c1").FolderID);
        Assert.Equal([script], result.Document.Scripts);
        Assert.Equal([scriptFolder], result.Document.ScriptFolders);
    }

    /// <summary>
    /// RN-TRANSF-012: a conexão de nome tomado no lugar (pelo que existe e pelo que a mesma importação já pôs) vai com o nome da cópia do "Duplicar conexão",
    /// ou fica de fora com "Não importar". A que existe nunca muda.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Theory(DisplayName = "OK conexão de nome tomado vai com outro nome, ou fica de fora")]
    [InlineData("rename")]
    [InlineData("skip")]
    public void Place_ShouldBeOK_Conflicts(string choice)
    {
        var onConflict = TransferRules.ConflictOf(choice);

        //Arrange
        var existing = Connection("DATA FIX");
        var copy = Connection("data fix (cópia)");
        var document = Document(connections: [existing, copy]);
        var content = FileContent(connections: [FileConnection("c1", null, "Data Fix"), FileConnection("c2", null, "NOMINAL"), FileConnection("c3", null, "NOMINAL")]);

        //Act
        var result = Place(document, content, onConflict: onConflict);

        //Assert
        Assert.Equal([existing, copy], result.Document.Connections.Take(2));
        Assert.True(result.Connections["c1"].Conflict);
        Assert.Equal("Data Fix (cópia 2)", result.Connections["c1"].CopyName);
        Assert.False(result.Connections["c2"].Conflict);
        Assert.True(result.Connections["c3"].Conflict);
        Assert.Equal("NOMINAL (cópia)", result.Connections["c3"].CopyName);
        if (onConflict == EImportConflict.Rename)
        {
            Assert.Equal("Data Fix (cópia 2)", Created(result, "c1").Name);
            Assert.Equal("NOMINAL (cópia)", Created(result, "c3").Name);
            Assert.Equal(2, result.Renamed);
            Assert.Equal(0, result.Skipped);
            Assert.Equal(5, result.Document.Connections.Count);
        }
        else
        {
            Assert.True(result.Connections["c1"].Skipped);
            Assert.Null(result.Connections["c1"].ID);
            Assert.Equal(0, result.Renamed);
            Assert.Equal(2, result.Skipped);
            Assert.Equal(["DATA FIX", "data fix (cópia)", "NOMINAL"], result.Document.Connections.Select(connection => connection.Name));
        }
    }

    /// <summary>RN-TRANSF-014: nada criado (tudo já existia, com "Não importar") é nada a gravar: o documento volta como entrou, e o cofre não é regravado.</summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK nada criado devolve o mesmo documento")]
    public void Place_ShouldBeOK_NothingCreatedKeepsTheDocument()
    {
        //Arrange
        var folder = Folder("Estoque");
        var connection = Connection("DATA FIX", folder.ID);
        var document = Document([folder], [connection]);
        var content = FileContent([FileFolder("f1", null, "Estoque")], [FileConnection("c1", "f1", "DATA FIX")]);

        //Act
        var result = Place(document, content, onConflict: EImportConflict.Skip);

        //Assert
        Assert.Same(document, result.Document);
        Assert.Empty(result.CreatedFolderIDs);
        Assert.Empty(result.CreatedConnectionIDs);
        Assert.Equal(1, result.Skipped);
    }

    /// <summary>
    /// RN-TRANSF-014: só vai o que foi marcado, com as pastas do caminho de cada item (marcadas ou não); a pasta desmarcada sem nada marcado dentro não vai,
    /// e a chave do item que não pode ser importado é ignorada.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK só o marcado vai, com as pastas do caminho")]
    public void Place_ShouldBeOK_OnlyTheSelected()
    {
        //Arrange
        var content = FileContent(
            [FileFolder("f1", null, "Estoque"), FileFolder("f2", "f1", "Production PRD"), FileFolder("f3", "f1", "Desenvolvimento DEV"), FileFolder("f4", null, "Vazia")],
            [FileConnection("c1", "f2", "DATA FIX"), FileConnection("c2", "f3", "NOMINAL"), FileConnection("c3", "f2", "Inválida", engine: "Snowflake")]);

        //Act
        var result = Place(Document(), content, selected: new HashSet<string> { "c1", "f4", "c3" });

        //Assert
        Assert.Equal(["Estoque", "Vazia", "Production PRD"], result.Document.Folders.Select(folder => folder.Name));
        Assert.Equal(["DATA FIX"], result.Document.Connections.Select(connection => connection.Name));
    }

    /// <summary>
    /// RN-TRANSF-013: a conexão que na origem era somente leitura (pela pasta dela) e que no lugar escolhido nada protegeria fica somente leitura nela mesma;
    /// a confirmação mais alta da origem é gravada nela quando o lugar daria menos. Com o lugar já protegido, nada muda. O mesmo vale para a pasta criada.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK nunca mais fraca: as proteções da origem gravadas no item quando o lugar daria menos")]
    public void Place_ShouldBeOK_NeverWeaker()
    {
        //Arrange
        var unprotected = Folder("Sem proteção");
        var protectedTarget = Folder("Protegida", readOnly: true, confirmCommands: "all");
        var document = Document([unprotected, protectedTarget]);
        var content = FileContent(
            [FileFolder("f1", null, "Production PRD", confirmCommands: "irreversible", readOnly: true), FileFolder("f2", "f1", "Interna")],
            [FileConnection("c1", "f2", "DATA FIX", effective: new JsonObject { ["readOnly"] = true, ["confirmCommands"] = "all" })]);

        //Act
        var open = Place(document, content, unprotected.ID);
        var guarded = Place(document, content, protectedTarget.ID);

        //Assert
        Assert.True(CreatedFolder(open, "f1").ReadOnly);
        Assert.Equal("irreversible", CreatedFolder(open, "f1").ConfirmCommands);
        Assert.Equal(Strengthening.None, open.Folders["f1"].Strengthening);
        Assert.Null(CreatedFolder(open, "f2").ReadOnly);
        Assert.Equal(Strengthening.None, open.Folders["f2"].Strengthening);
        Assert.Null(Created(open, "c1").ReadOnly);
        Assert.Equal("all", Created(open, "c1").ConfirmCommands);
        Assert.Equal(new Strengthening(null, "all", null, null), open.Connections["c1"].Strengthening);

        Assert.Equal(Strengthening.None, guarded.Connections["c1"].Strengthening);
        Assert.Null(Created(guarded, "c1").ConfirmCommands);
    }

    /// <summary>
    /// RN-TRANSF-013: no lugar que já tem uma pasta de mesmo nome sem as proteções, a pasta não muda (a que existe fica como está), e a conexão que entra
    /// nela grava o somente leitura e a confirmação nela mesma.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK pasta que existe não muda, e a conexão que entra nela fica com a proteção da origem")]
    public void Place_ShouldBeOK_StrengthenedInsideAnExistingFolder()
    {
        //Arrange
        var production = Folder("Production PRD");
        var document = Document([production]);
        var content = FileContent([FileFolder("f1", null, "Production PRD", confirmCommands: "all", readOnly: true)], [FileConnection("c1", "f1", "DATA FIX")]);

        //Act
        var result = Place(document, content);

        //Assert
        Assert.Equal(production, result.Document.Folders.Single());
        Assert.True(Created(result, "c1").ReadOnly);
        Assert.Equal("all", Created(result, "c1").ConfirmCommands);
        Assert.Equal(new Strengthening(true, "all", null, null), result.Connections["c1"].Strengthening);
        Assert.Equal(1, result.Strengthened);
    }

    /// <summary>
    /// RN-TRANSF-013: a conexão sem ambiente próprio que na origem mostrava um grava esse ambiente nela, com a cor, quando ali herdaria outro (pelo nome, sem
    /// diferenciar maiúsculas) ou nenhum; herdando o mesmo, nada muda. A que na origem não tinha ambiente fica com o que o lugar der.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Fact(DisplayName = "OK o ambiente da origem gravado na conexão quando o lugar daria outro ou nenhum")]
    public void Place_ShouldBeOK_Environment()
    {
        //Arrange
        var sameEnvironment = Folder("Mesmo", environmentName: "PRODUCTION", environmentColor: "#000000");
        var otherEnvironment = Folder("Outro", environmentName: "Homologação", environmentColor: "#e0a030");
        var document = Document([sameEnvironment, otherEnvironment]);
        var content = FileContent(
            [FileFolder("f1", null, "Production PRD", environmentName: "Production", environmentColor: "#d64545")],
            [FileConnection("c1", "f1", "DATA FIX"), FileConnection("c2", null, "Sem ambiente na origem")]);

        //Act
        var root = Place(document, content);
        var same = Place(document, content, sameEnvironment.ID);
        var other = Place(document, content, otherEnvironment.ID);

        //Assert
        Assert.Equal(("Production", "#d64545"), (CreatedFolder(root, "f1").EnvironmentName, CreatedFolder(root, "f1").EnvironmentColor));
        Assert.Null(Created(root, "c1").EnvironmentName);
        Assert.Equal(Strengthening.None, root.Connections["c1"].Strengthening);
        Assert.Null(Created(same, "c1").EnvironmentName);
        Assert.Null(Created(other, "c1").EnvironmentName);
        Assert.Null(Created(other, "c2").EnvironmentName);

        // Sem a pasta do arquivo no caminho (ela já existia, sem ambiente), a conexão grava o ambiente dela.
        var existingProduction = Folder("Production PRD");
        var merged = Place(Document([existingProduction]), content);
        Assert.Equal(("Production", "#d64545"), (Created(merged, "c1").EnvironmentName, Created(merged, "c1").EnvironmentColor));
        Assert.Equal(new Strengthening(null, null, "Production", "#d64545"), merged.Connections["c1"].Strengthening);
        Assert.Null(Created(merged, "c2").EnvironmentName);
    }

    /// <summary>
    /// RN-TRANSF-011 e 014: desmarcada a caixa "Manter as consultas de verificação do arquivo" (o padrão), a conexão de consulta própria entra com a do banco;
    /// a verificação, ligada ou não, e o intervalo continuam os do arquivo. Marcada, entra com a do arquivo.
    /// </summary>
    [Trait("ImportPlacement", "Place")]
    [Theory(DisplayName = "OK a consulta de verificação própria só entra com a caixa marcada")]
    [InlineData(false)]
    [InlineData(true)]
    public void Place_ShouldBeOK_KeepVerificationQueries(bool keep)
    {
        //Arrange
        var content = FileContent(connections: [FileConnection("c1", null, "DATA FIX", verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1"), FileConnection("c2", null, "NOMINAL")]);

        //Act
        var result = Place(Document(), content, keep: keep);
        var created = Created(result, "c1");

        //Assert
        Assert.Equal(keep ? "SELECT 1 FROM systables WHERE tabid = 1" : null, created.VerificationQuery);
        Assert.False(created.VerificationEnabled);
        Assert.Equal(120, created.VerificationInterval);
        Assert.Equal(keep ? 1 : 0, result.QueriesKept);
        Assert.Equal(keep ? 0 : 1, result.QueriesReplaced);
    }
}
