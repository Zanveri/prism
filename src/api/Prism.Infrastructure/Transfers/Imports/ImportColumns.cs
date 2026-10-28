using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>RN-IMPORT-010: a classe de uma coluna da tabela, pelo tipo que o catálogo dá, que decide a conversão de cada valor. A resposta a escreve em camelCase.</summary>
public enum EImportClass
{
    Text,
    Number,
    Date,
    DateTime,
    Time,
    Boolean,
    Binary,
    Other
}

/// <summary>RN-IMPORT-010: o número de uma coluna de número: o inteiro (com a faixa dele no Db2 e no Informix), o decimal e o de ponto flutuante.</summary>
public enum EImportNumber
{
    None,
    Int16,
    Int32,
    Int64,
    Decimal,
    Float
}

/// <summary>
/// RN-IMPORT-010 (emenda de 2026-10-17): o último campo do `DATETIME` do Informix que começa em `YEAR` e para antes dos segundos (`YEAR TO DAY`, `YEAR TO
/// HOUR` e `YEAR TO MINUTE`). Os campos do valor depois dele são recusados quando não são zero, porque o banco os cortaria sem dizer nada.
/// </summary>
public enum EImportDateTimeEnd
{
    Day,
    Hour,
    Minute
}

/// <summary>
/// RN-IMPORT-009 e 010: uma coluna da tabela de destino, como a prévia a mostra e a conversão a usa: o nome e o tipo do catálogo, se aceita nulo, o padrão,
/// quem a preenche (`always` ou `byDefault`), a classe e se ela recebe valores (com o motivo quando não recebe). O resto é da conversão: o tipo do número,
/// as casas decimais da coluna e as de fração da data e hora ou da hora (nulas quando o tipo não as fixa), e se a coluna guarda o fuso.
/// </summary>
public sealed record ImportTargetColumn(string Name, string Type, bool Nullable, string? DefaultValue, string? Generated, EImportClass Class, bool Importable, string? Reason)
{
    public EImportNumber Number { get; init; }

    /// <summary>As casas decimais da coluna (`DECIMAL(10,2)`, `MONEY(8,2)`), no Db2 e no Informix; nula quando o tipo não as fixa.</summary>
    public int? Scale { get; init; }

    /// <summary>As casas de fração da data e hora ou da hora (`TIMESTAMP(6)`, `FRACTION(5)`), no Db2 e no Informix.</summary>
    public int? Fraction { get; init; }

    /// <summary>O último campo do `DATETIME YEAR TO DAY`, `YEAR TO HOUR` ou `YEAR TO MINUTE` do Informix; nulo nos outros tipos.</summary>
    public EImportDateTimeEnd? EndsAt { get; init; }

    /// <summary>`timestamp with time zone` e `time with time zone`, no PostgreSQL.</summary>
    public bool TimeZone { get; init; }

    /// <summary>`NaN`, `Infinity` e `-Infinity` passam: `real`, `double precision` e `numeric` do PostgreSQL.</summary>
    public bool SpecialFloats { get; init; }

    public override string ToString()
        => nameof(ImportTargetColumn);
}

/// <summary>
/// RN-IMPORT-009 e 010: a classe de cada coluna da tabela de destino pelo tipo do catálogo (RN-CAT-001), em cada banco, e o que a impede de receber
/// valores: a coluna calculada pelo banco (`generated: always`) e, no Db2 e no Informix, a de um tipo que o Prism não importa (a classe "outra").
/// </summary>
public static partial class ImportColumns
{
    public const string GeneratedReason = "O banco calcula esta coluna e não aceita valor.";
    public const string UnsupportedReason = "O Prism ainda não importa este tipo neste banco.";

    /// <param name="baseType">No PostgreSQL, o tipo-base do domínio (o catálogo da prévia o lê junto); nulo na coluna que não é de um domínio.</param>
    public static ImportTargetColumn Of(EDatabaseEngine engine, ColumnInfo column, string? baseType = null)
    {
        var dialect = ReadOnlySql.DialectOf(engine);
        var generated = column.Generated is null && dialect == ESqlDialect.PostgreSql && IsNextValue(column.DefaultValue) ? ColumnGeneration.ByDefault : column.Generated;
        var shape = engine switch
        {
            EDatabaseEngine.PostgreSql => Postgres(baseType ?? column.Type),
            EDatabaseEngine.Db2 => Db2(column.Type),
            EDatabaseEngine.Informix => Informix(column.Type),
            _ => Standard(column.Type)


        };

        var reason = generated == ColumnGeneration.Always ? GeneratedReason : shape.Class == EImportClass.Other && dialect != ESqlDialect.PostgreSql ? UnsupportedReason : null;

        return shape with { Name = column.Name, Type = column.Type, Nullable = column.IsNullable, DefaultValue = column.DefaultValue, Generated = generated, Importable = reason is null, Reason = reason };
    }

    /// <summary>
    /// RN-IMPORT-010, no PostgreSQL: o tipo como o `format_type` o escreve, sem os modificadores (`numeric(10,2)`, `timestamp(3) without time zone`). A
    /// lista (`integer[]`) e o resto são "outra", que recebe o texto como está, e o banco converte.
    /// </summary>
    private static ImportTargetColumn Postgres(string type)
    {
        var bare = Modifiers().Replace(type, string.Empty).Trim();
        if (bare.EndsWith("[]", StringComparison.Ordinal))
            return Shape(EImportClass.Other);

        var name = bare.Contains('.') && !bare.StartsWith('"') ? bare[(bare.LastIndexOf('.') + 1)..] : bare;

        return name switch
        {
            "text" or "character varying" or "character" or "\"char\"" or "name" or "citext" => Shape(EImportClass.Text),
            "smallint" => Shape(EImportClass.Number) with { Number = EImportNumber.Int16 },
            "integer" => Shape(EImportClass.Number) with { Number = EImportNumber.Int32 },
            "bigint" => Shape(EImportClass.Number) with { Number = EImportNumber.Int64 },
            "numeric" => Shape(EImportClass.Number) with { Number = EImportNumber.Decimal, SpecialFloats = true },
            "real" or "double precision" => Shape(EImportClass.Number) with { Number = EImportNumber.Float, SpecialFloats = true },
            "date" => Shape(EImportClass.Date),
            "timestamp without time zone" => Shape(EImportClass.DateTime),
            "timestamp with time zone" => Shape(EImportClass.DateTime) with { TimeZone = true },
            "time without time zone" => Shape(EImportClass.Time),
            "time with time zone" => Shape(EImportClass.Time) with { TimeZone = true },
            "boolean" => Shape(EImportClass.Boolean),
            "bytea" => Shape(EImportClass.Binary),
            _ => Shape(EImportClass.Other)
        };
    }

    /// <summary>RN-IMPORT-010, no Db2: o tipo como o catálogo do Prism o escreve (`VARCHAR(80)`, `DECIMAL(12,2)`, `TIMESTAMP(12)`; o `TIMESTAMP` sem número tem 6 casas).</summary>
    private static ImportTargetColumn Db2(string type)
    {
        var (bare, arguments) = Split(type);

        return bare switch
        {
            "CHAR" or "CHARACTER" or "VARCHAR" or "GRAPHIC" or "VARGRAPHIC" or "LONG VARCHAR" or "CLOB" or "DBCLOB" => Shape(EImportClass.Text),
            "SMALLINT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int16 },
            "INTEGER" or "INT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int32 },
            "BIGINT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int64 },
            "DECIMAL" or "NUMERIC" => Shape(EImportClass.Number) with { Number = EImportNumber.Decimal, Scale = arguments.Count > 1 ? arguments[1] : 0 },
            "DECFLOAT" => Shape(EImportClass.Number) with { Number = EImportNumber.Decimal },
            "REAL" or "DOUBLE" or "FLOAT" => Shape(EImportClass.Number) with { Number = EImportNumber.Float },
            "DATE" => Shape(EImportClass.Date),
            "TIMESTAMP" => Shape(EImportClass.DateTime) with { Fraction = arguments.Count > 0 ? arguments[0] : 6 },
            "TIME" => Shape(EImportClass.Time) with { Fraction = 0 },
            "BOOLEAN" => Shape(EImportClass.Boolean),
            "BINARY" or "VARBINARY" or "BLOB" => Shape(EImportClass.Binary),
            _ => Shape(EImportClass.Other)
        };
    }

    /// <summary>
    /// RN-IMPORT-010, no Informix: o tipo como o catálogo do Prism o escreve (`DECIMAL(16)`, `MONEY(8,2)`, `DATETIME YEAR TO FRACTION(5)`). O `DATETIME`
    /// que começa em `YEAR` é data e hora, com as casas da `FRACTION` (nenhuma sem ela) e, no que para no dia, na hora ou nos minutos, o último campo; o
    /// `HOUR TO SECOND` é hora; o resto é "outra".
    /// </summary>
    private static ImportTargetColumn Informix(string type)
    {
        var upper = type.Trim().ToUpperInvariant();
        if (upper.StartsWith("DATETIME", StringComparison.Ordinal))
        {
            if (upper.StartsWith("DATETIME YEAR TO", StringComparison.Ordinal))
            {
                var endsAt = upper switch
                {
                    "DATETIME YEAR TO DAY" => EImportDateTimeEnd.Day,
                    "DATETIME YEAR TO HOUR" => EImportDateTimeEnd.Hour,
                    "DATETIME YEAR TO MINUTE" => EImportDateTimeEnd.Minute,
                    _ => (EImportDateTimeEnd?)null
                };

                return Shape(EImportClass.DateTime) with { Fraction = Fraction().Match(upper) is { Success: true } fraction ? int.Parse(fraction.Groups[1].Value, CultureInfo.InvariantCulture) : 0, EndsAt = endsAt };
            }

            return upper == "DATETIME HOUR TO SECOND" ? Shape(EImportClass.Time) with { Fraction = 0 } : Shape(EImportClass.Other);
        }

        var (bare, arguments) = Split(upper);

        return bare switch
        {
            "CHAR" or "VARCHAR" or "NCHAR" or "NVARCHAR" or "LVARCHAR" or "CLOB" or "TEXT" => Shape(EImportClass.Text),
            "SMALLINT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int16 },
            "INTEGER" or "INT" or "SERIAL" => Shape(EImportClass.Number) with { Number = EImportNumber.Int32 },
            "INT8" or "BIGINT" or "SERIAL8" or "BIGSERIAL" => Shape(EImportClass.Number) with { Number = EImportNumber.Int64 },
            "DECIMAL" or "MONEY" => Shape(EImportClass.Number) with { Number = EImportNumber.Decimal, Scale = arguments.Count > 1 ? arguments[1] : null },
            "SMALLFLOAT" or "FLOAT" => Shape(EImportClass.Number) with { Number = EImportNumber.Float },
            "DATE" => Shape(EImportClass.Date),
            "BOOLEAN" => Shape(EImportClass.Boolean),
            "BYTE" or "BLOB" => Shape(EImportClass.Binary),
            _ => Shape(EImportClass.Other)
        };
    }

    private static ImportTargetColumn Standard(string type)
    {
        var (bare, arguments) = Split(type);

        return bare switch
        {
            "CHAR" or "CHARACTER" or "VARCHAR" or "VARCHAR2" or "NVARCHAR" or "NVARCHAR2" or "NCHAR" or "TEXT" or "NTEXT" or "TINYTEXT" or "MEDIUMTEXT" or "LONGTEXT" or "CLOB" or "NCLOB" or "STRING" or "FIXEDSTRING" or "UUID" or "UNIQUEIDENTIFIER" or "JSON" or "XML" or "ENUM" or "SET" => Shape(EImportClass.Text),
            "TINYINT" or "SMALLINT" or "INT2" or "INT16" or "UINT8" or "UINT16" or "BYTEINT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int16 },
            "INTEGER" or "INT" or "MEDIUMINT" or "INT4" or "INT32" or "UINT32" => Shape(EImportClass.Number) with { Number = EImportNumber.Int32 },
            "BIGINT" or "INT8" or "INT64" or "UINT64" or "HUGEINT" => Shape(EImportClass.Number) with { Number = EImportNumber.Int64 },
            "DECIMAL" or "DEC" or "NUMERIC" or "BIGNUMERIC" or "NUMBER" or "MONEY" or "SMALLMONEY" or "DECFLOAT" => Shape(EImportClass.Number) with { Number = EImportNumber.Decimal, Scale = arguments.Count > 1 ? arguments[1] : null },
            "REAL" or "FLOAT" or "FLOAT4" or "FLOAT8" or "FLOAT32" or "FLOAT64" or "DOUBLE" or "DOUBLE PRECISION" or "BINARY_FLOAT" or "BINARY_DOUBLE" => Shape(EImportClass.Number) with { Number = EImportNumber.Float },
            "DATE" or "DATE32" => Shape(EImportClass.Date),
            "DATETIME" or "DATETIME2" or "DATETIME64" or "SMALLDATETIME" or "TIMESTAMP" or "TIMESTAMP_NTZ" or "TIMESTAMP_LTZ" or "TIMESTAMPTZ" => Shape(EImportClass.DateTime) with { Fraction = arguments.Count > 0 ? arguments[0] : 6 },
            "TIME" => Shape(EImportClass.Time) with { Fraction = 0 },
            "BOOLEAN" or "BOOL" or "BIT" => Shape(EImportClass.Boolean),
            "BLOB" or "TINYBLOB" or "MEDIUMBLOB" or "LONGBLOB" or "BINARY" or "VARBINARY" or "RAW" or "LONG RAW" or "BYTEA" or "BYTES" or "IMAGE" => Shape(EImportClass.Binary),
            _ => Shape(EImportClass.Other)
        };
    }

    private static ImportTargetColumn Shape(EImportClass importClass)
        => new(string.Empty, string.Empty, true, null, null, importClass, true, null);

    /// <summary>O nome do tipo sem os parênteses, em maiúsculas, e os números de dentro deles (`DECIMAL(12,2)` é `DECIMAL`, 12 e 2).</summary>
    private static (string Bare, IReadOnlyList<int> Arguments) Split(string type)
    {
        var upper = type.Trim().ToUpperInvariant();
        var open = upper.IndexOf('(');
        if (open < 0)
            return (upper, []);

        var close = upper.IndexOf(')', open);
        var inside = close < 0 ? upper[(open + 1)..] : upper[(open + 1)..close];
        var arguments = inside.Split(',').Select(part => int.TryParse(part.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var number) ? number : 0).ToList();

        return (upper[..open].TrimEnd(), arguments);
    }

    /// <summary>RN-EDIT-016: o padrão que é o próximo valor de uma sequência (`nextval('loja.pedido_id_seq'::regclass)`): a coluna é preenchida pelo banco.</summary>
    private static bool IsNextValue(string? expression)
        => expression?.Trim() is { } text && text.StartsWith("nextval(", StringComparison.OrdinalIgnoreCase) && text.EndsWith(')');

    [GeneratedRegex(@"\([^)]*\)")]
    private static partial Regex Modifiers();

    [GeneratedRegex(@"FRACTION\((\d+)\)\z")]
    private static partial Regex Fraction();
}
