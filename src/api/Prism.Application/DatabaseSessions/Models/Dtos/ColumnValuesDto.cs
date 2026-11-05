namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>RN-VAR-035: um valor da coluna no texto da grade (`truncated` no cortado em 10.000 caracteres) e a descrição dele, cortada em 200, ou nula.</summary>
public sealed record ColumnValueDto(string Value, string? Description, bool Truncated)
{
    /// <summary>RN-VAR-036: o valor é dado do banco.</summary>
    public override string ToString() => nameof(ColumnValueDto);
}

/// <summary>RN-VAR-035: a resposta de `POST .../tables/{table}/values`: o `kind` da coluna, os valores, se há mais, e o total (nulo quando não pedido).</summary>
public sealed record ColumnValuesDto(string Kind, IReadOnlyList<ColumnValueDto> Values, bool HasMore, long? Total)
{
    /// <summary>RN-VAR-036: os valores são dado do banco.</summary>
    public override string ToString() => nameof(ColumnValuesDto);
}

/// <summary>RN-VAR-035: a resposta de `POST .../tables/{table}/values/check`: os índices dos valores pedidos que não existem na coluna, na ordem.</summary>
public sealed record ColumnValuesCheckDto(IReadOnlyList<int> Missing);
