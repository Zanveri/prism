using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Prism.Api.Filters;
using Prism.Core.Api.Models.Dtos;

namespace Prism.UnitTesting.Filters;

public sealed class GlobalValidationExceptionFilterTests
{
    private static ExceptionContext ContextFor(Exception exception) => new(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), []) { Exception = exception };

    [Trait("GlobalValidationExceptionFilter", "OnException")]
    [Fact(DisplayName = "OK erro de validação com código específico vira 422 com o código no type")]
    public void OnException_ShouldBeOK_WhenSomeFailureHasASpecificErrorCode()
    {
        //Arrange
        var exception = new ValidationException(
        [
            new ValidationFailure("Name", "O nome é obrigatório.") { ErrorCode = "FOLDER_NAME_INVALID" },
            new ValidationFailure("Name", "O nome passa de 60 caracteres.") { ErrorCode = "FOLDER_NAME_INVALID" },
            new ValidationFailure("ParentID", "A pasta pai é inválida.") { ErrorCode = "NotEmptyValidator" }
        ]);
        var context = ContextFor(exception);

        //Act
        new GlobalValidationExceptionFilter().OnException(context);

        //Assert
        var result = Assert.IsType<UnprocessableEntityObjectResult>(context.Result);
        var error = Assert.IsType<ApiErrorDto>(result.Value);
        var errors = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errors"]);
        var errorCodes = Assert.IsType<Dictionary<string, string[]>>(error.Extensions["errorCodes"]);
        Assert.True(context.ExceptionHandled);
        Assert.Equal(StatusCodes.Status422UnprocessableEntity, result.StatusCode);
        Assert.Equal("FOLDER_NAME_INVALID", error.Type);
        Assert.Equal(["O nome é obrigatório.", "O nome passa de 60 caracteres."], errors["Name"]);
        Assert.Equal(["A pasta pai é inválida."], errors["ParentID"]);
        Assert.Equal(["FOLDER_NAME_INVALID"], Assert.Single(errorCodes).Value);
    }

    [Trait("GlobalValidationExceptionFilter", "OnException")]
    [Fact(DisplayName = "Erro de validação sem código específico não é tratado e segue para o 500")]
    public void OnException_ShouldNotHandle_WhenNoFailureHasASpecificErrorCode()
    {
        //Arrange
        var exception = new ValidationException([new ValidationFailure("Name", "O nome é obrigatório.") { ErrorCode = "NotEmptyValidator" }]);
        var context = ContextFor(exception);

        //Act
        new GlobalValidationExceptionFilter().OnException(context);

        //Assert
        Assert.False(context.ExceptionHandled);
        Assert.Null(context.Result);
    }

    [Trait("GlobalValidationExceptionFilter", "OnException")]
    [Fact(DisplayName = "Exceção que não é de validação não é tratada")]
    public void OnException_ShouldNotHandle_WhenTheExceptionIsNotAValidationException()
    {
        //Arrange
        var context = ContextFor(new InvalidOperationException("falha qualquer"));

        //Act
        new GlobalValidationExceptionFilter().OnException(context);

        //Assert
        Assert.False(context.ExceptionHandled);
        Assert.Null(context.Result);
    }
}
