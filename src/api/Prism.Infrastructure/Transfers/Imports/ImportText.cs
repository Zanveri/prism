using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>
/// RN-IMPORT-004, 006, 008, 010 e 028: as funções puras da leitura que as fixtures de ouro conferem: a volta da proteção contra fórmula (a mesma regra do
/// `csvFieldOf` da tela e do `ExportText.CsvField`, com as mesmas expressões), o `_xHHHH_` do texto do XLSX (a volta do `ExportText.XlsxText`), as pontas
/// e o valor citado nas recusas. As expressões terminam em `\z`, e não em `$`, como as do `ExportText`: o `$` do .NET aceita uma quebra de linha antes do
/// fim, e o do JavaScript não.
/// </summary>
public static partial class ImportText
{
    /// <summary>RN-IMPORT-010: as recusas citam o valor com até 200 caracteres.</summary>
    public const int MaxQuotedLength = 200;

    /// <summary>RN-IMPORT-008: as células das prévias vão cortadas nos 1.000 caracteres.</summary>
    public const int MaxPreviewLength = 1000;

    /// <summary>RN-IMPORT-011: o binário da prévia mostra os primeiros 32 bytes.</summary>
    public const int MaxPreviewBytes = 32;

    /// <summary>
    /// RN-IMPORT-004: a volta exata da proteção contra fórmula. O valor que começa por `'` e cujo resto a proteção protegeria (o primeiro caractere depois
    /// de espaços, tabulações e retornos de carro é `=`, `+`, `-` ou `@`, e o resto não é um número simples) perde o apóstrofo; o resto fica como está
    /// (`'abc`, `'-1` e `''=x` não mudam). As condições são conferidas sobre o resto inteiro, sem tirar nada dele.
    /// </summary>
    public static string Unguard(string value, out bool removed)
    {
        removed = value.Length > 1 && value[0] == '\'' && StartsAsFormula().IsMatch(value.AsSpan(1)) && !SimpleNumber().IsMatch(value.AsSpan(1));

        return removed ? value[1..] : value;
    }

    /// <summary>RN-IMPORT-004 e 010: o valor sem os espaços (U+0020) e as tabulações das pontas.</summary>
    public static string TrimEnds(string text)
        => text.Trim(' ', '\t');

    /// <summary>
    /// RN-IMPORT-006 e 028: o texto de uma célula do XLSX com o escape `_xHHHH_` desfeito (o `x` minúsculo e quatro dígitos hexadecimais, maiúsculos ou
    /// minúsculos), da esquerda para a direita: `_x000D_` é o retorno de carro, e `_x005F_x0041_` é o texto `_x0041_`. É a volta do `XlsxText` da
    /// exportação (depois de o XML desfazer as entidades).
    /// </summary>
    public static string XlsxText(string text)
    {
        if (!text.Contains("_x", StringComparison.Ordinal))
            return text;

        var decoder = new XlsxTextDecoder(long.MaxValue);
        decoder.Append(text);

        return decoder.Finish();
    }

    /// <summary>
    /// RN-IMPORT-010: o valor como as recusas o citam, entre aspas angulares, com até 200 caracteres (sem partir um par substituto) e "…" depois do corte.
    /// </summary>
    public static string Quoted(string value)
        => $"«{Cut(value, MaxQuotedLength)}»";

    /// <summary>RN-IMPORT-008: o texto até `length` unidades UTF-16, sem partir um par substituto, com "…" depois do corte.</summary>
    public static string Cut(string value, int length)
    {
        if (value.Length <= length)
            return value;

        var end = char.IsHighSurrogate(value[length - 1]) && char.IsLowSurrogate(value[length]) ? length - 1 : length;

        return $"{value[..end]}…";
    }

    /// <summary>O número com o ponto de milhar do português ("1.234"), sem depender da cultura da máquina.</summary>
    public static string Thousands(long value)
        => value.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', '.');

    /// <summary>RN-IMPORT-003 e 008: o tamanho em GB de 1.024³ bytes, com uma casa e a vírgula ("2,4 GB"), como o Windows o escreve.</summary>
    public static string Gigabytes(long bytes)
        => TenthsText(GigabyteTenths(bytes));

    /// <summary>
    /// RN-IMPORT-008: a recusa do arquivo acima de 2 GiB, com o tamanho dele. O arquivo que passa de 2 GiB por pouco não aparece como "2,0 GB", que seria
    /// o próprio limite: o tamanho mostrado é, no mínimo, "2,1 GB".
    /// </summary>
    public static string TooLarge(long bytes)
        => $"O arquivo tem {TenthsText(Math.Max(GigabyteTenths(bytes), 21))}, e o Prism importa até 2 GB.";

    private static long GigabyteTenths(long bytes)
        => (long)Math.Round(bytes * 10.0 / (1L << 30), MidpointRounding.AwayFromZero);

    private static string TenthsText(long tenths)
        => $"{tenths / 10},{tenths % 10} GB";

    /// <summary>A letra da coluna da planilha (a primeira é 0 e vale `A`; a 16.383 é `XFD`).</summary>
    public static string ColumnLetters(int index)
    {
        var letters = string.Empty;
        for (var number = index + 1; number > 0; number = (number - 1) / 26)
            letters = (char)('A' + ((number - 1) % 26)) + letters;

        return letters;
    }

    /// <summary>
    /// RN-IMPORT-004 e 006: os nomes das colunas do arquivo, a partir dos textos do cabeçalho: sem os espaços e as tabulações das pontas; o vazio vira
    /// "Coluna 3" (a posição, a partir de 1), e o repetido ganha " (2)", " (3)"… (o primeiro número livre, letra por letra).
    /// </summary>
    public static IReadOnlyList<string> ColumnNames(IReadOnlyList<string?> header)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        var names = new List<string>(header.Count);
        for (var position = 0; position < header.Count; position++)
        {
            var name = TrimEnds(header[position] ?? string.Empty);
            if (name.Length == 0)
                name = DefaultColumnName(position);

            var unique = name;
            for (var suffix = 2; used.Contains(unique); suffix++)
                unique = $"{name} ({suffix})";

            used.Add(unique);
            names.Add(unique);
        }

        return names;
    }

    /// <summary>RN-IMPORT-004: o nome da coluna sem cabeçalho ("Coluna 1"), pela posição a partir de 0.</summary>
    public static string DefaultColumnName(int position)
        => $"Coluna {position + 1}";

    /// <summary>RN-IMPORT-008: o tamanho do texto em bytes de UTF-8, contado sem montar os bytes (o par substituto solto conta 3, como o U+FFFD que o trocaria).</summary>
    public static long Utf8Length(ReadOnlySpan<char> text)
    {
        long bytes = 0;
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (character < 0x80)
                bytes++;
            else if (character < 0x800)
                bytes += 2;
            else if (char.IsHighSurrogate(character) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]))
            {
                bytes += 4;
                index++;
            }
            else
                bytes += 3;
        }

        return bytes;
    }

    internal static bool IsHex(ReadOnlySpan<char> digits)
    {
        foreach (var digit in digits)
        {
            if (!char.IsAsciiHexDigit(digit))
                return false;
        }

        return true;
    }

    /// <summary>A mesma expressão do `csvFieldOf` da tela e do `ExportText.CsvField`.</summary>
    [GeneratedRegex(@"^[ \t\r]*[=+\-@]")]
    private static partial Regex StartsAsFormula();

    /// <summary>A mesma expressão do `csvFieldOf` da tela e do `ExportText.CsvField` (só os dígitos de 0 a 9, como o `\d` do JavaScript), terminada em `\z`.</summary>
    [GeneratedRegex(@"^-?(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex SimpleNumber();
}

/// <summary>
/// RN-IMPORT-006 e 008: o texto de uma célula do XLSX montado em pedaços, como o <see cref="System.Xml.XmlReader"/> o entrega (`ReadValueChunk`), com o
/// `_xHHHH_` desfeito no caminho, da esquerda para a direita (a mesma regra do <see cref="ImportText.XlsxText"/>, que é ele com um pedaço só). O que
/// sobra no fim de um pedaço e ainda pode ser o começo de um escape (até seis caracteres depois de um `_`) espera o pedaço seguinte. Com `decode`
/// desligado, o texto vai como veio (o `v` de um número). Para de montar ao passar de `maxChars` caracteres já desfeitos: a leitura recusa o valor sem
/// guardá-lo inteiro.
/// </summary>
public sealed class XlsxTextDecoder(long maxChars, bool decode = true)
{
    /// <summary>O escape tem sete caracteres: `_x`, quatro dígitos hexadecimais e `_`.</summary>
    private const int EscapeLength = 7;

    private readonly StringBuilder _text = new();
    private string _carry = string.Empty;

    /// <summary>Os caracteres já montados, com os que esperam o pedaço seguinte (que não mudam de tamanho: menos de sete nunca são um escape).</summary>
    public long Length => _text.Length + _carry.Length;

    /// <summary>Junta um pedaço. Falso quando o texto passou de `maxChars`: quem lê para ali.</summary>
    public bool Append(ReadOnlySpan<char> chunk)
    {
        if (!decode)
        {
            _text.Append(chunk);

            return Length <= maxChars;
        }

        var joined = _carry.Length == 0 ? null : string.Concat(_carry, chunk);
        var span = joined is null ? chunk : joined.AsSpan();
        _carry = string.Empty;
        var index = 0;
        while (index < span.Length)
        {
            var underscore = span[index..].IndexOf('_');
            if (underscore < 0)
            {
                _text.Append(span[index..]);
                index = span.Length;
                break;
            }

            _text.Append(span.Slice(index, underscore));
            index += underscore;
            if (index + EscapeLength > span.Length)
                break;

            if (span[index + 1] == 'x' && span[index + 6] == '_' && ImportText.IsHex(span.Slice(index + 2, 4)))
            {
                _text.Append((char)int.Parse(span.Slice(index + 2, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                index += EscapeLength;
                continue;
            }

            _text.Append('_');
            index++;
        }

        _carry = span[index..].ToString();

        return Length <= maxChars;
    }

    /// <summary>O texto inteiro; o que esperava o pedaço seguinte vai como veio.</summary>
    public string Finish()
    {
        _text.Append(_carry);
        _carry = string.Empty;

        return _text.ToString();
    }

    public override string ToString()
        => nameof(XlsxTextDecoder);
}
