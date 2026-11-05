namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-VAR-035: o pedido dos valores de uma coluna, já conferido na forma pela rota: a coluna, a descrição, a busca, o deslocamento, quantos valores e se o
/// total vem. A busca é texto da pessoa: o `ToString()` escreve só o nome do tipo (RN-VAR-036).
/// </summary>
public sealed record ColumnValuesRequest(string Column, string? Description, string? Search, int Offset, int Limit, bool Total)
{
    public override string ToString()
        => nameof(ColumnValuesRequest);
}

/// <summary>RN-VAR-035: um valor da coluna, no texto da grade, cortado em 10.000 caracteres (`Truncated`), e a descrição dele, cortada em 200.</summary>
public sealed record ColumnValue(string Value, string? Description, bool Truncated)
{
    public override string ToString()
        => nameof(ColumnValue);
}

/// <summary>RN-VAR-035: a página dos valores de uma coluna: o `kind` da coluna, como na página, os valores, se há mais, e o total (nulo sem o pedido).</summary>
public sealed record ColumnValuesPage(string Kind, IReadOnlyList<ColumnValue> Values, bool HasMore, long? Total)
{
    public override string ToString()
        => nameof(ColumnValuesPage);
}
