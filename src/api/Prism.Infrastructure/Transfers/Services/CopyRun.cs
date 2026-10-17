using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-IMPORT-022 a 027: uma cópia para outro banco, do começo ao fim, no trabalho que o registro roda. São duas conexões à parte, mesmo quando a conexão é a
/// mesma: a de leitura, nas regras da exportação (o prazo de trava, a transação `REPEATABLE READ READ ONLY` e a forma do texto no PostgreSQL, a contagem
/// quando pedida ou obrigatória, os limites de 64 MiB por valor e 256 MiB por linha, a conferência das colunas), e a de gravação, nas regras do
/// carregador. A leitura e a gravação andam juntas: cada lote lido é convertido, linha por linha, e vai ao carregador.
///
/// Nada aqui lança: o que falha é o fim do trabalho, com o lado (`source` na leitura, `target` na gravação). A linha das mensagens é o número da linha
/// na leitura da origem, a partir de 1, e a coluna, a da origem.
/// </summary>
internal sealed class CopyRun(CopyJob job, Func<ConnectionSettings, CancellationToken, Task<Result<IDatabaseConnection, DatabaseFailure>>> connect, TransferProgress progress, CancellationToken token)
{
    private const string What = "a cópia";
    private const string ColumnsChangedMessage = "As colunas do resultado mudaram desde a grade. Execute o comando de novo e copie outra vez.";
    private const string ValueTooLargeMessage = "Um valor passa de 64 MiB, e o Prism não o copia.";
    private const string RowTooLargeMessage = "A linha passa de 256 MiB de valores, e o Prism não a copia.";

    /// <summary>RN-LOG-001: as linhas lidas da origem, para o log do fim.</summary>
    public long ReadRows { get; private set; }

    public async Task<LoadEnd> RunAsync()
    {
        var source = await connect(job.SourceSettings, token);
        if (source.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(source.Error, ETransferSide.Source, token));

        await using var reading = source.Value;
        using var readingInterruption = token.Register(reading.Cancel);

        var target = await connect(job.TargetSettings, token);
        if (target.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(target.Error, ETransferSide.Target, token));

        await using var writing = target.Value;
        var guard = new CommitGuard();

        // RN-IMPORT-014: o cancelamento interrompe o comando em andamento, e não a confirmação, que vai até o fim.
        using var writingInterruption = token.Register(() =>
        {
            if (!guard.Committing)
                writing.Cancel();
        });

        return await CopyAsync(reading, writing, guard);
    }

    private async Task<LoadEnd> CopyAsync(IDatabaseConnection reading, IDatabaseConnection writing, CommitGuard guard)
    {
        var engine = job.TargetSettings.Engine;
        var begunRead = await reading.BeginExportAsync(token);
        if (begunRead.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(begunRead.Error, ETransferSide.Source, token));

        var begunWrite = await writing.BeginLoadAsync(token);
        if (begunWrite.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(begunWrite.Error, ETransferSide.Target, token));

        var first = await LoadSteps.DescribeAsync(writing, engine, job.Schema, job.Table, job.Mapping, null, What, token);
        if (first.IsFailure)
            return LoadEnd.Of(first.Error);

        // RN-IMPORT-023: a contagem, pedida ou obrigatória (a origem e o destino no mesmo banco do Db2 ou do Informix); a obrigatória que falha termina a cópia.
        long? total = null;
        if (job.Count || job.ForcedCount)
        {
            progress.Phase(ETransferPhase.Counting);
            var counted = await reading.CountExportAsync(job.Sql, job.ForcedCount, token);
            if (counted.IsFailure)
                return LoadEnd.Of(LoadSteps.Database(counted.Error, ETransferSide.Source, token));

            total = counted.Value;
            progress.Total(total);
        }

        var started = await reading.StartExportReadAsync(job.Sql, token);
        if (started.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(started.Error, ETransferSide.Source, token));

        // RN-EXPORT-017: nos Registros e no resultado, cada coluna pedida tem de estar na posição e com o nome que a tela mandou; na tabela, o `SELECT` já
        // leva só as pedidas, na ordem das posições.
        var columns = started.Value;
        if (columns.Count == 0 || (job.CheckColumns && job.Columns.Any(column => column.Position >= columns.Count || columns[column.Position].Name != column.Name)))
            return LoadEnd.Of(LoadSteps.Prism(ETransferError.ColumnsChanged, ColumnsChangedMessage, side: ETransferSide.Source));

        var ordinals = job.Mapping.Select(entry => OrdinalOf(job.Columns[entry.Source])).ToList();
        if (ordinals.Any(ordinal => ordinal >= columns.Count))
            return LoadEnd.Of(LoadSteps.Prism(ETransferError.ColumnsChanged, ColumnsChangedMessage, side: ETransferSide.Source));

        var sources = ordinals.Select(ordinal => columns[ordinal]).ToList();
        var target = new LoadTarget(first.Value.Table.Schema, first.Value.Table.Name, [.. job.Mapping.Select(entry => entry.Target)]);
        var loader = new TableLoader(writing, target, job.Load, first.Value.Table.OneAtATime, progress, guard, job.TargetStop, SourceColumnOf, ETransferSide.Target, token);
        if (await loader.BeginAsync() is { } notBegun)
            return LoadEnd.Of(notBegun);

        // RN-IMPORT-015: na primeira transação, antes de gravar, o catálogo de novo; as conversões usam os tipos desta leitura.
        var second = await LoadSteps.DescribeAsync(writing, engine, job.Schema, job.Table, job.Mapping, first.Value.Columns, What, token);
        if (second.IsFailure)
            return LoadEnd.Of(second.Error);

        if (job.Load.Empty && await loader.EmptyAsync() is { } notEmptied)
            return LoadEnd.Of(notEmptied);

        progress.Phase(ETransferPhase.Loading);
        var plan = new ExportReadPlan(ordinals, new HashSet<int>()) { Copy = true };
        var growing = job.ForcedCount && total is { } counted2 ? counted2 + Math.Max(counted2 / 10, 1000) : (long?)null;
        while (true)
        {
            if (token.IsCancellationRequested)
                return LoadEnd.Of(LoadStop.Canceled);

            var batch = await reading.ReadExportRowsAsync(plan, token);
            if (batch.IsFailure)
                return LoadEnd.Of(LoadSteps.Database(batch.Error, ETransferSide.Source, token));

            foreach (var row in batch.Value.Rows)
            {
                ReadRows++;
                if (growing is { } limit && ReadRows > limit)
                    return LoadEnd.Of(LoadSteps.Prism(ETransferError.ImportSourceGrowing, $"A origem continua crescendo: a cópia leu mais linhas do que as {ImportText.Thousands(total!.Value)} contadas e foi encerrada.", side: ETransferSide.Source));

                var values = new EditParameter[row.Count];
                for (var index = 0; index < values.Length; index++)
                {
                    var name = job.Columns[job.Mapping[index].Source].Name;
                    var converted = ImportValues.ConvertCopied(job.SourceSettings.Engine, name, sources[index].Type, sources[index].Kind, engine, second.Value.Columns[index], row[index]);
                    if (converted.IsFailure)
                        return LoadEnd.Of(LoadSteps.Prism(ETransferError.ImportValueInvalid, converted.Error, ReadRows, name));

                    values[index] = converted.Value;
                }

                if (await loader.AddAsync(values, ReadRows) is { } stop)
                    return LoadEnd.Of(stop);
            }

            if (batch.Value.Oversize is { } oversize)
                return LoadEnd.Of(LoadSteps.Prism(ETransferError.ValueTooLarge, oversize.WholeRow ? RowTooLargeMessage : ValueTooLargeMessage, ReadRows + 1, oversize.WholeRow ? null : job.Columns[job.Mapping[oversize.Column].Source].Name, ETransferSide.Source));

            if (batch.Value.Finished)
                break;
        }

        if (await loader.FinishAsync() is { } notFinished)
            return LoadEnd.Of(notFinished);

        return new LoadEnd(new TransferSummary(loader.Written, 0, null, 0, 0, 0) { Committed = loader.Committed, Emptied = loader.Emptied }, null);
    }

    /// <summary>
    /// A posição no resultado da coluna pedida: nos Registros e no resultado, a que a tela mandou; na tabela, a ordem dela entre as pedidas, que o `SELECT`
    /// montado pela API escreve na ordem das posições.
    /// </summary>
    private int OrdinalOf(ExportColumnChoice column)
        => job.CheckColumns ? column.Position : job.Columns.Count(other => other.Position < column.Position);

    /// <summary>RN-IMPORT-016: a coluna que o banco de destino diz no erro é da tabela; a mensagem fala da coluna da origem que vai para ela.</summary>
    private string? SourceColumnOf(string? tableColumn)
        => job.Mapping.FirstOrDefault(entry => entry.Target == tableColumn) is { } entry ? job.Columns[entry.Source].Name : null;
}
