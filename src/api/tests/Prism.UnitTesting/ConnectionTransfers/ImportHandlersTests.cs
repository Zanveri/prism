using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.ConnectionTransfers.Features.ImportConnections;
using Prism.Application.ConnectionTransfers.Features.PreviewConnectionsImport;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Application.ConnectionTransfers.Repositories;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Serilog.Core;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-009 a 014: a prévia e a importação sobre o serviço do arquivo de verdade (com a derivação barata), o repository de verdade e o cofre de
/// mentira, que roda a função da gravação contra o documento que o teste der (o mais recente, com o que outra janela fez entre a prévia e a importação).
/// A senha de exportação perde os espaços das pontas; a prévia não grava nada; a importação lê e confere tudo de novo, numa gravação só.
/// </summary>
public sealed class ImportHandlersTests
{
    private const long Generation = 7;
    private static readonly DateTime Now = new(2026, 10, 17, 9, 30, 0, DateTimeKind.Utc);

    private readonly Mock<IVaultService> _vault = new();
    private readonly TimeProvider _time = new FixedTime(Now);
    private VaultDocument? _saved;
    private int _derivations;

    private sealed class FixedTime(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
            => new(now);
    }

    private byte[] CountingDerive(string passphrase, VaultKdf kdf)
    {
        _derivations++;

        return Derive(passphrase, kdf);
    }

    private PreviewConnectionsImportHandler CreatePreviewHandler()
        => new(_vault.Object, CreateFileService(CountingDerive), _time, Logger.None);

    private ImportConnectionsHandler CreateImportHandler()
        => new(_vault.Object, CreateFileService(CountingDerive), new ConnectionImportRepository(_vault.Object), _time, Logger.None);

    /// <summary>O cofre de mentira: a leitura devolve `read`, e a gravação roda a função contra `latest` (o documento mais recente), com a geração dada.</summary>
    private void SetupVault(VaultDocument read, VaultDocument? latest = null, long generationAfter = Generation)
    {
        _vault.SetupSequence(v => v.Generation).Returns(Generation).Returns(generationAfter).Returns(generationAfter);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(read));
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(latest ?? read);

                return Task.FromResult(UnitResult.Success<EVaultError>());
            });
    }

    private static JsonObject StockContent()
        => FileContent(
            [FileFolder("f1", null, "Estoque"), FileFolder("f2", "f1", "Production PRD", environmentName: "Production", environmentColor: "#d64545", readOnly: true)],
            [
                FileConnection("c1", "f2", "DATA FIX", verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1"),
                FileConnection("c2", "f2", "NOMINAL", userName: "nominal", password: null),
                FileConnection("c3", "f2", "Sem credenciais", userName: null, password: null),
                FileConnection("c4", "f2", "Snowflake", engine: "Snowflake")
            ]);

    /// <summary>
    /// RN-TRANSF-011: a prévia devolve a árvore do arquivo com o que a importação faria no lugar escolhido, com tudo o que pode ser importado marcado; a
    /// senha de banco nunca vem (só `hasPassword`), e o item que não pode ser importado vem com o motivo. Nada é gravado. A senha de exportação com espaços
    /// nas pontas abre o arquivo (RN-TRANSF-009).
    /// </summary>
    [Trait("PreviewConnectionsImportHandler", "PreviewConnectionsImportCommand")]
    [Fact(DisplayName = "OK prévia mostra a árvore e o que a importação faria, sem gravar e sem a senha de banco")]
    public async Task Preview_ShouldBeOK()
    {
        //Arrange
        var existing = Folder("Estoque");
        var dataFix = Connection("DATA FIX");
        SetupVault(Document([existing], [dataFix]));
        var content = await SealAsync(StockContent());

        //Act
        var result = await CreatePreviewHandler().Handle(new PreviewConnectionsImportCommand { Content = content, Passphrase = "  " + Passphrase + "\u00A0" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var preview = result.Value;
        var folders = preview.Folders.ToDictionary(folder => folder.Key);
        var connections = preview.Connections.ToDictionary(connection => connection.Key);
        Assert.True(folders["f1"].Existing);
        Assert.False(folders["f2"].Existing);
        Assert.Equal("Production", folders["f2"].EnvironmentName);
        Assert.True(folders["f2"].ReadOnly);
        Assert.Equal(EDatabaseEngine.Informix, connections["c1"].Engine);
        Assert.Equal("informix-prd.exemplo.invalid", connections["c1"].Host);
        Assert.Equal("datafix", connections["c1"].UserName);
        Assert.True(connections["c1"].HasPassword);
        Assert.Equal("SELECT 1 FROM systables WHERE tabid = 1", connections["c1"].VerificationQuery);
        Assert.True(connections["c1"].Effective!.ReadOnly);
        Assert.Equal("Production", connections["c1"].Effective!.EnvironmentName);
        Assert.Equal(("nominal", false), (connections["c2"].UserName, connections["c2"].HasPassword));
        Assert.Equal((string.Empty, false), (connections["c3"].UserName, connections["c3"].HasPassword));
        Assert.Null(connections["c4"].Engine);
        Assert.Equal("Este Prism não conhece o banco Snowflake.", connections["c4"].Invalid);
        Assert.Null(connections["c4"].Effective);
        Assert.DoesNotContain("senha-ficticia-do-banco", System.Text.Json.JsonSerializer.Serialize(preview));
        Assert.Null(_saved);
        Assert.Equal(1, _derivations);
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// RN-TRANSF-011: o nome tomado no lugar aparece como conflito, com o nome que a conexão receberia ("Importar com outro nome"), e a proteção ou o ambiente
    /// que a importação gravaria no item aparecem em `strengthened`.
    /// </summary>
    [Trait("PreviewConnectionsImportHandler", "PreviewConnectionsImportCommand")]
    [Fact(DisplayName = "OK prévia mostra conflitos com o nome da cópia e o que seria gravado no item")]
    public async Task Preview_ShouldBeOK_ConflictsAndStrengthening()
    {
        //Arrange
        var production = Folder("Production PRD");
        var dataFix = Connection("DATA FIX", production.ID);
        SetupVault(Document([production], [dataFix]));
        var content = await SealAsync(FileContent([FileFolder("f1", null, "Production PRD", environmentName: "Production", environmentColor: "#d64545", readOnly: true)], [FileConnection("c1", "f1", "DATA FIX")]));

        //Act
        var result = await CreatePreviewHandler().Handle(new PreviewConnectionsImportCommand { Content = content, Passphrase = Passphrase }, CancellationToken.None);

        //Assert
        var connection = Assert.Single(result.Value.Connections);
        Assert.True(Assert.Single(result.Value.Folders).Existing);
        Assert.True(connection.Conflict);
        Assert.Equal("DATA FIX (cópia)", connection.CopyName);
        Assert.Equal(new ImportStrengthenedDto { ReadOnly = true, EnvironmentName = "Production", EnvironmentColor = "#d64545" }, connection.Strengthened);
    }

    /// <summary>
    /// RN-TRANSF-010: as recusas da leitura, cada uma com o código e o campo da tela. A senha errada e o arquivo alterado dão a MESMA recusa, depois de uma
    /// derivação; o arquivo que não é do Prism e o de formato mais novo vêm antes de qualquer derivação. Nenhuma recusa repete o conteúdo nem a senha.
    /// </summary>
    [Trait("PreviewConnectionsImportHandler", "PreviewConnectionsImportCommand")]
    [Theory(DisplayName = "Erro arquivo recusado na leitura, com o código e o campo")]
    [InlineData("senha-errada", "IMPORT_PASSPHRASE_WRONG", 422, "Passphrase", 1)]
    [InlineData("conteudo-alterado", "IMPORT_PASSPHRASE_WRONG", 422, "Passphrase", 1)]
    [InlineData("nao-e-do-prism", "IMPORT_FILE_INVALID", 422, "Content", 0)]
    [InlineData("formato-novo", "IMPORT_FILE_NEWER", 409, null, 0)]
    [InlineData("estrutura", "IMPORT_FILE_INVALID", 422, "Content", 1)]
    [InlineData("limites", "IMPORT_LIMITS_EXCEEDED", 422, "Content", 1)]
    public async Task Preview_ShouldBeError_Reading(string change, string code, int status, string? field, int derivations)
    {
        //Arrange
        SetupVault(Document());
        var content = change switch
        {
            "estrutura" => await SealAsync(FileContent([FileFolder("f1", "f9", "Estoque")])),
            "limites" => await SealAsync(FileContent(connections: Enumerable.Range(1, 2001).Select(index => FileConnection($"c{index}", null, $"C{index}")))),
            _ => await SealAsync(StockContent())
        };
        var passphrase = Passphrase;
        switch (change)
        {
            case "senha-errada": passphrase = "outra senha de exportação"; break;
            case "conteudo-alterado":
                var node = JsonNode.Parse(content)!;
                var bytes = Convert.FromBase64String(node["payload"]!["ciphertext"]!.GetValue<string>());
                bytes[^1] ^= 0x80;
                node["payload"]!["ciphertext"] = Convert.ToBase64String(bytes);
                content = node.ToJsonString();
                break;
            case "nao-e-do-prism": content = "{\"kind\":\"prism-vault\",\"version\":3}"; break;
            case "formato-novo": content = content.Replace("\"version\":1", "\"version\":2"); break;
        }

        //Act
        var result = await CreatePreviewHandler().Handle(new PreviewConnectionsImportCommand { Content = content, Passphrase = passphrase }, CancellationToken.None);

        //Assert
        Assert.Equal(code, result.Error.Type);
        Assert.Equal((HttpStatusCode)status, result.Error.StatusCode);
        if (field is not null)
            Assert.Equal(code, ((Dictionary<string, string[]>)result.Error.Extensions["errorCodes"]!)[field].Single());
        Assert.DoesNotContain(passphrase, result.Error.Detail);
        Assert.Equal(derivations, _derivations);
    }

    /// <summary>
    /// A prévia diz o que há no cofre aberto (os conflitos, o que já existe): o cofre que fechou durante a derivação, ou que outro usuário abriu, não responde
    /// por ela. 401 `VAULT_LOCKED`, sem prévia e sem gravar nada.
    /// </summary>
    [Trait("PreviewConnectionsImportHandler", "PreviewConnectionsImportCommand")]
    [Fact(DisplayName = "Erro cofre mudou durante a derivação da prévia")]
    public async Task Preview_ShouldBeError_VaultChanged()
    {
        //Arrange
        SetupVault(Document(), generationAfter: Generation + 1);
        var content = await SealAsync(StockContent());

        //Act
        var result = await CreatePreviewHandler().Handle(new PreviewConnectionsImportCommand { Content = content, Passphrase = Passphrase }, CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal(1, _derivations);
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>RN-TRANSF-014: o lugar escolhido que outra janela excluiu é 404 `FOLDER_NOT_FOUND`, na prévia e na importação; nada é gravado.</summary>
    [Trait("PreviewConnectionsImportHandler", "PreviewConnectionsImportCommand")]
    [Fact(DisplayName = "Erro lugar escolhido que não existe mais")]
    public async Task PreviewAndImport_ShouldBeError_TargetGone()
    {
        //Arrange
        var target = Folder("Squad");
        SetupVault(Document(), latest: Document());
        var content = await SealAsync(StockContent());

        //Act
        var preview = await CreatePreviewHandler().Handle(new PreviewConnectionsImportCommand { Content = content, Passphrase = Passphrase, TargetFolderID = target.ID }, CancellationToken.None);
        SetupVault(Document([target]), latest: Document());
        var imported = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, TargetFolderID = target.ID, Items = ["c1"] }, CancellationToken.None);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", preview.Error.Type);
        Assert.Equal("FOLDER_NOT_FOUND", imported.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, imported.Error.StatusCode);
        Assert.Empty(_saved!.Connections);
    }

    /// <summary>
    /// RN-TRANSF-014: a importação lê o arquivo de novo, confere tudo e grava numa gravação só, contra o documento mais recente: o que outra janela criou
    /// entre a prévia e a importação conta (a conexão de mesmo nome que apareceu no meio vai com outro nome). As pastas do caminho vão sozinhas, o item que
    /// não pode ser importado é ignorado mesmo marcado, e a consulta de verificação própria só fica com a caixa marcada.
    /// </summary>
    [Trait("ImportConnectionsHandler", "ImportConnectionsCommand")]
    [Fact(DisplayName = "OK importa numa gravação só, contra o documento mais recente")]
    public async Task Import_ShouldBeOK()
    {
        //Arrange
        var content = await SealAsync(StockContent());
        var stockCreatedMeanwhile = Folder("Estoque");
        var productionCreatedMeanwhile = Folder("Production PRD", stockCreatedMeanwhile.ID);
        var dataFixCreatedMeanwhile = Connection("DATA FIX", productionCreatedMeanwhile.ID);
        SetupVault(Document(), latest: Document([stockCreatedMeanwhile, productionCreatedMeanwhile], [dataFixCreatedMeanwhile]));

        //Act
        var result = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, Items = ["c1", "c3", "c4"] }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value.FolderIDs);
        Assert.Equal(2, result.Value.ConnectionIDs.Count);
        Assert.Equal(2, result.Value.MergedFolders);
        Assert.Equal(1, result.Value.Renamed);
        Assert.Equal(0, result.Value.Skipped);
        var created = _saved!.Connections.Where(connection => result.Value.ConnectionIDs.Contains(connection.ID)).ToDictionary(connection => connection.Name);
        Assert.Equal(productionCreatedMeanwhile.ID, created["DATA FIX (cópia)"].FolderID);
        Assert.Null(created["DATA FIX (cópia)"].VerificationQuery);
        Assert.True(created["DATA FIX (cópia)"].ReadOnly);
        Assert.Equal("Production", created["DATA FIX (cópia)"].EnvironmentName);
        Assert.Equal((string.Empty, string.Empty), (created["Sem credenciais"].UserName, created["Sem credenciais"].Password));
        Assert.Equal(Now, created["Sem credenciais"].CreatedAt);
        Assert.Equal(1, _derivations);
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>RN-TRANSF-014: o cofre que fechou durante a derivação, ou que outro usuário abriu, não recebe a importação: 401 `VAULT_LOCKED`, nada gravado.</summary>
    [Trait("ImportConnectionsHandler", "ImportConnectionsCommand")]
    [Fact(DisplayName = "Erro cofre mudou antes da gravação")]
    public async Task Import_ShouldBeError_VaultChanged()
    {
        //Arrange
        var content = await SealAsync(StockContent());
        var latest = Document();
        SetupVault(Document(), latest: latest, generationAfter: Generation + 1);

        //Act
        var result = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, Items = ["c1"] }, CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Same(latest, _saved);
    }

    /// <summary>RN-TRANSF-014: a chave que o arquivo não tem só se sabe depois de abri-lo: 422 `IMPORT_INVALID`, nada gravado.</summary>
    [Trait("ImportConnectionsHandler", "ImportConnectionsCommand")]
    [Fact(DisplayName = "Erro chave marcada que o arquivo não tem")]
    public async Task Import_ShouldBeError_UnknownKey()
    {
        //Arrange
        var content = await SealAsync(StockContent());
        SetupVault(Document());

        //Act
        var result = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, Items = ["c1", "c9"] }, CancellationToken.None);

        //Assert
        Assert.Equal("IMPORT_INVALID", result.Error.Type);
        Assert.Equal("IMPORT_INVALID", ((Dictionary<string, string[]>)result.Error.Extensions["errorCodes"]!)["Items"].Single());
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>RN-TRANSF-014: o "Não importar" com tudo já existindo não cria nada, e o cofre não é regravado (o mesmo documento volta).</summary>
    [Trait("ImportConnectionsHandler", "ImportConnectionsCommand")]
    [Fact(DisplayName = "OK nada importado quando tudo já existia, com Não importar")]
    public async Task Import_ShouldBeOK_NothingImported()
    {
        //Arrange
        var content = await SealAsync(FileContent(connections: [FileConnection("c1", null, "DATA FIX")]));
        var latest = Document(connections: [Connection("DATA FIX")]);
        SetupVault(Document(), latest: latest);

        //Act
        var result = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, Items = ["c1"], OnConflict = "skip" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value.ConnectionIDs);
        Assert.Equal(1, result.Value.Skipped);
        Assert.Same(latest, _saved);
    }

    /// <summary>RN-TRANSF-011: marcada a caixa "Manter as consultas de verificação do arquivo", a consulta própria entra com a conexão.</summary>
    [Trait("ImportConnectionsHandler", "ImportConnectionsCommand")]
    [Fact(DisplayName = "OK a consulta própria fica com a caixa marcada")]
    public async Task Import_ShouldBeOK_KeepVerificationQueries()
    {
        //Arrange
        var content = await SealAsync(StockContent());
        SetupVault(Document());

        //Act
        var result = await CreateImportHandler().Handle(new ImportConnectionsCommand { Content = content, Passphrase = Passphrase, Items = ["c1"], KeepVerificationQueries = true }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.FolderIDs.Count);
        Assert.Equal("SELECT 1 FROM systables WHERE tabid = 1", _saved!.Connections.Single().VerificationQuery);
    }

    /// <summary>
    /// RN-TRANSF-010 e 014, sem derivar nada e nesta ordem: nenhuma chave marcada (`IMPORT_EMPTY`), as formas de `IMPORT_INVALID` que não dependem do
    /// arquivo, o texto acima de 5 MiB e a senha de exportação vazia ou longa (no campo). O código do corpo é o da primeira.
    /// </summary>
    [Trait("ImportConnectionsValidator", "ImportConnectionsCommand")]
    [Theory(DisplayName = "Erro pedido de importação recusado antes de abrir o arquivo")]
    [InlineData("vazio", "IMPORT_EMPTY", "Items")]
    [InlineData("sem-items", "IMPORT_EMPTY", "Items")]
    [InlineData("chave-repetida", "IMPORT_INVALID", "Items")]
    [InlineData("chave-nula", "IMPORT_INVALID", "Items")]
    [InlineData("4001-chaves", "IMPORT_INVALID", "Items")]
    [InlineData("conflito-fora-da-lista", "IMPORT_INVALID", "OnConflict")]
    [InlineData("arquivo-grande", "IMPORT_LIMITS_EXCEEDED", "Content")]
    [InlineData("senha-vazia", "IMPORT_PASSPHRASE_INVALID", "Passphrase")]
    [InlineData("senha-longa", "IMPORT_PASSPHRASE_INVALID", "Passphrase")]
    public void ImportValidator_ShouldBeError(string change, string code, string field)
    {
        //Arrange
        var command = new ImportConnectionsCommand { Content = "{}", Passphrase = Passphrase, Items = ["c1"] };
        command = change switch
        {
            "vazio" => command with { Items = [], Passphrase = "" },
            "sem-items" => command with { Items = null },
            "chave-repetida" => command with { Items = ["c1", "c1"] },
            "chave-nula" => command with { Items = ["c1", null] },
            "4001-chaves" => command with { Items = [.. Enumerable.Range(1, 4001).Select(index => (string?)$"c{index}")] },
            "conflito-fora-da-lista" => command with { OnConflict = "overwrite" },
            "arquivo-grande" => command with { Content = new string('a', 5 * 1024 * 1024 - 1) + "é", Passphrase = "" },
            "senha-vazia" => command with { Passphrase = " \u3000 " },
            _ => command with { Passphrase = new string('a', 129) }
        };

        //Act
        var result = new ImportConnectionsValidator().TestValidate(command);

        //Assert
        Assert.Equal(code, result.Errors[0].ErrorCode);
        result.ShouldHaveValidationErrorFor(field).WithErrorCode(code);
    }

    [Trait("ImportConnectionsValidator", "ImportConnectionsCommand")]
    [Fact(DisplayName = "OK pedido de importação no limite: 4.000 chaves e 5 MiB")]
    public void ImportValidator_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var command = new ImportConnectionsCommand { Content = new string('a', 5 * 1024 * 1024), Passphrase = Passphrase, Items = [.. Enumerable.Range(1, 4000).Select(index => (string?)$"c{index}")], OnConflict = "skip", KeepVerificationQueries = null };

        //Act
        var result = new ImportConnectionsValidator().TestValidate(command);
        var preview = new PreviewConnectionsImportValidator().TestValidate(new PreviewConnectionsImportCommand { Content = command.Content, Passphrase = "x" });
        var previewTooLarge = new PreviewConnectionsImportValidator().TestValidate(new PreviewConnectionsImportCommand { Content = command.Content + "a", Passphrase = "" });

        //Assert
        Assert.Equal(5 * 1024 * 1024, Encoding.UTF8.GetByteCount(command.Content));
        result.ShouldNotHaveAnyValidationErrors();
        preview.ShouldNotHaveAnyValidationErrors();
        Assert.Equal("IMPORT_LIMITS_EXCEEDED", previewTooLarge.Errors[0].ErrorCode);
        previewTooLarge.ShouldHaveValidationErrorFor(item => item.Passphrase).WithErrorCode("IMPORT_PASSPHRASE_INVALID");
    }

    /// <summary>RN-LOG-001: os comandos e a prévia levam o arquivo, a senha de exportação e hosts, e escrevem só o nome do tipo.</summary>
    [Trait("ImportConnectionsCommand", "ToString")]
    [Fact(DisplayName = "OK comandos e prévia não escrevem o arquivo nem a senha")]
    public void ToString_ShouldWriteOnlyTheTypeName()
    {
        //Assert
        Assert.Equal(nameof(ImportConnectionsCommand), new ImportConnectionsCommand { Content = "arquivo", Passphrase = Passphrase }.ToString());
        Assert.Equal(nameof(PreviewConnectionsImportCommand), new PreviewConnectionsImportCommand { Content = "arquivo", Passphrase = Passphrase }.ToString());
        Assert.Equal(nameof(ImportPreviewDto), new ImportPreviewDto().ToString());
        Assert.Equal(nameof(ImportPreviewConnectionDto), new ImportPreviewConnectionDto { Host = "informix-prd.exemplo.invalid" }.ToString());
    }
}
