namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EXPORT-017: o que ler de cada linha da exportação e até onde. `Ordinals` são as colunas do resultado que o arquivo escreve, na ordem dele; as de
/// `Skipped` (o binário com "Deixar vazio", RN-EXPORT-006) nem são pedidas ao leitor, e chegam nulas. Os tetos seguram a memória da API: cada valor
/// até 64 MiB (o texto em bytes de UTF-8, o binário em bytes) e cada linha até 256 MiB de valores somados; o lote para nas linhas ou nos bytes, o que
/// vier antes, com ao menos uma linha.
/// </summary>
public sealed record ExportReadPlan(IReadOnlyList<int> Ordinals, IReadOnlySet<int> Skipped)
{
    /// <summary>RN-EXPORT-017: o valor acima disto termina a exportação com `EXPORT_VALUE_TOO_LARGE`.</summary>
    public const long DefaultMaxValueBytes = 64L * 1024 * 1024;

    /// <summary>RN-EXPORT-017: a linha cujos valores somados passam disto termina a exportação com `EXPORT_VALUE_TOO_LARGE`.</summary>
    public const long DefaultMaxRowBytes = 256L * 1024 * 1024;

    public long MaxValueBytes { get; init; } = DefaultMaxValueBytes;

    public long MaxRowBytes { get; init; } = DefaultMaxRowBytes;

    /// <summary>As linhas de um lote, no máximo. O lote é o que vai do banco ao arquivo de uma vez: a memória é a dele, ou a de uma linha grande.</summary>
    public int MaxRows { get; init; } = 1000;

    /// <summary>Os bytes de valores de um lote: passando deles, o lote fecha na linha que os passou.</summary>
    public long MaxBatchBytes { get; init; } = 1024 * 1024;

    /// <summary>
    /// RN-IMPORT-026: a leitura da cópia para outro banco, e não de um arquivo: a data e hora do driver da IBM sai no texto canônico da cópia, com as 7
    /// casas de fração que ele entrega (`aaaa-mm-dd hh:mm:ss.fffffff`), e não com as 6 da grade e da exportação.
    /// </summary>
    public bool Copy { get; init; }
}

/// <summary>
/// RN-EXPORT-017: um lote de linhas lidas, na ordem da origem, cada uma com uma célula por coluna do plano. `Finished`: o resultado acabou, e o leitor
/// fechou (no PostgreSQL, com o `COMMIT` da transação só de leitura). `Oversize`: a leitura parou num valor ou numa linha acima do teto; as linhas do
/// lote são as anteriores a ela, e o leitor continua aberto até a conexão ser descartada.
/// </summary>
public sealed record ExportBatch(IReadOnlyList<IReadOnlyList<ExportCell>> Rows, bool Finished, ExportOversize? Oversize = null)
{
    public override string ToString()
        => nameof(ExportBatch);
}

/// <summary>RN-EXPORT-017: o valor acima do teto, na coluna de posição `Column` do plano, ou, com `WholeRow`, a linha cujos valores somados passaram do teto dela.</summary>
public sealed record ExportOversize(int Column, bool WholeRow);
