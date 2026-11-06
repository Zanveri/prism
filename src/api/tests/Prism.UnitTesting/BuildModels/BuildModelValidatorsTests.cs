using FluentValidation.TestHelper;
using Prism.Application.BuildModels.Features.CreateBuildModel;
using Prism.Application.BuildModels.Features.UpdateBuildModel;

namespace Prism.UnitTesting.BuildModels;

/// <summary>
/// Testes dos validadores de modelos do Construir (seção 7 da especificação): nome de 1 a 200 caracteres sem controle, corpo até 4 MB em UTF-8 e objeto JSON.
/// </summary>
public sealed class BuildModelValidatorsTests
{
    private const int FourMegabytes = 4 * 1024 * 1024;

    public static TheoryData<string> InvalidNames()
        => ["", "   ", new string('a', 201), "manutencao\u0001", "manu\ttencao", "manu\ntencao", "manu\rtencao", "\0"];

    public static TheoryData<string> InvalidJsonBodies()
        => ["[]", "1", "{", "", "   ", "null", "\"texto\""];

    [Trait("CreateBuildModelValidator", "CreateBuildModelCommand")]
    [Theory(DisplayName = "Erro nome vazio, de 201 caracteres ou com controle responde BUILD_MODEL_NAME_INVALID")]
    [MemberData(nameof(InvalidNames))]
    public void Validator_RejectsEmptyName_201Characters_ControlCharacter_WithBuildModelNameInvalid(string name)
    {
        //Arrange
        var validator = new CreateBuildModelValidator();
        var command = new CreateBuildModelCommand { Name = name, Body = """{"version":1}""" };

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(c => c.Name).WithErrorCode("BUILD_MODEL_NAME_INVALID");
        result.ShouldNotHaveValidationErrorFor(c => c.Body);
    }

    [Trait("CreateBuildModelValidator", "CreateBuildModelCommand")]
    [Fact(DisplayName = "Erro corpo acima de 4 MB responde BUILD_MODEL_TOO_LARGE")]
    public void Validator_RejectsBodyAbove4MB_WithBuildModelTooLarge()
    {
        //Arrange
        var validator = new CreateBuildModelValidator();
        var command = new CreateBuildModelCommand { Name = "manutencao", Body = new string('x', FourMegabytes + 1) };

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(c => c.Body).WithErrorCode("BUILD_MODEL_TOO_LARGE");
    }

    [Trait("CreateBuildModelValidator", "CreateBuildModelCommand")]
    [Theory(DisplayName = "Erro corpo que não é um objeto JSON responde BUILD_MODEL_BODY_INVALID")]
    [MemberData(nameof(InvalidJsonBodies))]
    public void Validator_RejectsBodyThatIsNotAJsonObject_WithBuildModelBodyInvalid(string body)
    {
        //Arrange
        var validator = new CreateBuildModelValidator();
        var command = new CreateBuildModelCommand { Name = "manutencao", Body = body };

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(c => c.Body).WithErrorCode("BUILD_MODEL_BODY_INVALID");
    }

    [Trait("UpdateBuildModelValidator", "UpdateBuildModelCommand")]
    [Theory(DisplayName = "Erro no PATCH com corpo que não é um objeto JSON responde BUILD_MODEL_BODY_INVALID")]
    [MemberData(nameof(InvalidJsonBodies))]
    public void UpdateValidator_RejectsBodyThatIsNotAJsonObject_WithBuildModelBodyInvalid(string body)
    {
        //Arrange
        var validator = new UpdateBuildModelValidator();
        var command = new UpdateBuildModelCommand { ID = Guid.CreateVersion7(), Body = body, ExpectedUpdatedAt = DateTime.UtcNow };

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(c => c.Body).WithErrorCode("BUILD_MODEL_BODY_INVALID");
    }
}
