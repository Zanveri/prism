using Prism.Infrastructure.Transfers.Models;
using System.Text;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-008: a tabela de texto do DBeaver. As colunas separadas por `|`, sem espaço em volta, cada valor alinhado à esquerda e completado com
/// espaços até a largura da coluna. A largura é a maior entre a mínima, o nome da coluna e os valores do lote, contada em pontos de código, e cortada na
/// máxima, quando há; o valor maior que ela é cortado e contado. As larguras são calculadas a cada lote de 200 linhas (ou menos, quando os valores do
/// lote passam de 16 MiB): cada lote é guardado, medido e escrito, e o cabeçalho sai uma vez, no alto, com as larguras do primeiro. Os caracteres de
/// controle do valor (a quebra de linha inclusive) e os separadores de linha e de parágrafo do Unicode viram espaço: cada linha da origem é uma
/// linha do arquivo. Cada linha vai ao arquivo célula a célula, sem ser montada num texto só.
/// </summary>
internal sealed class TxtExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    private const int BatchRows = 200;
    private const long BatchBytes = 16L * 1024 * 1024;
    private const string NullText = "NULL";

    /// <summary>Os espaços que completam a célula e os traços da linha sob o cabeçalho saem destes, em pedaços, e não de um texto novo do tamanho da coluna.</summary>
    private static readonly string Spaces = new(' ', 256);

    private static readonly string Dashes = new('-', 256);

    private readonly TxtExportOptions _options = (TxtExportOptions)context.Options;
    private readonly List<string[]> _batch = [];
    private long _batchBytes;
    private bool _started;

    private readonly IReadOnlyList<string> _names = [.. context.Columns.Select(column => ExportText.TxtValue(column.Name))];

    public override void Begin()
    {
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        var values = new string[row.Count];
        for (var index = 0; index < row.Count; index++)
        {
            values[index] = TextOf(row[index]) is { } text ? ExportText.TxtValue(text) : _options.ShowNull ? NullText : string.Empty;
            _batchBytes += Encoding.UTF8.GetByteCount(values[index]);
        }

        _batch.Add(values);
        if (_batch.Count >= BatchRows || _batchBytes > BatchBytes)
            WriteBatch();
    }

    public override void End()
    {
        WriteBatch();
        Output.Flush();
    }

    /// <summary>Mede o lote, escreve o cabeçalho na primeira vez (também sem nenhuma linha) e as linhas do lote, e o esvazia.</summary>
    private void WriteBatch()
    {
        if (_started && _batch.Count == 0)
            return;

        var widths = new int[Columns.Count];
        for (var column = 0; column < widths.Length; column++)
        {
            var width = Math.Max(_options.MinWidth, ExportText.CodePointCount(_names[column]));
            foreach (var values in _batch)
                width = Math.Max(width, ExportText.CodePointCount(values[column]));

            widths[column] = _options.MaxWidth > 0 ? Math.Min(width, _options.MaxWidth) : width;
        }

        if (!_started)
        {
            _started = true;
            if (_options.Header)
            {
                WriteLine(widths.Length, column => WritePadded(ExportText.TakeCodePoints(_names[column], widths[column]), widths[column]));
                if (_options.HeaderLine)
                    WriteLine(widths.Length, column => WriteRun(Dashes, widths[column]));
            }
        }

        foreach (var values in _batch)
            WriteLine(widths.Length, column => WritePadded(Cut(values[column], widths[column]), widths[column]));

        _batch.Clear();
        _batchBytes = 0;
    }

    private string Cut(string value, int width)
    {
        var cut = ExportText.TakeCodePoints(value, width);
        if (cut.Length < value.Length)
            Counts.CutValues++;

        return cut;
    }

    /// <summary>
    /// Uma linha da tabela, célula a célula, direto no arquivo: a linha não é montada num texto só, e o valor grande não é copiado para ganhar os
    /// espaços, as barras e a quebra.
    /// </summary>
    private void WriteLine(int columns, Action<int> writeCell)
    {
        if (_options.EdgeDelimiters)
            Output.Write('|');

        for (var column = 0; column < columns; column++)
        {
            if (column > 0)
                Output.Write('|');

            writeCell(column);
        }

        if (_options.EdgeDelimiters)
            Output.Write('|');

        Output.Write(_options.LineBreak);
    }

    /// <summary>O valor alinhado à esquerda e completado com espaços até a largura, contada em pontos de código.</summary>
    private void WritePadded(string value, int width)
    {
        Output.Write(value);
        WriteRun(Spaces, width - ExportText.CodePointCount(value));
    }

    private void WriteRun(string run, int count)
    {
        for (; count > 0; count -= run.Length)
            Output.Write(run.AsSpan(0, Math.Min(count, run.Length)));
    }
}
