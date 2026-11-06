using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.BuildModels.Repositories;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.BuildModels;

/// <summary>
/// Testes de unidade de <see cref="BuildModelRepository"/>: unicidade do nome sem diferenciar maiúsculas, controle de concorrência por
/// <c>expectedUpdatedAt</c> (409 <c>BUILD_MODEL_CHANGED</c>) e leitura/gravação quando <c>BuildModels</c> ainda é nulo no documento do cofre.
/// </summary>
public sealed class BuildModelRepositoryTests
{
    private static readonly DateTime Created = new(2026, 10, 29, 10, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 10, 29, 12, 0, 0, DateTimeKind.Utc);

    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _saved;

    private static VaultDocument Document(params VaultBuildModelRecord[] models)
        => new("marina.costa", [VaultFakers.CreateFolder()], [VaultFakers.CreateConnection()], [], VaultWorkspaceRecord.Empty, [], BuildModels: models);

    private static VaultBuildModelRecord Record(string name = "manutencao", string body = """{"version":1}""", DateTime? updatedAt = null)
        => new(Guid.CreateVersion7(), name, body, Created, updatedAt ?? Created);

    private BuildModelRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new BuildModelRepository(_vault.Object);
    }

    [Trait("BuildModelRepository", "Insert")]
    [Fact(DisplayName = "Erro nome de outro modelo com outras maiúsculas responde 409 BUILD_MODEL_ALREADY_EXISTS e não grava")]
    public async Task Create_WithNameOfAnotherModelInOtherCase_Fails409BuildModelAlreadyExists()
    {
        //Arrange
        var current = Document(Record(name: "Manutenção Industrial"));
        var repository = CreateRepository(current);
        var model = new BuildModelDto
        {
            ID = Guid.CreateVersion7(),
            Name = "manutenção industrial",
            Body = """{"version":1}""",
            CreatedAt = Now,
            UpdatedAt = Now,
        };

        //Act
        var result = await repository.Insert(model, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Equal("BUILD_MODEL_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("BuildModelRepository", "Update")]
    [Fact(DisplayName = "Erro expectedUpdatedAt antigo responde 409 BUILD_MODEL_CHANGED e não grava")]
    public async Task Update_WithStaleExpectedUpdatedAt_Fails409BuildModelChanged()
    {
        //Arrange
        var target = Record(name: "manutencao", updatedAt: Created.AddMinutes(5));
        var current = Document(target);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(target.ID, null, """{"version":1,"tables":[]}""", Created, Now, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Equal("BUILD_MODEL_CHANGED", result.Error.Type);
        Assert.Same(current, _saved);
    }

    [Trait("BuildModelRepository", "Update")]
    [Fact(DisplayName = "OK expectedUpdatedAt igual ao do cofre grava o corpo e avança UpdatedAt")]
    public async Task Update_WithCurrentExpectedUpdatedAt_SavesBodyAndBumpsUpdatedAt()
    {
        //Arrange
        var target = Record(name: "manutencao", body: """{"version":1}""", updatedAt: Created);
        var current = Document(target);
        var repository = CreateRepository(current);
        const string nextBody = """{"version":1,"engine":"postgresql"}""";

        //Act
        var result = await repository.Update(target.ID, "  manutencao 2  ", nextBody, Created, Now, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("manutencao 2", result.Value.Name);
        Assert.Equal(nextBody, result.Value.Body);
        Assert.Equal(Now, result.Value.UpdatedAt);
        Assert.NotNull(_saved);
        Assert.Equal([target with { Name = "manutencao 2", Body = nextBody, UpdatedAt = Now }], _saved.BuildModels);
    }
}
