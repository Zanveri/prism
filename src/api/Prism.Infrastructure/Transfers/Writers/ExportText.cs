using Prism.Infrastructure.Transfers.Models;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-006 a 010 e 024: os valores e os escapes de cada formato, em funções puras. As que existem também na tela (o campo do CSV, o texto do
/// HTML, a célula do Markdown, o valor e a chave do JSON) escrevem o mesmo texto que ela, e as fixtures de ouro de `src/test-fixtures/export/` conferem
/// os dois lados; as que só a API escreve (TXT, PHP, data em ISO 8601) têm fixtures só dela, no mesmo lugar e na mesma forma.
///
/// O texto é percorrido por ponto de código, e não por `char`: o par substituto é um caractere só, e o par solto (U+D800 a U+DFFF sozinho) também conta
/// como um, como o `for...of` do JavaScript o lê.
///
/// As expressões regulares terminam em `\z`, e não em `$`: o `$` do .NET aceita uma quebra de linha antes do fim, e o do JavaScript não. Com `$`,
/// `-1` seguido de uma quebra de linha passava por número simples (sem a proteção contra fórmula), e `1` com a quebra saía como número do JSON.
/// </summary>
internal static partial class ExportText
{
    /// <summary>A célula como a grade a escreve: o texto como veio, o binário como `0x` e os dígitos hexadecimais em maiúsculas, inteiro (RN-EXPORT-002).</summary>
    public static string? Of(ExportCell cell)
        => cell.Bytes is { } bytes ? "0x" + Convert.ToHexString(bytes) : cell.Text;

    /// <summary>Os pontos de código do texto, cada um com a posição e o tamanho em `char`: o par substituto é um só, e o solto também.</summary>
    public static IEnumerable<(int CodePoint, int Index, int Length)> CodePoints(string text)
    {
        for (var index = 0; index < text.Length; index++)
        {
            var current = text[index];
            if (char.IsHighSurrogate(current) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]))
            {
                yield return (char.ConvertToUtf32(current, text[index + 1]), index, 2);
                index++;
            }
            else
            {
                yield return (current, index, 1);
            }
        }
    }

    /// <summary>Quantos pontos de código o texto tem (RN-EXPORT-008: a largura da coluna do TXT, sem a largura de exibição).</summary>
    public static int CodePointCount(string text)
        => CodePoints(text).Count();

    /// <summary>Tira os pontos de código que `accepts` recusa e diz quantos tirou. O par substituto solto é um ponto de código que nenhum formato guarda.</summary>
    public static string StripUnaccepted(string text, Func<int, bool> accepts, out int removed)
    {
        removed = 0;
        StringBuilder? kept = null;

        foreach (var (codePoint, index, length) in CodePoints(text))
        {
            if (accepts(codePoint))
            {
                kept?.Append(text, index, length);
                continue;
            }

            kept ??= new StringBuilder(text, 0, index, text.Length);
            removed++;
        }

        return kept?.ToString() ?? text;
    }

    /// <summary>O caractere de direção do texto (U+202A a U+202E, U+2066 a U+2069, U+200E, U+200F e U+061C), que faria um código ser lido numa ordem e executado noutra.</summary>
    public static bool IsDirectionMark(int codePoint)
        => codePoint is (>= 0x202A and <= 0x202E) or (>= 0x2066 and <= 0x2069) or 0x200E or 0x200F or 0x061C;

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // CSV (RN-EXPORT-007 e RN-TABELA-006: `csvFieldOf` e `toDelimited` da tela).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// Um campo do CSV. O nulo é o texto dele, sem a proteção contra fórmula e entre aspas só quando o texto tem o separador, a aspa ou uma quebra. O
    /// valor recebe o apóstrofo da proteção quando o primeiro caractere depois de espaços, tabulação e retorno de carro é `=`, `+`, `-` ou `@`, menos o
    /// número simples, e vai entre aspas (com a aspa dobrada) conforme o modo: só quando precisa; em todos os textos (todo valor que não é de coluna de
    /// número, e os nomes das colunas, que chegam aqui como `text`); ou em todos os valores.
    /// </summary>
    /// <param name="kind">O tipo da coluna na grade (`number`, `text`...): só decide o modo "Em todos os textos".</param>
    public static string CsvField(string? value, string kind, CsvFieldOptions options)
    {
        using var field = new StringWriter(CultureInfo.InvariantCulture);
        WriteCsvField(field, value, kind, options);

        return field.ToString();
    }

    /// <summary>
    /// O campo do <see cref="CsvField"/>, escrito direto no arquivo, em pedaços: o apóstrofo da proteção, as aspas e cada trecho entre duas aspas do
    /// valor. O valor grande (até 64 MiB, RN-EXPORT-017) não é copiado de novo para ganhar o apóstrofo, as aspas dobradas e a linha inteira.
    /// </summary>
    public static void WriteCsvField(TextWriter output, string? value, string kind, CsvFieldOptions options)
    {
        if (value is null)
        {
            WriteCsvText(output, options.NullText, guard: false, NeedsCsvQuotes(options.NullText, options.Delimiter));
            return;
        }

        // O apóstrofo da proteção não é o separador (`;`, `,`, a tabulação ou `|`), a aspa nem uma quebra: o valor precisa das aspas com ele ou sem ele.
        var guard = options.FormulaGuard && StartsAsFormula().IsMatch(value) && !SimpleNumber().IsMatch(value);
        var quoted = options.Quoting switch
        {
            ECsvQuoting.All => true,
            ECsvQuoting.Text when kind != "number" => true,
            _ => NeedsCsvQuotes(value, options.Delimiter)
        };

        WriteCsvText(output, value, guard, quoted);
    }

    private static bool NeedsCsvQuotes(string text, string delimiter)
        => text.Contains(delimiter, StringComparison.Ordinal) || text.Contains('"') || text.Contains('\n') || text.Contains('\r');

    /// <summary>O texto do campo, com o apóstrofo da proteção e, entre aspas, com cada aspa dobrada.</summary>
    private static void WriteCsvText(TextWriter output, string text, bool guard, bool quoted)
    {
        if (quoted)
            output.Write('"');

        if (guard)
            output.Write('\'');

        var rest = text.AsSpan();
        if (quoted)
        {
            for (var quote = rest.IndexOf('"'); quote >= 0; quote = rest.IndexOf('"'))
            {
                output.Write(rest[..(quote + 1)]);
                output.Write('"');
                rest = rest[(quote + 1)..];
            }
        }

        output.Write(rest);
        if (quoted)
            output.Write('"');
    }

    /// <summary>Uma planilha executa como fórmula o campo cujo primeiro caractere, depois de espaços, tabulação e retorno de carro (ela os ignora), é `=`, `+`, `-` ou `@`.</summary>
    [GeneratedRegex(@"^[ \t\r]*[=+\-@]")]
    private static partial Regex StartsAsFormula();

    /// <summary>O número simples, negativo ou não, com vírgula ou ponto decimal e expoente: dígitos do ASCII, no máximo um separador, e nada mais.</summary>
    [GeneratedRegex(@"^-?(?:[0-9]+(?:[.,][0-9]+)?|[.,][0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex SimpleNumber();

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // HTML (RN-EXPORT-009: `escapeHtml` e `isHtmlChar` da tela).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// Um ponto de código que um documento HTML válido aceita: o branco (tabulação, quebra de linha, avanço de página e retorno de carro), o texto de
    /// U+0020 a U+007E e de U+00A0 em diante, sem o par substituto solto e sem os não-caracteres (U+FDD0 a U+FDEF e os dois últimos de cada plano).
    /// </summary>
    public static bool IsHtmlChar(int codePoint)
        => codePoint is 0x9 or 0xA or 0xC or 0xD or (>= 0x20 and <= 0x7E) or (>= 0xA0 and <= 0xD7FF)
            || (codePoint is >= 0xE000 and <= 0x10FFFF && codePoint is not (>= 0xFDD0 and <= 0xFDEF) && (codePoint & 0xFFFE) != 0xFFFE);

    /// <summary>O texto de uma célula ou de um atributo do HTML: `&amp;`, `&lt;`, `&gt;` e as duas aspas.</summary>
    public static string EscapeHtml(string text)
    {
        if (text.AsSpan().IndexOfAny("&<>\"'") < 0)
            return text;

        var escaped = new StringBuilder(text.Length + 16);
        foreach (var character in text)
            escaped.Append(character switch
            {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                '\'' => "&#39;",
                _ => character.ToString()
            });

        return escaped.ToString();
    }

    /// <summary>O texto do dado no HTML: sem o que o documento não aceita (contado em `removed`) e escapado.</summary>
    public static string HtmlText(string text, out int removed)
        => EscapeHtml(StripUnaccepted(text, IsHtmlChar, out removed));

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // Markdown (RN-EXPORT-009: a célula do `to-markdown.ts`).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// Uma célula da tabela do GitHub: a barra invertida, a vertical, a crase, o asterisco, o sublinhado, o til e os colchetes ganham a barra invertida;
    /// `&lt;` e `&amp;` viram entidade; e cada quebra de linha (\n, \r\n ou \r) vira `&lt;br&gt;`, depois do escape.
    /// </summary>
    public static string MarkdownCell(string text)
    {
        var escaped = new StringBuilder(text.Length + 8);
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            switch (character)
            {
                case '<':
                    escaped.Append("&lt;");
                    break;
                case '&':
                    escaped.Append("&amp;");
                    break;
                case '\\' or '|' or '`' or '*' or '_' or '~' or '[' or ']':
                    escaped.Append('\\').Append(character);
                    break;
                case '\r':
                    escaped.Append("<br>");
                    if (index + 1 < text.Length && text[index + 1] == '\n')
                        index++;
                    break;
                case '\n':
                    escaped.Append("<br>");
                    break;
                default:
                    escaped.Append(character);
                    break;
            }
        }

        return escaped.ToString();
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // JSON (RN-EXPORT-010: `jsonValue`, `jsonKeys` e o escape do `JSON.stringify` da tela).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// O texto entre aspas como o `JSON.stringify` o escreve: só a aspa, a barra invertida e os controles (U+0000 a U+001F) são escapados, `\b`, `\f`,
    /// `\n`, `\r` e `\t` na forma curta e os outros como `\u00xx`, em minúsculas; o par substituto solto vira `\uXXXX` (em minúsculas); o resto vai como
    /// está. O `Utf8JsonWriter` do .NET, que escapa os acentos, não serve.
    /// </summary>
    public static string JsonString(string text)
    {
        var escaped = new StringBuilder(text.Length + 2).Append('"');
        foreach (var (codePoint, index, length) in CodePoints(text))
        {
            switch (codePoint)
            {
                case '"':
                    escaped.Append("\\\"");
                    break;
                case '\\':
                    escaped.Append("\\\\");
                    break;
                case '\b':
                    escaped.Append("\\b");
                    break;
                case '\f':
                    escaped.Append("\\f");
                    break;
                case '\n':
                    escaped.Append("\\n");
                    break;
                case '\r':
                    escaped.Append("\\r");
                    break;
                case '\t':
                    escaped.Append("\\t");
                    break;
                case < 0x20 or (>= 0xD800 and <= 0xDFFF):
                    escaped.Append("\\u").Append(codePoint.ToString("x4", CultureInfo.InvariantCulture));
                    break;
                default:
                    escaped.Append(text, index, length);
                    break;
            }
        }

        return escaped.Append('"').ToString();
    }

    /// <summary>
    /// Uma célula como valor do JSON (e do PHP, que segue as regras dele). Numa coluna de número, o texto que é um número na gramática do JSON sai como
    /// está, dígito por dígito; numa coluna lógica, `true` e `false` saem como tais; o nulo é `null`; o resto é texto.
    /// </summary>
    public static bool IsBareJsonValue(string kind, string text)
        => (kind == "number" && JsonNumber().IsMatch(text)) || (kind == "boolean" && text is "true" or "false");

    public static string JsonValue(string kind, string? text)
        => text is null ? "null" : IsBareJsonValue(kind, text) ? text : JsonString(text);

    /// <summary>A gramática do número do JSON: sem `+`, sem zero à esquerda, sem `.5` nem `5.`, só os dígitos de 0 a 9.</summary>
    [GeneratedRegex(@"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex JsonNumber();

    /// <summary>
    /// As chaves de cada linha: o nome da coluna; o que já foi usado ganha `_2`, `_3`… (o primeiro número livre). Uma coluna que já se chama `id_2` não
    /// colide com o sufixo: `id`, `id`, `id_2`, `id` viram `id`, `id_2`, `id_2_2`, `id_3`.
    /// </summary>
    public static IReadOnlyList<string> UniqueKeys(IReadOnlyList<string> names)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);

        return [.. names.Select(name =>
        {
            var key = name;
            for (var suffix = 2; used.Contains(key); suffix++)
                key = $"{name}_{suffix}";

            used.Add(key);

            return key;
        })];
    }

    /// <summary>
    /// RN-EXPORT-010, "Datas em ISO 8601": a data e hora no formato da grade (`aaaa-mm-dd hh:mm:ss[.f…]`, com ou sem o fuso `±hh` ou `±hh:mm`) ganha o
    /// `T` no lugar do espaço, e o fuso `±hh` vira `±hh:00`. A data sem hora, a hora sem data e o texto em outro formato saem como estão.
    /// </summary>
    public static string IsoDateTime(string text)
    {
        var match = GridDateTime().Match(text);
        if (!match.Success)
            return text;

        var zone = match.Groups["zone"].Value;

        return $"{match.Groups["date"].Value}T{match.Groups["time"].Value}{(zone.Length == 3 ? $"{zone}:00" : zone)}";
    }

    [GeneratedRegex(@"^(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2}) (?<time>[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)(?<zone>[+-][0-9]{2}(?::[0-9]{2})?)?\z")]
    private static partial Regex GridDateTime();

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // Código fonte, PHP (RN-EXPORT-010).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// O texto como literal do PHP. Nas aspas duplas: a barra invertida, a aspa e o cifrão (`\$`) escapados; a quebra de linha, o retorno de carro, a
    /// tabulação, a tabulação vertical e o avanço de página como `\n`, `\r`, `\t`, `\v` e `\f`; os outros controles e o caractere de direção como `\xHH`,
    /// um por byte do UTF-8. Nas aspas simples, que não têm escape para eles: só a barra invertida e o apóstrofo escapados, e o caractere de direção é
    /// tirado e contado em `removed`.
    /// </summary>
    public static string PhpString(string text, bool singleQuotes, out int removed)
    {
        removed = 0;
        var quote = singleQuotes ? '\'' : '"';
        var literal = new StringBuilder(text.Length + 2).Append(quote);

        foreach (var (codePoint, index, length) in CodePoints(text))
        {
            if (singleQuotes)
            {
                if (IsDirectionMark(codePoint))
                    removed++;
                else if (codePoint is '\\' or '\'')
                    literal.Append('\\').Append((char)codePoint);
                else
                    literal.Append(text, index, length);

                continue;
            }

            switch (codePoint)
            {
                case '\\' or '"' or '$':
                    literal.Append('\\').Append((char)codePoint);
                    break;
                case '\n':
                    literal.Append("\\n");
                    break;
                case '\r':
                    literal.Append("\\r");
                    break;
                case '\t':
                    literal.Append("\\t");
                    break;
                case '\v':
                    literal.Append("\\v");
                    break;
                case '\f':
                    literal.Append("\\f");
                    break;
                default:
                    if (IsDirectionMark(codePoint) || (codePoint <= 0xFFFF && char.IsControl((char)codePoint)))
                    {
                        foreach (var value in Encoding.UTF8.GetBytes(char.ConvertFromUtf32(codePoint)))
                            literal.Append("\\x").Append(value.ToString("X2", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        literal.Append(text, index, length);
                    }

                    break;
            }
        }

        return literal.Append(quote).ToString();
    }

    /// <summary>
    /// O nome da variável do PHP a partir do nome da origem: sem os caracteres de direção (contados em `removed`), com o que o PHP não aceita num nome
    /// (o que não é letra ou dígito do ASCII, `_` ou um caractere fora do ASCII) trocado por `_`, e com um `_` na frente quando começa por dígito; vazio,
    /// `resultado`. Sem o `$`.
    /// </summary>
    public static string PhpVariable(string name, out int removed)
    {
        removed = 0;
        var variable = new StringBuilder(name.Length);

        foreach (var (codePoint, index, length) in CodePoints(name))
        {
            if (IsDirectionMark(codePoint))
                removed++;
            else if (codePoint is (>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '_' or >= 0x80)
                variable.Append(name, index, length);
            else
                variable.Append('_');
        }

        if (variable.Length == 0)
            return "resultado";

        return variable[0] is >= '0' and <= '9' ? $"_{variable}" : variable.ToString();
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // TXT (RN-EXPORT-008).
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// O valor numa linha da tabela de texto: a quebra de linha, o retorno de carro, a tabulação e os outros caracteres de controle viram um espaço, e
    /// também o separador de linha e o de parágrafo do Unicode (U+2028 e U+2029), que não são controle, mas que um editor e o `splitlines` do Python
    /// leem como quebra: cada linha da origem é uma linha do arquivo.
    /// </summary>
    public static string TxtValue(string text)
    {
        if (!text.Any(BreaksTxtLine))
            return text;

        return string.Create(text.Length, text, (span, source) =>
        {
            for (var index = 0; index < source.Length; index++)
                span[index] = BreaksTxtLine(source[index]) ? ' ' : source[index];
        });
    }

    private static bool BreaksTxtLine(char character)
        => char.IsControl(character) || character is '\u2028' or '\u2029';

    /// <summary>Os primeiros `width` pontos de código do texto, sem partir um par substituto.</summary>
    public static string TakeCodePoints(string text, int width)
    {
        var taken = 0;
        foreach (var (_, index, length) in CodePoints(text))
        {
            if (taken == width)
                return text[..index];

            taken++;
        }

        return text;
    }
}

/// <summary>As escolhas do CSV que decidem um campo (RN-EXPORT-007).</summary>
internal sealed record CsvFieldOptions(string Delimiter, ECsvQuoting Quoting, bool FormulaGuard, string NullText);
