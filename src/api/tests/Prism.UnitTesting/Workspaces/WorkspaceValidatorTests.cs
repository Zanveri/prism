using FluentValidation.TestHelper;
using Prism.Application.Workspaces.Features.SaveWorkspace;
using Prism.Application.Workspaces.Models.Dtos;
using Prism.TestingCore.Fakers.Workspaces;

namespace Prism.UnitTesting.Workspaces;

/// <summary>
/// RN-ABAS-006 e a tabela de rotas da seção 24: o `PUT api/user/workspace` recusa com 422 `WORKSPACE_INVALID` a lista que não tem a forma de abas de consulta e
/// de tabela, ou cujo índice da aba ativa está fora dela, e com 422 `WORKSPACE_TOO_LARGE` o texto de uma aba acima de 1 MB (RN-SCRIPT-004: 1.048.576 bytes de
/// UTF-8, a mesma conta da tela e dos scripts).
/// </summary>
public sealed class WorkspaceValidatorTests
{
    private const int OneMegabyte = 1024 * 1024;

    private static SaveWorkspaceCommand With(params WorkspaceTabDto[] tabs)
        => WorkspaceFakers.ReturnSaveWorkspaceCommandValid(tabs);

    public static TheoryData<string, WorkspaceTabDto> TabsWithoutTheirShape()
        => new()
        {
            { "tipo desconhecido", WorkspaceFakers.QueryTab() with { Kind = "grafico" } },
            { "tipo vazio", WorkspaceFakers.QueryTab() with { Kind = "" } },
            { "tipo em maiúsculas", WorkspaceFakers.QueryTab() with { Kind = "QUERY" } },
            { "consulta sem o texto", WorkspaceFakers.QueryTab() with { Sql = null } },
            { "consulta com a tabela", WorkspaceFakers.QueryTab() with { Schema = "loja", Table = "clientes", View = "data" } },
            { "consulta com só a vista", WorkspaceFakers.QueryTab() with { View = "data" } },
            { "texto grande demais que veio junto", WorkspaceFakers.QueryTab(sql: "SELECT 1", sqlTooLarge: true) },
            { "tabela sem conexão", WorkspaceFakers.TableTab() with { ConnectionID = null } },
            { "tabela sem esquema", WorkspaceFakers.TableTab() with { Schema = null } },
            { "tabela sem nome", WorkspaceFakers.TableTab() with { Table = null } },
            { "tabela de nome vazio", WorkspaceFakers.TableTab(table: "") },
            { "tabela de nome longo demais", WorkspaceFakers.TableTab(table: new string('t', 1025)) },
            { "esquema longo demais", WorkspaceFakers.TableTab(schema: new string('e', 1025)) },
            { "vista desconhecida", WorkspaceFakers.TableTab(view: "grade") },
            { "tabela sem vista", WorkspaceFakers.TableTab() with { View = null } },
            { "tabela com texto", WorkspaceFakers.TableTab() with { Sql = "SELECT 1" } },
            { "tabela com script", WorkspaceFakers.TableTab() with { ScriptID = Guid.CreateVersion7() } },
            { "tabela com mudança não salva", WorkspaceFakers.TableTab() with { Dirty = true } },
            { "tabela com texto grande demais", WorkspaceFakers.TableTab() with { SqlTooLarge = true } },
            { "banco vazio", WorkspaceFakers.QueryTab(connectionID: Guid.CreateVersion7(), database: "") },
            { "banco longo demais", WorkspaceFakers.TableTab(database: new string('b', 129)) },
            { "banco com caractere de controle", WorkspaceFakers.QueryTab(connectionID: Guid.CreateVersion7(), database: "ven\ndas") },
        };

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK abas de consulta e de tabela, com e sem conexão, banco e script, e a ativa na lista")]
    public void Save_ShouldBeOK()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();
        var command = WorkspaceFakers.ReturnSaveWorkspaceCommandValid(
        [
            WorkspaceFakers.QueryTab(),
            WorkspaceFakers.QueryTab(connectionID: Guid.CreateVersion7(), database: "vendas", scriptID: Guid.CreateVersion7(), dirty: true),
            WorkspaceFakers.TableTab(view: "structure"),
            WorkspaceFakers.TableTab(database: new string('b', 128), schema: "", view: "diagram"),
        ], activeIndex: 3);

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK sem abas e sem aba ativa, e o corpo vazio também")]
    public void Save_WithoutTabs_ShouldBeOK()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();

        //Act
        var empty = validator.TestValidate(WorkspaceFakers.ReturnSaveWorkspaceCommandValid([]));
        var body = validator.TestValidate(new SaveWorkspaceCommand());

        //Assert
        empty.ShouldNotHaveAnyValidationErrors();
        body.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK texto de exatamente 1 MB, texto vazio, e a aba cujo texto passou de 1 MB, que vem vazia e marcada")]
    public void Save_AtTheLimit_ShouldBeOK()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();
        var command = With(WorkspaceFakers.QueryTab(sql: new string('a', OneMegabyte)), WorkspaceFakers.QueryTab(sql: ""), WorkspaceFakers.QueryTab(sql: "", sqlTooLarge: true));

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "Erro texto de uma aba acima de 1 MB em bytes de UTF-8 responde WORKSPACE_TOO_LARGE")]
    public void Save_SqlAboveOneMegabyte_ReturnsWorkspaceTooLarge()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();
        // 524.288 caracteres de dois bytes são 1 MB exato; um a mais passa do limite, com menos de 1.048.576 caracteres.
        var command = With(WorkspaceFakers.QueryTab(), WorkspaceFakers.QueryTab(sql: new string('é', (OneMegabyte / 2) + 1)));

        //Act
        var result = validator.TestValidate(command);

        //Assert
        var error = Assert.Single(result.Errors);
        Assert.Equal("WORKSPACE_TOO_LARGE", error.ErrorCode);
        Assert.Equal("Tabs[1].Sql", error.PropertyName);
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Theory(DisplayName = "Erro aba sem a forma de uma aba de consulta ou de tabela responde WORKSPACE_INVALID")]
    [MemberData(nameof(TabsWithoutTheirShape))]
    public void Save_TabWithoutItsShape_ReturnsWorkspaceInvalid(string why, WorkspaceTabDto tab)
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();

        //Act
        var result = validator.TestValidate(With(WorkspaceFakers.QueryTab(), tab));

        //Assert
        Assert.NotEmpty(result.Errors);
        Assert.All(result.Errors, error => Assert.Equal("WORKSPACE_INVALID", error.ErrorCode));
        Assert.All(result.Errors, error => Assert.StartsWith("Tabs[1]", error.PropertyName, StringComparison.Ordinal));
        Assert.False(string.IsNullOrEmpty(why));
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "Erro aba nula na lista responde WORKSPACE_INVALID")]
    public void Save_NullTab_ReturnsWorkspaceInvalid()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();

        //Act
        var result = validator.TestValidate(new SaveWorkspaceCommand { Tabs = [WorkspaceFakers.QueryTab(), null!], ActiveIndex = 0 });

        //Assert
        var error = Assert.Single(result.Errors);
        Assert.Equal("WORKSPACE_INVALID", error.ErrorCode);
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Theory(DisplayName = "Erro índice da aba ativa fora da lista responde WORKSPACE_INVALID")]
    [InlineData(2, -1)]
    [InlineData(2, 2)]
    [InlineData(2, 50)]
    [InlineData(0, 0)]
    public void Save_ActiveIndexOutsideTheList_ReturnsWorkspaceInvalid(int count, int activeIndex)
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();
        var tabs = Enumerable.Range(0, count).Select(_ => WorkspaceFakers.QueryTab()).ToList();

        //Act
        var result = validator.TestValidate(WorkspaceFakers.ReturnSaveWorkspaceCommandValid(tabs, activeIndex));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.ActiveIndex).WithErrorCode("WORKSPACE_INVALID");
    }

    [Trait("SaveWorkspaceValidator", "SaveWorkspaceCommand")]
    [Fact(DisplayName = "OK abas sem aba ativa (a tela ainda não escolheu uma)")]
    public void Save_TabsWithoutActiveIndex_ShouldBeOK()
    {
        //Arrange
        var validator = new SaveWorkspaceValidator();

        //Act
        var result = validator.TestValidate(new SaveWorkspaceCommand { Tabs = [WorkspaceFakers.QueryTab()], ActiveIndex = null });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }
}
