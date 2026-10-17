using Prism.Infrastructure.Databases.Models;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>Por que uma linha não vira `INSERT` (RN-EXPORT-011): o valor dela que não tem literal no banco da origem.</summary>
internal enum ESqlSkipReason
{
    /// <summary>O binário no Informix, que não tem literal para ele (com "Literal do banco").</summary>
    InformixBinary,

    /// <summary>O texto com outro caractere de controle, que não é quebra de linha, retorno de carro nem tabulação.</summary>
    Control,

    /// <summary>No Informix, a data e hora que não vira o literal tipado: mais de cinco casas de segundo que não são zeros, ou outra forma.</summary>
    InformixDateTime
}

/// <summary>
/// RN-EXPORT-011 e 024: os literais do SQL, os mesmos do "Gerar SQL" da tela (`sqlLiteral`, em `table-sql.ts`, e `scriptLiteral`, em
/// `script-literal.ts`), com o mesmo texto para as mesmas entradas, que a fixture `sql-literal.json` confere nos dois lados; e o literal do binário, que
/// só a API escreve (`sql-binary.json`). O tipo da coluna é o da grade (`text`, `number`, `datetime`, `boolean` ou `binary`).
/// </summary>
internal static partial class ExportText
{
    /// <summary>RN-EXPORT-011: o maior pedaço de uma constante hexadecimal do Db2, 32.672 dígitos.</summary>
    public const int Db2HexPieceBytes = 16336;

    /// <summary>O nome no texto do comando (RN-TABELA-002, `quoteIdentifier` da tela): sempre entre aspas duplas, com a aspa de dentro dobrada, nos três bancos.</summary>
    public static string QuoteIdentifier(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>A tabela de destino: o esquema e a tabela entre aspas; sem esquema (vazio, ou "Omitir o esquema"), só a tabela (`qualifiedTable` da tela).</summary>
    public static string QualifiedTable(string? schema, string table)
        => string.IsNullOrEmpty(schema) ? QuoteIdentifier(table) : $"{QuoteIdentifier(schema)}.{QuoteIdentifier(table)}";

    /// <summary>
    /// O literal de uma linha só, o do campo de filtro (`sqlLiteral` da tela), ou nulo. Nulo com qualquer caractere de controle (abaixo de U+0020, e o DEL).
    /// O número sem aspas só numa coluna de número, e quando é um número simples. No Informix, o lógico é `'t'` ou `'f'` (outro texto não tem literal), a
    /// data e a hora vão entre aspas, e a data e hora vira `DATETIME (…) YEAR TO FRACTION(5)`, com as casas que passam de cinco só se forem zeros; outra
    /// forma não tem literal. O resto vai entre aspas simples, com a aspa dobrada, e no PostgreSQL o texto com barra invertida vai como `E'…'`, com a
    /// barra dobrada.
    /// </summary>
    public static string? SqlLiteral(EDatabaseEngine engine, string value, string kind)
    {
        if (!FitsALine(value))
            return null;

        if (kind == "number" && PlainNumber().IsMatch(value))
            return value;

        if (engine == EDatabaseEngine.Informix && kind is "boolean" or "datetime")
            return InformixLiteral(kind, value);

        var quoted = value.Replace("'", "''", StringComparison.Ordinal);

        return engine == EDatabaseEngine.PostgreSql && value.Contains('\\') ? $"E'{quoted.Replace(@"\", @"\\", StringComparison.Ordinal)}'" : $"'{quoted}'";
    }

    /// <summary>
    /// O literal de um script (`scriptLiteral` da tela), ou nulo: o <see cref="SqlLiteral"/> em tudo o que ele resolve, e a quebra de linha, o retorno de
    /// carro e a tabulação, que ele recusa, aqui viram literal. No PostgreSQL e no Db2, a quebra de linha e a tabulação vão dentro das aspas. O retorno de
    /// carro, no PostgreSQL, vai como `\r` num `E'…'` (<see cref="PostgreSqlEscapeLiteral"/>), e no Db2 como `' || CHR(13) || '`. No Informix, os três
    /// vão como partes entre aspas unidas por `||`, com `CHR(10)`, `CHR(13)` e `CHR(9)`. Cada parte de texto passa pelo <see cref="SqlLiteral"/> como
    /// texto, e nunca sobra uma parte vazia. Outro caractere de controle deixa o valor sem literal.
    /// </summary>
    public static string? ScriptLiteral(EDatabaseEngine engine, string value, string kind)
    {
        if (value.AsSpan().IndexOfAny('\n', '\r', '\t') < 0)
            return SqlLiteral(engine, value, kind);

        if (engine == EDatabaseEngine.PostgreSql && value.Contains('\r'))
            return PostgreSqlEscapeLiteral(value);

        var informix = engine == EDatabaseEngine.Informix;
        var parts = new List<string>();
        foreach (var (part, separator) in Split(value, informix ? "\n\r\t" : "\r"))
        {
            if (separator)
            {
                parts.Add($"CHR({(int)part[0]})");
                continue;
            }

            var literal = informix ? SqlLiteral(engine, part, "text") : QuotedWithBreaks(engine, part);
            if (literal is null)
                return null;

            parts.Add(literal);
        }

        return string.Join(" || ", parts);
    }

    /// <summary>
    /// RN-EXPORT-011: o texto com retorno de carro no PostgreSQL, como um literal só, `E'…'`, com o retorno de carro como `\r`, a barra invertida e a aspa
    /// dobradas, e a quebra de linha e a tabulação como estão (`E'a\rb'`). Continua um literal sem tipo, que vale numa coluna `json`, `xml` ou de lista; a
    /// expressão `'a' || CHR(13) || 'b'` seria `text`, que essas colunas não aceitam sem conversão. O `\r` atravessa o editor da aba de consulta, que troca o
    /// retorno de carro cru por uma quebra de linha (o "Gerar SQL" da tela escreve o mesmo). Outro caractere de controle deixa o valor sem literal.
    /// </summary>
    private static string? PostgreSqlEscapeLiteral(string value)
    {
        if (value.Any(IsOtherControl))
            return null;

        var literal = new StringBuilder(value.Length + 8).Append("E'");
        foreach (var character in value)
        {
            switch (character)
            {
                case '\\':
                    literal.Append(@"\\");
                    break;
                case '\'':
                    literal.Append("''");
                    break;
                case '\r':
                    literal.Append(@"\r");
                    break;
                default:
                    literal.Append(character);
                    break;
            }
        }

        return literal.Append('\'').ToString();
    }

    /// <summary>
    /// RN-EXPORT-011: o literal do binário, que o "Gerar SQL" não escreve. No PostgreSQL, `decode('DEADBEEF', 'hex')`, que vale qualquer que seja o
    /// `standard_conforming_strings`. No Db2, `X'DEADBEEF'`, e `BLOB(X'…')` quando a coluna é `BLOB`, em pedaços de até 16.336 bytes unidos por `||`
    /// (a constante hexadecimal do Db2 tem até 32.672 dígitos). No Informix não há: nulo.
    /// </summary>
    /// <param name="type">O tipo da coluna como o banco o diz (`BLOB`, `VARBINARY`...).</param>
    public static string? BinaryLiteral(EDatabaseEngine engine, byte[] bytes, string type)
    {
        if (engine == EDatabaseEngine.PostgreSql)
            return $"decode('{Convert.ToHexString(bytes)}', 'hex')";

        if (engine != EDatabaseEngine.Db2)
            return null;

        var blob = string.Equals(type.Trim(), "BLOB", StringComparison.OrdinalIgnoreCase);
        var pieces = new List<string>();
        var offset = 0;
        do
        {
            var length = Math.Min(Db2HexPieceBytes, bytes.Length - offset);
            var piece = $"X'{Convert.ToHexString(bytes, offset, length)}'";
            pieces.Add(blob ? $"BLOB({piece})" : piece);
            offset += length;
        }
        while (offset < bytes.Length);

        return string.Join(" || ", pieces);
    }

    /// <summary>
    /// Por que o valor não teve literal, para o comentário que fica no lugar da linha: o caractere de controle que não é quebra de linha, retorno de carro
    /// nem tabulação; senão, a data e hora do Informix (o único outro texto sem literal: o lógico do Informix chega sempre como `true` ou `false`).
    /// </summary>
    public static ESqlSkipReason SkipReasonOf(string value)
        => value.Any(IsOtherControl) ? ESqlSkipReason.Control : ESqlSkipReason.InformixDateTime;

    /// <summary>O caractere de controle (abaixo de U+0020, e o DEL) que não é quebra de linha, retorno de carro nem tabulação: o que um script não leva.</summary>
    private static bool IsOtherControl(char character)
        => character is < ' ' and not ('\n' or '\r' or '\t') or '\u007f';

    /// <summary>
    /// Um texto sem retorno de carro como literal do PostgreSQL ou do Db2, com a quebra de linha e a tabulação dentro das aspas. Cada pedaço entre elas passa
    /// pelo <see cref="SqlLiteral"/>, e o resultado é um literal só: o prefixo de um pedaço (o `E` de quem tem barra invertida) vale para todos.
    /// </summary>
    private static string? QuotedWithBreaks(EDatabaseEngine engine, string text)
    {
        if (text.AsSpan().IndexOfAny('\n', '\t') < 0)
            return SqlLiteral(engine, text, "text");

        var prefix = string.Empty;
        var body = new StringBuilder();
        foreach (var (part, separator) in Split(text, "\n\t"))
        {
            if (separator)
            {
                body.Append(part);
                continue;
            }

            var literal = SqlLiteral(engine, part, "text");
            if (literal is null)
                return null;

            var quote = literal.IndexOf('\'', StringComparison.Ordinal);
            if (prefix.Length == 0)
                prefix = literal[..quote];

            body.Append(literal, quote + 1, literal.Length - quote - 2);
        }

        return $"{prefix}'{body}'";
    }

    /// <summary>O texto em pedaços: os de texto, nunca vazios, e cada separador sozinho, na ordem (o `split` com grupo da tela, sem os pedaços vazios).</summary>
    private static IEnumerable<(string Part, bool Separator)> Split(string text, string separators)
    {
        var start = 0;
        for (var index = 0; index < text.Length; index++)
        {
            if (!separators.Contains(text[index]))
                continue;

            if (index > start)
                yield return (text[start..index], false);

            yield return (text[index].ToString(), true);
            start = index + 1;
        }

        if (start < text.Length)
            yield return (text[start..], false);
    }

    /// <summary>O valor cabe numa linha de filtro: sem caractere de controle (abaixo de U+0020) nem o DEL (`fitsFilter` da tela).</summary>
    private static bool FitsALine(string value)
        => !value.Any(character => character is < ' ' or '\u007f');

    /// <summary>O lógico e a data e hora no Informix (`informixLiteral` da tela).</summary>
    private static string? InformixLiteral(string kind, string value)
    {
        if (kind == "boolean")
            return value switch
            {
                "true" => "'t'",
                "false" => "'f'",
                _ => null
            };

        if (DateText().IsMatch(value) || TimeText().IsMatch(value))
            return $"'{value}'";

        var match = DateTimeText().Match(value);
        if (!match.Success)
            return null;

        var fraction = match.Groups[2].Value;
        if (fraction.Length > 5 && fraction[5..].Any(digit => digit != '0'))
            return null;

        return $"DATETIME ({match.Groups[1].Value}.{fraction[..Math.Min(5, fraction.Length)].PadRight(5, '0')}) YEAR TO FRACTION(5)";
    }

    /// <summary>O número que um literal aceita sem aspas (`plainNumber` da tela): dígitos do ASCII, um ponto, expoente.</summary>
    [GeneratedRegex(@"^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex PlainNumber();

    [GeneratedRegex(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}\z")]
    private static partial Regex DateText();

    [GeneratedRegex(@"^[0-9]{2}:[0-9]{2}:[0-9]{2}\z")]
    private static partial Regex TimeText();

    [GeneratedRegex(@"^([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,6}))?\z")]
    private static partial Regex DateTimeText();
}
