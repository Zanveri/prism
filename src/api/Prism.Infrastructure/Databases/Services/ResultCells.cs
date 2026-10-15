using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Services;

/// <summary>
/// RN-SQL-017: o valor completo das células que a API cortou (RN-SQL-011) nas páginas que ela já entregou de um resultado, pela linha no
/// resultado inteiro (a página do "carregar mais" continua a contagem) e pela coluna. Só na memória do processo: nada daqui vai para
/// disco ou para o log. Cada resultado tem o seu, e a sessão só tem um resultado de cada vez, então o teto daqui é o da sessão.
///
/// O teto conta o que fica na memória (<see cref="FullCellValue.Bytes"/>: 2 bytes por caractere do texto, 1 por byte do binário). A
/// célula que não cabe e todas as seguintes ficam sem valor completo, e quem guarda diz à página quais foram. Largado o resultado
/// (<see cref="Clear"/>), nada mais é guardado.
///
/// Seguro para chamadas ao mesmo tempo: a página do "carregar mais" entra com a vez da sessão, e o pedido dos valores, sem ela.
/// </summary>
internal sealed class ResultCells(long capacity = QueryPaging.MaxFullValueBytes)
{
    private readonly Lock _lock = new();
    private readonly Dictionary<CellPosition, FullCellValue> _values = [];
    private long _bytes;
    private int _rows;

    /// <summary>Uma célula não coube, ou o resultado foi largado: daqui em diante nenhum valor é guardado.</summary>
    private bool _closed;

    /// <summary>As linhas que as páginas entregues somam: o que está fora delas não é do resultado (ainda).</summary>
    public int Rows
    {
        get
        {
            lock (_lock)
                return _rows;
        }
    }

    /// <summary>
    /// Guarda o valor completo das células cortadas da página seguinte do resultado e devolve as que ficaram sem, como `[linha, coluna]`
    /// dentro da página.
    /// </summary>
    public IReadOnlyList<int[]> Add(QueryPage page)
    {
        var missing = new List<int[]>();
        var values = page.FullValues ?? [];

        lock (_lock)
        {
            for (var index = 0; index < page.TruncatedCells.Count; index++)
            {
                var cell = page.TruncatedCells[index];
                var value = index < values.Count ? values[index] : null;

                if (value is null || _closed || _bytes + value.Bytes > capacity)
                {
                    _closed |= value is not null;
                    missing.Add(cell);

                    continue;
                }

                _values[new CellPosition(_rows + cell[0], cell[1])] = value;
                _bytes += value.Bytes;
            }

            _rows += page.Rows.Count;
        }

        return missing;
    }

    /// <summary>
    /// O valor completo de cada célula pedida, na ordem pedida; nulo na que não tem (não foi cortada, ou passou do teto). Uma célula fora
    /// das linhas entregues ou das colunas do resultado recusa o pedido inteiro com `CellsInvalid`.
    /// </summary>
    public Result<IReadOnlyList<string?>, DatabaseFailure> Read(IReadOnlyList<CellPosition> cells, int columns)
    {
        FullCellValue?[] found;

        lock (_lock)
        {
            foreach (var cell in cells)
            {
                if (cell.Row < 0 || cell.Row >= _rows)
                    return new DatabaseFailure(EDatabaseFailure.CellsInvalid, $"A linha {cell.Row} não está entre as {_rows} que o resultado entregou.");

                if (cell.Column < 0 || cell.Column >= columns)
                    return new DatabaseFailure(EDatabaseFailure.CellsInvalid, $"A coluna {cell.Column} não existe no resultado, que tem {columns}.");
            }

            found = [.. cells.Select(cell => _values.GetValueOrDefault(cell))];
        }

        // O hexadecimal de um binário grande é escrito fora da trava: o "carregar mais" não espera por ele.
        return found.Select(value => value?.Write()).ToArray();
    }

    /// <summary>RN-SQL-017: o resultado foi largado (outro comando, a sessão fechou). Os valores saem da memória, e nenhum outro entra.</summary>
    public void Clear()
    {
        lock (_lock)
        {
            _values.Clear();
            _values.TrimExcess();
            _bytes = 0;
            _closed = true;
        }
    }
}
