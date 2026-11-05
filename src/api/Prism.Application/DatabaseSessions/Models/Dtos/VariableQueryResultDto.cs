namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>
/// RN-VAR-034: a resposta da consulta de uma variável: as colunas como na página e as linhas inteiras, no texto da grade sem o corte de 10.000 caracteres. Leva
/// valores do banco: o `ToString()` escreve só o nome do tipo (RN-VAR-036).
/// </summary>
public sealed record VariableQueryResultDto(IReadOnlyList<QueryColumnDto> Columns, IReadOnlyList<string?[]> Rows, long ElapsedMs)
{
    public override string ToString() => nameof(VariableQueryResultDto);
}
