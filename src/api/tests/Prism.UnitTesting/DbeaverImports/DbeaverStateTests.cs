using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Features.GetDbeaverState;
using Prism.Application.DbeaverImports.Features.InviteToDbeaver;
using Prism.Application.DbeaverImports.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>RN-DBEAVER-018: o convite e a última importação deste usuário no cofre (`GET` e `PUT .../invite`), e a origem que a edição da conexão mantém.</summary>
public sealed class DbeaverStateTests
{
    private static readonly DateTime Now = new(2026, 10, 20, 14, 32, 0, DateTimeKind.Utc);

    private readonly Mock<IVaultService> _vault = new();

    private static VaultDocument Document(VaultDbeaverRecord? dbeaver = null)
        => new("marina.costa", [], [], [], VaultWorkspaceRecord.Empty, [], dbeaver);

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
            => new(now);
    }

    [Trait("DbeaverState", "Get")]
    [Fact(DisplayName = "OK sem nada gravado, as duas datas vêm nulas")]
    public async Task Get_WithNothingSaved_ReturnsNulls()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document()));
        var handler = new GetDbeaverStateHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetDbeaverStateCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.InvitedAt);
        Assert.Null(result.Value.LastImportAt);
    }

    [Trait("DbeaverState", "Get")]
    [Fact(DisplayName = "OK devolve o convite e a última importação gravados")]
    public async Task Get_WithTheDatesSaved_ReturnsThem()
    {
        //Arrange
        var imported = Now.AddDays(1);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document(new VaultDbeaverRecord(Now, imported))));
        var handler = new GetDbeaverStateHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetDbeaverStateCommand(), CancellationToken.None);

        //Assert
        Assert.Equal((Now, imported), (result.Value.InvitedAt, result.Value.LastImportAt));
    }

    [Trait("DbeaverState", "Get")]
    [Fact(DisplayName = "ERRO o cofre fechado é 401 VAULT_LOCKED, e não um estado vazio")]
    public async Task Get_WithTheVaultLocked_IsAnError()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));
        var handler = new GetDbeaverStateHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetDbeaverStateCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("DbeaverState", "Invite")]
    [Fact(DisplayName = "OK grava o convite com a hora da API")]
    public async Task Invite_WithoutAnInvitation_SavesTheTime()
    {
        //Arrange
        VaultDocument? saved = null;
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                saved = change(Document());

                return Task.FromResult(UnitResult.Success<EVaultError>());
            });
        var handler = new InviteToDbeaverHandler(_vault.Object, new FixedClock(Now));

        //Act
        var result = await handler.Handle(new InviteToDbeaverCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new VaultDbeaverRecord(Now, null), saved!.Dbeaver);
    }

    [Trait("DbeaverState", "Invite")]
    [Fact(DisplayName = "OK o convite que já tem data fica com ela, e o cofre não é regravado")]
    public void Invite_WithAnInvitation_KeepsTheDocument()
    {
        //Arrange
        var document = Document(new VaultDbeaverRecord(Now.AddDays(-3), null));

        //Act
        var invited = DbeaverState.Invite(document, Now);

        //Assert
        Assert.Same(document, invited);
    }

    [Trait("DbeaverState", "Imported")]
    [Fact(DisplayName = "OK a importação grava a data dela e o convite feito, sem trocar a data de um convite anterior")]
    public void Imported_SavesTheDateAndTheInvitation()
    {
        //Arrange
        var first = DbeaverState.Imported(Document(), Now);
        var later = DbeaverState.Imported(Document(new VaultDbeaverRecord(Now.AddDays(-3), Now.AddDays(-1))), Now);

        //Assert
        Assert.Equal(new VaultDbeaverRecord(Now, Now), first.Dbeaver);
        Assert.Equal(new VaultDbeaverRecord(Now.AddDays(-3), Now), later.Dbeaver);
    }

    [Trait("DbeaverState", "Export")]
    [Fact(DisplayName = "OK a exportação não leva a origem do DBeaver: o arquivo do Prism chega sem ela (RN-TRANSF-006)")]
    public void Export_DoesNotCarryTheOrigin()
    {
        //Arrange
        var connection = VaultFakers.CreateConnection(name: "Importada", userName: "fulano", password: "senha-fictícia") with { Origin = new VaultConnectionOrigin("dbeaver", "Projeto-Secreto", "id-do-dbeaver-secreto") };
        var document = Document() with { Connections = [connection] };
        var planned = ExportPlanner.Plan(document, [], [new ExportChoice(connection.ID, ETransferCredentials.UserAndPassword)]);

        //Act
        var json = System.Text.Json.JsonSerializer.Serialize(ExportPlanner.Build(document, planned.Value).Content, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        //Assert
        Assert.Contains("Importada", json);
        Assert.DoesNotContain("Projeto-Secreto", json);
        Assert.DoesNotContain("id-do-dbeaver-secreto", json);
        Assert.DoesNotContain("origin", json, StringComparison.OrdinalIgnoreCase);
    }
}
