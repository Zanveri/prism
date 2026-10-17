using Prism.Infrastructure.Transfers.Imports;
using System.Buffers;
using System.Text.Unicode;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-004: o texto de um arquivo, um caractere por vez, decodificado em blocos pela codificação escolhida, sem montar o arquivo na memória. A
/// sequência inválida (no UTF-8 e no UTF-16) não vira U+FFFD nem exceção: os caracteres válidos antes dela saem, e depois <see cref="Read"/> responde
/// <see cref="Invalid"/>, para quem lê dizer em que linha ela está. Windows-1252 e ISO-8859-1 leem qualquer byte. O BOM da codificação, no começo, é pulado.
/// </summary>
internal sealed class TextSource
{
    public const int End = -1;
    public const int Invalid = -2;

    private const int BlockBytes = 64 * 1024;

    /// <summary>Os 32 caracteres que o Windows-1252 põe de 0x80 a 0x9F; os cinco que ele não define (0x81, 0x8D, 0x8F, 0x90 e 0x9D) ficam o controle C1 do mesmo número, como o Windows os lê.</summary>
    private static readonly char[] Windows1252High =
    [
        '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u008D', 'Ž', '\u008F',
        '\u0090', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u009D', 'ž', 'Ÿ'
    ];

    private readonly Stream _stream;
    private readonly string _encoding;
    private readonly byte[] _bytes = new byte[BlockBytes];
    private readonly char[] _chars = new char[BlockBytes];
    private int _byteStart;
    private int _byteEnd;
    private int _charStart;
    private int _charEnd;
    private bool _endOfStream;
    private bool _invalid;
    private long _consumed;

    /// <param name="encoding">Um dos nomes de <see cref="ImportEncodings"/>, menos `auto`.</param>
    public TextSource(Stream stream, string encoding)
    {
        _stream = stream;
        _encoding = encoding;
        Bom = SkipBom();
    }

    /// <summary>O arquivo começava pelo BOM da codificação, que foi pulado.</summary>
    public bool Bom { get; }

    /// <summary>Os bytes do arquivo que já viraram caracteres entregues ou prontos para sair (RN-IMPORT-014, o progresso).</summary>
    public long Position => _consumed;

    public int Peek()
    {
        if (_charStart == _charEnd && !Fill())
            return _invalid ? Invalid : End;

        return _chars[_charStart];
    }

    public int Read()
    {
        var next = Peek();
        if (next >= 0)
            _charStart++;

        return next;
    }

    /// <summary>
    /// RN-IMPORT-004, a codificação automática: a do BOM, quando o arquivo começa por um (UTF-8, UTF-16 LE ou UTF-16 BE); sem BOM, UTF-8 quando o
    /// arquivo inteiro é UTF-8 válido e não tem o byte zero; senão, Windows-1252. Lê o arquivo inteiro, em blocos, sem guardá-lo, e volta ao começo.
    /// </summary>
    public static ImportEncodingInfo Detect(Stream stream, CancellationToken cancellationToken)
    {
        stream.Position = 0;
        Span<byte> start = stackalloc byte[3];
        var read = stream.ReadAtLeast(start, 3, throwOnEndOfStream: false);
        ImportEncodingInfo? bom = read switch
        {
            >= 3 when start[0] == 0xEF && start[1] == 0xBB && start[2] == 0xBF => new ImportEncodingInfo(ImportEncodings.Utf8, true),
            >= 2 when start[0] == 0xFF && start[1] == 0xFE => new ImportEncodingInfo(ImportEncodings.Utf16Le, true),
            >= 2 when start[0] == 0xFE && start[1] == 0xFF => new ImportEncodingInfo(ImportEncodings.Utf16Be, true),
            _ => null
        };

        stream.Position = 0;
        if (bom is not null)
            return bom;

        var bytes = ArrayPool<byte>.Shared.Rent(BlockBytes);
        var chars = ArrayPool<char>.Shared.Rent(BlockBytes);
        var pending = 0;
        var valid = true;
        while (valid)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = stream.Read(bytes, pending, BlockBytes - pending);
            var final = count == 0;
            var available = pending + count;
            if (bytes.AsSpan(pending, count).Contains((byte)0))
            {
                valid = false;
                break;
            }

            var offset = 0;
            while (true)
            {
                var status = Utf8.ToUtf16(bytes.AsSpan(offset, available - offset), chars.AsSpan(0, BlockBytes), out var bytesRead, out _, replaceInvalidSequences: false, isFinalBlock: final);
                offset += bytesRead;
                if (status == OperationStatus.DestinationTooSmall)
                    continue;

                valid = status != OperationStatus.InvalidData;
                break;
            }

            if (final || !valid)
                break;

            pending = available - offset;
            bytes.AsSpan(offset, pending).CopyTo(bytes);
        }

        ArrayPool<byte>.Shared.Return(bytes);
        ArrayPool<char>.Shared.Return(chars);
        stream.Position = 0;

        return new ImportEncodingInfo(valid ? ImportEncodings.Utf8 : ImportEncodings.Windows1252, false);
    }

    private bool SkipBom()
    {
        byte[] bom = _encoding switch
        {
            ImportEncodings.Utf8 => [0xEF, 0xBB, 0xBF],
            ImportEncodings.Utf16Le => [0xFF, 0xFE],
            ImportEncodings.Utf16Be => [0xFE, 0xFF],
            _ => []
        };

        if (bom.Length == 0 || !Refill() || _byteEnd - _byteStart < bom.Length && !RefillUntil(bom.Length))
            return false;

        if (!_bytes.AsSpan(_byteStart, bom.Length).SequenceEqual(bom))
            return false;

        _byteStart += bom.Length;
        _consumed += bom.Length;

        return true;
    }

    /// <summary>Lê mais bytes do arquivo para o fim do bloco, juntando ao começo o que sobrou sem decodificar. Falso quando não há mais nada a ler nem sobrou nada.</summary>
    private bool Refill()
    {
        if (_byteStart > 0)
        {
            _bytes.AsSpan(_byteStart, _byteEnd - _byteStart).CopyTo(_bytes);
            _byteEnd -= _byteStart;
            _byteStart = 0;
        }

        if (!_endOfStream && _byteEnd < _bytes.Length)
        {
            var count = _stream.Read(_bytes, _byteEnd, _bytes.Length - _byteEnd);
            if (count == 0)
                _endOfStream = true;

            _byteEnd += count;
        }

        return _byteEnd > _byteStart;
    }

    private bool RefillUntil(int length)
    {
        while (_byteEnd - _byteStart < length && !_endOfStream)
            Refill();

        return _byteEnd - _byteStart >= length;
    }

    /// <summary>Decodifica o bloco seguinte. Falso no fim do arquivo e na sequência inválida (com os caracteres válidos antes dela já entregues).</summary>
    private bool Fill()
    {
        _charStart = 0;
        _charEnd = 0;

        while (!_invalid)
        {
            if (_byteEnd - _byteStart < 4 && !_endOfStream)
                Refill();

            if (_byteEnd == _byteStart)
                return false;

            var before = _byteStart;
            _charEnd = _encoding switch
            {
                ImportEncodings.Utf8 => DecodeUtf8(),
                ImportEncodings.Utf16Le => DecodeUtf16(littleEndian: true),
                ImportEncodings.Utf16Be => DecodeUtf16(littleEndian: false),
                ImportEncodings.Windows1252 => DecodeSingleByte(windows1252: true),
                _ => DecodeSingleByte(windows1252: false)
            };
            _consumed += _byteStart - before;

            if (_charEnd > 0)
                return true;

            // Sem caractere e sem recusa: o bloco terminou no meio de uma sequência, e ela continua no bloco seguinte.
            if (!_invalid && !Refill())
                return false;
        }

        return false;
    }

    private int DecodeUtf8()
    {
        var status = Utf8.ToUtf16(_bytes.AsSpan(_byteStart, _byteEnd - _byteStart), _chars, out var bytesRead, out var written, replaceInvalidSequences: false, isFinalBlock: _endOfStream);
        _byteStart += bytesRead;
        if (status == OperationStatus.InvalidData)
            _invalid = true;

        return written;
    }

    /// <summary>
    /// Um caractere a cada dois bytes, na ordem pedida. O par substituto tem de vir inteiro: o alto seguido do baixo. O alto que fica no fim do bloco espera
    /// o bloco seguinte; o byte que sobra no fim do arquivo, o baixo sem o alto e o alto sem o baixo são a sequência inválida.
    /// </summary>
    private int DecodeUtf16(bool littleEndian)
    {
        var written = 0;
        while (_byteEnd - _byteStart >= 2 && written < _chars.Length)
        {
            var character = Utf16At(_byteStart, littleEndian);
            if (char.IsHighSurrogate(character))
            {
                if (_byteEnd - _byteStart < 4)
                {
                    if (_endOfStream)
                        _invalid = true;

                    return written;
                }

                if (!char.IsLowSurrogate(Utf16At(_byteStart + 2, littleEndian)))
                {
                    _invalid = true;

                    return written;
                }

                if (written + 2 > _chars.Length)
                    return written;

                _chars[written++] = character;
                _chars[written++] = Utf16At(_byteStart + 2, littleEndian);
                _byteStart += 4;
                continue;
            }

            if (char.IsLowSurrogate(character))
            {
                _invalid = true;

                return written;
            }

            _chars[written++] = character;
            _byteStart += 2;
        }

        if (written == 0 && _endOfStream && _byteEnd - _byteStart == 1)
            _invalid = true;

        return written;
    }

    private char Utf16At(int index, bool littleEndian)
        => littleEndian ? (char)(_bytes[index] | (_bytes[index + 1] << 8)) : (char)((_bytes[index] << 8) | _bytes[index + 1]);

    private int DecodeSingleByte(bool windows1252)
    {
        var count = Math.Min(_byteEnd - _byteStart, _chars.Length);
        for (var index = 0; index < count; index++)
        {
            var value = _bytes[_byteStart + index];
            _chars[index] = windows1252 && value is >= 0x80 and <= 0x9F ? Windows1252High[value - 0x80] : (char)value;
        }

        _byteStart += count;

        return count;
    }
}
