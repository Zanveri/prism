using Prism.Infrastructure.Transfers.Imports;
using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Unicode;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-005: o JSON, lido em fluxo pelo <see cref="Utf8JsonReader"/>, sobre um espaço que só cresce até o tamanho de um valor. O arquivo tem uma de
/// duas formas, as que o Prism e o DBeaver exportam: uma lista de objetos, ou um objeto com uma chave só cujo valor é uma lista de objetos. Cada objeto é
/// uma linha; o item que não é objeto, a chave repetida e a chave que não estava no arquivo quando ele foi lido são problemas da linha.
///
/// As colunas são todas as chaves do arquivo inteiro, na ordem em que aparecem pela primeira vez: sem `keys` no pedido, a abertura percorre o arquivo todo
/// (sem guardá-lo) para achá-las, e volta ao começo. O arquivo é UTF-8, com ou sem BOM, conferido bloco a bloco antes de o leitor do .NET o ver, para a
/// recusa dizer a linha.
/// </summary>
internal sealed class JsonImportReader(Stream stream, JsonImportOptions options, ILogger logger) : ImportReader(stream, logger)
{
    private const string ShapeMessage = "O JSON não é uma lista de objetos, nem um objeto com uma lista de objetos dentro.";

    private Tokens _tokens = null!;
    private Dictionary<string, int> _positions = new(StringComparer.Ordinal);
    private bool _objectForm;
    private long _item;
    private bool _listDone;

    public override long Position => _tokens?.Consumed ?? 0;

    public override long Size => Stream.Length;

    /// <summary>RN-IMPORT-005: o JSON mal formado, com a linha e a posição que o leitor do .NET dá, somadas de 1 (a posição é em bytes, e não em caracteres).</summary>
    public static ImportReadFailure Malformed(JsonException exception)
    {
        var line = (exception.LineNumber ?? 0) + 1;

        return new ImportReadFailure(EImportReadReason.Format, $"O arquivo não é um JSON válido: erro na linha {ImportText.Thousands(line)}, byte {ImportText.Thousands((exception.BytePositionInLine ?? 0) + 1)} da linha.", line);
    }

    protected override void Begin(CancellationToken cancellationToken)
    {
        var listKey = OpenList(cancellationToken);
        var columns = options.Keys;
        if (columns is null)
        {
            columns = ScanKeys(cancellationToken);
            _listDone = false;
            _item = 0;
            OpenList(cancellationToken);
        }

        _positions = columns.Select((key, position) => (key, position)).GroupBy(column => column.key, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First().position, StringComparer.Ordinal);
        Info = new ImportReadInfo(null, null, listKey, null, null, columns);
    }

    protected override ImportRecord? ReadNext(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_listDone)
            return null;

        if (!_tokens.Next())
            throw Shape();

        if (_tokens.Type == JsonTokenType.EndArray)
        {
            CloseList();

            return null;
        }

        _item++;
        var values = Enumerable.Repeat(ImportValue.Null, Columns.Count).ToArray();
        if (_tokens.Type != JsonTokenType.StartObject)
        {
            SkipValue();

            return new ImportRecord(_item, values, new ImportProblem($"O item {ImportText.Thousands(_item)} da lista não é um objeto."), false);
        }

        ImportProblem? problem = null;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        long rowBytes = 0;
        while (_tokens.Next() && _tokens.Type == JsonTokenType.PropertyName)
        {
            var key = _tokens.Text!;
            var value = ReadValue(key);
            rowBytes += value.Text is null ? 0 : ImportText.Utf8Length(value.Text);
            if (rowBytes > MaxRowBytes)
                throw RowTooLarge($"O item {ImportText.Thousands(_item)} da lista", feminine: false, _item);

            if (!seen.Add(key))
                problem ??= new ImportProblem($"O item {ImportText.Thousands(_item)} da lista tem a chave {key} duas vezes.");
            else if (!_positions.TryGetValue(key, out var position))
                problem ??= new ImportProblem($"O item {ImportText.Thousands(_item)} da lista tem a chave {key}, que não estava no arquivo quando ele foi lido.");
            else
                values[position] = value;
        }

        return new ImportRecord(_item, values, problem, false);
    }

    /// <summary>A forma do arquivo, até o começo da lista: `[`, ou `{` com a chave da lista e o `[`. Devolve a chave (nula na lista solta).</summary>
    private string? OpenList(CancellationToken cancellationToken)
    {
        _tokens = new Tokens(Stream, cancellationToken);
        if (!_tokens.Next())
            throw Shape();

        _objectForm = _tokens.Type == JsonTokenType.StartObject;
        if (_tokens.Type == JsonTokenType.StartArray)
            return null;

        if (!_objectForm || !_tokens.Next() || _tokens.Type != JsonTokenType.PropertyName)
            throw Shape();

        var key = _tokens.Text!;
        if (!_tokens.Next() || _tokens.Type != JsonTokenType.StartArray)
            throw Shape();

        return key;
    }

    /// <summary>O fim da lista: na forma do objeto, ele tem de fechar logo depois dela (uma chave só); e nada vem depois do JSON.</summary>
    private void CloseList()
    {
        _listDone = true;
        if (_objectForm && (!_tokens.Next() || _tokens.Type != JsonTokenType.EndObject))
            throw Shape();

        if (_tokens.Next())
            throw Shape();
    }

    /// <summary>RN-IMPORT-005 e 008: todas as chaves do arquivo, na ordem em que aparecem pela primeira vez, até 16.384, cada uma com até 256 caracteres.</summary>
    private List<string> ScanKeys(CancellationToken cancellationToken)
    {
        var keys = new List<string>();
        var known = new HashSet<string>(StringComparer.Ordinal);

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_tokens.Next())
                throw Shape();

            if (_tokens.Type == JsonTokenType.EndArray)
            {
                CloseList();

                return keys;
            }

            _item++;
            if (_tokens.Type != JsonTokenType.StartObject)
            {
                SkipValue();
                continue;
            }

            while (_tokens.Next() && _tokens.Type == JsonTokenType.PropertyName)
            {
                var key = _tokens.Text!;
                if (known.Add(key))
                {
                    if (keys.Count == MaxColumns)
                        throw TooManyColumns(null);

                    if (key.Length > MaxColumnNameLength)
                        throw ColumnNameTooLong(keys.Count);

                    keys.Add(key);
                }

                ReadValue(key);
            }
        }
    }

    /// <summary>
    /// RN-IMPORT-005: o valor de uma chave: o texto, com os escapes desfeitos; o número, o texto dele como está no arquivo; `true` e `false`; `null`; o
    /// objeto e a lista, o texto JSON deles como está no arquivo. RN-IMPORT-008: até 64 MiB.
    /// </summary>
    private ImportValue ReadValue(string key)
    {
        if (!_tokens.Next())
            throw Shape();

        ImportValue value;
        if (_tokens.Type is JsonTokenType.StartObject or JsonTokenType.StartArray)
        {
            var raw = _tokens.SkipRaw(MaxValueBytes);
            value = raw is null ? throw ValueTooLarge(Place(), _item, key) : new ImportValue(raw, EImportValueSource.Json);
        }
        else
        {
            // RN-IMPORT-008: o texto ou o número sem escape acima de 64 MiB no arquivo passa do limite já ali, sem virar um `string`.
            if (_tokens.Oversized)
                throw ValueTooLarge(Place(), _item, key);

            value = _tokens.Type switch
            {
                JsonTokenType.String => new ImportValue(_tokens.Text, EImportValueSource.Text),
                JsonTokenType.Number => new ImportValue(_tokens.Text, EImportValueSource.Canonical),
                JsonTokenType.True => new ImportValue("true", EImportValueSource.Canonical),
                JsonTokenType.False => new ImportValue("false", EImportValueSource.Canonical),
                _ => ImportValue.Null
            };
        }

        if (value.Text is { } text && ImportText.Utf8Length(text) > MaxValueBytes)
            throw ValueTooLarge(Place(), _item, key);

        return value;
    }

    /// <summary>O item que não é objeto: o objeto ou a lista dele é pulado inteiro (o texto não importa, e não precisa caber no espaço).</summary>
    private void SkipValue()
    {
        if (_tokens.Type is JsonTokenType.StartObject or JsonTokenType.StartArray)
            _tokens.SkipRaw(null);
    }

    private string Place()
        => $"do item {ImportText.Thousands(_item)} da lista";

    private static ImportReadException Shape()
        => new(new ImportReadFailure(EImportReadReason.Format, ShapeMessage));

    /// <summary>
    /// Os tokens do arquivo, um por vez: o <see cref="Utf8JsonReader"/> é recriado a cada token sobre o espaço, com o estado do anterior, e o espaço é
    /// enchido (e, para um token maior que ele, aumentado) quando o token não cabe. O UTF-8 de cada bloco é conferido antes, com a linha.
    /// </summary>
    private sealed class Tokens
    {
        private const int BlockBytes = 64 * 1024;

        /// <summary>RN-IMPORT-008: o maior token que o espaço guarda: um texto de 64 MiB todo escrito em `\u00XX` tem seis bytes por byte.</summary>
        private const int MaxTokenBytes = (int)(6 * MaxValueBytes) + BlockBytes;

        private readonly Stream _stream;
        private readonly CancellationToken _cancellationToken;
        private byte[] _buffer = new byte[BlockBytes];
        private int _start;
        private int _end;
        private int _validated;
        private bool _final;
        private long _base;
        private long _line = 1;
        private JsonReaderState _state = new(new JsonReaderOptions { CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 64 });

        /// <summary>De onde o leitor partiu para o token atual, e com que estado: é por aqui que o objeto ou a lista de um valor é lido de novo, inteiro.</summary>
        private int _tokenFrom;
        private JsonReaderState _tokenState;

        public Tokens(Stream stream, CancellationToken cancellationToken)
        {
            _stream = stream;
            _cancellationToken = cancellationToken;

            // RFC 8259: o BOM do UTF-8 é tolerado no começo, e pulado.
            stream.Position = 0;
            Span<byte> bom = stackalloc byte[3];
            var read = stream.ReadAtLeast(bom, 3, throwOnEndOfStream: false);
            _base = read == 3 && bom[0] == 0xEF && bom[1] == 0xBB && bom[2] == 0xBF ? 3 : 0;
            stream.Position = _base;
        }

        public JsonTokenType Type { get; private set; }

        /// <summary>O texto do token: o nome, o texto com os escapes desfeitos (o par substituto solto fica como veio, para a conversão o recusar) ou o número como está.</summary>
        public string? Text { get; private set; }

        /// <summary>
        /// RN-IMPORT-008: o texto ou o número sem escape com mais de 64 MiB no arquivo, que são os bytes de UTF-8 dele: passa do limite, e o <see cref="Text"/>
        /// fica nulo, sem montar o valor. O texto com escape é desfeito e conferido depois (ele só encolhe ao ser desfeito).
        /// </summary>
        public bool Oversized { get; private set; }

        public long Consumed => _base + _start;

        public bool Next()
        {
            while (true)
            {
                var reader = new Utf8JsonReader(_buffer.AsSpan(_start, _validated - _start), _final && _validated == _end, _state);
                if (reader.Read())
                {
                    Type = reader.TokenType;
                    Oversized = Type is JsonTokenType.String or JsonTokenType.Number && !reader.ValueIsEscaped && reader.ValueSpan.Length > MaxValueBytes;
                    Text = Oversized ? null : Type switch
                    {
                        JsonTokenType.PropertyName or JsonTokenType.String => Unescape(reader.ValueSpan, reader.ValueIsEscaped),
                        JsonTokenType.Number => Encoding.UTF8.GetString(reader.ValueSpan),
                        _ => null
                    };

                    _tokenFrom = _start;
                    _tokenState = _state;
                    _start += (int)reader.BytesConsumed;
                    _state = reader.CurrentState;

                    return true;
                }

                if (_final && _validated == _end)
                    return false;

                Fill(_start);
            }
        }

        /// <summary>
        /// O objeto ou a lista que começa no token atual, inteiro, no texto como está no arquivo, com o espaço guardando o valor todo até `limit` bytes:
        /// nulo quando ele passa disso. Sem `limit`, o valor é só pulado, e devolve nulo.
        /// </summary>
        public string? SkipRaw(long? limit)
        {
            while (true)
            {
                var reader = new Utf8JsonReader(_buffer.AsSpan(_tokenFrom, _validated - _tokenFrom), _final && _validated == _end, _tokenState);
                reader.Read();
                var rawStart = _tokenFrom + (int)reader.TokenStartIndex;
                if (reader.TrySkip())
                {
                    var end = _tokenFrom + (int)reader.BytesConsumed;
                    var raw = limit is null ? null : Encoding.UTF8.GetString(_buffer, rawStart, end - rawStart);
                    _start = end;
                    _state = reader.CurrentState;
                    Type = JsonTokenType.None;

                    return raw;
                }

                if (limit is { } maximum && _validated - rawStart > maximum)
                    return null;

                Fill(_tokenFrom);
            }
        }

        /// <summary>Lê mais do arquivo para o espaço, mantendo o que ainda não foi lido desde `keep`, e confere o UTF-8 do que chegou.</summary>
        private void Fill(int keep)
        {
            _cancellationToken.ThrowIfCancellationRequested();
            if (keep > 0)
            {
                _buffer.AsSpan(keep, _end - keep).CopyTo(_buffer);
                _base += keep;
                _start -= keep;
                _tokenFrom -= keep;
                _validated -= keep;
                _end -= keep;
            }

            if (_end == _buffer.Length)
            {
                if (_buffer.Length >= MaxTokenBytes)
                    throw new ImportReadException(new ImportReadFailure(EImportReadReason.Limits, "Um valor do arquivo passa de 64 MiB, e o Prism não o importa.", _line, ValueTooLarge: true));

                Array.Resize(ref _buffer, (int)Math.Min((long)_buffer.Length * 2, MaxTokenBytes));
            }

            var read = _stream.Read(_buffer, _end, _buffer.Length - _end);
            if (read == 0)
                _final = true;

            _end += read;
            Validate();
        }

        /// <summary>RN-IMPORT-005: o UTF-8 do que chegou, até o fim da última sequência completa; a inválida recusa o arquivo, com a linha.</summary>
        private void Validate()
        {
            Span<char> scratch = stackalloc char[1024];
            while (_validated < _end)
            {
                var status = Utf8.ToUtf16(_buffer.AsSpan(_validated, _end - _validated), scratch, out var bytesRead, out _, replaceInvalidSequences: false, isFinalBlock: _final);
                _line += _buffer.AsSpan(_validated, bytesRead).Count((byte)'\n');
                _validated += bytesRead;
                if (status == OperationStatus.InvalidData)
                    throw new ImportReadException(new ImportReadFailure(EImportReadReason.Encoding, $"O JSON não é UTF-8 válido: erro na linha {ImportText.Thousands(_line)} do arquivo.", _line));

                if (status != OperationStatus.DestinationTooSmall)
                    break;
            }
        }

        /// <summary>
        /// O texto de um nome ou de um valor, com os escapes do JSON desfeitos à mão: o `GetString` do .NET recusa o par substituto solto (`"\ud83d"`),
        /// que aqui fica como veio, para a conversão o recusar no valor (RN-IMPORT-010), e não no arquivo. O leitor já conferiu cada escape.
        /// </summary>
        private static string Unescape(ReadOnlySpan<byte> raw, bool escaped)
        {
            if (!escaped)
                return Encoding.UTF8.GetString(raw);

            var text = new StringBuilder(raw.Length);
            while (raw.Length > 0)
            {
                var slash = raw.IndexOf((byte)'\\');
                if (slash < 0)
                {
                    text.Append(Encoding.UTF8.GetString(raw));
                    break;
                }

                text.Append(Encoding.UTF8.GetString(raw[..slash]));
                var code = raw[slash + 1];
                if (code == (byte)'u')
                {
                    text.Append((char)Convert.ToInt32(Encoding.ASCII.GetString(raw.Slice(slash + 2, 4)), 16));
                    raw = raw[(slash + 6)..];
                    continue;
                }

                text.Append(code switch
                {
                    (byte)'b' => '\b',
                    (byte)'f' => '\f',
                    (byte)'n' => '\n',
                    (byte)'r' => '\r',
                    (byte)'t' => '\t',
                    _ => (char)code
                });
                raw = raw[(slash + 2)..];
            }

            return text.ToString();
        }
    }
}
