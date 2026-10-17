using Prism.Infrastructure.Transfers.Imports;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-004: o CSV e o TSV (o CSV com a tabulação como separador), lidos em fluxo, um registro por vez. Com aspas duplas, como na RFC 4180 e no
/// Excel: o campo que começa por `"` vai até a próxima `"` que não está dobrada, com o separador e as quebras de linha dentro dele como texto, e o que vem
/// depois da aspa que fecha, até o separador, é juntado ao valor; a aspa no meio de um campo que não começou por ela é um caractere comum. As linhas
/// terminam em CRLF, LF ou CR sozinho, e a linha de cada registro é a física em que ele começa (a do cabeçalho é a 1).
///
/// O leitor entrega o texto de cada campo e se ele veio entre aspas; o nulo, a proteção contra fórmula e as pontas são da conversão (RN-IMPORT-010), que
/// depende da coluna de destino.
/// </summary>
internal sealed class CsvImportReader(Stream stream, CsvImportOptions options, bool tsv, ILogger logger) : ImportReader(stream, logger)
{
    /// <summary>RN-IMPORT-004: o separador automático olha as primeiras 100 linhas, até 1 MiB.</summary>
    private const int DelimiterSampleLines = 100;
    private const int DelimiterSampleChars = 1024 * 1024;

    /// <summary>RN-IMPORT-004: os separadores do automático, na ordem do desempate (o `;` é o do Prism e o do Excel em português).</summary>
    private static readonly char[] Delimiters = [';', ',', '\t', '|'];

    private TextSource _source = null!;
    private string _encoding = ImportEncodings.Utf8;
    private char? _delimiter;
    private long _line = 1;
    private int _width;
    private bool _header;
    private RawRecord? _pending;

    public override long Position => _source?.Position ?? 0;

    public override long Size => Stream.Length;

    protected override void Begin(CancellationToken cancellationToken)
    {
        var encoding = _encoding = options.Encoding == ImportEncodings.Auto ? TextSource.Detect(Stream, cancellationToken).Name : options.Encoding;
        Stream.Position = 0;
        _source = new TextSource(Stream, encoding);
        var bom = _source.Bom;

        _delimiter = tsv ? '\t' : options.Delimiter is { Length: 1 } chosen ? chosen[0] : DetectDelimiter(cancellationToken);
        if (!tsv && options.Delimiter is null)
        {
            Stream.Position = 0;
            _source = new TextSource(Stream, encoding);
        }

        _header = options.Header;
        var first = ReadNonBlank(cancellationToken);
        IReadOnlyList<string> columns = [];
        if (first is not null)
        {
            _width = first.Fields.Count;
            if (_header)
            {
                var names = first.Fields.Select(field => options.UnguardFormulas ? ImportText.Unguard(field.Text, out _) : field.Text).ToList();
                columns = ImportText.ColumnNames(names);
                if (columns.Select((name, position) => (name, position)).FirstOrDefault(column => column.name.Length > MaxColumnNameLength) is { name: not null } tooLong)
                    throw ColumnNameTooLong(tooLong.position);
            }
            else
            {
                columns = [.. Enumerable.Range(0, _width).Select(ImportText.DefaultColumnName)];
                _pending = first;
            }
        }

        Info = new ImportReadInfo(new ImportEncodingInfo(encoding, bom), _delimiter?.ToString(), null, null, null, columns);
    }

    protected override ImportRecord? ReadNext(CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var raw = _pending ?? Parse();
            _pending = null;
            if (raw is null)
                return null;

            // RN-IMPORT-004: a linha sem nenhum caractere é pulada sempre que o arquivo tem mais de uma coluna; com "Pular linhas vazias", também a que só
            // tem separadores, espaços e tabulações. No arquivo de uma coluna só, sem a opção, a linha sem nenhum caractere é um campo vazio.
            if ((raw.Empty && (options.SkipEmptyLines || _width > 1)) || (raw.Blank && options.SkipEmptyLines))
            {
                SkippedLines++;
                continue;
            }

            return ToRecord(raw);
        }
    }

    private ImportRecord ToRecord(RawRecord raw)
    {
        var values = new ImportValue[_width];
        var count = Math.Min(raw.Fields.Count, _width);
        for (var index = 0; index < count; index++)
            values[index] = new ImportValue(raw.Fields[index].Text, raw.Fields[index].Quoted ? EImportValueSource.Quoted : EImportValueSource.Plain);

        // RN-IMPORT-004: os que faltam vão como nulo, e a linha é marcada; os que sobram só passam vazios (os separadores a mais no fim).
        for (var index = count; index < _width; index++)
            values[index] = ImportValue.Null;

        ImportProblem? problem = null;
        if (raw.Fields.Count > _width && raw.Fields.Skip(_width).Any(field => field.Text.Length > 0))
            problem = new ImportProblem($"A linha {ImportText.Thousands(raw.Line)} tem {ImportText.Thousands(raw.Fields.Count)} valores, e {(_header ? "o cabeçalho" : "a primeira linha")} tem {ImportText.Thousands(_width)}.");

        return new ImportRecord(raw.Line, values, problem, raw.Fields.Count < _width);
    }

    /// <summary>RN-IMPORT-004: o cabeçalho (ou, sem ele, a primeira linha de dados) é o primeiro registro que tem algo além de separadores, espaços e tabulações.</summary>
    private RawRecord? ReadNonBlank(CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var raw = Parse();
            if (raw is null || !(raw.Empty || raw.Blank))
                return raw;

            SkippedLines++;
        }
    }

    /// <summary>O registro seguinte, ou nulo no fim do arquivo. Recusa a codificação inválida, a aspa que não fecha e os limites, com a linha.</summary>
    private RawRecord? Parse()
    {
        var next = _source.Peek();
        if (next == TextSource.End)
            return null;

        var start = _line;
        var fields = new List<RawField>();
        var text = new StringBuilder();
        var quoted = false;
        var inQuotes = false;
        var atFieldStart = true;
        var any = false;
        var blank = true;
        long quoteLine = 0;
        long fieldBytes = 0;
        long rowBytes = 0;

        while (true)
        {
            var read = _source.Read();
            if (read == TextSource.Invalid)
                throw InvalidEncoding();

            if (read == TextSource.End)
            {
                if (inQuotes)
                    throw new ImportReadException(new ImportReadFailure(EImportReadReason.Format, $"A aspa aberta na linha {ImportText.Thousands(quoteLine)} não fecha até o fim do arquivo.", quoteLine));

                break;
            }

            var character = (char)read;
            if (inQuotes)
            {
                if (character == '"')
                {
                    if (_source.Peek() != '"')
                    {
                        inQuotes = false;
                        continue;
                    }

                    _source.Read();
                }
                else if (character == '\r' || character == '\n')
                {
                    if (character == '\r' && _source.Peek() == '\n')
                    {
                        Append(text, character, ref fieldBytes, ref rowBytes, start, fields.Count);
                        character = (char)_source.Read();
                    }

                    _line++;
                }

                Append(text, character, ref fieldBytes, ref rowBytes, start, fields.Count);
                continue;
            }

            if (character == _delimiter)
            {
                any = true;
                fields.Add(new RawField(text.ToString(), quoted));
                if (fields.Count >= MaxColumns)
                    throw TooManyColumns(start);

                text.Clear();
                quoted = false;
                atFieldStart = true;
                fieldBytes = 0;
                continue;
            }

            if (character == '\r' || character == '\n')
            {
                if (character == '\r' && _source.Peek() == '\n')
                    _source.Read();

                _line++;
                break;
            }

            any = true;
            if (atFieldStart && options.Quotes && character == '"')
            {
                inQuotes = quoted = true;
                quoteLine = _line;
                atFieldStart = false;
                blank = false;
                continue;
            }

            atFieldStart = false;
            if (character is not (' ' or '\t'))
                blank = false;

            Append(text, character, ref fieldBytes, ref rowBytes, start, fields.Count);
        }

        fields.Add(new RawField(text.ToString(), quoted));
        if (fields.Count > MaxColumns)
            throw TooManyColumns(start);

        return new RawRecord(start, fields, Empty: !any, Blank: any && blank);
    }

    /// <summary>RN-IMPORT-008: o valor acima de 64 MiB e a linha acima de 256 MiB param a leitura ali, sem montar o resto do valor.</summary>
    private void Append(StringBuilder text, char character, ref long fieldBytes, ref long rowBytes, long line, int field)
    {
        var bytes = character < 0x80 ? 1 : character < 0x800 ? 2 : char.IsSurrogate(character) ? 2 : 3;
        fieldBytes += bytes;
        rowBytes += bytes;
        if (fieldBytes > MaxValueBytes)
            throw ValueTooLarge($"da linha {ImportText.Thousands(line)} do arquivo", line, field < Columns.Count ? Columns[field] : ImportText.DefaultColumnName(field));

        if (rowBytes > MaxRowBytes)
            throw RowTooLarge($"A linha {ImportText.Thousands(line)} do arquivo", feminine: true, line);

        text.Append(character);
    }

    private ImportReadException InvalidEncoding()
    {
        var label = _encoding.StartsWith("utf-16", StringComparison.Ordinal) ? "UTF-16" : "UTF-8";

        return new ImportReadException(new ImportReadFailure(EImportReadReason.Encoding, $"O arquivo não é {label} válido na linha {ImportText.Thousands(_line)}. Escolha a codificação dele.", _line));
    }

    /// <summary>
    /// RN-IMPORT-004, o separador automático: conta os quatro fora das aspas nas primeiras 100 linhas (até 1 MiB) e escolhe o que aparece o mesmo número
    /// de vezes, mais de zero, no maior número de linhas; no empate, o primeiro na ordem `;`, `,`, tabulação e `|`. Sem nenhum deles, o arquivo tem uma
    /// coluna só (nulo). A sequência inválida para a amostra ali: quem a recusa, com a linha, é a leitura.
    /// </summary>
    private char? DetectDelimiter(CancellationToken cancellationToken)
    {
        var histograms = Delimiters.Select(_ => new Dictionary<int, int>()).ToArray();
        var counts = new int[Delimiters.Length];
        var inQuotes = false;
        var lines = 0;
        var chars = 0;
        var lineHasText = false;

        while (lines < DelimiterSampleLines && chars < DelimiterSampleChars)
        {
            if (chars % 4096 == 0)
                cancellationToken.ThrowIfCancellationRequested();

            var read = _source.Read();
            chars++;
            var endOfLine = read < 0 || (!inQuotes && read is '\r' or '\n');
            if (endOfLine)
            {
                if (read == '\r' && _source.Peek() == '\n')
                    _source.Read();

                if (lineHasText)
                {
                    for (var index = 0; index < Delimiters.Length; index++)
                    {
                        if (counts[index] > 0)
                            histograms[index][counts[index]] = histograms[index].GetValueOrDefault(counts[index]) + 1;
                    }

                    lines++;
                }

                Array.Clear(counts);
                lineHasText = false;
                if (read < 0)
                    break;

                continue;
            }

            lineHasText = true;
            if (options.Quotes && read == '"')
            {
                inQuotes = !inQuotes;
                continue;
            }

            if (inQuotes)
                continue;

            var position = Array.IndexOf(Delimiters, (char)read);
            if (position >= 0)
                counts[position]++;
        }

        var best = -1;
        var bestScore = 0;
        for (var index = 0; index < Delimiters.Length; index++)
        {
            var score = histograms[index].Count == 0 ? 0 : histograms[index].Values.Max();
            if (score > bestScore)
            {
                best = index;
                bestScore = score;
            }
        }

        return best < 0 ? null : Delimiters[best];
    }

    private sealed record RawField(string Text, bool Quoted)
    {
        public override string ToString()
            => nameof(RawField);
    }

    /// <param name="Empty">A linha não tem nenhum caractere.</param>
    /// <param name="Blank">A linha só tem separadores, espaços e tabulações (sem aspas).</param>
    private sealed record RawRecord(long Line, IReadOnlyList<RawField> Fields, bool Empty, bool Blank)
    {
        public override string ToString()
            => nameof(RawRecord);
    }
}
