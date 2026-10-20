using Prism.Infrastructure.Transfers.Imports;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>
/// RN-IMPORT-006 e 008: o .zip de um .xlsx, aberto com a proteção contra a bomba de zip. Antes do <see cref="ZipArchive"/> (que monta o diretório central
/// inteiro na memória ao procurar a primeira entrada), confere o registro de fim do diretório central (e o do ZIP64, quando há): no máximo 10.000
/// entradas, um diretório de até 4 MiB e que cabe no arquivo; depois percorre ele mesmo os cabeçalhos do diretório, sem ler os dados, contando as
/// entradas (o número declarado pode mentir) e recusando o nome repetido. Cada entrada aberta tem um teto, conferido antes pelo tamanho declarado e
/// enquanto se descompacta, pelo que sai de fato.
/// </summary>
internal sealed class XlsxPackage : IDisposable
{
    public const int MaxEntries = 10000;
    public const int MaxDirectoryBytes = 4 * 1024 * 1024;

    public const string LimitsMessage = "A planilha passa dos limites que o Prism lê de um .xlsx.";

    private const uint EndOfDirectorySignature = 0x06054b50;
    private const uint Zip64LocatorSignature = 0x07064b50;
    private const uint Zip64EndSignature = 0x06064b50;
    private const uint DirectoryHeaderSignature = 0x02014b50;
    private const int EndOfDirectoryLength = 22;
    private const int DirectoryHeaderLength = 46;

    private readonly ZipArchive _archive;

    private XlsxPackage(ZipArchive archive, IReadOnlyDictionary<string, long> declared)
    {
        _archive = archive;
        Declared = declared;
    }

    /// <summary>O tamanho descompactado que o diretório central declara para cada entrada, pelo nome.</summary>
    public IReadOnlyDictionary<string, long> Declared { get; }

    public static XlsxPackage Open(Stream stream)
    {
        var declared = Check(stream);
        stream.Position = 0;

        return new XlsxPackage(new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true), declared);
    }

    public bool Has(string name)
        => Declared.ContainsKey(name);

    /// <summary>A entrada, descompactada enquanto é lida, com o teto dela; a que falta é a pasta de trabalho que o Prism não lê.</summary>
    public CountingStream OpenEntry(string name, long limit)
    {
        var entry = _archive.GetEntry(name) ?? throw Format($"Este arquivo não é um .xlsx que o Prism lê: falta a parte {name}.");
        if (entry.Length > limit)
            throw Limits();

        return new CountingStream(entry.Open(), limit);
    }

    public void Dispose()
        => _archive.Dispose();

    public static ImportReadException Limits()
        => new(new ImportReadFailure(EImportReadReason.Limits, LimitsMessage));

    public static ImportReadException Format(string message)
        => new(new ImportReadFailure(EImportReadReason.Format, message));

    /// <summary>A conferência do .zip antes do <see cref="ZipArchive"/>: devolve o tamanho declarado de cada entrada, pelo nome.</summary>
    private static Dictionary<string, long> Check(Stream stream)
    {
        var length = stream.Length;
        Span<byte> head = stackalloc byte[4];
        stream.Position = 0;
        var read = stream.ReadAtLeast(head, 4, throwOnEndOfStream: false);

        // RN-IMPORT-003: o `.xls` e a planilha com senha são um arquivo composto do OLE, e não um .zip.
        if (read == 4 && head[0] == 0xD0 && head[1] == 0xCF && head[2] == 0x11 && head[3] == 0xE0)
            throw Format("Este arquivo não é um .xlsx que o Prism lê: é uma planilha do Excel antigo (.xls) ou uma planilha com senha. No Excel, salve-a como .xlsx, sem senha.");

        var tailLength = (int)Math.Min(length, EndOfDirectoryLength + ushort.MaxValue);
        var tail = new byte[tailLength];
        stream.Position = length - tailLength;
        stream.ReadExactly(tail);

        var at = -1;
        for (var index = tailLength - EndOfDirectoryLength; index >= 0; index--)
        {
            if (BinaryPrimitives.ReadUInt32LittleEndian(tail.AsSpan(index)) == EndOfDirectorySignature)
            {
                at = index;
                break;
            }
        }

        if (at < 0)
            throw Format("Este arquivo não é um .xlsx que o Prism lê: ele não é um .zip, como todo .xlsx.");

        var endOfDirectory = length - tailLength + at;
        long entries = BinaryPrimitives.ReadUInt16LittleEndian(tail.AsSpan(at + 10));
        long size = BinaryPrimitives.ReadUInt32LittleEndian(tail.AsSpan(at + 12));
        long offset = BinaryPrimitives.ReadUInt32LittleEndian(tail.AsSpan(at + 16));
        var limit = endOfDirectory;

        if (entries == ushort.MaxValue || size == uint.MaxValue || offset == uint.MaxValue)
        {
            if (endOfDirectory < 20)
                throw Limits();

            Span<byte> locator = stackalloc byte[20];
            stream.Position = endOfDirectory - 20;
            stream.ReadExactly(locator);
            if (BinaryPrimitives.ReadUInt32LittleEndian(locator) != Zip64LocatorSignature)
                throw Limits();

            var zip64 = BinaryPrimitives.ReadInt64LittleEndian(locator[8..]);
            if (zip64 < 0 || zip64 + 56 > endOfDirectory)
                throw Limits();

            Span<byte> record = stackalloc byte[56];
            stream.Position = zip64;
            stream.ReadExactly(record);
            if (BinaryPrimitives.ReadUInt32LittleEndian(record) != Zip64EndSignature)
                throw Limits();

            entries = BinaryPrimitives.ReadInt64LittleEndian(record[32..]);
            size = BinaryPrimitives.ReadInt64LittleEndian(record[40..]);
            offset = BinaryPrimitives.ReadInt64LittleEndian(record[48..]);
            limit = zip64;
        }

        if (entries is < 0 or > MaxEntries || size is < 0 or > MaxDirectoryBytes || offset < 0 || offset + size > limit)
            throw Limits();

        var directory = new byte[size];
        stream.Position = offset;
        stream.ReadExactly(directory);

        return Walk(directory);
    }

    /// <summary>Os cabeçalhos do diretório central, um a um, sem ler os dados: o nome e o tamanho descompactado de cada entrada (no ZIP64, pelo campo extra).</summary>
    private static Dictionary<string, long> Walk(byte[] directory)
    {
        var names = new Dictionary<string, long>(StringComparer.Ordinal);
        var position = 0;
        while (position < directory.Length)
        {
            if (position + DirectoryHeaderLength > directory.Length || BinaryPrimitives.ReadUInt32LittleEndian(directory.AsSpan(position)) != DirectoryHeaderSignature)
                throw Format("O .xlsx está estragado: o Prism não consegue descompactá-lo. No Excel, salve-o de novo como .xlsx.");

            long uncompressed = BinaryPrimitives.ReadUInt32LittleEndian(directory.AsSpan(position + 24));
            var nameLength = BinaryPrimitives.ReadUInt16LittleEndian(directory.AsSpan(position + 28));
            var extraLength = BinaryPrimitives.ReadUInt16LittleEndian(directory.AsSpan(position + 30));
            var commentLength = BinaryPrimitives.ReadUInt16LittleEndian(directory.AsSpan(position + 32));
            var next = position + DirectoryHeaderLength + nameLength + extraLength + commentLength;
            if (next > directory.Length)
                throw Format("O .xlsx está estragado: o Prism não consegue descompactá-lo. No Excel, salve-o de novo como .xlsx.");

            var name = Encoding.UTF8.GetString(directory, position + DirectoryHeaderLength, nameLength);
            if (uncompressed == uint.MaxValue)
                uncompressed = Zip64Size(directory.AsSpan(position + DirectoryHeaderLength + nameLength, extraLength));

            if (names.Count == MaxEntries || !names.TryAdd(name, uncompressed))
                throw Limits();

            position = next;
        }

        return names;
    }

    /// <summary>O tamanho descompactado do campo extra do ZIP64 (o identificador 0x0001, que começa por ele); sem o campo, o maior possível.</summary>
    private static long Zip64Size(ReadOnlySpan<byte> extra)
    {
        while (extra.Length >= 4)
        {
            var id = BinaryPrimitives.ReadUInt16LittleEndian(extra);
            var length = BinaryPrimitives.ReadUInt16LittleEndian(extra[2..]);
            if (id == 0x0001 && length >= 8 && extra.Length >= 12)
                return BinaryPrimitives.ReadInt64LittleEndian(extra[4..]);

            extra = extra.Length >= 4 + length ? extra[(4 + length)..] : [];
        }

        return long.MaxValue;
    }
}

/// <summary>
/// RN-IMPORT-008 e 014: o fluxo de uma entrada do .zip, que conta o que já saiu descompactado (o progresso da planilha) e para quando passa do teto da
/// entrada, sem confiar no tamanho que o .zip declara.
/// </summary>
internal sealed class CountingStream(Stream inner, long limit) : Stream
{
    public long Count { get; private set; }

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => Count;
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
        => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var read = inner.Read(buffer);
        Count += read;
        if (Count > limit)
            throw XlsxPackage.Limits();

        return read;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin)
        => throw new NotSupportedException();

    public override void SetLength(long value)
        => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count)
        => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            inner.Dispose();

        base.Dispose(disposing);
    }
}
