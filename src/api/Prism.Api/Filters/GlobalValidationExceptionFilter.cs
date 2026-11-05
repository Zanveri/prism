using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Prism.Core.Api.Models.Dtos;
using System.Net;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Api.Filters;

public class GlobalValidationExceptionFilter : IExceptionFilter, IOrderedFilter
{
    /// <summary>Os textos, no idioma do pedido: <c>GlobalValidationExceptionFilter.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GlobalValidationExceptionFilter));

    public int Order => 0;

    public void OnException(ExceptionContext context)
    {
        if (context.Exception is not FluentValidation.ValidationException validationEx)
            return;

        static bool IsSpecificErrorCode(string code)
            => !string.IsNullOrWhiteSpace(code) && code.All(character => char.IsUpper(character) || char.IsDigit(character) || character == '_');

        var type = validationEx.Errors
            .Select(e => e.ErrorCode)
            .FirstOrDefault(IsSpecificErrorCode);

        // Validator sem `WithErrorCode` é defeito de quem o escreveu e tem de aparecer: sem tratar, a
        // exceção cai no 500 `INTERNAL_SERVER_ERROR` com a pilha no log, em vez de virar um código
        // que a tela não conhece (os códigos de erro são só os da seção 6 da especificação).
        if (type is null)
            return;

        var errors = validationEx.Errors
            .GroupBy(e => e.PropertyName)
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());

        var errorCodes = validationEx.Errors
            .Where(e => IsSpecificErrorCode(e.ErrorCode))
            .GroupBy(e => e.PropertyName)
            .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorCode).Distinct().ToArray());

        var extensions = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["errors"] = errors,
            ["errorCodes"] = errorCodes
        };

        context.Result = new UnprocessableEntityObjectResult(ApiErrorDto.Create(type, Texts.Get("Title"), HttpStatusCode.UnprocessableEntity, Texts.Get("Detail"), null, extensions));

        context.ExceptionHandled = true;
    }
}
