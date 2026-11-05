namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-VAR-034 e 035: as linhas inteiras de uma leitura, com as colunas como na página e cada célula no texto da grade (RN-SQL-011), mas sem o corte de
/// 10.000 caracteres; o binário vem como na grade (`0x…`). É o que a consulta de uma variável devolve e o que os valores de uma coluna leem antes do corte
/// deles. Leva valores do banco: o `ToString()` escreve só o nome do tipo (RN-VAR-036).
/// </summary>
public sealed record FullRows(IReadOnlyList<QueryColumn> Columns, IReadOnlyList<string?[]> Rows, long ElapsedMs)
{
    public override string ToString()
        => nameof(FullRows);
}
