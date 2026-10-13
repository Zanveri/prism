using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>Como o Prism converte o texto de uma célula para a coluna (RN-EDIT-006). No PostgreSQL é sempre texto: quem converte é o banco.</summary>
internal enum EEditType
{
    Text,
    Int16,
    Int32,
    Int64,
    Decimal,
    Float,
    Date,
    Time,
    Timestamp,
    Boolean,

    /// <summary>Binário: só leitura (o valor chega cortado, RN-SQL-011).</summary>
    Binary,

    /// <summary>Um tipo que o Prism ainda não converte neste banco: intervalo, objeto grande, coleção, tipo do usuário, XML.</summary>
    Unsupported
}

/// <summary>
/// RN-EDIT-006 e 008: o tipo de cada coluna para a edição, a conversão do texto digitado e o literal que o "Ver SQL" mostra. A célula
/// viaja como texto (RN-SQL-011): no PostgreSQL ela vai como está, num parâmetro sem tipo, e o banco a lê como leria um literal escrito
/// na sessão; no Db2 e no Informix quem converte é o Prism, do mesmo formato em que ele escreveu a célula (`CellFormatter`), com a
/// cultura invariável e sem depender do `DBDATE` nem da localidade do servidor. O que não cabe no tipo do C# (o decimal de mais de 28
/// dígitos, a fração de mais de 7 casas do Db2) vai como texto no formato canônico do banco, e quem termina a conversão é ele.
/// </summary>
internal static partial class EditValues
{
    /// <summary>As casas de fração que a data e hora do C# guarda.</summary>
    private const int MaxDateTimeFraction = 7;

    public static EEditType TypeOf(ESqlDialect dialect, string type, string kind)
    {
        if (kind == "binary")
            return EEditType.Binary;

        if (dialect == ESqlDialect.PostgreSql)
            return EEditType.Text;

        var name = type.Trim().ToUpperInvariant();
        var bare = name.IndexOf('(') is var open and >= 0 ? name[..open].TrimEnd() : name;

        if (dialect == ESqlDialect.Informix && bare.StartsWith("DATETIME", StringComparison.Ordinal))
            return name.Contains("YEAR TO", StringComparison.Ordinal) ? EEditType.Timestamp : name.Contains("HOUR TO SECOND", StringComparison.Ordinal) ? EEditType.Time : EEditType.Unsupported;

        return bare switch
        {
            "CHARACTER" or "CHAR" or "VARCHAR" or "GRAPHIC" or "VARGRAPHIC" or "NCHAR" or "NVARCHAR" or "LVARCHAR" => EEditType.Text,
            "SMALLINT" => EEditType.Int16,
            "INTEGER" or "INT" or "SERIAL" => EEditType.Int32,
            "BIGINT" or "INT8" or "SERIAL8" or "BIGSERIAL" => EEditType.Int64,
            "DECIMAL" or "NUMERIC" or "DECFLOAT" or "MONEY" => EEditType.Decimal,
            "REAL" or "DOUBLE" or "FLOAT" or "SMALLFLOAT" => EEditType.Float,
            "DATE" => EEditType.Date,
            "TIME" => EEditType.Time,
            "TIMESTAMP" => EEditType.Timestamp,
            "BOOLEAN" => EEditType.Boolean,
            "BINARY" or "VARBINARY" or "BLOB" or "BYTE" => EEditType.Binary,
            _ => EEditType.Unsupported
        };
    }

    /// <summary>O valor do parâmetro, ou o motivo de o texto não converter, apontando o texto entre aspas angulares.</summary>
    public static Result<EditParameter, string> Convert(ESqlDialect dialect, EEditType type, string? text)
    {
        if (text is null)
            return new EditParameter(null, type == EEditType.Date ? DbType.Date : null);

        if (dialect == ESqlDialect.PostgreSql || type == EEditType.Text)
            return new EditParameter(text);

        return type switch
        {
            EEditType.Int16 => Integer(text, short.MinValue, short.MaxValue, value => (short)value),
            EEditType.Int32 => Integer(text, int.MinValue, int.MaxValue, value => (int)value),
            EEditType.Int64 => Integer(text, long.MinValue, long.MaxValue, value => value),
            EEditType.Decimal => DecimalOf(text),
            EEditType.Float => double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number) ? new EditParameter(number) : NotANumber(text),
            EEditType.Date => DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? new EditParameter(date, DbType.Date) : $"«{text}» não é uma data no formato aaaa-mm-dd.",
            EEditType.Time => TimeSpan.TryParseExact(text, @"hh\:mm\:ss", CultureInfo.InvariantCulture, out var time) ? new EditParameter(time, DbType.Time) : $"«{text}» não é uma hora no formato hh:mm:ss.",
            EEditType.Timestamp => TimestampOf(dialect, text),
            EEditType.Boolean => BooleanOf(dialect, text),
            _ => "O Prism ainda não edita este tipo neste banco."
        };
    }

    /// <summary>
    /// RN-EDIT-008: o valor escrito como literal do banco, para leitura. Nulo quando ele não tem literal (caractere de controle), e o
    /// "Ver SQL" mostra `?` com o valor ao lado. O número só sai sem aspas quando a coluna é numérica e o texto é um número.
    /// </summary>
    /// <param name="kind">O `kind` da coluna no resultado: no PostgreSQL é ele que diz que o valor é número.</param>
    public static string? Literal(ESqlDialect dialect, EEditType type, string kind, string? text)
    {
        if (text is null)
            return "NULL";

        if (text.Any(character => character < ' ' || character == '\u007f'))
            return null;

        var quoted = $"'{text.Replace("'", "''", StringComparison.Ordinal)}'";
        if (dialect == ESqlDialect.PostgreSql)
            return kind == "number" && PlainNumber().IsMatch(text) ? text : text.Contains('\\') ? $"E{quoted.Replace(@"\", @"\\", StringComparison.Ordinal)}" : quoted;

        return type switch
        {
            EEditType.Int16 or EEditType.Int32 or EEditType.Int64 or EEditType.Decimal or EEditType.Float when PlainNumber().IsMatch(text) => text,
            EEditType.Date when dialect == ESqlDialect.Db2 => $"DATE {quoted}",
            EEditType.Time when dialect == ESqlDialect.Db2 => $"TIME {quoted}",
            EEditType.Timestamp when dialect == ESqlDialect.Db2 => $"TIMESTAMP {quoted}",
            EEditType.Timestamp when Timestamp().Match(text) is { Success: true } match => $"DATETIME ({match.Groups[1].Value} {match.Groups[2].Value}.{match.Groups[3].Value.PadRight(5, '0')[..5]}) YEAR TO FRACTION(5)",
            EEditType.Boolean when BooleanText(text) is { } flag => dialect == ESqlDialect.Db2 ? flag ? "TRUE" : "FALSE" : flag ? "'t'" : "'f'",
            _ => quoted
        };
    }

    private static Result<EditParameter, string> Integer(string text, long minimum, long maximum, Func<long, object> narrow)
    {
        if (!IntegerText().IsMatch(text))
            return $"«{text}» não é um número inteiro.";

        return long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value) && value >= minimum && value <= maximum ? new EditParameter(narrow(value)) : $"«{text}» está fora da faixa da coluna.";
    }

    /// <summary>O `decimal` do C# guarda 28 dígitos com folga: acima disso o texto vai como está (já conferido), e o banco o lê.</summary>
    private static Result<EditParameter, string> DecimalOf(string text)
    {
        if (!DecimalText().IsMatch(text))
            return NotANumber(text);

        var digits = text.Count(char.IsAsciiDigit);

        return digits <= 28 && decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? new EditParameter(value) : new EditParameter(text);
    }

    /// <summary>
    /// A data e hora como o `CellFormatter` e o tipo do driver do Db2 a escrevem: `aaaa-mm-dd hh:mm:ss`, com a fração que a coluna tem.
    /// Até 7 casas ela vira a data e hora do C#; no Db2, que guarda até 12, o resto vai como texto no formato dele
    /// (`aaaa-mm-dd-hh.mm.ss.ffffffffffff`).
    /// </summary>
    private static Result<EditParameter, string> TimestampOf(ESqlDialect dialect, string text)
    {
        var maximum = dialect == ESqlDialect.Db2 ? 12 : MaxDateTimeFraction;
        var match = Timestamp().Match(text);
        if (!match.Success || match.Groups[3].Length > maximum || !DateTime.TryParseExact($"{match.Groups[1].Value} {match.Groups[2].Value}", "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var value))
            return $"«{text}» não é uma data e hora no formato aaaa-mm-dd hh:mm:ss, com até {maximum} casas de fração.";

        var fraction = match.Groups[3].Value;
        if (fraction.Length > MaxDateTimeFraction)
            return new EditParameter($"{match.Groups[1].Value}-{match.Groups[2].Value.Replace(':', '.')}.{fraction}");

        return new EditParameter(value.AddTicks(fraction.Length == 0 ? 0 : long.Parse(fraction.PadRight(MaxDateTimeFraction, '0'), CultureInfo.InvariantCulture)));
    }

    /// <summary>O Db2 escreve o lógico como `true` e `false`; o Informix o entrega pela DRDA como número (0 ou 1) e o lê de um texto `t` ou `f`.</summary>
    private static Result<EditParameter, string> BooleanOf(ESqlDialect dialect, string text)
    {
        if (BooleanText(text) is not { } flag)
            return $"«{text}» não é um valor lógico: use {(dialect == ESqlDialect.Db2 ? "true ou false" : "1 ou 0")}.";

        return dialect == ESqlDialect.Db2 ? new EditParameter(flag) : new EditParameter(flag ? "t" : "f");
    }

    private static bool? BooleanText(string text)
        => text.Trim().ToLowerInvariant() switch
        {
            "true" or "t" or "1" => true,
            "false" or "f" or "0" => false,
            _ => null
        };

    private static string NotANumber(string text)
        => $"«{text}» não é um número: use ponto para as casas decimais.";

    [GeneratedRegex(@"^[+-]?\d+$")]
    private static partial Regex IntegerText();

    [GeneratedRegex(@"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")]
    private static partial Regex DecimalText();

    [GeneratedRegex(@"^-?\d+(\.\d+)?$")]
    private static partial Regex PlainNumber();

    [GeneratedRegex(@"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,12}))?$")]
    private static partial Regex Timestamp();
}
