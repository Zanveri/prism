using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-013 e 024: as regras da planilha, as mesmas da tela (`to-xlsx.ts`): o texto com o escape `_xHHHH_` (`xlsxText`), o número que cabe no
/// Excel (`spreadsheetNumber`), o nome da planilha (`sheetNameOf`) e o corte nos 32.767 caracteres (`withinCell`), que as fixtures `xlsx-*.json`
/// conferem nos dois lados. O nome da planilha seguinte ("pedido (2)") é só da API.
/// </summary>
internal static partial class ExportText
{
    /// <summary>O texto de uma célula do Excel tem no máximo 32.767 caracteres (unidades UTF-16).</summary>
    public const int MaxCellLength = 32767;

    /// <summary>O nome de uma planilha tem no máximo 31 caracteres (unidades UTF-16).</summary>
    public const int MaxSheetNameLength = 31;

    /// <summary>O nome da planilha sem nada que sirva: o título padrão da tela.</summary>
    public const string DefaultSheetName = "Resultado";

    /// <summary>O menor número normal de um `double`: abaixo dele o valor perde dígitos, e o Excel não o guarda.</summary>
    private const double MinNormalNumber = 2.2250738585072014e-308;

    /// <summary>O maior número que o Excel guarda (9,99999999999999E+307).</summary>
    private const double MaxExcelNumber = 9.99999999999999e307;

    /// <summary>
    /// O texto dentro de `&lt;t&gt;`: o que o XML 1.0 não escreve (os controles fora da tabulação e da quebra de linha, o retorno de carro, U+FFFE, U+FFFF
    /// e o par substituto solto) como `_xHHHH_`, com 4 dígitos maiúsculos; o sublinhado de todo `_` seguido de `xHHHH` (o que PODE virar um escape, com
    /// ou sem o sublinhado do fim) como `_x005F_`; e `&amp;`, `&lt;` e `&gt;` escapados. A leitura de volta dá o texto de ida.
    /// </summary>
    public static string XlsxText(string text)
    {
        var spared = MayBeAnEscape().Replace(text, "_x005F_");
        var escaped = new StringBuilder(spared.Length + 8);

        foreach (var (codePoint, index, length) in CodePoints(spared))
        {
            if (codePoint == 0xD || !IsXmlChar(codePoint))
                escaped.Append("_x").Append(((int)spared[index]).ToString("X4", CultureInfo.InvariantCulture)).Append('_');
            else
                escaped.Append(spared, index, length);
        }

        return EscapeXmlText(escaped.ToString());
    }

    /// <summary>O texto até o limite da célula (32.767 unidades UTF-16), sem partir um par substituto ao meio.</summary>
    public static string WithinCell(string text)
    {
        if (text.Length <= MaxCellLength)
            return text;

        var splitsPair = char.IsHighSurrogate(text[MaxCellLength - 1]) && char.IsLowSurrogate(text[MaxCellLength]);

        return text[..(splitsPair ? MaxCellLength - 1 : MaxCellLength)];
    }

    /// <summary>
    /// O número como vai no `&lt;v&gt;` de uma célula numérica, ou nulo quando ele tem de ser texto: o Excel guarda um `double` e só garante 15 dígitos
    /// significativos. Entra o decimal na gramática do JSON (sem `+`, sem zero à esquerda, sem `.5` nem `5.`), com até 15 dígitos significativos (os zeros
    /// das pontas não contam), finito, na faixa normal do `double` e até o maior que o Excel guarda. Sai como o `String` do JavaScript o escreve (`12.50`
    /// vira `12.5`, `1e5` vira `100000`, `1e21` vira `1e+21`), que o Excel lê: com até 15 dígitos, os do texto são os do `double`.
    /// </summary>
    public static string? SpreadsheetNumber(string text)
    {
        if (!JsonNumber().IsMatch(text))
            return null;

        var (negative, digits, exponent) = DecimalParts(text);
        if (digits.Length > 15)
            return null;

        var number = double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture);
        if (!double.IsFinite(number) || Math.Abs(number) > MaxExcelNumber || (digits.Length > 0 && Math.Abs(number) < MinNormalNumber))
            return null;

        return digits.Length == 0 ? "0" : (negative ? "-" : string.Empty) + JavaScriptDigits(digits, exponent + digits.Length);
    }

    /// <summary>
    /// O nome da planilha que o Excel aceita: sem o que o XML 1.0 não escreve e sem os caracteres de controle, com `[ ] : * ? / \` trocados por `_`, sem
    /// espaço nem apóstrofo nas pontas, com até 31 caracteres (sem partir um par), nunca vazio (vira `Resultado`) e nunca `History`, que o Excel reserva
    /// (ganha um `_`).
    /// </summary>
    public static string SheetNameOf(string name)
    {
        var clean = new StringBuilder(name.Length);
        foreach (var (codePoint, index, length) in CodePoints(name))
        {
            if (!IsXmlChar(codePoint) || codePoint is < 0x20 or (>= 0x7F and <= 0x9F))
                continue;

            clean.Append(codePoint is '[' or ']' or ':' or '*' or '?' or '/' or '\\' ? "_" : name.Substring(index, length));
        }

        var edged = Edges(clean.ToString());
        var cut = new StringBuilder(MaxSheetNameLength);
        foreach (var (_, index, length) in CodePoints(edged))
        {
            if (cut.Length + length > MaxSheetNameLength)
                break;

            cut.Append(edged, index, length);
        }

        var result = Edges(cut.ToString());
        if (result.Length == 0)
            result = DefaultSheetName;

        return result.Length == 7 && result.All(char.IsAscii) && result.Equals("history", StringComparison.OrdinalIgnoreCase) ? $"{result}_" : result;
    }

    /// <summary>
    /// RN-EXPORT-013: o nome da planilha de número `number` (a partir de 2) quando as linhas passam de uma planilha: o nome da primeira, cortado para o
    /// sufixo ` (2)` caber nos 31 caracteres, sem partir um par e sem espaço nem apóstrofo no fim do corte. Um nome que já é de outra planilha (o Excel não
    /// diferencia maiúsculas) é cortado mais um caractere.
    /// </summary>
    public static string NextSheetName(string first, int number, IReadOnlyCollection<string> taken)
    {
        var suffix = $" ({number.ToString(CultureInfo.InvariantCulture)})";
        var room = MaxSheetNameLength - suffix.Length;

        while (true)
        {
            var cut = new StringBuilder(room);
            foreach (var (_, index, length) in CodePoints(first))
            {
                if (cut.Length + length > room)
                    break;

                cut.Append(first, index, length);
            }

            var name = Edges(cut.ToString()) + suffix;
            if (room <= 1 || !taken.Contains(name, StringComparer.OrdinalIgnoreCase))
                return name;

            room--;
        }
    }

    /// <summary>A letra da coluna (a primeira é 0 e vale `A`; depois de `Z`, `AA`; a 16.383 é `XFD`).</summary>
    public static string ColumnLetters(int index)
    {
        var letters = string.Empty;
        for (var number = index + 1; number > 0; number = (number - 1) / 26)
            letters = (char)('A' + ((number - 1) % 26)) + letters;

        return letters;
    }

    /// <summary>Sem espaço (o branco do JavaScript, U+FEFF inclusive) nem apóstrofo nas pontas.</summary>
    private static string Edges(string text)
        => SheetNameEdges().Replace(text, string.Empty);

    /// <summary>
    /// Um número da gramática do JSON em partes: o sinal, os dígitos significativos (sem os zeros da frente e sem os do fim) e o expoente do último deles
    /// (`decimalParts` da tela). Os dígitos vazios são o zero.
    /// </summary>
    private static (bool Negative, string Digits, long Exponent) DecimalParts(string text)
    {
        var match = DecimalShape().Match(text);
        var fraction = match.Groups["fraction"].Value;
        var all = (match.Groups["whole"].Value + fraction).TrimStart('0');
        var significant = all.TrimEnd('0');
        // O expoente que não cabe num `long` dá um número que não é finito ou que é zero, e quem decide é o `double`: aqui ele só não pode lançar.
        var written = match.Groups["exponent"].Value;
        var exponent = written.Length == 0 ? 0 : long.TryParse(written, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var parsed) ? parsed : written.StartsWith('-') ? long.MinValue / 4 : long.MaxValue / 4;

        return (match.Groups["sign"].Value == "-", significant, exponent - fraction.Length + (all.Length - significant.Length));
    }

    /// <summary>
    /// Os dígitos `digits` com o ponto depois de `point` deles (o `n` do `Number::toString` do JavaScript), como ele escreve um número: sem expoente de
    /// 10^-7 a 10^21, e com `e+`/`e-` fora dessa faixa.
    /// </summary>
    private static string JavaScriptDigits(string digits, long point)
    {
        var count = digits.Length;
        if (count <= point && point <= 21)
            return digits + new string('0', (int)(point - count));

        if (point is > 0 and <= 21)
            return $"{digits[..(int)point]}.{digits[(int)point..]}";

        if (point is > -6 and <= 0)
            return $"0.{new string('0', (int)-point)}{digits}";

        var exponent = point - 1;
        var sign = exponent < 0 ? "-" : "+";
        var mantissa = count == 1 ? digits : $"{digits[0]}.{digits[1..]}";

        return $"{mantissa}e{sign}{Math.Abs(exponent).ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>O `_` que pode abrir um escape `_xHHHH_`: seguido de `x` e quatro dígitos hexadecimais, com ou sem o `_` do fim.</summary>
    [GeneratedRegex("_(?=x[0-9A-Fa-f]{4})")]
    private static partial Regex MayBeAnEscape();

    [GeneratedRegex(@"^(?<sign>-?)(?<whole>[0-9]*)(?:\.(?<fraction>[0-9]*))?(?:[eE](?<exponent>[+-]?[0-9]+))?\z")]
    private static partial Regex DecimalShape();

    /// <summary>O `['\s]` das pontas na tela, com o `\s` do JavaScript (que tem o U+FEFF e não tem o U+0085).</summary>
    [GeneratedRegex(@"^['\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|['\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+\z")]
    private static partial Regex SheetNameEdges();
}
