using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.ScriptFolders.Domain;
using Prism.Application.ScriptFolders.Features.CreateScriptFolder;
using Prism.Application.ScriptFolders.Features.DeleteScriptFolder;
using Prism.Application.ScriptFolders.Features.GetScriptFolders;
using Prism.Application.ScriptFolders.Features.UpdateScriptFolder;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.ScriptFolders;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.ScriptFolders;

/// <summary>
/// Os handlers das rotas `api/user/script-folders` (seção 33): a lista de todos os níveis, em ordem de nome; criar, alterar e excluir pelo repository, sem
/// leitura antes. O log leva os IDs e as contagens, nunca o nome (RN-LOG-001).
/// </summary>
public sealed class ScriptFolderHandlersTests
{
    private readonly Mock<IVaultService> _vault = new();
    private readonly Mock<IScriptFolderRepository> _repository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 16, 12, 0, 0, TimeSpan.Zero));
    private readonly CollectingSink _sink = new();

    private ILogger Logger
        => new LoggerConfiguration().WriteTo.Sink(_sink).CreateLogger();

    private void SetDocument(params VaultScriptFolderRecord[] folders)
        => _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [], [], VaultWorkspaceRecord.Empty, folders)));

    [Trait("GetScriptFoldersHandler", "GetScriptFoldersCommand")]
    [Fact(DisplayName = "OK a lista traz as pastas de todos os níveis, em ordem de nome, sem diferenciar maiúsculas, com a pasta pai")]
    public async Task GetScriptFolders_ShouldBeOK()
    {
        //Arrange
        var beta = VaultFakers.CreateScriptFolder(name: "beta");
        var alfa = VaultFakers.CreateScriptFolder(name: "Alfa", parentID: beta.ID);
        var gama = VaultFakers.CreateScriptFolder(name: "Gama");
        SetDocument(beta, gama, alfa);

        //Act
        var result = await new GetScriptFoldersHandler(_vault.Object, Logger).Handle(new GetScriptFoldersCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(["Alfa", "beta", "Gama"], result.Value.Select(folder => folder.Name));
        Assert.Equal((alfa.ID, beta.ID, alfa.CreatedAt, alfa.UpdatedAt), (result.Value[0].ID, result.Value[0].ParentID, result.Value[0].CreatedAt, result.Value[0].UpdatedAt));
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Value, JsonSerializerOptions.Web));
        Assert.Equal(["id", "parentID", "name", "createdAt", "updatedAt"], json.RootElement[0].EnumerateObject().Select(property => property.Name));
        var logged = Assert.Single(_sink.Events).RenderMessage();
        Assert.Contains("3", logged);
        Assert.DoesNotContain("Alfa", logged);
    }

    [Trait("GetScriptFoldersHandler", "GetScriptFoldersCommand")]
    [Fact(DisplayName = "Erro cofre fechado responde 401, e não uma lista vazia")]
    public async Task GetScriptFolders_VaultLocked_Returns401()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var result = await new GetScriptFoldersHandler(_vault.Object, Logger).Handle(new GetScriptFoldersCommand(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("CreateScriptFolderHandler", "CreateScriptFolderCommand")]
    [Fact(DisplayName = "OK cria a pasta com o nome normalizado e a data do relógio, e devolve a pasta")]
    public async Task CreateScriptFolder_ShouldBeOK()
    {
        //Arrange
        var parentID = Guid.CreateVersion7();
        ScriptFolder? inserted = null;
        _repository.Setup(r => r.Insert(It.IsAny<ScriptFolder>(), It.IsAny<CancellationToken>())).Callback((ScriptFolder folder, CancellationToken _) => inserted = folder).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var handler = new CreateScriptFolderHandler(_repository.Object, _timeProvider, Logger);

        //Act
        var result = await handler.Handle(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: "  Fechamento   do mês ", parentID: parentID), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal((inserted.ID, parentID, "Fechamento do mês", _timeProvider.GetUtcNow().UtcDateTime), (result.Value.ID, result.Value.ParentID, result.Value.Name, result.Value.CreatedAt));
        var logged = Assert.Single(_sink.Events).RenderMessage();
        Assert.Contains(inserted.ID.ToString(), logged);
        Assert.DoesNotContain("Fechamento", logged);
    }

    [Trait("CreateScriptFolderHandler", "CreateScriptFolderCommand")]
    [Fact(DisplayName = "Erro a recusa do repository volta como veio")]
    public async Task CreateScriptFolder_Refused_ReturnsTheRefusal()
    {
        //Arrange
        var refusal = ApiErrorDto.CreateConflict("Pasta já existe.", "SCRIPT_FOLDER_ALREADY_EXISTS", "Já existe uma pasta chamada Fechamento na raiz da seção Scripts.");
        _repository.Setup(r => r.Insert(It.IsAny<ScriptFolder>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(refusal));
        var handler = new CreateScriptFolderHandler(_repository.Object, _timeProvider, Logger);

        //Act
        var result = await handler.Handle(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: "Fechamento"), CancellationToken.None);

        //Assert
        Assert.Same(refusal, result.Error);
        Assert.Empty(_sink.Events);
    }

    /// <summary>O handler não lê nada antes: a alteração roda sobre a pasta que o repository achou no documento mais recente, com o nome e a pasta pai do corpo.</summary>
    [Trait("UpdateScriptFolderHandler", "UpdateScriptFolderCommand")]
    [Fact(DisplayName = "OK a alteração leva o nome e a pasta pai do corpo, com a data do relógio")]
    public async Task UpdateScriptFolder_ShouldBeOK()
    {
        //Arrange
        var stored = ScriptFolderFakers.Create(name: "Mensal", parentID: Guid.CreateVersion7());
        _repository.Setup(r => r.Update(stored.ID, It.IsAny<Func<ScriptFolder, bool>>(), It.IsAny<CancellationToken>()))
            .Returns((Guid _, Func<ScriptFolder, bool> change, CancellationToken _) =>
            {
                change(stored);

                return Task.FromResult(Result.Success<ScriptFolder, ApiErrorDto>(stored));
            });
        var handler = new UpdateScriptFolderHandler(_repository.Object, _timeProvider, Logger);

        //Act
        var result = await handler.Handle(ScriptFolderFakers.ReturnUpdateScriptFolderCommandValid(iD: stored.ID, name: "Mensal 2026"), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("Mensal 2026", (Guid?)null, _timeProvider.GetUtcNow().UtcDateTime), (result.Value.Name, result.Value.ParentID, result.Value.UpdatedAt));
        Assert.DoesNotContain("Mensal", Assert.Single(_sink.Events).RenderMessage());
    }

    [Trait("DeleteScriptFolderHandler", "DeleteScriptFolderCommand")]
    [Fact(DisplayName = "OK a exclusão é do repository, e o log leva o ID")]
    public async Task DeleteScriptFolder_ShouldBeOK()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        _repository.Setup(r => r.Delete(id, It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Success<ApiErrorDto>());

        //Act
        var result = await new DeleteScriptFolderHandler(_repository.Object, Logger).Handle(new DeleteScriptFolderCommand(id), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Contains(id.ToString(), Assert.Single(_sink.Events).RenderMessage());
    }

    /// <summary>A pasta que não está vazia: a recusa volta como veio, e o log leva o ID e as contagens, sem o nome que o detalhe tem.</summary>
    [Trait("DeleteScriptFolderHandler", "DeleteScriptFolderCommand")]
    [Fact(DisplayName = "Erro a pasta que não está vazia volta com as contagens, e o log as leva sem o nome")]
    public async Task DeleteScriptFolder_NotEmpty_LogsTheCounts()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        var refusal = ApiErrorDto.Create("SCRIPT_FOLDER_NOT_EMPTY", "Pasta não está vazia.", HttpStatusCode.Conflict, "A pasta Fechamento tem 2 subpastas e 3 scripts. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela.", null, new Dictionary<string, object?> { ["folders"] = 2, ["scripts"] = 3 });
        _repository.Setup(r => r.Delete(id, It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(refusal));

        //Act
        var result = await new DeleteScriptFolderHandler(_repository.Object, Logger).Handle(new DeleteScriptFolderCommand(id), CancellationToken.None);

        //Assert
        Assert.Same(refusal, result.Error);
        var logged = Assert.Single(_sink.Events).RenderMessage();
        Assert.Contains(id.ToString(), logged);
        Assert.Contains("2 subpastas e 3 scripts", logged);
        Assert.DoesNotContain("Fechamento", logged);
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }
}
