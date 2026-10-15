namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>RN-SQL-017: uma célula pedida, pela linha no resultado inteiro (contando o "carregar mais") e pela coluna, contando de zero.</summary>
public sealed record CellRefDto(int Row, int Column);

/// <summary>RN-SQL-017: o valor completo de uma célula cortada; nulo quando ela não tem (não foi cortada, ou passou do teto da sessão).</summary>
public sealed record CellValueDto(int Row, int Column, string? Value)
{
    /// <summary>RN-LOG-001: o valor é dado do usuário.</summary>
    public override string ToString() => nameof(CellValueDto);
}

/// <summary>RN-SQL-017: a resposta de `POST .../results/{resultID}/cells`, na ordem pedida.</summary>
public sealed record ResultCellsDto(IReadOnlyList<CellValueDto> Values);
