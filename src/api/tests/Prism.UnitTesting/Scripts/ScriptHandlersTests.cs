using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Features.CreateScript;
using Prism.Application.Scripts.Features.DeleteScript;
using Prism.Application.Scripts.Features.GetScript;
using Prism.Application.Scripts.Features.GetScripts;
using Prism.Application.Scripts.Features.UpdateScript;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Scripts;
using Prism.TestingCore.Fakers.Vault;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Scripts;

/// <summary>Os handlers das rotas `api/user/scripts` (seção 23): a lista sem o SQL, em ordem de nome; o item com o SQL; criar, alterar e excluir pelo repository.</summary>
public sealed class ScriptHandlersTests
{
    private readonly Mock<IVaultService> _vault = new();
    private readonly Mock<IScriptRepository> _repository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 13, 12, 0, 0, TimeSpan.Zero));

    private void SetDocument(params VaultScriptRecord[] scripts)
        => _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [], scripts, VaultWorkspaceRecord.Empty)));

    [Trait("GetScriptsHandler", "GetScriptsCommand")]
    [Fact(DisplayName = "OK a lista vem em ordem de nome, sem diferenciar maiúsculas, e sem o SQL")]
    public async Task GetScripts_ShouldBeOK()
    {
        //Arrange
        var beta = VaultFakers.CreateScript(name: "beta", sql: "SELECT 'b'");
        var alfa = VaultFakers.CreateScript(name: "Alfa", sql: "SELECT 'a'", connectionID: Guid.CreateVersion7(), database: "vendas");
        var gama = VaultFakers.CreateScript(name: "Gama", sql: "SELECT 'g'");
        SetDocument(beta, gama, alfa);

        //Act
        var result = await new GetScriptsHandler(_vault.Object).Handle(new GetScriptsCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(["Alfa", "beta", "Gama"], result.Value.Select(script => script.Name));
        var first = result.Value[0];
        Assert.Equal((alfa.ID, alfa.ConnectionID, alfa.Database, alfa.UpdatedAt), (first.ID, first.ConnectionID, first.Database, first.UpdatedAt));
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Value, JsonSerializerOptions.Web));
        Assert.Equal(["id", "name", "connectionID", "database", "updatedAt"], json.RootElement[0].EnumerateObject().Select(property => property.Name));
    }

    [Trait("GetScriptsHandler", "GetScriptsCommand")]
    [Fact(DisplayName = "Erro cofre fechado responde 401, e não uma lista vazia")]
    public async Task GetScripts_VaultLocked_Returns401()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var result = await new GetScriptsHandler(_vault.Object).Handle(new GetScriptsCommand(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("GetScriptHandler", "GetScriptCommand")]
    [Fact(DisplayName = "OK o item vem com o SQL")]
    public async Task GetScript_ShouldBeOK()
    {
        //Arrange
        var target = VaultFakers.CreateScript(sql: "SELECT * FROM pedidos", connectionID: Guid.CreateVersion7(), database: "vendas");
        SetDocument(VaultFakers.CreateScript(), target);

        //Act
        var result = await new GetScriptHandler(_vault.Object).Handle(new GetScriptCommand(target.ID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal((target.ID, target.Name, target.ConnectionID, target.Database, target.Sql, target.UpdatedAt), (result.Value.ID, result.Value.Name, result.Value.ConnectionID, result.Value.Database, result.Value.Sql, result.Value.UpdatedAt));
    }

    [Trait("GetScriptHandler", "GetScriptCommand")]
    [Fact(DisplayName = "Erro script que não existe responde 404")]
    public async Task GetScript_Missing_Returns404()
    {
        //Arrange
        SetDocument(VaultFakers.CreateScript());

        //Act
        var result = await new GetScriptHandler(_vault.Object).Handle(new GetScriptCommand(Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_NOT_FOUND", result.Error.Type);
    }

    [Trait("GetScriptHandler", "GetScriptCommand")]
    [Fact(DisplayName = "Erro cofre fechado responde 401, e não 404")]
    public async Task GetScript_VaultLocked_Returns401()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var result = await new GetScriptHandler(_vault.Object).Handle(new GetScriptCommand(Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
    }

    [Trait("CreateScriptHandler", "CreateScriptCommand")]
    [Fact(DisplayName = "OK cria com o nome normalizado e a data do relógio, e responde sem o SQL")]
    public async Task CreateScript_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        Script? inserted = null;
        _repository.Setup(r => r.Insert(It.IsAny<Script>(), It.IsAny<CancellationToken>())).Callback<Script, CancellationToken>((script, _) => inserted = script).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var command = ScriptFakers.ReturnCreateScriptCommandValid(name: "  Fechamento  ", sql: "SELECT 1", connectionID: connectionID, database: "vendas");

        //Act
        var result = await new CreateScriptHandler(_repository.Object, _timeProvider).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal(("Fechamento", "SELECT 1", connectionID, "vendas", _timeProvider.GetUtcNow().UtcDateTime), (inserted.Name, inserted.Sql, inserted.ConnectionID, inserted.Database, inserted.CreatedAt));
        Assert.Equal(new ScriptSummaryDto { ID = inserted.ID, Name = "Fechamento", ConnectionID = connectionID, Database = "vendas", UpdatedAt = inserted.UpdatedAt }, result.Value);
    }

    [Trait("CreateScriptHandler", "CreateScriptCommand")]
    [Fact(DisplayName = "Erro a recusa do repository volta como veio")]
    public async Task CreateScript_Refused_ReturnsTheRefusal()
    {
        //Arrange
        var refusal = ApiErrorDto.CreateConflict("Script já existe.", "SCRIPT_ALREADY_EXISTS", "x");
        _repository.Setup(r => r.Insert(It.IsAny<Script>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(refusal));

        //Act
        var result = await new CreateScriptHandler(_repository.Object, _timeProvider).Handle(ScriptFakers.ReturnCreateScriptCommandValid(), CancellationToken.None);

        //Assert
        Assert.Same(refusal, result.Error);
    }

    /// <summary>O handler não lê nada antes: entrega a alteração ao repository, que a roda sobre o registro mais recente, dentro da gravação.</summary>
    [Trait("UpdateScriptHandler", "UpdateScriptCommand")]
    [Fact(DisplayName = "OK a alteração do PATCH roda no repository, com a data do relógio")]
    public async Task UpdateScript_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var stored = ScriptFakers.Create(name: "Antes", sql: "SELECT 1");
        var command = ScriptFakers.ReturnUpdateScriptCommandValid(iD: stored.ID, name: "Depois", sql: "SELECT 2", connectionID: connectionID, database: "vendas");
        _repository.Setup(r => r.Update(stored.ID, It.IsAny<Func<Script, bool>>(), It.IsAny<CancellationToken>()))
            .Returns((Guid _, Func<Script, bool> change, CancellationToken _) =>
            {
                change(stored);

                return Task.FromResult(Result.Success<Script, ApiErrorDto>(stored));
            });

        //Act
        var result = await new UpdateScriptHandler(_repository.Object, _timeProvider).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("Depois", "SELECT 2", connectionID, "vendas", _timeProvider.GetUtcNow().UtcDateTime), (stored.Name, stored.Sql, stored.ConnectionID, stored.Database, stored.UpdatedAt));
        Assert.Equal("Depois", result.Value.Name);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("DeleteScriptHandler", "DeleteScriptCommand")]
    [Fact(DisplayName = "OK exclui pelo repository")]
    public async Task DeleteScript_ShouldBeOK()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        _repository.Setup(r => r.Delete(id, It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Success<ApiErrorDto>());

        //Act
        var result = await new DeleteScriptHandler(_repository.Object).Handle(new DeleteScriptCommand(id), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        _repository.Verify(r => r.Delete(id, It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>RN-LOG-001: o command e o DTO com o SQL não imprimem o SQL nem o nome, onde quer que parem.</summary>
    [Trait("ScriptCommands", "ToString")]
    [Fact(DisplayName = "OK os commands e o DTO com o SQL não o imprimem no ToString")]
    public void ToString_DoesNotPrintTheSql()
    {
        //Arrange
        const string sql = "SELECT 'segredo'";

        //Act
        string[] printed = [ScriptFakers.ReturnCreateScriptCommandValid(sql: sql).ToString(), ScriptFakers.ReturnUpdateScriptCommandValid(sql: sql).ToString(), new ScriptDto { Sql = sql }.ToString(), VaultFakers.CreateScript(sql: sql).ToString()];

        //Assert
        Assert.All(printed, text => Assert.DoesNotContain("segredo", text, StringComparison.Ordinal));
    }
}
