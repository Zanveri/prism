using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-IMPORT-014 e 027: como terminou uma importação ou uma cópia: com o resumo (`done`), ou parada (`LoadStop`: a falha, a conexão que passou a ser
/// somente leitura, ou o cancelamento pedido).
/// </summary>
internal sealed record LoadEnd(TransferSummary? Summary, LoadStop? Stop)
{
    public static LoadEnd Of(LoadStop stop)
        => new(null, stop);

    public override string ToString()
        => nameof(LoadEnd);
}

/// <summary>
/// RN-IMPORT-015: os passos que a importação e a cópia têm em comum antes da carga: a leitura do catálogo da tabela de destino (ao conectar, e de novo na
/// primeira transação), com as recusas de cada uma, e a tradução das falhas do banco e do Prism para o fim do trabalho.
/// </summary>
internal static class LoadSteps
{
    /// <summary>
    /// RN-IMPORT-015: a tabela de destino pela consulta da edição, e as colunas mapeadas, uma por entrada do mapeamento. A tabela que sumiu é
    /// `IMPORT_TABLE_NOT_FOUND`; a que deixou de ser tabela, `IMPORT_TARGET_NOT_TABLE`; a coluna mapeada que sumiu, passou a ser calculada pelo banco,
    /// mudou para um tipo que não se importa ou, desde a leitura de antes (`before`), converte de outro jeito, `IMPORT_TABLE_CHANGED`.
    /// </summary>
    /// <param name="what">"a importação" ou "a cópia", na frase da tabela que mudou.</param>
    public static async Task<Result<(ImportTargetTable Table, IReadOnlyList<ImportTargetColumn> Columns), LoadStop>> DescribeAsync(IDatabaseConnection connection, EDatabaseEngine engine, string schema, string table, IReadOnlyList<ImportMappingEntry> mapping, IReadOnlyList<ImportTargetColumn>? before, string what, CancellationToken cancellationToken)
    {
        var described = await connection.DescribeImportTargetAsync(schema, table, cancellationToken);
        if (described.IsFailure)
            return Database(described.Error, ETransferSide.Target, cancellationToken);

        var name = $"{schema}.{table}";
        if (described.Value is not { } catalog)
            return Prism(ETransferError.ImportTableNotFound, $"A tabela {name} não existe mais.");

        if (ImportTargets.NotATableReason(engine, catalog.Table.Kind) is { } kind)
            return Prism(ETransferError.ImportTargetNotTable, $"Só uma tabela recebe linhas: {name} {kind}.");

        var target = ImportTargets.TableOf(engine, catalog);
        var columns = new List<ImportTargetColumn>(mapping.Count);
        for (var index = 0; index < mapping.Count; index++)
        {
            var column = target.Columns.FirstOrDefault(candidate => candidate.Name == mapping[index].Target);
            if (column is not { Importable: true } || (before is not null && !ImportTargets.ConvertsTheSame(before[index], column)))
                return Prism(ETransferError.ImportTableChanged, $"As colunas de {name} mudaram desde a prévia. Abra {what} de novo.");

            columns.Add(column);
        }

        return (target, columns);
    }

    /// <summary>A recusa do Prism, do lado do destino, sem linha.</summary>
    public static LoadStop Prism(ETransferError code, string message, long? line = null, string? column = null, ETransferSide side = ETransferSide.Target)
        => new(new TransferFailure(code, message) { Line = line, Column = column, Side = side });

    /// <summary>
    /// RN-IMPORT-016: a falha do banco, com a mensagem como veio (decisão 4 da seção 8) e o SQLSTATE: ao conectar, `DATABASE_CONNECTION_FAILED`; depois,
    /// `SQL_EXECUTION_FAILED`. Com o cancelamento pedido, é o cancelamento.
    /// </summary>
    public static LoadStop Database(DatabaseFailure failure, ETransferSide side, CancellationToken cancellationToken)
        => cancellationToken.IsCancellationRequested
            ? LoadStop.Canceled
            : new LoadStop(new TransferFailure(failure.Kind == EDatabaseFailure.ConnectionFailed ? ETransferError.DatabaseConnectionFailed : ETransferError.SqlExecutionFailed, failure.Message, failure.SqlState) { Side = side });
}
