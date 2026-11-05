using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Features.GetScript;
using Prism.Application.Scripts.Features.GetScripts;
using Prism.Application.Scripts.Features.SaveScriptRunValues;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// RN-VAR-028: os valores lembrados do "Executar com valores…": o handler do `PUT .../run-values` (o lugar como o do script, o mapa vazio que esquece, a hora em
/// UTC), o repository (só o registro do script muda, sem a data de alteração; o `PATCH` não os esquece; excluir o script os exclui), o validator, o `runValues` do
/// item e o `declaresVariables` da lista e das respostas de criar e de alterar.
/// </summary>
public sealed class ScriptRunValuesTests
{
    private static readonly DateTime Now = new(2026, 11, 5, 12, 0, 0, DateTimeKind.Utc);

    private readonly Mock<IScriptRepository> _repository = new();
    private readonly Mock<IVaultService> _vault = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(Now));
    private VaultDocument? _saved;

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);

        return document.RootElement.Clone();
    }

    private static VaultDocument Document(params VaultScriptRecord[] scripts)
        => new("marina.costa", [], [], scripts, VaultWorkspaceRecord.Empty, []);

    private static VaultScriptRunValuesRecord RunValues(string values = """{"x":{"type":"number","value":"7"}}""")
        => new(Json(values), null, null, Now.AddDays(-1));

    /// <summary>Roda a função do `SaveAsync` contra o documento, como o serviço faz.</summary>
    private ScriptRepository CreateRepository(VaultDocument current)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(UnitResult.Success<EVaultError>());
            });

        return new ScriptRepository(_vault.Object);
    }

    private async Task<VaultScriptRunValuesRecord?> SendAsync(SaveScriptRunValuesCommand command)
    {
        VaultScriptRunValuesRecord? sent = null;
        _repository.Setup(r => r.SaveRunValues(command.ID, It.IsAny<VaultScriptRunValuesRecord?>(), It.IsAny<CancellationToken>()))
            .Callback((Guid _, VaultScriptRunValuesRecord? runValues, CancellationToken _) => sent = runValues)
            .ReturnsAsync(UnitResult.Success<ApiErrorDto>());

        var result = await new SaveScriptRunValuesHandler(_repository.Object, _timeProvider).Handle(command, CancellationToken.None);
        Assert.True(result.IsSuccess);

        return sent;
    }

    [Trait("SaveScriptRunValuesHandler", "SaveScriptRunValuesCommand")]
    [Fact(DisplayName = "OK grava o mapa como veio, a conexão e o banco do script genérico e a hora em UTC")]
    public async Task Handle_ShouldSaveTheValuesAsTheyCame()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var values = """{"status":{"type":"list","items":[{"type":"text","value":"aberta"}]},"x":{"type":"number","value":"7"}}""";

        //Act
        var sent = await SendAsync(new SaveScriptRunValuesCommand { ID = Guid.CreateVersion7(), Values = Json(values), ConnectionID = connectionID, Database = "vendas" });

        //Assert
        Assert.NotNull(sent);
        Assert.Equal(values, sent.Values.GetRawText());
        Assert.Equal((connectionID, "vendas", Now), (sent.ConnectionID, sent.Database, sent.SavedAt));
        Assert.Equal(DateTimeKind.Utc, sent.SavedAt.Kind);
    }

    [Trait("SaveScriptRunValuesHandler", "SaveScriptRunValuesCommand")]
    [Fact(DisplayName = "OK o lugar é como o do script: sem conexão não há banco, e o banco vazio é o da conexão")]
    public async Task Handle_PlaceLikeTheScript()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();

        //Act
        var withoutConnection = await SendAsync(new SaveScriptRunValuesCommand { ID = Guid.CreateVersion7(), Values = Json("""{"x":{"type":"null","value":null}}"""), Database = "vendas" });
        var emptyDatabase = await SendAsync(new SaveScriptRunValuesCommand { ID = Guid.CreateVersion7(), Values = Json("{}"), ConnectionID = connectionID, Database = "" });

        //Assert
        Assert.Equal((null, null), (withoutConnection!.ConnectionID, withoutConnection.Database));
        Assert.Equal((connectionID, null), (emptyDatabase!.ConnectionID, emptyDatabase.Database));
        Assert.Equal("{}", emptyDatabase.Values.GetRawText());
    }

    [Trait("SaveScriptRunValuesHandler", "SaveScriptRunValuesCommand")]
    [Fact(DisplayName = "OK o mapa vazio sem conexão esquece os valores")]
    public async Task Handle_EmptyWithoutConnection_Forgets()
    {
        //Act
        var sent = await SendAsync(new SaveScriptRunValuesCommand { ID = Guid.CreateVersion7(), Values = Json("{}"), Database = "vendas" });

        //Assert
        Assert.Null(sent);
        _repository.Verify(r => r.SaveRunValues(It.IsAny<Guid>(), null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Trait("SaveScriptRunValuesValidator", "Validate")]
    [Fact(DisplayName = "Erro a recusa vem com SCRIPT_RUN_VALUES_INVALID no campo")]
    public void Validator_RefusesOnTheField()
    {
        //Act
        var result = new SaveScriptRunValuesValidator().Validate(new SaveScriptRunValuesCommand { Values = Json("""{"x":{"type":"integer","value":"7"}}""") });
        var missing = new SaveScriptRunValuesValidator().Validate(new SaveScriptRunValuesCommand());

        //Assert
        var failure = Assert.Single(result.Errors);
        Assert.Equal(("values.x.type", "SCRIPT_RUN_VALUES_INVALID"), (failure.PropertyName, failure.ErrorCode));
        Assert.Equal(["values"], missing.Errors.Select(error => error.PropertyName));
        Assert.True(new SaveScriptRunValuesValidator().Validate(new SaveScriptRunValuesCommand { Values = Json("{}") }).IsValid);
    }

    [Trait("ScriptRepository", "SaveRunValues")]
    [Fact(DisplayName = "OK troca os valores só no registro do script, sem mudar a data de alteração")]
    public async Task SaveRunValues_ShouldChangeOnlyTheScript()
    {
        //Arrange
        var other = VaultFakers.CreateScript(name: "outro") with { RunValues = RunValues() };
        var script = VaultFakers.CreateScript(name: "relatório");
        var repository = CreateRepository(Document(other, script));
        var runValues = RunValues("""{"y":{"type":"text","value":"a"}}""");

        //Act
        var result = await repository.SaveRunValues(script.ID, runValues, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([other, script with { RunValues = runValues }], _saved!.Scripts);
        Assert.Equal(script.UpdatedAt, _saved.Scripts[1].UpdatedAt);
    }

    [Trait("ScriptRepository", "SaveRunValues")]
    [Fact(DisplayName = "OK nulo esquece os valores")]
    public async Task SaveRunValues_Null_Forgets()
    {
        //Arrange
        var script = VaultFakers.CreateScript() with { RunValues = RunValues() };
        var repository = CreateRepository(Document(script));

        //Act
        var result = await repository.SaveRunValues(script.ID, null, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(Assert.Single(_saved!.Scripts).RunValues);
    }

    [Trait("ScriptRepository", "SaveRunValues")]
    [Fact(DisplayName = "Erro o script que não existe responde 404 SCRIPT_NOT_FOUND")]
    public async Task SaveRunValues_NotFound_Returns404()
    {
        //Arrange
        var repository = CreateRepository(Document(VaultFakers.CreateScript()));

        //Act
        var result = await repository.SaveRunValues(Guid.CreateVersion7(), RunValues(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal((HttpStatusCode.NotFound, "SCRIPT_NOT_FOUND"), (result.Error.StatusCode, result.Error.Type));
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "OK alterar o script (o nome, o SQL, o lugar, a pasta) não esquece os valores lembrados")]
    public async Task Update_ShouldKeepTheRunValues()
    {
        //Arrange
        var runValues = RunValues();
        var script = VaultFakers.CreateScript(name: "relatório") with { RunValues = runValues };
        var repository = CreateRepository(Document(script));

        //Act
        var result = await repository.Update(script.ID, current => current.Change("fechamento", "let x = 1\nSELECT @x", Guid.CreateVersion7(), null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        var saved = Assert.Single(_saved!.Scripts);
        Assert.Equal(("fechamento", "let x = 1\nSELECT @x"), (saved.Name, saved.Sql));
        Assert.Same(runValues, saved.RunValues);
    }

    [Trait("ScriptRepository", "Delete")]
    [Fact(DisplayName = "OK excluir o script exclui os valores lembrados, que estão no registro dele")]
    public async Task Delete_ShouldRemoveTheRunValues()
    {
        //Arrange
        var script = VaultFakers.CreateScript() with { RunValues = RunValues() };
        var repository = CreateRepository(Document(script));

        //Act
        var result = await repository.Delete(script.ID, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(_saved!.Scripts);
    }

    [Trait("GetScriptHandler", "GetScriptCommand")]
    [Fact(DisplayName = "OK o item traz o runValues como foi gravado, e nulo no script sem eles")]
    public async Task GetScript_ShouldCarryTheRunValues()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var values = """{"x":{"type":"number","value":"7"}}""";
        var remembered = VaultFakers.CreateScript() with { RunValues = new VaultScriptRunValuesRecord(Json(values), connectionID, "vendas", Now) };
        var plain = VaultFakers.CreateScript();
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document(remembered, plain)));
        var handler = new GetScriptHandler(_vault.Object);

        //Act
        var withValues = await handler.Handle(new GetScriptCommand(remembered.ID), CancellationToken.None);
        var withoutValues = await handler.Handle(new GetScriptCommand(plain.ID), CancellationToken.None);

        //Assert
        var runValues = withValues.Value.RunValues;
        Assert.NotNull(runValues);
        Assert.Equal((values, connectionID, "vendas", Now), (runValues.Values.GetRawText(), runValues.ConnectionID, runValues.Database, runValues.SavedAt));
        Assert.Null(withoutValues.Value.RunValues);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(withValues.Value, JsonSerializerOptions.Web));
        Assert.Equal(["values", "connectionID", "database", "savedAt"], json.RootElement.GetProperty("runValues").EnumerateObject().Select(property => property.Name));
        Assert.Equal(values, json.RootElement.GetProperty("runValues").GetProperty("values").GetRawText());
    }

    [Trait("GetScriptsHandler", "GetScriptsCommand")]
    [Fact(DisplayName = "OK a lista traz o declaresVariables calculado pelo SQL")]
    public async Task GetScripts_ShouldCarryDeclaresVariables()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(Document(
            VaultFakers.CreateScript(name: "a", sql: "-- filtro\nlet x = 1\nSELECT @x"),
            VaultFakers.CreateScript(name: "b", sql: "SELECT 1"))));

        //Act
        var result = await new GetScriptsHandler(_vault.Object).Handle(new GetScriptsCommand(), CancellationToken.None);

        //Assert
        Assert.Equal([true, false], result.Value.Select(script => script.DeclaresVariables));
    }

    [Trait("ScriptMappings", "ToSummaryDto")]
    [Fact(DisplayName = "OK a resposta de criar e de alterar leva o declaresVariables como a lista")]
    public void ToSummaryDto_FromTheDomain_ShouldCarryDeclaresVariables()
    {
        //Assert
        Assert.True(Script.Create("a", "const n = 1\nSELECT @n", null, null, null, Now).ToSummaryDto().DeclaresVariables);
        Assert.False(Script.Create("b", "SELECT 1", null, null, null, Now).ToSummaryDto().DeclaresVariables);
    }

    [Trait("ScriptRunValues", "ToString")]
    [Fact(DisplayName = "OK o command, o DTO e o registro escrevem só o nome do tipo (RN-VAR-036)")]
    public void ToString_ShouldBeTheTypeName()
    {
        //Arrange
        var values = Json("""{"senha":{"type":"text","value":"segredo"}}""");

        //Assert
        Assert.Equal(nameof(SaveScriptRunValuesCommand), new SaveScriptRunValuesCommand { Values = values }.ToString());
        Assert.Equal(nameof(ScriptRunValuesDto), new ScriptRunValuesDto(values, null, null, Now).ToString());
        Assert.Equal(nameof(VaultScriptRunValuesRecord), new VaultScriptRunValuesRecord(values, null, null, Now).ToString());
    }
}
