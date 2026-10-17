using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Readers;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-IMPORT-012 a 016: uma importação, do começo ao fim, no trabalho que o registro roda. Conecta (numa conexão à parte, com o prazo de trava) e lê o
/// catálogo da tabela; abre o arquivo que o trabalho tomou (`&lt;id&gt;.in`) pelo mesmo leitor das prévias; confere as posições do mapeamento; com
/// "Conferir o arquivo inteiro antes de gravar", lê o arquivo todo e aplica o que é do Prism, sem tocar na tabela; então abre a primeira transação, lê o
/// catálogo de novo dentro dela, esvazia a tabela quando pedido e grava as linhas pelo carregador, até a confirmação final.
///
/// Nada aqui lança: o que falha é o fim do trabalho. A linha das mensagens é a do arquivo (a da planilha, o item da lista), e a coluna, a do arquivo.
/// </summary>
internal sealed class ImportRun(Guid id, ImportJob job, Func<ConnectionSettings, CancellationToken, Task<Result<IDatabaseConnection, DatabaseFailure>>> connect, IImportFileClient files, TransferProgress progress, ILogger logger, CancellationToken token)
{
    /// <summary>De quantos em quantos bytes lidos o progresso da leitura é contado ao registro.</summary>
    private const long ProgressStep = 64 * 1024;

    private const string What = "a importação";

    /// <summary>RN-LOG-001: as linhas lidas do arquivo na carga (não na conferência), para o log do fim.</summary>
    public long ReadRows { get; private set; }

    public async Task<LoadEnd> RunAsync()
    {
        var opened = await connect(job.Settings, token);
        if (opened.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(opened.Error, ETransferSide.Target, token));

        await using var connection = opened.Value;
        var guard = new CommitGuard();

        // RN-IMPORT-014: o cancelamento interrompe o comando em andamento, e não a confirmação, que vai até o fim.
        using var interruption = token.Register(() =>
        {
            if (!guard.Committing)
                connection.Cancel();
        });

        using var slot = new ReaderSlot();

        return await LoadAsync(connection, guard, slot);
    }

    private async Task<LoadEnd> LoadAsync(IDatabaseConnection connection, CommitGuard guard, ReaderSlot slot)
    {
        var engine = job.Settings.Engine;
        var begun = await connection.BeginLoadAsync(token);
        if (begun.IsFailure)
            return LoadEnd.Of(LoadSteps.Database(begun.Error, ETransferSide.Target, token));

        var first = await LoadSteps.DescribeAsync(connection, engine, job.Schema, job.Table, job.Mapping, null, What, token);
        if (first.IsFailure)
            return LoadEnd.Of(first.Error);

        var reader = Open(slot);
        if (reader.IsFailure)
            return LoadEnd.Of(reader.Error);

        progress.Size(reader.Value.Size);

        // RN-IMPORT-009: a posição além das colunas do arquivo, que só a leitura conhece, é o fim antes de gravar a primeira linha (e antes do esvaziamento).
        for (var index = 0; index < job.Mapping.Count; index++)
        {
            if (job.Mapping[index].Source < reader.Value.Columns.Count)
                continue;

            var count = reader.Value.Columns.Count;

            return LoadEnd.Of(LoadSteps.Prism(ETransferError.ImportMappingInvalid, $"A coluna {job.Mapping[index].Source + 1} do arquivo não existe: o arquivo tem {ImportText.Thousands(count)} {(count == 1 ? "coluna" : "colunas")}."));
        }

        // RN-IMPORT-012: a conferência lê o arquivo inteiro com os tipos da leitura do catálogo ao conectar, sem transação e sem gravar; a carga lê de novo.
        if (job.Load.Check)
        {
            progress.Phase(ETransferPhase.Checking);
            if (await PassAsync(reader.Value, first.Value.Columns, null) is { } refused)
                return LoadEnd.Of(refused);

            reader = Open(slot);
            if (reader.IsFailure)
                return LoadEnd.Of(reader.Error);
        }

        var oneAtATime = first.Value.Table.OneAtATime;
        var target = new LoadTarget(first.Value.Table.Schema, first.Value.Table.Name, [.. job.Mapping.Select(entry => entry.Target)]);
        var loader = new TableLoader(connection, target, job.Load, oneAtATime, progress, guard, job.TargetStop, SourceColumnOf(reader.Value), ETransferSide.Target, token);
        if (await loader.BeginAsync() is { } notBegun)
            return LoadEnd.Of(notBegun);

        // RN-IMPORT-015: na primeira transação, antes de gravar, o catálogo de novo; as conversões usam os tipos desta leitura.
        var second = await LoadSteps.DescribeAsync(connection, engine, job.Schema, job.Table, job.Mapping, first.Value.Columns, What, token);
        if (second.IsFailure)
            return LoadEnd.Of(second.Error);

        if (job.Load.Empty && await loader.EmptyAsync() is { } notEmptied)
            return LoadEnd.Of(notEmptied);

        // RN-IMPORT-014: a conta dos bytes volta a zero quando a carga começa, junto com a fase, e não antes (a fase ainda diria a conferência).
        progress.Phase(ETransferPhase.Loading, bytes: 0);
        var counts = new Counts();
        if (await PassAsync(reader.Value, second.Value.Columns, loader, counts) is { } stopped)
            return LoadEnd.Of(stopped);

        if (await loader.FinishAsync() is { } notFinished)
            return LoadEnd.Of(notFinished);

        var summary = new TransferSummary(loader.Written, reader.Value.Position, null, 0, 0, 0)
        {
            Committed = loader.Committed,
            Emptied = loader.Emptied,
            ShortRows = counts.ShortRows,
            SkippedLines = reader.Value.SkippedLines,
            Unguarded = counts.Unguarded,
            FormulasWithoutValue = reader.Value.FormulasWithoutValue
        };

        return new LoadEnd(summary, null);
    }

    /// <summary>
    /// Uma passada pelo arquivo: cada linha, com o problema dela na leitura (`IMPORT_VALUE_INVALID`) e cada valor mapeado convertido (RN-IMPORT-010, os
    /// passos 1 a 4 e, no Db2 e no Informix, o 5). Com o carregador, cada linha convertida vai a ele; sem ele, é a conferência, que não grava nada.
    /// </summary>
    private async Task<LoadStop?> PassAsync(ImportReader reader, IReadOnlyList<ImportTargetColumn> columns, TableLoader? loader, Counts? counts = null)
    {
        var rules = job.Options is CsvImportOptions csv ? ImportValueRules.Of(csv, reader.Info.Delimiter) : ImportValueRules.None;
        long reported = 0;
        while (true)
        {
            if (token.IsCancellationRequested)
                return LoadStop.Canceled;

            var next = reader.Next(token);
            if (next.IsFailure)
                return ReadStop(next.Error);

            if (next.Value is not { } record)
                break;

            if (loader is not null)
                ReadRows++;

            if (record.Problem is { } problem)
                return LoadSteps.Prism(ETransferError.ImportValueInvalid, problem.Message, record.Line, problem.Column is { } position && position < reader.Columns.Count ? reader.Columns[position] : null);

            var row = new EditParameter[job.Mapping.Count];
            for (var index = 0; index < row.Length; index++)
            {
                var source = job.Mapping[index].Source;
                var converted = ImportValues.Convert(job.Settings.Engine, columns[index], record.Values[source], rules, job.Formats);
                if (converted.IsFailure)
                    return LoadSteps.Prism(ETransferError.ImportValueInvalid, converted.Error, record.Line, reader.Columns[source]);

                row[index] = converted.Value.Parameter;
                if (converted.Value.Unguarded && counts is not null)
                    counts.Unguarded++;
            }

            if (record.Short && counts is not null)
                counts.ShortRows++;

            if (loader is not null && await loader.AddAsync(row, record.Line) is { } stop)
                return stop;

            if (reader.Position - reported >= ProgressStep)
            {
                reported = reader.Position;
                progress.Read(reported);
            }
        }

        progress.Read(reader.Position);

        return null;
    }

    /// <summary>
    /// O arquivo que o trabalho tomou, aberto de novo a cada passada, com o mesmo leitor e as mesmas opções das prévias (no JSON, as chaves do pedido). O
    /// leitor anterior fecha.
    /// </summary>
    private Result<ImportReader, LoadStop> Open(ReaderSlot slot)
    {
        slot.Set(null);
        var file = files.Open(id);
        if (file.IsFailure)
            return LoadSteps.Prism(ETransferError.ImportFileUnreadable, file.Error.Kind == EImportFileRefusal.TooLarge ? ImportText.TooLarge(file.Error.Size) : file.Error.Reason ?? "O arquivo da importação não está mais na pasta do Prism.");

        var opened = ImportReader.Open(job.Format, job.Options, file.Value, logger, token);
        if (opened.IsFailure)
            return ReadStop(opened.Error);

        slot.Set(opened.Value);

        return opened.Value;
    }

    /// <summary>
    /// RN-IMPORT-016: o arquivo que parou no meio da leitura é `IMPORT_FILE_UNREADABLE`, e o valor ou a linha acima do teto, `IMPORT_VALUE_TOO_LARGE`, com a
    /// linha e a coluna quando se sabem. A leitura interrompida pelo cancelamento é o cancelamento.
    /// </summary>
    private static LoadStop ReadStop(ImportReadFailure failure)
        => failure.Canceled
            ? LoadStop.Canceled
            : LoadSteps.Prism(failure.ValueTooLarge ? ETransferError.ImportValueTooLarge : ETransferError.ImportFileUnreadable, failure.Message, failure.Line, failure.Column);

    /// <summary>RN-IMPORT-016: a coluna que o banco diz no erro é da tabela; a mensagem fala da coluna do arquivo que vai para ela.</summary>
    private Func<string?, string?> SourceColumnOf(ImportReader reader)
        => tableColumn => job.Mapping.FirstOrDefault(entry => entry.Target == tableColumn) is { } entry && entry.Source < reader.Columns.Count ? reader.Columns[entry.Source] : null;

    /// <summary>RN-IMPORT-020: o que a leitura fez no caminho, contado na carga.</summary>
    private sealed class Counts
    {
        public long ShortRows { get; set; }

        public long Unguarded { get; set; }
    }

    /// <summary>O leitor aberto do arquivo, fechado ao trocar por outro e no fim do trabalho, em qualquer saída.</summary>
    private sealed class ReaderSlot : IDisposable
    {
        private ImportReader? _reader;

        public void Set(ImportReader? reader)
        {
            _reader?.Dispose();
            _reader = reader;
        }

        public void Dispose()
            => Set(null);
    }
}
