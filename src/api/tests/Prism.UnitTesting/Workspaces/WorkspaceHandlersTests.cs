using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Workspaces.Domain;
using Prism.Application.Workspaces.Features.GetWorkspace;
using Prism.Application.Workspaces.Repositories;
using Prism.Application.Workspaces.Features.SaveWorkspace;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Prism.TestingCore.Fakers.Workspaces;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Workspaces;

/// <summary>
/// Os handlers de `api/user/workspace` (seção 24, RN-ABAS-006): a leitura devolve as abas gravadas na ordem e a ativa (a lista vazia e o índice nulo quando
/// nada foi gravado), a gravação entrega ao repository a área de trabalho do domínio, e o log das duas registra só a contagem de abas, nunca o SQL nem os nomes.
/// </summary>
public sealed class WorkspaceHandlersTests
{
    private readonly Mock<IVaultService> _vault = new();
    private readonly Mock<IWorkspaceRepository> _repository = new();
    private readonly CollectingSink _sink = new();

    private ILogger Logger()
        => new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(_sink).CreateLogger();

    private void SetWorkspace(VaultWorkspaceRecord workspace)
        => _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(new VaultDocument("marina.costa", [], [], [], workspace, [])));

    [Trait("GetWorkspaceHandler", "GetWorkspaceCommand")]
    [Fact(DisplayName = "OK as abas gravadas voltam na ordem, com a ativa, e cada uma com os campos dela")]
    public async Task GetWorkspace_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var scriptID = Guid.CreateVersion7();
        SetWorkspace(VaultFakers.CreateWorkspace(1, VaultFakers.CreateTableTab(connectionID: connectionID, database: "vendas", view: "diagram"), VaultFakers.CreateQueryTab(connectionID: connectionID, sql: "SELECT 'a'", scriptID: scriptID, dirty: true, resultPlace: "window")));

        //Act
        var result = await new GetWorkspaceHandler(_vault.Object, Logger()).Handle(new GetWorkspaceCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.ActiveIndex);
        Assert.Equal(["table", "query"], result.Value.Tabs.Select(tab => tab.Kind));
        var (table, query) = (result.Value.Tabs[0], result.Value.Tabs[1]);
        Assert.Equal((connectionID, "vendas", "loja", "clientes", "diagram"), (table.ConnectionID, table.Database, table.Schema, table.Table, table.View));
        Assert.Equal((connectionID, "SELECT 'a'", scriptID, true, false, "window"), (query.ConnectionID, query.Sql, query.ScriptID, query.Dirty, query.SqlTooLarge, query.ResultPlace));
        Assert.Null(table.ResultPlace);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Value, JsonSerializerOptions.Web));
        Assert.Equal(["tabs", "activeIndex"], json.RootElement.EnumerateObject().Select(property => property.Name));
        Assert.Equal(["kind", "connectionID", "database", "sql", "scriptID", "dirty", "sqlTooLarge", "schema", "table", "view", "resultPlace"], json.RootElement.GetProperty("tabs")[0].EnumerateObject().Select(property => property.Name));
    }

    /// <summary>RN-ABAS-016 e a seção 24: a aba de consulta gravada antes da 0.5.0 não tem o lugar do resultado, e volta no painel; a de tabela, sem lugar.</summary>
    [Trait("GetWorkspaceHandler", "GetWorkspaceCommand")]
    [Fact(DisplayName = "OK a aba de consulta gravada sem o lugar do resultado volta no painel, e a de tabela, sem lugar")]
    public async Task GetWorkspace_TabSavedWithoutTheResultPlace_ComesBackInThePanel()
    {
        //Arrange
        SetWorkspace(VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(sql: "SELECT 1", resultPlace: null), VaultFakers.CreateTableTab(), VaultFakers.CreateQueryTab(sql: "SELECT 2", resultPlace: "tab")));

        //Act
        var result = await new GetWorkspaceHandler(_vault.Object, Logger()).Handle(new GetWorkspaceCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(["panel", null, "tab"], result.Value.Tabs.Select(tab => tab.ResultPlace));
    }

    [Trait("GetWorkspaceHandler", "GetWorkspaceCommand")]
    [Fact(DisplayName = "OK nada gravado responde a lista vazia e o índice nulo")]
    public async Task GetWorkspace_NothingSaved_ReturnsAnEmptyList()
    {
        //Arrange
        SetWorkspace(VaultWorkspaceRecord.Empty);

        //Act
        var result = await new GetWorkspaceHandler(_vault.Object, Logger()).Handle(new GetWorkspaceCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value.Tabs);
        Assert.Null(result.Value.ActiveIndex);
    }

    [Trait("GetWorkspaceHandler", "GetWorkspaceCommand")]
    [Fact(DisplayName = "Erro cofre fechado responde 401, e não uma área de trabalho vazia")]
    public async Task GetWorkspace_VaultLocked_Returns401()
    {
        //Arrange
        _vault.Setup(v => v.Read()).Returns(Result.Failure<VaultDocument, EVaultError>(EVaultError.Locked));

        //Act
        var result = await new GetWorkspaceHandler(_vault.Object, Logger()).Handle(new GetWorkspaceCommand(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("SaveWorkspaceHandler", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK entrega ao repository as abas do domínio, na ordem e com a ativa")]
    public async Task SaveWorkspace_ShouldBeOK()
    {
        //Arrange
        Workspace? replaced = null;
        _repository.Setup(r => r.Replace(It.IsAny<Workspace>(), It.IsAny<CancellationToken>())).Callback((Workspace workspace, CancellationToken _) => replaced = workspace).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        var connectionID = Guid.CreateVersion7();
        var command = WorkspaceFakers.ReturnSaveWorkspaceCommandValid([WorkspaceFakers.QueryTab(database: "sem_conexao", sql: "SELECT 1", dirty: true), WorkspaceFakers.TableTab(connectionID: connectionID, schema: "loja", table: "pedidos", view: "structure"), WorkspaceFakers.QueryTab(resultPlace: "tab")], activeIndex: 1);

        //Act
        var result = await new SaveWorkspaceHandler(_repository.Object, Logger()).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(replaced);
        Assert.Equal(1, replaced.ActiveIndex);
        var (query, table) = (replaced.Tabs[0], replaced.Tabs[1]);
        Assert.Equal((WorkspaceTab.QueryKind, null, null, "SELECT 1", false, "panel"), (query.Kind, query.ConnectionID, query.Database, query.Sql, query.Dirty, query.ResultPlace));
        Assert.Equal((WorkspaceTab.TableKind, connectionID, "loja", "pedidos", "structure", null), (table.Kind, table.ConnectionID, table.Schema, table.Table, table.View, table.ResultPlace));
        Assert.Equal("tab", replaced.Tabs[2].ResultPlace);
    }

    [Trait("SaveWorkspaceHandler", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "Erro a recusa do cofre volta como veio")]
    public async Task SaveWorkspace_WhenTheRepositoryRefuses_ReturnsTheError()
    {
        //Arrange
        var locked = ApiErrorDto.CreateUnauthorized("Cofre fechado.", "VAULT_LOCKED", "Entre de novo.");
        _repository.Setup(r => r.Replace(It.IsAny<Workspace>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(locked));

        //Act
        var result = await new SaveWorkspaceHandler(_repository.Object, Logger()).Handle(WorkspaceFakers.ReturnSaveWorkspaceCommandValid(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Same(locked, result.Error);
        Assert.Empty(_sink.Events);
    }

    /// <summary>O log das duas rotas registra só a contagem de abas (seção 24): nem o SQL, nem o banco, nem o esquema, nem a tabela (RN-LOG-001).</summary>
    [Trait("SaveWorkspaceHandler", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK o log da leitura e da gravação leva só a contagem de abas")]
    public async Task Handlers_LogOnlyTheTabCount()
    {
        //Arrange
        _repository.Setup(r => r.Replace(It.IsAny<Workspace>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Success<ApiErrorDto>());
        SetWorkspace(VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(sql: "SELECT 'segredo-lido'"), VaultFakers.CreateTableTab(database: "banco_lido", schema: "esquema_lido", table: "tabela_lida")));
        var command = WorkspaceFakers.ReturnSaveWorkspaceCommandValid([WorkspaceFakers.QueryTab(connectionID: Guid.CreateVersion7(), database: "banco_gravado", sql: "SELECT 'segredo-gravado'"), WorkspaceFakers.TableTab(schema: "esquema_gravado", table: "tabela_gravada"), WorkspaceFakers.QueryTab()]);

        //Act
        await new GetWorkspaceHandler(_vault.Object, Logger()).Handle(new GetWorkspaceCommand(), CancellationToken.None);
        await new SaveWorkspaceHandler(_repository.Object, Logger()).Handle(command, CancellationToken.None);

        //Assert
        Assert.Equal(2, _sink.Events.Count);
        Assert.All(_sink.Events, logged => Assert.Equal(LogEventLevel.Information, logged.Level));
        Assert.Equal(2, ((ScalarValue)_sink.Events[0].Properties["TabCount"]).Value);
        Assert.Equal(3, ((ScalarValue)_sink.Events[1].Properties["TabCount"]).Value);
        foreach (var logged in _sink.Events)
        {
            var rendered = logged.RenderMessage();
            Assert.Equal(["SourceContext", "TabCount"], logged.Properties.Keys.Order(StringComparer.Ordinal));
            foreach (var mark in new[] { "segredo", "banco_", "esquema_", "tabela_" })
                Assert.DoesNotContain(mark, rendered, StringComparison.Ordinal);
        }
    }

    /// <summary>RN-LOG-001: o comando e a aba levam o SQL do usuário.</summary>
    [Trait("SaveWorkspaceCommand", "ToString")]
    [Fact(DisplayName = "OK o comando e a aba não imprimem o texto do SQL")]
    public void ToString_DoesNotPrintTheSql()
    {
        //Arrange
        var command = WorkspaceFakers.ReturnSaveWorkspaceCommandValid([WorkspaceFakers.QueryTab(sql: "SELECT 'segredo'")]);

        //Act
        var printed = $"{command} {command.Tabs[0]} {VaultFakers.CreateQueryTab(sql: "SELECT 'segredo'")} {VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(sql: "SELECT 'segredo'"))}";

        //Assert
        Assert.DoesNotContain("segredo", printed, StringComparison.Ordinal);
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }
}
