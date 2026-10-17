using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Data;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>
/// RN-IMPORT-004 e 010: as opções do leitor que valem na conversão de cada valor (só o CSV e o TSV as têm). `NullText` nulo é "nenhum texto é nulo";
/// `NullTextQuoted` diz que o texto do nulo tem o separador ou a aspa, e então é nulo também entre aspas (o Exportar sempre o põe entre aspas).
/// </summary>
public sealed record ImportValueRules(string? NullText, bool NullTextQuoted, bool EmptyAsNull, bool Trim, bool Unguard)
{
    /// <summary>O JSON e o XLSX: sem texto do nulo, sem "Campo vazio vira nulo", sem tirar as pontas das colunas de texto e sem a proteção contra fórmula.</summary>
    public static ImportValueRules None { get; } = new(null, false, false, false, false);

    /// <summary>As regras do CSV e do TSV, com o separador que a leitura usou.</summary>
    public static ImportValueRules Of(CsvImportOptions options, string? delimiter)
        => new(options.NullText.Length == 0 ? null : options.NullText, options.NullText.Contains('"') || (delimiter is not null && options.NullText.Contains(delimiter, StringComparison.Ordinal)), options.EmptyAsNull, options.Trim, options.UnguardFormulas);

    public override string ToString()
        => nameof(ImportValueRules);
}

/// <summary>
/// Um valor convertido para a coluna: o texto canônico, como a prévia o mostra (nulo é o nulo), e o parâmetro que a carga manda ao banco (no PostgreSQL o
/// texto canônico, num parâmetro sem tipo, e o binário em bytes; no Db2 e no Informix o valor já convertido, com o tipo quando ele não basta).
/// `Unguarded` diz que o valor perdeu o apóstrofo da proteção contra fórmula (RN-IMPORT-020).
/// </summary>
public sealed record ImportConverted(string? Text, EditParameter Parameter, bool Unguarded)
{
    public static ImportConverted Null { get; } = new(null, new EditParameter(null), false);

    public override string ToString()
        => nameof(ImportConverted);
}

/// <summary>
/// RN-IMPORT-010: a conversão dos valores, a mesma na prévia e na carga. Cada valor do arquivo passa, nesta ordem: (1) o nulo; (2) a proteção contra
/// fórmula, sobre o valor como veio; (3) as pontas; (4) a forma canônica, pelos formatos da etapa Arquivo, escrita pelo Prism nos três bancos; e (5) a
/// conversão do banco: no PostgreSQL, o texto canônico vai num parâmetro sem tipo e quem converte é ele; no Db2 e no Informix, o Prism converte com a
/// conversão da RN-EDIT-006, e recusa as casas a mais que não são zero. As recusas citam o valor entre aspas angulares, como as da edição.
/// </summary>
public static partial class ImportValues
{
    /// <summary>As casas de fração que a data e hora do C# guarda.</summary>
    private const int MaxDateTimeFraction = 7;

    /// <summary>O expoente acima do qual o número não cabe em nenhuma coluna de inteiro ou de decimal do Db2 e do Informix (32 dígitos é o maior decimal deles).</summary>
    private const int MaxPlainExponent = 1000;

    public static Result<ImportConverted, string> Convert(EDatabaseEngine engine, ImportTargetColumn column, ImportValue value, ImportValueRules rules, ImportValueFormats formats)
    {
        var dialect = ReadOnlySql.DialectOf(engine);
        if (!column.Importable)
            return column.Reason ?? ImportColumns.UnsupportedReason;

        // (1) o nulo. Onde as pontas saem (3), a comparação com o texto do nulo e o teste do vazio já olham o valor sem elas.
        if (value.Source == EImportValueSource.Null || value.Text is null)
            return ImportConverted.Null;

        var text = value.Text;
        var trims = value.Source != EImportValueSource.Copied && (column.Class != EImportClass.Text || rules.Trim);
        var compared = trims ? ImportText.TrimEnds(text) : text;
        if (rules.NullText is { } nullText && compared == nullText && (value.Source == EImportValueSource.Plain || (value.Source == EImportValueSource.Quoted && rules.NullTextQuoted)))
            return ImportConverted.Null;

        if (compared.Length == 0 && value.Source is EImportValueSource.Plain or EImportValueSource.Quoted or EImportValueSource.Text && (column.Class != EImportClass.Text || rules.EmptyAsNull))
            return ImportConverted.Null;

        if (InvalidCharacter(text, column.Class) is { } invalid)
            return invalid;

        // (2) a proteção contra fórmula, sobre o valor como veio no campo, sem as aspas; (3) as pontas.
        var unguarded = false;
        if (rules.Unguard && value.Source is EImportValueSource.Plain or EImportValueSource.Quoted)
            text = ImportText.Unguard(text, out unguarded);

        if (trims)
            text = ImportText.TrimEnds(text);

        // (4) e (5): o número, a data e o lógico que o JSON e o XLSX trazem como tais já vêm na forma canônica, e não passam pelos formatos.
        var canonical = value.Source is EImportValueSource.Canonical or EImportValueSource.Json or EImportValueSource.Copied ? ImportValueFormats.Default : formats;
        var converted = column.Class switch
        {
            EImportClass.Text => Result.Success<ImportConverted, string>(new ImportConverted(text, new EditParameter(text), false)),
            EImportClass.Other => Result.Success<ImportConverted, string>(new ImportConverted(text, new EditParameter(text), false)),
            EImportClass.Number => Number(dialect, column, text, canonical),
            EImportClass.Date => Date(dialect, column, text, canonical),
            EImportClass.DateTime => DateTime(dialect, column, text, canonical),
            EImportClass.Time => Time(dialect, column, text),
            EImportClass.Boolean => Boolean(dialect, text),
            EImportClass.Binary => Binary(dialect, text),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

        return converted.Map(result => result with { Unguarded = unguarded });
    }

    /// <summary>
    /// RN-IMPORT-024 e 026: um valor da origem da cópia para o parâmetro do destino, sem passar pelo texto da grade (sem o corte, sem os formatos da etapa
    /// Arquivo). O nulo é o da origem, e passa sempre. O binário só vai para uma coluna binária, e a coluna binária só recebe binário, em bytes. O resto:
    /// - no PostgreSQL de destino, o texto vai como veio (o do servidor de origem, ou o canônico que o Prism escreve do valor do driver da IBM), num parâmetro
    ///   sem tipo, e quem converte é o banco; o Prism só recusa o que o banco faria em silêncio: a data e hora com hora que não é zero numa coluna só de
    ///   data e o fuso numa coluna sem fuso;
    /// - no Db2 e no Informix de destino, o Prism converte o texto como o de um arquivo, pelos passos 4 e 5 da RN-IMPORT-010, com os formatos canônicos
    ///   (a faixa do inteiro, as casas do decimal e da fração, a data e hora numa coluna só de data).
    ///
    /// A data e hora (e a hora) com fuso do PostgreSQL de origem vai a uma coluna sem fuso com a hora que ele escreveu, sem o fuso: é a única exceção à
    /// recusa do fuso.
    /// </summary>
    /// <param name="sourceColumn">O nome da coluna da origem, na frase do binário.</param>
    /// <param name="sourceType">O tipo da coluna da origem, como o driver o informa (`timestamp with time zone`).</param>
    /// <param name="sourceKind">O tipo da grade da coluna da origem (`binary` é o binário).</param>
    public static Result<EditParameter, string> ConvertCopied(EDatabaseEngine sourceEngine, string sourceColumn, string sourceType, string sourceKind, EDatabaseEngine targetEngine, ImportTargetColumn column, ExportCell cell)
    {
        if (!column.Importable)
            return column.Reason ?? ImportColumns.UnsupportedReason;

        if (cell.IsNull)
            return new EditParameter(null);

        var sourceBinary = sourceKind == "binary" || cell.Bytes is not null;
        if (sourceBinary != (column.Class == EImportClass.Binary))
            return sourceBinary ? $"A coluna {sourceColumn} da origem é binária, e a coluna de destino não é." : $"A coluna {sourceColumn} da origem não é binária, e a coluna de destino é.";

        if (cell.Bytes is { } bytes)
            return new EditParameter(bytes, DbType.Binary);

        var text = cell.Text!;
        if (InvalidCharacter(text, column.Class) is { } invalid)
            return invalid;

        var keepsZone = column.TimeZone && targetEngine == EDatabaseEngine.PostgreSql;
        if (column.Class is EImportClass.DateTime or EImportClass.Time && !keepsZone && sourceEngine == EDatabaseEngine.PostgreSql && WithTimeZone(sourceType) && text.Contains(':'))
            text = TrailingZone().Replace(text, string.Empty);

        if (targetEngine != EDatabaseEngine.PostgreSql)
        {
            var converted = Convert(targetEngine, column, new ImportValue(text, EImportValueSource.Copied), ImportValueRules.None, ImportValueFormats.Default);

            return converted.IsSuccess ? converted.Value.Parameter : converted.Error;
        }

        // No PostgreSQL de destino, o banco converte; o que não casa com a forma ISO é dele também.
        if (column.Class is EImportClass.Date or EImportClass.DateTime or EImportClass.Time && ParseTemporal(text, EImportDates.Iso) is { Refusal: null } parsed && (parsed.Date is not null || parsed.Time is not null))
        {
            var quoted = ImportText.Quoted(text);
            if (parsed.Zone.Length > 0 && !keepsZone)
                return $"{quoted} tem fuso, e a coluna não guarda fuso.";

            if (column.Class == EImportClass.Date && parsed.Time is { } time && time.Trim('0', ':', '.').Length > 0)
                return $"{quoted} tem hora, e a coluna {column.Name} é só data.";
        }

        return new EditParameter(text);
    }

    /// <summary>O tipo do PostgreSQL que guarda o fuso: `timestamp with time zone` e `time with time zone` (com os modificadores, `timestamp(3) with time zone`).</summary>
    private static bool WithTimeZone(string type)
        => type.Contains("with time zone", StringComparison.OrdinalIgnoreCase) || type.Trim() is "timestamptz" or "timetz";

    /// <summary>
    /// RN-IMPORT-010: o par substituto solto, que nenhum dos três bancos grava em UTF-8, e o caractere nulo (U+0000) fora de uma coluna binária, que o
    /// PostgreSQL não aceita num texto e o Prism não grava em nenhum.
    /// </summary>
    private static string? InvalidCharacter(string text, EImportClass importClass)
    {
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            if (char.IsHighSurrogate(character) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]))
            {
                index++;
                continue;
            }

            if (char.IsSurrogate(character))
                return $"O valor tem um caractere inválido (U+{(int)character:X4} sozinho).";

            if (character == '\0' && importClass != EImportClass.Binary)
                return "O valor tem o caractere nulo (U+0000), que o Prism não grava num texto.";
        }

        return null;
    }

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // O número.
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// RN-IMPORT-010, (4): o número com ponto e sem separador de milhar. Com "Ponto", nenhum separador de milhar; com "Vírgula", a vírgula é o separador
    /// decimal e o ponto é recusado, a não ser com "Aceitar o ponto como separador de milhar", em que ele vale só como milhar, em grupos de 3 depois de um
    /// primeiro grupo de 1 a 3 dígitos que não começa por 0. `NaN`, `Infinity` e `-Infinity` passam nas colunas do PostgreSQL que os leem.
    /// </summary>
    public static Result<string, string> CanonicalNumber(string text, ImportValueFormats formats, bool specialFloats, bool integer)
    {
        if (specialFloats && SpecialFloat().IsMatch(text))
            return Ok(text);

        var quoted = ImportText.Quoted(text);
        if (formats.Decimal == EImportDecimal.Point)
        {
            if (PointNumber().IsMatch(text))
                return Ok(text);

            return No(text.Contains(',') && LooksLikeANumber().IsMatch(text) ? $"{quoted} não é um número com ponto decimal. Se o arquivo usa vírgula, escolha Vírgula em Separador decimal." : NotANumber(quoted, integer));
        }

        if (!formats.ThousandsDot)
        {
            if (CommaNumber().IsMatch(text))
                return Ok(text.Replace(',', '.'));

            return No(text.Contains('.') && LooksLikeANumber().IsMatch(text) ? $"{quoted} tem ponto, e o separador decimal escolhido é a vírgula. Se o arquivo usa ponto decimal, escolha Ponto em Separador decimal; se escreve os milhares com ponto, ligue Aceitar o ponto como separador de milhar." : NotANumber(quoted, integer));
        }

        if (ThousandsNumber().IsMatch(text))
            return Ok(text.Replace(".", string.Empty, StringComparison.Ordinal).Replace(',', '.'));

        return No(text.Contains('.') && LooksLikeANumber().IsMatch(text) ? $"{quoted} não é um número com vírgula decimal e ponto de milhar." : NotANumber(quoted, integer));
    }

    private static Result<ImportConverted, string> Number(ESqlDialect dialect, ImportTargetColumn column, string text, ImportValueFormats formats)
    {
        var integer = column.Number is EImportNumber.Int16 or EImportNumber.Int32 or EImportNumber.Int64;
        var canonical = CanonicalNumber(text, formats, column.SpecialFloats && dialect == ESqlDialect.PostgreSql, integer);
        if (canonical.IsFailure)
            return canonical.Error;

        if (dialect == ESqlDialect.PostgreSql)
            return new ImportConverted(canonical.Value, new EditParameter(canonical.Value), false);

        var quoted = ImportText.Quoted(text);
        switch (column.Number)
        {
            case EImportNumber.Int16 or EImportNumber.Int32 or EImportNumber.Int64:
            {
                if (Plain(canonical.Value) is not { } plain)
                    return $"{quoted} está fora da faixa da coluna.";

                if (plain.Fraction.TrimEnd('0').Length > 0)
                    return $"{quoted} não é um número inteiro.";

                return Edit(dialect, column.Number == EImportNumber.Int16 ? EEditType.Int16 : column.Number == EImportNumber.Int32 ? EEditType.Int32 : EEditType.Int64, plain.Integer.Length == 0 ? "0" : $"{plain.Sign}{plain.Integer}", text);
            }

            case EImportNumber.Decimal when column.Scale is { } scale:
            {
                if (Plain(canonical.Value) is not { } plain)
                    return $"{quoted} está fora da faixa da coluna.";

                var fraction = plain.Fraction;
                if (fraction.Length > scale)
                {
                    if (fraction[scale..].Any(digit => digit != '0'))
                        return scale == 0 ? $"{quoted} tem casas decimais, e a coluna {column.Name} não guarda nenhuma." : $"{quoted} tem mais casas decimais que as {scale} da coluna {column.Name}.";

                    fraction = fraction[..scale];
                }

                var digits = $"{(plain.Integer.Length == 0 ? "0" : plain.Integer)}{(fraction.Length > 0 ? $".{fraction}" : string.Empty)}";

                return Edit(dialect, EEditType.Decimal, plain.Integer.Length == 0 && fraction.TrimEnd('0').Length == 0 ? digits : $"{plain.Sign}{digits}", text);
            }

            case EImportNumber.Decimal:
                return Edit(dialect, EEditType.Decimal, canonical.Value, text);

            default:
                return Edit(dialect, EEditType.Float, canonical.Value, text);
        }
    }

    /// <summary>
    /// O número canônico (com expoente ou não) como decimal sem expoente: o sinal, os dígitos da parte inteira sem os zeros da frente e os da fração. As
    /// casas contam no valor com o expoente aplicado (`1.5E-3` tem 4). Nulo quando o expoente é grande demais para qualquer coluna, também o que nem cabe
    /// num `long` (`1E99999999999999999999`, que a expressão aceita com quantos dígitos vierem).
    /// </summary>
    private static (string Sign, string Integer, string Fraction)? Plain(string canonical)
    {
        var match = PointNumber().Match(canonical);
        var sign = canonical.StartsWith('-') ? "-" : string.Empty;
        var mantissa = match.Groups["mantissa"].Value;
        long exponent = 0;
        if (match.Groups["exponent"].Success && !long.TryParse(match.Groups["exponent"].ValueSpan, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out exponent))
            return null;

        if (exponent is < -MaxPlainExponent or > MaxPlainExponent)
            return null;

        var point = mantissa.IndexOf('.');
        var digits = point < 0 ? mantissa : mantissa.Remove(point, 1);
        var integerLength = (point < 0 ? mantissa.Length : point) + (int)exponent;
        string integer;
        string fraction;
        if (integerLength <= 0)
        {
            integer = string.Empty;
            fraction = new string('0', -integerLength) + digits;
        }
        else if (integerLength >= digits.Length)
        {
            integer = digits + new string('0', integerLength - digits.Length);
            fraction = string.Empty;
        }
        else
        {
            integer = digits[..integerLength];
            fraction = digits[integerLength..];
        }

        return (sign, integer.TrimStart('0'), fraction);
    }

    private static Result<string, string> Ok(string value)
        => Result.Success<string, string>(value);

    private static Result<string, string> No(string refusal)
        => Result.Failure<string, string>(refusal);

    private static string NotANumber(string quoted, bool integer)
        => integer ? $"{quoted} não é um número inteiro." : $"{quoted} não é um número.";

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // A data, a data e hora e a hora.
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>
    /// RN-IMPORT-010, (4): a data, a data e hora ou a hora no texto canônico (`aaaa-mm-dd`, `aaaa-mm-dd hh:mm:ss[.f…][fuso]`, `hh:mm:ss[.f…][fuso]`), ou a
    /// recusa. A data vem no formato escolhido (`2024-01-15`, ou `15/01/2024` com um ou dois dígitos no dia e no mês e quatro no ano); a data e hora, com um
    /// espaço (ou um `T`, com "aaaa-mm-dd") e a hora como `10:30`, `10:30:00` ou `10:30:00.123456`; o fuso (`Z`, `+00`, `-03:00`) só na coluna que o guarda.
    /// A data sem hora numa coluna de data e hora é a meia-noite; a data com hora numa coluna de data passa quando a hora é zero.
    /// </summary>
    public static Result<string, string> CanonicalTemporal(EImportClass importClass, string text, ImportValueFormats formats, bool timeZone, string column)
    {
        var quoted = ImportText.Quoted(text);
        var parsed = ParseTemporal(text, formats.Dates);
        if (parsed.Refusal is { } refusal)
            return No(refusal(quoted));

        switch (importClass)
        {
            case EImportClass.Date:
                if (parsed.Date is null)
                    return No(DateFormatRefusal(quoted, formats.Dates, "uma data"));

                if (parsed.Time is null)
                    return Ok(parsed.Date);

                if (parsed.Zone.Length > 0)
                    return No($"{quoted} tem fuso, e a coluna não guarda fuso.");

                return parsed.Time.Trim('0', ':', '.').Length == 0 ? Ok(parsed.Date) : No($"{quoted} tem hora, e a coluna {column} é só data.");

            case EImportClass.DateTime:
                if (parsed.Date is null)
                    return No(parsed.Time is null ? DateFormatRefusal(quoted, formats.Dates, "uma data e hora") : $"{quoted} não é uma data e hora.");

                if (parsed.Zone.Length > 0 && !timeZone)
                    return No($"{quoted} tem fuso, e a coluna não guarda fuso.");

                return Ok($"{parsed.Date} {parsed.Time ?? "00:00:00"}{parsed.Zone}");

            default:
                if (parsed.Date is not null || parsed.Time is null)
                    return No($"{quoted} não é uma hora no formato hh:mm:ss.");

                if (parsed.Zone.Length > 0 && !timeZone)
                    return No($"{quoted} tem fuso, e a coluna não guarda fuso.");

                return Ok($"{parsed.Time}{parsed.Zone}");
        }
    }

    private static Result<ImportConverted, string> Date(ESqlDialect dialect, ImportTargetColumn column, string text, ImportValueFormats formats)
    {
        var canonical = CanonicalTemporal(EImportClass.Date, text, formats, column.TimeZone, column.Name);
        if (canonical.IsFailure)
            return canonical.Error;

        return dialect == ESqlDialect.PostgreSql ? new ImportConverted(canonical.Value, new EditParameter(canonical.Value), false) : Edit(dialect, EEditType.Date, canonical.Value, text);
    }

    private static Result<ImportConverted, string> DateTime(ESqlDialect dialect, ImportTargetColumn column, string text, ImportValueFormats formats)
    {
        var canonical = CanonicalTemporal(EImportClass.DateTime, text, formats, column.TimeZone && dialect == ESqlDialect.PostgreSql, column.Name);
        if (canonical.IsFailure)
            return canonical.Error;

        if (dialect == ESqlDialect.PostgreSql)
            return new ImportConverted(canonical.Value, new EditParameter(canonical.Value), false);

        if (column.EndsAt is { } endsAt)
            return WithinLastField(dialect, canonical.Value, column, endsAt, text);

        var fitted = WithinFraction(canonical.Value, column, text);

        return fitted.IsFailure ? fitted.Error : Edit(dialect, EEditType.Timestamp, fitted.Value, text);
    }

    /// <summary>
    /// RN-IMPORT-010, (5) no Informix (emenda de 2026-10-17): o `DATETIME` que para no dia, na hora ou nos minutos recusa o valor com um campo depois do
    /// último dele que não é zero, porque o banco o cortaria sem dizer nada, com as frases da data com hora numa coluna de data: no `YEAR TO DAY`, qualquer
    /// hora que não é zero "tem hora"; no `YEAR TO HOUR` e no `YEAR TO MINUTE`, o primeiro campo a mais que não é zero ("tem minutos", "tem segundos",
    /// "tem casas de fração"). Os campos a mais que são zero saem, e a prévia mostra o valor só até o último campo da coluna (`2024-01-15 10`).
    /// </summary>
    private static Result<ImportConverted, string> WithinLastField(ESqlDialect dialect, string canonical, ImportTargetColumn column, EImportDateTimeEnd endsAt, string text)
    {
        // O canônico da data e hora sem fuso: `aaaa-mm-dd hh:mm:ss[.f…]`.
        var date = canonical[..10];
        var (hour, minute, second) = (canonical[11..13], canonical[14..16], canonical[17..19]);
        var fraction = canonical.Length > 20 ? canonical[20..] : string.Empty;
        static bool Zero(string field)
            => field.All(digit => digit == '0');

        var extra = endsAt switch
        {
            EImportDateTimeEnd.Day => Zero(hour) && Zero(minute) && Zero(second) && Zero(fraction) ? null : "hora",
            EImportDateTimeEnd.Hour => !Zero(minute) ? "minutos" : !Zero(second) ? "segundos" : !Zero(fraction) ? "casas de fração" : null,
            _ => !Zero(second) ? "segundos" : !Zero(fraction) ? "casas de fração" : null
        };

        if (extra is not null)
        {
            var quoted = ImportText.Quoted(text);

            return endsAt switch
            {
                EImportDateTimeEnd.Day => $"{quoted} tem hora, e a coluna {column.Name} é só data.",
                EImportDateTimeEnd.Hour => $"{quoted} tem {extra}, e a coluna {column.Name} guarda só até a hora.",
                _ => $"{quoted} tem {extra}, e a coluna {column.Name} guarda só até os minutos."
            };
        }

        var shown = endsAt switch
        {
            EImportDateTimeEnd.Day => date,
            EImportDateTimeEnd.Hour => $"{date} {hour}",
            _ => $"{date} {hour}:{minute}"
        };

        return Edit(dialect, EEditType.Timestamp, $"{date} {hour}:{minute}:{second}", text).Map(converted => converted with { Text = shown });
    }

    private static Result<ImportConverted, string> Time(ESqlDialect dialect, ImportTargetColumn column, string text)
    {
        var canonical = CanonicalTemporal(EImportClass.Time, text, ImportValueFormats.Default, column.TimeZone && dialect == ESqlDialect.PostgreSql, column.Name);
        if (canonical.IsFailure)
            return canonical.Error;

        if (dialect == ESqlDialect.PostgreSql)
            return new ImportConverted(canonical.Value, new EditParameter(canonical.Value), false);

        var fitted = WithinFraction(canonical.Value, column, text);

        return fitted.IsFailure ? fitted.Error : Edit(dialect, EEditType.Time, fitted.Value, text);
    }

    /// <summary>
    /// RN-IMPORT-010, (5) no Db2 e no Informix: a fração com mais casas que a coluna guarda é recusada quando as casas a mais não são zero, porque o banco
    /// as cortaria ou arredondaria sem dizer nada; as que são zero saem.
    /// </summary>
    private static Result<string, string> WithinFraction(string canonical, ImportTargetColumn column, string text)
    {
        var point = canonical.LastIndexOf('.');
        if (point < 0)
            return Ok(canonical);

        var fraction = canonical[(point + 1)..];
        var kept = column.Fraction ?? MaxDateTimeFraction;
        if (fraction.Length <= kept)
            return Ok(canonical);

        if (fraction[kept..].Any(digit => digit != '0'))
        {
            var quoted = ImportText.Quoted(text);

            return No(kept == 0 ? $"{quoted} tem casas de fração, e a coluna {column.Name} não guarda nenhuma." : $"{quoted} tem mais casas de fração que as {kept} da coluna {column.Name}.");
        }

        return Ok(kept == 0 ? canonical[..point] : canonical[..(point + 1 + kept)]);
    }

    /// <summary>O texto de uma data, de uma data e hora ou de uma hora, em partes, já canônicas; ou a recusa dele (a data que não existe, o ano com menos de 4 dígitos).</summary>
    private static (string? Date, string? Time, string Zone, Func<string, string>? Refusal) ParseTemporal(string text, EImportDates dates)
    {
        if (TimeOnly().Match(text) is { Success: true } time)
            return TimeOf(time) is { } clock ? (null, clock, time.Groups["zone"].Value, null) : (null, null, string.Empty, quoted => $"{quoted} não é uma hora válida.");

        var match = dates == EImportDates.Iso ? IsoDateTime().Match(text) : DayMonthYearDateTime().Match(text);
        if (!match.Success)
            return (null, null, string.Empty, null);

        if (match.Groups["year"].Length != 4)
            return (null, null, string.Empty, quoted => $"O ano tem de ter 4 dígitos: {quoted}.");

        var year = int.Parse(match.Groups["year"].Value, CultureInfo.InvariantCulture);
        var month = int.Parse(match.Groups["month"].Value, CultureInfo.InvariantCulture);
        var day = int.Parse(match.Groups["day"].Value, CultureInfo.InvariantCulture);
        if (year < 1 || month is < 1 or > 12 || day < 1 || day > System.DateTime.DaysInMonth(year, month))
            return (null, null, string.Empty, quoted => $"{quoted} não é uma data válida.");

        var date = $"{year:0000}-{month:00}-{day:00}";
        if (!match.Groups["hour"].Success)
            return (date, null, string.Empty, null);

        return TimeOf(match) is { } clockOf ? (date, clockOf, match.Groups["zone"].Value, null) : (null, null, string.Empty, quoted => $"{quoted} não é uma hora válida.");
    }

    /// <summary>A hora `hh:mm:ss[.f…]` de um texto que casou com uma das expressões, ou nula fora da faixa (até 23:59:59).</summary>
    private static string? TimeOf(Match match)
    {
        var hour = int.Parse(match.Groups["hour"].Value, CultureInfo.InvariantCulture);
        var minute = int.Parse(match.Groups["minute"].Value, CultureInfo.InvariantCulture);
        var second = match.Groups["second"].Success ? int.Parse(match.Groups["second"].Value, CultureInfo.InvariantCulture) : 0;
        if (hour > 23 || minute > 59 || second > 59)
            return null;

        var fraction = match.Groups["fraction"].Success ? $".{match.Groups["fraction"].Value}" : string.Empty;

        return $"{hour:00}:{minute:00}:{second:00}{fraction}";
    }

    private static string DateFormatRefusal(string quoted, EImportDates dates, string what)
        => $"{quoted} não é {what} no formato {(dates == EImportDates.Iso ? "aaaa-mm-dd" : "dd/mm/aaaa")}{(what == "uma data" ? string.Empty : " hh:mm:ss")}.";

    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // O lógico e o binário.
    // ---------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>RN-IMPORT-010: `true` ou `false`; o Prism troca `verdadeiro` e `falso`, os do Excel em português, sem diferenciar maiúsculas; o resto vai como veio.</summary>
    public static string CanonicalBoolean(string text)
        => text.ToLowerInvariant() switch
        {
            "verdadeiro" => "true",
            "falso" => "false",
            _ => text
        };

    private static Result<ImportConverted, string> Boolean(ESqlDialect dialect, string text)
    {
        var canonical = CanonicalBoolean(text);

        return dialect == ESqlDialect.PostgreSql ? new ImportConverted(canonical, new EditParameter(canonical), false) : Edit(dialect, EEditType.Boolean, canonical, text);
    }

    /// <summary>
    /// RN-IMPORT-010: o binário em bytes, de `0x` seguido dos dígitos hexadecimais (maiúsculos ou minúsculos, em número par), o que a exportação escreve; no
    /// PostgreSQL também de `\x` seguido deles, o texto do próprio banco. Nulo quando o texto não é nenhum dos dois.
    /// </summary>
    public static byte[]? BinaryOf(string text, bool postgres)
    {
        if (!(text.StartsWith("0x", StringComparison.Ordinal) || (postgres && text.StartsWith(@"\x", StringComparison.Ordinal))))
            return null;

        var digits = text.AsSpan(2);
        if (digits.Length % 2 != 0 || digits.ContainsAnyExcept(HexDigits))
            return null;

        return System.Convert.FromHexString(digits);
    }

    private static Result<ImportConverted, string> Binary(ESqlDialect dialect, string text)
    {
        if (BinaryOf(text, dialect == ESqlDialect.PostgreSql) is not { } bytes)
            return "Um binário vem como 0x seguido dos dígitos hexadecimais.";

        return new ImportConverted(PreviewBinary(bytes), new EditParameter(bytes, DbType.Binary), false);
    }

    /// <summary>RN-IMPORT-011: o binário como a prévia o mostra: `0x` e os primeiros 32 bytes, com "…" quando há mais.</summary>
    public static string PreviewBinary(byte[] bytes)
        => $"0x{System.Convert.ToHexString(bytes.AsSpan(0, Math.Min(bytes.Length, ImportText.MaxPreviewBytes)))}{(bytes.Length > ImportText.MaxPreviewBytes ? "…" : string.Empty)}";

    /// <summary>
    /// RN-IMPORT-010, (5) no Db2 e no Informix: a conversão da edição (RN-EDIT-006) do texto canônico para o tipo da coluna, com a frase dela. A recusa cita
    /// o valor como veio do arquivo, e não o canônico.
    /// </summary>
    private static Result<ImportConverted, string> Edit(ESqlDialect dialect, EEditType type, string canonical, string text)
    {
        var converted = EditValues.Convert(dialect, type, canonical);
        if (converted.IsFailure)
            return converted.Error.Replace(ImportText.Quoted(canonical), ImportText.Quoted(text), StringComparison.Ordinal);

        return new ImportConverted(canonical, converted.Value, false);
    }

    private static readonly System.Buffers.SearchValues<char> HexDigits = System.Buffers.SearchValues.Create("0123456789abcdefABCDEF");

    /// <summary>O fuso no fim do texto da data e hora (ou da hora) do PostgreSQL: `Z`, `+00`, `-03:00`, e o de segundos das datas antigas, `-03:06:28`.</summary>
    [GeneratedRegex(@"(?:Z|[+-][0-9]{2}(?::?[0-9]{2}(?::?[0-9]{2})?)?)\z")]
    private static partial Regex TrailingZone();

    [GeneratedRegex(@"^(?:NaN|-?Infinity)\z", RegexOptions.IgnoreCase)]
    private static partial Regex SpecialFloat();

    [GeneratedRegex(@"^[+-]?(?<mantissa>[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE](?<exponent>[+-]?[0-9]+))?\z")]
    private static partial Regex PointNumber();

    [GeneratedRegex(@"^[+-]?(?:[0-9]+(?:,[0-9]*)?|,[0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex CommaNumber();

    [GeneratedRegex(@"^[+-]?(?:(?:[1-9][0-9]{0,2}(?:\.[0-9]{3})+|[0-9]+)(?:,[0-9]*)?|,[0-9]+)(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex ThousandsNumber();

    /// <summary>
    /// Dígitos, pontos e vírgulas, com o sinal e o expoente: o texto que seria um número com outro separador. O dígito obrigatório é conferido à frente
    /// (`(?=…)`), e não entre dois `[0-9.,]*`, que voltariam em tempo quadrático no valor longo que não casa (um valor de 64 MiB levaria horas).
    /// </summary>
    [GeneratedRegex(@"^[+-]?(?=[0-9.,]*[0-9])[0-9.,]+(?:[eE][+-]?[0-9]+)?\z")]
    private static partial Regex LooksLikeANumber();

    [GeneratedRegex(@"^(?<hour>[0-9]{1,2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?(?<zone>Z|[+-][0-9]{2}(?::?[0-9]{2})?)?\z")]
    private static partial Regex TimeOnly();

    [GeneratedRegex(@"^(?<year>[0-9]+)-(?<month>[0-9]{2})-(?<day>[0-9]{2})(?:[ T](?<hour>[0-9]{1,2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?(?<zone>Z|[+-][0-9]{2}(?::?[0-9]{2})?)?)?\z")]
    private static partial Regex IsoDateTime();

    [GeneratedRegex(@"^(?<day>[0-9]{1,2})/(?<month>[0-9]{1,2})/(?<year>[0-9]+)(?: (?<hour>[0-9]{1,2}):(?<minute>[0-9]{2})(?::(?<second>[0-9]{2})(?:\.(?<fraction>[0-9]+))?)?(?<zone>Z|[+-][0-9]{2}(?::?[0-9]{2})?)?)?\z")]
    private static partial Regex DayMonthYearDateTime();
}
