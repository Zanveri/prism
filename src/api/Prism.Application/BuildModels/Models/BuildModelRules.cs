using Prism.Core.Extensions;
using System.Text;
using System.Text.Json;

namespace Prism.Application.BuildModels.Models;

/// <summary>Regras de validação dos modelos do Construir (seção 7 da especificação): nome de 1 a 200 caracteres sem controle, corpo até 4 MB em UTF-8 e objeto JSON.</summary>
public static class BuildModelRules
{
    public const int MaxNameLength = 200;

    /// <summary>4 MB do corpo JSON do modelo, em bytes de UTF-8 (4.194.304).</summary>
    public const int MaxBodyBytes = 4 * 1024 * 1024;

    public static bool IsValidName(string? name)
        => name is not null && !name.Any(char.IsControl) && name.NormalizeName().Length is >= 1 and <= MaxNameLength;

    public static bool FitsTheLimit(string? body)
        => body is null || Encoding.UTF8.GetByteCount(body) <= MaxBodyBytes;

    public static bool IsJsonObject(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
            return false;

        try
        {
            using var document = JsonDocument.Parse(body);

            return document.RootElement.ValueKind == JsonValueKind.Object;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
