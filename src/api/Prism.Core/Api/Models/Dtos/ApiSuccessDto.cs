using System.Net;
using System.Text.Json.Serialization;

namespace Prism.Core.Api.Models.Dtos;

public sealed class ApiSuccessDto
{
    [JsonIgnore]
    public HttpStatusCode StatusCode { get; private set; }

    public dynamic? Value { get; private set; }

    private ApiSuccessDto(HttpStatusCode statusCode, dynamic? value)
    {
        StatusCode = statusCode;
        Value = value;
    }

    public static ApiSuccessDto CreateOk(dynamic? value)
        => Create(HttpStatusCode.OK, value);

    public static ApiSuccessDto CreateCreated(dynamic? value)
        => Create(HttpStatusCode.Created, value);

    public static ApiSuccessDto Create(HttpStatusCode statusCode, dynamic? value)
        => new(statusCode, value);
}
