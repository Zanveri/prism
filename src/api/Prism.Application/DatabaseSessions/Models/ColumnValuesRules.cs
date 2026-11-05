using Prism.Core.Extensions;
using System.Resources;
using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Models;

/// <summary>
/// RN-VAR-035: a forma do pedido dos valores de uma coluna e da conferência deles, antes de qualquer coisa ir ao banco, com `VALUES_INVALID` no campo (o caminho
/// do campo em camelCase, como a especificação o escreve). O que depende do catálogo (a coluna é da tabela, não é binária, a descrição não é a própria coluna) é do
/// registro de sessões, na sessão. Nenhuma mensagem leva o texto da busca (RN-VAR-036).
/// </summary>
internal static class ColumnValuesRules
{
    public const string InvalidCode = "VALUES_INVALID";

    /// <summary>Os textos, no idioma do pedido: <c>ColumnValuesRules.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ColumnValuesRules));

    public const int MaxSearchLength = 200;
    public const int MaxOffset = 1_000_000;
    public const int MaxLimit = 200;
    public const int DefaultLimit = 100;

    /// <summary>RN-VAR-035: os valores de uma conferência, de 1 a 1.000.</summary>
    public const int MaxCheckValues = 1_000;

    /// <summary>A coluna é obrigatória nas duas rotas; se ela é da tabela, quem diz é o catálogo.</summary>
    public static (string Field, string Message)? ColumnRefusal(string? column)
        => string.IsNullOrEmpty(column) ? ("column", Texts.Get("ColumnRequired")) : null;

    /// <summary>A forma de `column`, `search`, `offset`, `limit` e `total`, cada recusa no campo dela. A descrição só é conferida no catálogo.</summary>
    public static IReadOnlyList<(string Field, string Message)> Refusals(string? column, string? search, JsonElement? offset, JsonElement? limit, JsonElement? total)
    {
        var refusals = new List<(string, string)>();
        if (ColumnRefusal(column) is { } columnRefusal)
            refusals.Add(columnRefusal);

        if (search is not null && (search.Length > MaxSearchLength || search.Any(char.IsControl)))
            refusals.Add(("search", Texts.Get("SearchInvalid")));

        if (!IsAbsent(offset) && !IsIntegerIn(offset!.Value, 0, MaxOffset))
            refusals.Add(("offset", Texts.Get("OffsetInvalid")));

        if (!IsAbsent(total) && total!.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            refusals.Add(("total", Texts.Get("TotalInvalid")));

        // "0 só com `total`": a página vazia só serve para saber quantos valores há (o sorteio do `random.of`, RN-VAR-010).
        if (!IsAbsent(limit) && !IsIntegerIn(limit!.Value, 0, MaxLimit))
            refusals.Add(("limit", Texts.Get("LimitInvalid")));
        else if (!IsAbsent(limit) && limit!.Value.GetInt32() == 0 && !WantsTotal(total))
            refusals.Add(("limit", Texts.Get("LimitZeroNeedsTotal")));

        return refusals;
    }

    /// <summary>Os valores já conferidos: o deslocamento (0 sem ele), o limite (100 sem ele) e o total (falso sem ele).</summary>
    public static (int Offset, int Limit, bool Total) Read(JsonElement? offset, JsonElement? limit, JsonElement? total)
        => (IsAbsent(offset) ? 0 : offset!.Value.GetInt32(), IsAbsent(limit) ? DefaultLimit : limit!.Value.GetInt32(), WantsTotal(total));

    private static bool WantsTotal(JsonElement? total)
        => total is { ValueKind: JsonValueKind.True };

    private static bool IsAbsent(JsonElement? element)
        => element is null or { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined };

    private static bool IsIntegerIn(JsonElement element, int minimum, int maximum)
        => element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value) && value >= minimum && value <= maximum;
}
