using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.ConnectionTransfers.Features.ExportConnections;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Serilog.Core;
using System.Net;
using System.Text.Json;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-005 e 008: o handler da exportação sobre o serviço do arquivo de verdade (com a derivação barata) e o cofre de mentira. Ele lê o cofre uma vez,
/// confere o pedido antes da senha do Prism (as recusas que não dependem dela não gastam tentativa), pede a senha do Prism só quando uma senha de banco vai,
/// monta o arquivo do documento que a conferência devolve, e o descarta se o cofre mudou durante a derivação. Nada é gravado no cofre.
/// </summary>
public sealed class ExportConnectionsHandlerTests
{
    private const long Generation = 7;
    private const string UserPassword = "senha do usuário do Prism";

    private readonly Mock<IVaultService> _vault = new();

    private ExportConnectionsHandler CreateHandler()
        => new(_vault.Object, CreateFileService(), Logger.None);

    private void SetupRead(VaultDocument document, long generationAfter = Generation)
    {
        _vault.SetupSequence(v => v.Generation).Returns(Generation).Returns(generationAfter);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(document));
    }

    private void SetupVerification(Result<VaultDocument?, EVaultError> result)
        => _vault.Setup(v => v.ReadIfPasswordMatchesAsync(UserPassword, It.IsAny<CancellationToken>())).ReturnsAsync(result);

    private static ExportConnectionsCommand Command(IReadOnlyList<Guid>? folderIDs = null, IReadOnlyList<(Guid ID, string? Credentials)>? connections = null, string passphrase = Passphrase, string? userPassword = null)
        => new()
        {
            FolderIDs = folderIDs ?? [],
            Connections = [.. (connections ?? []).Select(choice => new ExportConnectionChoice { ID = choice.ID, Credentials = choice.Credentials })],
            Passphrase = passphrase,
            UserPassword = userPassword
        };

    private static string FieldCode(Prism.Core.Api.Models.Dtos.ApiErrorDto error, string field)
        => ((Dictionary<string, string[]>)error.Extensions["errorCodes"]!)[field].Single();

    /// <summary>
    /// Sem senha de banco no arquivo a senha do Prism não é pedida, nem conferida quando vem. O arquivo abre com a senha de exportação na forma NFC (o "é"
    /// colado como "e" mais o acento abre com o "é" de uma vez), e a resposta traz as contagens. O cofre é lido uma vez e nunca gravado.
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "OK exporta sem pedir a senha do Prism quando nenhuma senha de banco vai")]
    public async Task Handle_ShouldBeOK_WithoutDatabasePasswords()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var stock = Folder("Estoque");
        var production = Folder("Production PRD", stock.ID, environmentName: "Production", environmentColor: "#d64545");
        var dataFix = Connection("DATA FIX", production.ID);
        var nominal = Connection("NOMINAL", production.ID, userName: "nominal", password: "senha-nominal-ficticia");
        SetupRead(Document([stock, production], [dataFix, nominal]));
        var command = Command(connections: [(dataFix.ID, "user"), (nominal.ID, null)], passphrase: "senha de exportac\u0327a\u0303o fictícia", userPassword: "nem conferida");

        //Act
        var result = await CreateHandler().Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Folders);
        Assert.Equal(2, result.Value.Connections);
        Assert.Equal(1, result.Value.WithUser);
        Assert.Equal(0, result.Value.WithPassword);
        var content = await OpenAsync(result.Value.Content, "senha de exportação fictícia");
        var connections = content.GetProperty("connections").EnumerateArray().ToList();
        Assert.Equal("datafix", connections[0].GetProperty("userName").GetString());
        Assert.False(connections[0].TryGetProperty("password", out _));
        Assert.False(connections[1].TryGetProperty("userName", out _));
        Assert.False(connections[1].TryGetProperty("password", out _));
        Assert.DoesNotContain("senha-ficticia-do-banco", result.Value.Content);
        _vault.Verify(v => v.Read(), Times.Once);
        _vault.VerifyGet(v => v.Generation, Times.Exactly(2));
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>
    /// RN-TRANSF-005: com uma senha de banco no arquivo, a senha do Prism é conferida (a mesma conferência e a mesma contagem da revelação), e o arquivo sai
    /// do documento que a conferência devolve, nunca da leitura de antes: a senha do banco gravada no meio é a que vai.
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "OK com senha de banco, confere a senha do Prism e monta o arquivo do documento conferido")]
    public async Task Handle_ShouldBeOK_FromTheVerifiedDocument()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var firstRead = Connection("DATA FIX", password: "senha-da-primeira-leitura");
        var verified = firstRead with { Password = "senha-do-documento-conferido" };
        SetupRead(Document(connections: [firstRead]));
        SetupVerification(Result.Success<VaultDocument?, EVaultError>(Document(connections: [verified])));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [(firstRead.ID, "userAndPassword")], userPassword: UserPassword), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.WithPassword);
        var content = await OpenAsync(result.Value.Content);
        Assert.Equal("senha-do-documento-conferido", content.GetProperty("connections")[0].GetProperty("password").GetString());
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync(UserPassword, cancellationToken), Times.Once);
    }

    /// <summary>RN-TRANSF-005: sem a senha do Prism quando ela é pedida, 422 `USER_PASSWORD_REQUIRED` no campo, sem conferir e sem contar.</summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Theory(DisplayName = "Erro senha de banco sem a senha do Prism")]
    [InlineData(null)]
    [InlineData("")]
    public async Task Handle_ShouldBeError_UserPasswordRequired(string? userPassword)
    {
        //Arrange
        var connection = Connection("DATA FIX");
        SetupRead(Document(connections: [connection]));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [(connection.ID, "userAndPassword")], userPassword: userPassword), CancellationToken.None);

        //Assert
        Assert.Equal("USER_PASSWORD_REQUIRED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("USER_PASSWORD_REQUIRED", FieldCode(result.Error, "UserPassword"));
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>RN-TRANSF-005: a senha do Prism errada é 422 `INVALID_PASSWORD` no campo; o quinto erro seguido (o serviço fecha o cofre) é 401 `VAULT_LOCKED`.</summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro senha do Prism errada, e o quinto erro fecha o cofre")]
    public async Task Handle_ShouldBeError_WrongUserPassword()
    {
        //Arrange
        var connection = Connection("DATA FIX");
        SetupRead(Document(connections: [connection]));
        SetupVerification(Result.Success<VaultDocument?, EVaultError>(null));

        //Act
        var wrong = await CreateHandler().Handle(Command(connections: [(connection.ID, "userAndPassword")], userPassword: UserPassword), CancellationToken.None);
        SetupRead(Document(connections: [connection]));
        SetupVerification(Result.Failure<VaultDocument?, EVaultError>(EVaultError.Locked));
        var locked = await CreateHandler().Handle(Command(connections: [(connection.ID, "userAndPassword")], userPassword: UserPassword), CancellationToken.None);

        //Assert
        Assert.Equal("INVALID_PASSWORD", wrong.Error.Type);
        Assert.Equal("INVALID_PASSWORD", FieldCode(wrong.Error, "UserPassword"));
        Assert.Equal("VAULT_LOCKED", locked.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, locked.Error.StatusCode);
    }

    /// <summary>
    /// RN-TRANSF-004: a senha de exportação igual à senha do Prism que veio e conferiu (as duas na NFC) é recusada no campo da senha de exportação, depois
    /// da conferência. Sem a senha do Prism no pedido, nada é comparado.
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro senha de exportação igual à senha do Prism")]
    public async Task Handle_ShouldBeError_PassphraseEqualsUserPassword()
    {
        //Arrange
        var connection = Connection("DATA FIX");
        var document = Document(connections: [connection]);
        SetupRead(document);
        _vault.Setup(v => v.ReadIfPasswordMatchesAsync("senha do usuário", It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success<VaultDocument?, EVaultError>(document));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [(connection.ID, "userAndPassword")], passphrase: "senha do usua\u0301rio", userPassword: "senha do usuário"), CancellationToken.None);

        //Assert
        Assert.Equal("EXPORT_PASSPHRASE_INVALID", result.Error.Type);
        Assert.Equal("EXPORT_PASSPHRASE_INVALID", FieldCode(result.Error, "Passphrase"));
        Assert.Equal(["Use uma senha de exportação diferente da sua senha do Prism."], ((Dictionary<string, string[]>)result.Error.Extensions["errors"]!)["Passphrase"]);
    }

    /// <summary>
    /// RN-TRANSF-005: o que foi marcado e não existe mais é 404 ANTES da senha do Prism (não gasta tentativa) e de novo no documento conferido (o cofre pode
    /// ter mudado no meio), já depois da senha.
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro item que sumiu, antes e depois da conferência da senha do Prism")]
    public async Task Handle_ShouldBeError_MarkedItemGone()
    {
        //Arrange
        var connection = Connection("DATA FIX");
        var folder = Folder("Estoque");
        SetupRead(Document([folder], [connection]));

        //Act
        var before = await CreateHandler().Handle(Command(folderIDs: [Guid.CreateVersion7()], connections: [(connection.ID, "userAndPassword")], userPassword: UserPassword), CancellationToken.None);
        SetupRead(Document([folder], [connection]));
        SetupVerification(Result.Success<VaultDocument?, EVaultError>(Document([folder])));
        var after = await CreateHandler().Handle(Command(folderIDs: [folder.ID], connections: [(connection.ID, "userAndPassword")], userPassword: UserPassword), CancellationToken.None);

        //Assert
        Assert.Equal("FOLDER_NOT_FOUND", before.Error.Type);
        Assert.Equal("CONNECTION_NOT_FOUND", after.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, after.Error.StatusCode);
        _vault.Verify(v => v.ReadIfPasswordMatchesAsync(UserPassword, It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>RN-TRANSF-008: o cofre que fechou (ou mudou de dono) durante a derivação e a cifra faz o arquivo ser descartado, com 401 `VAULT_LOCKED`.</summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro cofre mudou durante a derivação")]
    public async Task Handle_ShouldBeError_VaultChangedDuringTheDerivation()
    {
        //Arrange
        var connection = Connection("DATA FIX");
        SetupRead(Document(connections: [connection]), generationAfter: Generation + 1);

        //Act
        var result = await CreateHandler().Handle(Command(connections: [(connection.ID, null)]), CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
    }

    /// <summary>O cofre fechado na leitura é o 401 de sempre.</summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_VaultLocked()
    {
        //Arrange
        _vault.SetupGet(v => v.Generation).Returns(Generation);
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var result = await CreateHandler().Handle(Command(folderIDs: [Guid.CreateVersion7()]), CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    /// <summary>
    /// RN-TRANSF-006: o tamanho se sabe com o arquivo montado, e passa dos 5 MiB da importação: `EXPORT_LIMITS_EXCEEDED`, e nenhum arquivo sai. São 2.000
    /// conexões com os campos no teto (a senha de 1.024 e a consulta de 1.000 caracteres).
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro arquivo montado passaria de 5 MiB")]
    public async Task Handle_ShouldBeError_FileLargerThanTheImportLimit()
    {
        //Arrange
        var connections = ConnectionsAtTheFieldLimits();
        var document = Document(connections: connections);
        SetupRead(document);
        SetupVerification(Result.Success<VaultDocument?, EVaultError>(document));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [.. connections.Select(connection => (connection.ID, (string?)"userAndPassword"))], userPassword: UserPassword), CancellationToken.None);

        //Assert
        Assert.Equal("EXPORT_LIMITS_EXCEEDED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
    }

    /// <summary>
    /// RN-TRANSF-008: o cofre que mudou durante a derivação descarta o arquivo com 401 `VAULT_LOCKED`, também quando o arquivo montado passaria dos 5 MiB: a
    /// geração é conferida antes do tamanho.
    /// </summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro cofre mudou durante a derivação vem antes do tamanho")]
    public async Task Handle_ShouldBeError_VaultChangedBeforeTheSize()
    {
        //Arrange
        var connections = ConnectionsAtTheFieldLimits();
        var document = Document(connections: connections);
        SetupRead(document, generationAfter: Generation + 1);
        SetupVerification(Result.Success<VaultDocument?, EVaultError>(document));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [.. connections.Select(connection => (connection.ID, (string?)"userAndPassword"))], userPassword: UserPassword), CancellationToken.None);

        //Assert
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
    }

    /// <summary>2.000 conexões com os campos no teto (a senha de 1.024 e a consulta de 1.000 caracteres): o arquivo montado com as senhas passa de 5 MiB.</summary>
    private static List<VaultConnectionRecord> ConnectionsAtTheFieldLimits()
        => [.. Enumerable.Range(1, 2000).Select(index => Connection($"Conexão {index:0000} " + new string('n', 60), host: new string('h', 240) + ".invalid", database: new string('d', 128), userName: new string('u', 128), password: new string('s', 1024), verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1 " + new string(' ', 900) + "AND 1 = 1"))];

    /// <summary>RN-LOG-001: a resposta leva o arquivo e escreve só o nome do tipo.</summary>
    [Trait("ExportedConnectionsDto", "ToString")]
    [Fact(DisplayName = "OK a resposta não escreve o arquivo")]
    public void Dto_ToString_ShouldNotWriteTheFile()
        => Assert.Equal("ExportedConnectionsDto", new Prism.Application.ConnectionTransfers.Models.Dtos.ExportedConnectionsDto { Content = "arquivo" }.ToString());

    /// <summary>O conteúdo em claro é um JSON em camelCase com `folders` e `connections`.</summary>
    [Trait("ExportConnectionsHandler", "ExportConnectionsCommand")]
    [Fact(DisplayName = "OK o conteúdo em claro tem a forma da RN-TRANSF-007")]
    public async Task Handle_ShouldBeOK_ContentShape()
    {
        //Arrange
        var folder = Folder("Estoque", readOnly: true);
        var connection = Connection("DATA FIX", folder.ID);
        SetupRead(Document([folder], [connection]));

        //Act
        var result = await CreateHandler().Handle(Command(connections: [(connection.ID, "none")]), CancellationToken.None);
        var content = await OpenAsync(result.Value.Content);

        //Assert
        Assert.Equal(["folders", "connections"], content.EnumerateObject().Select(property => property.Name));
        Assert.Equal(["key", "parentKey", "name", "color", "environmentName", "environmentColor", "confirmCommands", "readOnly", "effective"], content.GetProperty("folders")[0].EnumerateObject().Select(property => property.Name));
        Assert.Equal(["key", "folderKey", "name", "engine", "host", "port", "database", "environmentName", "environmentColor", "confirmCommands", "readOnly", "verificationEnabled", "verificationInterval", "verificationQuery", "effective"], content.GetProperty("connections")[0].EnumerateObject().Select(property => property.Name));
        Assert.Equal(JsonValueKind.Null, content.GetProperty("folders")[0].GetProperty("parentKey").ValueKind);
        Assert.True(content.GetProperty("connections")[0].GetProperty("effective").GetProperty("readOnly").GetBoolean());
    }
}
