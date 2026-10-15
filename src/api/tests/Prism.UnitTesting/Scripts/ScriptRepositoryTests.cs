using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Scripts;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// O que o repository entrega ao `SaveAsync` é uma função, e é ela que o serviço roda com o cofre reservado. Estes testes fazem o papel do serviço: rodam
/// a função contra um documento que já tem o que uma requisição concorrente teria gravado, e conferem que a regra vale ali dentro: o nome único sem
/// diferenciar maiúsculas (RN-SCRIPT-004), a existência do script e a alteração feita sobre o registro mais recente, e não sobre o que o handler leu.
/// </summary>
public sealed class ScriptRepositoryTests
{
    private static readonly DateTime Now = new(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);

    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _current;
    private VaultDocument? _saved;

    private static VaultDocument Document(params VaultScriptRecord[] scripts)
        => new("marina.costa", [VaultFakers.CreateFolder()], [VaultFakers.CreateConnection()], scripts, VaultWorkspaceRecord.Empty);

    private static VaultScriptRecord ToRecord(Script script)
        => new(script.ID, script.Name, script.Sql, script.ConnectionID, script.Database, script.CreatedAt, script.UpdatedAt);

    /// <summary>Roda a função do `SaveAsync` contra o documento atual, como o serviço faz, e responde o que o teste mandou (sucesso por padrão).</summary>
    private ScriptRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _current = current;
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new ScriptRepository(_vault.Object);
    }

    [Trait("ScriptRepository", "Insert")]
    [Fact(DisplayName = "OK acrescenta o script ao documento sem mexer no resto")]
    public async Task Insert_ShouldBeOK()
    {
        //Arrange
        var existing = VaultFakers.CreateScript(name: "Relatório");
        var current = Document(existing);
        var script = ScriptFakers.Create(name: "Fechamento", connectionID: Guid.CreateVersion7(), database: "vendas");
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(script, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(_saved);
        Assert.Equal([existing, ToRecord(script)], _saved.Scripts);
        Assert.Same(current.Folders, _saved.Folders);
        Assert.Same(current.Connections, _saved.Connections);
    }

    [Trait("ScriptRepository", "Insert")]
    [Fact(DisplayName = "Erro nome que outro script já tem, com outras maiúsculas, responde 409 e não grava")]
    public async Task Insert_NameTakenIgnoringCase_Returns409()
    {
        //Arrange
        var current = Document(VaultFakers.CreateScript(name: "Fechamento do Mês"));
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ScriptFakers.Create(name: "fechamento do mês"), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Equal("SCRIPT_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptRepository", "Insert")]
    [Fact(DisplayName = "Erro cofre fechado responde 401")]
    public async Task Insert_VaultLocked_Returns401()
    {
        //Arrange
        var repository = CreateRepository(Document(), EVaultError.Locked);

        //Act
        var result = await repository.Insert(ScriptFakers.Create(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "OK a alteração roda sobre o registro do documento mais recente e devolve o script alterado")]
    public async Task Update_ShouldBeOK()
    {
        //Arrange
        var before = VaultFakers.CreateScript(name: "Antes");
        var target = VaultFakers.CreateScript(name: "Relatório", sql: "SELECT 1");
        var after = VaultFakers.CreateScript(name: "Depois");
        var repository = CreateRepository(Document(before, target, after));

        //Act
        var result = await repository.Update(target.ID, script => script.Change(null, "SELECT 2", null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Relatório", result.Value.Name);
        Assert.Equal("SELECT 2", result.Value.Sql);
        Assert.Equal(Now, result.Value.UpdatedAt);
        Assert.NotNull(_saved);
        Assert.Equal([before, target with { Sql = "SELECT 2", UpdatedAt = Now }, after], _saved.Scripts);
    }

    /// <summary>RN-SCRIPT-006: o ícone e a cor vão ao registro do cofre; o registro de antes deles (sem os campos) é lido com os dois nulos.</summary>
    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "OK grava o ícone e a cor no registro do script")]
    public async Task Update_ShouldWriteTheIconAndTheColor()
    {
        //Arrange
        var target = VaultFakers.CreateScript(name: "Relatório", sql: "SELECT 1");
        var repository = CreateRepository(Document(target));

        //Act
        var result = await repository.Update(target.ID, script => script.Change(null, null, null, null, false, "clock", "#5ED3A3", Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("clock", "#5ED3A3"), (result.Value.Icon, result.Value.Color));
        Assert.NotNull(_saved);
        Assert.Equal([target with { Icon = "clock", Color = "#5ED3A3", UpdatedAt = Now }], _saved.Scripts);
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "OK nada mudou: devolve o script e o documento como entrou, sem gravar")]
    public async Task Update_NothingChanged_KeepsTheDocument()
    {
        //Arrange
        var target = VaultFakers.CreateScript(name: "Relatório");
        var current = Document(target);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, script => script.Change("Relatório", target.Sql, null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(target.UpdatedAt, result.Value.UpdatedAt);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "Erro script que não existe responde 404 e não grava")]
    public async Task Update_Missing_Returns404()
    {
        //Arrange
        var current = Document(VaultFakers.CreateScript());
        var repository = CreateRepository(current);
        var id = Guid.CreateVersion7();

        //Act
        var result = await repository.Update(id, script => script.Change("Outro", null, null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_NOT_FOUND", result.Error.Type);
        Assert.Same(current, _saved);
    }

    /// <summary>A corrida: outro script tomou o nome depois de o usuário abrir o "Renomear". Quem recusa é a função, contra o documento que já tem o outro.</summary>
    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "Erro renomear para o nome de outro script responde 409 e não grava")]
    public async Task Update_RenameToATakenName_Returns409()
    {
        //Arrange
        var target = VaultFakers.CreateScript(name: "Relatório");
        var current = Document(target, VaultFakers.CreateScript(name: "Fechamento"));
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, script => script.Change("FECHAMENTO", null, null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Equal("SCRIPT_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "OK renomear o próprio script com outras maiúsculas não é duplicidade")]
    public async Task Update_RenameItselfWithOtherCase_ShouldBeOK()
    {
        //Arrange
        var target = VaultFakers.CreateScript(name: "relatório");
        var repository = CreateRepository(Document(target));

        //Act
        var result = await repository.Update(target.ID, script => script.Change("Relatório", null, null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("Relatório", Assert.Single(_saved!.Scripts).Name);
    }

    [Trait("ScriptRepository", "Update")]
    [Fact(DisplayName = "Erro cofre fechado responde 401")]
    public async Task Update_VaultLocked_Returns401()
    {
        //Arrange
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>())).ReturnsAsync(UnitResult.Failure(EVaultError.Locked));
        var repository = new ScriptRepository(_vault.Object);

        //Act
        var result = await repository.Update(Guid.CreateVersion7(), script => script.Change("Outro", null, null, null, false, null, null, Now), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
    }

    [Trait("ScriptRepository", "Delete")]
    [Fact(DisplayName = "OK tira só o script pedido")]
    public async Task Delete_ShouldBeOK()
    {
        //Arrange
        var keep = VaultFakers.CreateScript();
        var target = VaultFakers.CreateScript();
        var repository = CreateRepository(Document(keep, target));

        //Act
        var result = await repository.Delete(target.ID, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([keep], _saved!.Scripts);
    }

    [Trait("ScriptRepository", "Delete")]
    [Fact(DisplayName = "Erro script que não existe responde 404 e não grava")]
    public async Task Delete_Missing_Returns404()
    {
        //Arrange
        var current = Document(VaultFakers.CreateScript());
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(Guid.CreateVersion7(), CancellationToken.None);

        //Assert
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("SCRIPT_NOT_FOUND", result.Error.Type);
        Assert.Same(_current, _saved);
    }
}
