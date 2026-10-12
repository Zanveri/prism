using Microsoft.AspNetCore.Mvc;
using System.Net;
using System.Text.Json.Serialization;

namespace Prism.Core.Api.Models.Dtos;

public sealed class ApiErrorDto : ProblemDetails
{
    [JsonIgnore]
    public HttpStatusCode StatusCode { get; private set; }

    private ApiErrorDto(string? type, string title, HttpStatusCode status, string? detail, string? instance, IDictionary<string, object?>? extensions)
    {
        Type = type;
        Title = title;
        Status = (int)status;
        Detail = detail;
        Instance = instance;
        Extensions = extensions is null ? new Dictionary<string, object?>(StringComparer.Ordinal) : extensions;
        StatusCode = status;
    }

    public static ApiErrorDto CreateBadRequest(string title, string type, string details)
        => new(type, title, HttpStatusCode.BadRequest, details, null, null);

    public static ApiErrorDto CreateInternalServerError(string details)
        => new("INTERNAL_SERVER_ERROR", "Erro interno do servidor.", HttpStatusCode.InternalServerError, details, null, null);

    /// <summary>Identidade ausente ou inválida.</summary>
    public static ApiErrorDto CreateUnauthorized(string title, string type, string details)
        => new(type, title, HttpStatusCode.Unauthorized, details, null, null);

    /// <summary>Identidade válida, permissão insuficiente.</summary>
    public static ApiErrorDto CreateForbidden(string title, string type, string details)
        => new(type, title, HttpStatusCode.Forbidden, details, null, null);

    public static ApiErrorDto CreateNotFound(string title, string type, string details)
        => new(type, title, HttpStatusCode.NotFound, details, null, null);

    public static ApiErrorDto CreateConflict(string title, string type, string details)
        => new(type, title, HttpStatusCode.Conflict, details, null, null);

    public static ApiErrorDto CreateUnprocessableEntity(string title, string type, string details, IDictionary<string, object?>? extensions = null)
        => new(type, title, HttpStatusCode.UnprocessableEntity, details, null, extensions);

    /// <summary>
    /// 422 de uma regra de negócio que a tela mostra no CAMPO, na forma do filtro de validação (`errors` e `errorCodes` por campo, com o nome da propriedade em PascalCase,
    /// como o filtro os devolve; a tela os lê com a primeira letra em minúscula). A mensagem é o detalhe e o texto do campo, e o código é o `type` e o do campo.
    /// </summary>
    public static ApiErrorDto CreateUnprocessableEntityOnField(string title, string type, string field, string message)
        => CreateUnprocessableEntity(title, type, message, new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["errors"] = new Dictionary<string, string[]> { [field] = [message] },
            ["errorCodes"] = new Dictionary<string, string[]> { [field] = [type] }
        });

    public static ApiErrorDto Create(string? type, string title, HttpStatusCode status, string? detail, string? instance, IDictionary<string, object?>? extensions)
        => new(type, title, status, detail, instance, extensions);
}
