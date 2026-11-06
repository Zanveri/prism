using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Application.BuildModels.Features.CreateBuildModel;
using Prism.Application.BuildModels.Features.GetBuildModel;
using Prism.Application.BuildModels.Features.GetBuildModels;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.BuildModels.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Net;

namespace Prism.UnitTesting.BuildModels;

/// <summary>Testes dos handlers de <c>api/user/build-models</c>.</summary>
public sealed class BuildModelHandlersTests
{
    private readonly Mock<IVaultService> _vault = new();
    private readonly Mock<IBuildModelRepository> _repository = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 29, 12, 0, 0, TimeSpan.Zero));

    [Trait("GetBuildModelsHandler", "GetBuildModelsCommand")]
    [Fact(DisplayName = "OK cofre sem o campo BuildModels devolve lista vazia")]
    public async Task ReadVaultWithoutBuildModels_ListsNone()
    {
        //Arrange
        var documentWithoutBuildModels = new VaultDocument("marina.costa", [], [], [], VaultWorkspaceRecord.Empty, []);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(documentWithoutBuildModels));

        //Act
        var result = await new GetBuildModelsHandler(_vault.Object).Handle(new GetBuildModelsCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value);
    }

    [Trait("GetBuildModelHandler", "GetBuildModelCommand")]
    [Fact(DisplayName = "Erro modelo inexistente responde 404 BUILD_MODEL_NOT_FOUND")]
    public async Task GetBuildModel_Missing_Returns404()
    {
        //Arrange
        var document = new VaultDocument("marina.costa", [], [], [], VaultWorkspaceRecord.Empty, []);
        _vault.Setup(v => v.Read()).Returns(Result.Success<VaultDocument, EVaultError>(document));

        //Act
        var result = await new GetBuildModelHandler(_vault.Object).Handle(new GetBuildModelCommand(Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Equal("BUILD_MODEL_NOT_FOUND", result.Error.Type);
    }

    [Trait("CreateBuildModelHandler", "CreateBuildModelCommand")]
    [Fact(DisplayName = "OK cria com nome normalizado e datas do relógio")]
    public async Task CreateBuildModel_ShouldBeOK()
    {
        //Arrange
        BuildModelDto? inserted = null;
        _repository.Setup(r => r.Insert(It.IsAny<BuildModelDto>(), It.IsAny<CancellationToken>()))
            .Callback<BuildModelDto, CancellationToken>((dto, _) => inserted = dto)
            .ReturnsAsync(UnitResult.Success<ApiErrorDto>());

        //Act
        var result = await new CreateBuildModelHandler(_repository.Object, _timeProvider)
            .Handle(new CreateBuildModelCommand { Name = "  manutencao  ", Body = """{"version":1}""" }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(inserted);
        Assert.Equal("manutencao", result.Value.Name);
        Assert.Equal("""{"version":1}""", result.Value.Body);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, result.Value.CreatedAt);
        Assert.Equal(_timeProvider.GetUtcNow().UtcDateTime, result.Value.UpdatedAt);
    }
}
