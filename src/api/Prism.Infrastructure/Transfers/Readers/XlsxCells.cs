using System.Globalization;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Transfers.Readers;

/// <summary>RN-IMPORT-006: o que o formato de número de uma célula diz do número dela.</summary>
internal enum EXlsxNumberKind
{
    Number,
    Date,
    DateTime,
    Time
}

/// <summary>RN-IMPORT-006: por que o número de uma célula de data não é uma data.</summary>
internal enum EXlsxDateRefusal
{
    None,

    /// <summary>O número negativo, e a parte inteira menor que 1 numa data do sistema de 1900, e a data depois de 31/12/9999.</summary>
    NotADate,

    /// <summary>O 60 do sistema de 1900: o 29/02/1900 que o Excel inventa.</summary>
    Leap1900
}

/// <summary>
/// RN-IMPORT-006: as regras puras de uma célula do XLSX, que os testes conferem: a referência (`C12`), o formato de data e hora pelo código, o número de
/// data que vira data e hora pelo sistema de datas da pasta de trabalho, a célula de data (`t="d"`), o número no texto mais curto e o erro do Excel.
/// </summary>
internal static partial class XlsxCells
{
    /// <summary>A última coluna (XFD) e a última linha do Excel.</summary>
    public const int MaxColumn = 16384;
    public const int MaxRow = 1048576;

    private const long MillisecondsPerDay = 86_400_000;

    /// <summary>Os formatos embutidos de data e hora (os números 14 a 22, 27 a 36, 45, 47 e 50 a 58); o 46 (`[h]:mm:ss`) é tempo decorrido, e é número.</summary>
    private static readonly HashSet<int> BuiltInDates = [14, 15, 16, 17, 27, 28, 29, 30, 31, 36, 50, 51, 54, 57, 58];
    private static readonly HashSet<int> BuiltInTimes = [18, 19, 20, 21, 32, 33, 34, 35, 45, 47, 52, 53, 55, 56];
    private const int BuiltInDateTime = 22;

    /// <summary>Os erros do Excel como ele os mostra em português (o arquivo guarda o código em inglês).</summary>
    private static readonly Dictionary<string, string> Errors = new(StringComparer.Ordinal)
    {
        ["#N/A"] = "#N/D",
        ["#VALUE!"] = "#VALOR!",
        ["#NAME?"] = "#NOME?",
        ["#NUM!"] = "#NÚM!",
        ["#NULL!"] = "#NULO!",
        ["#GETTING_DATA"] = "#OBTENDO_DADOS",
        ["#SPILL!"] = "#DESPEJAR!"
    };

    /// <summary>A referência de uma célula (`C12`): a coluna a partir de 0 e a linha a partir de 1. Falso fora de A1:XFD1048576 ou na referência mal escrita.</summary>
    public static bool TryParseReference(string reference, out int column, out int row)
    {
        column = 0;
        row = 0;
        var index = 0;
        while (index < reference.Length && char.IsAsciiLetterUpper(reference[index]))
        {
            column = column * 26 + (reference[index] - 'A' + 1);
            index++;
            if (column > MaxColumn)
                return false;
        }

        if (index == 0 || index == reference.Length || !int.TryParse(reference.AsSpan(index), NumberStyles.None, CultureInfo.InvariantCulture, out row) || row is < 1 or > MaxRow)
            return false;

        column--;

        return true;
    }

    /// <summary>
    /// RN-IMPORT-006: o que o formato de número diz. O embutido pelo número dele; o próprio pelo código, sem o que está entre aspas, depois de `\` (e do
    /// `_` e do `*` de preenchimento) e entre colchetes, com `d`, `m`, `y`, `h` ou `s`, em maiúscula ou minúscula. Antes de tirar os colchetes, o código
    /// com `[h]`, `[hh]`, `[m]`, `[mm]`, `[s]` ou `[ss]` é de tempo decorrido, e é número. O `m` é minuto logo depois de `h` ou logo antes de `s`; senão, mês.
    /// </summary>
    public static EXlsxNumberKind KindOf(int formatID, string? code)
    {
        if (code is null)
        {
            if (BuiltInDates.Contains(formatID))
                return EXlsxNumberKind.Date;

            if (BuiltInTimes.Contains(formatID))
                return EXlsxNumberKind.Time;

            return formatID == BuiltInDateTime ? EXlsxNumberKind.DateTime : EXlsxNumberKind.Number;
        }

        if (Elapsed().IsMatch(code))
            return EXlsxNumberKind.Number;

        var bare = AmPm().Replace(Stripped().Replace(code, string.Empty), string.Empty);
        var runs = Letters().Matches(bare).Select(match => char.ToLowerInvariant(match.Value[0])).ToList();
        var hasDate = false;
        var hasTime = false;
        for (var index = 0; index < runs.Count; index++)
        {
            switch (runs[index])
            {
                case 'd' or 'y':
                    hasDate = true;
                    break;
                case 'h' or 's':
                    hasTime = true;
                    break;
                case 'm' when (index > 0 && runs[index - 1] == 'h') || (index + 1 < runs.Count && runs[index + 1] == 's'):
                    hasTime = true;
                    break;
                case 'm':
                    hasDate = true;
                    break;
            }
        }

        return (hasDate, hasTime) switch
        {
            (true, true) => EXlsxNumberKind.DateTime,
            (true, false) => EXlsxNumberKind.Date,
            (false, true) => EXlsxNumberKind.Time,
            _ => EXlsxNumberKind.Number
        };
    }

    /// <summary>
    /// RN-IMPORT-006: o número de uma célula de data, hora ou data e hora no texto canônico. O número é o dia contado do sistema de datas da pasta: no de
    /// 1900, do 1 ao 59 o dia é contado de 31/12/1899, o 60 é o 29/02/1900 que o Excel inventa (recusado), e do 61 em diante o dia é contado de
    /// 30/12/1899; no de 1904, o 0 é 01/01/1904. A fração do dia é a hora, arredondada ao milissegundo; o arredondamento que chega a 24:00:00.000 avança a
    /// data. Sai `aaaa-mm-dd` sem hora no formato; `aaaa-mm-dd hh:mm:ss`, com `.fff` quando há milissegundos, com hora; e `hh:mm:ss` quando o formato só tem
    /// hora e o número é menor que 1.
    /// </summary>
    public static string? DateText(double serial, bool date1904, EXlsxNumberKind kind, out EXlsxDateRefusal refusal)
    {
        refusal = EXlsxDateRefusal.None;
        if (serial < 0 || !double.IsFinite(serial))
        {
            refusal = EXlsxDateRefusal.NotADate;

            return null;
        }

        var whole = Math.Floor(serial);
        var milliseconds = (long)Math.Round((serial - whole) * MillisecondsPerDay, MidpointRounding.AwayFromZero);
        if (milliseconds >= MillisecondsPerDay)
        {
            whole++;
            milliseconds -= MillisecondsPerDay;
        }

        if (kind == EXlsxNumberKind.Time && serial < 1)
            return Time(whole >= 1 ? 0 : milliseconds);

        DateOnly date;
        if (date1904)
            date = new DateOnly(1904, 1, 1);
        else if (whole < 1)
        {
            refusal = EXlsxDateRefusal.NotADate;

            return null;
        }
        else if (whole == 60)
        {
            refusal = EXlsxDateRefusal.Leap1900;

            return null;
        }
        else
            date = whole < 60 ? new DateOnly(1899, 12, 31) : new DateOnly(1899, 12, 30);

        if (whole > DateOnly.MaxValue.DayNumber - date.DayNumber)
        {
            refusal = EXlsxDateRefusal.NotADate;

            return null;
        }

        var text = date.AddDays((int)whole).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        return kind == EXlsxNumberKind.Date ? text : $"{text} {Time(milliseconds)}";
    }

    /// <summary>
    /// RN-IMPORT-006: a célula de data (`t="d"`), que vale a data ISO 8601 dela, escrita como `aaaa-mm-dd`, `aaaa-mm-dd hh:mm:ss` (com a fração, quando vem)
    /// ou `hh:mm:ss`, com o fuso no fim quando ela o tem. Nulo quando ela não é ISO 8601.
    /// </summary>
    public static string? IsoDateText(string text)
    {
        if (IsoDate().Match(text) is { Success: true } date)
        {
            if (!IsDate(date.Groups["date"].Value))
                return null;

            if (!date.Groups["time"].Success)
                return date.Groups["date"].Value;

            return $"{date.Groups["date"].Value} {TimeOf(date.Groups["time"].Value)}{date.Groups["zone"].Value}";
        }

        if (IsoTime().Match(text) is { Success: true } time)
            return $"{TimeOf(time.Groups["time"].Value)}{time.Groups["zone"].Value}";

        return null;
    }

    /// <summary>RN-IMPORT-006: o número fora do formato de data, no texto mais curto que volta ao mesmo número (`0.1`, `12`, `1E+20`), com ponto.</summary>
    public static string? NumberText(string value)
        => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number) ? number.ToString(CultureInfo.InvariantCulture) : null;

    /// <summary>RN-IMPORT-006: o erro do Excel como ele o mostra em português (`#N/D`); o que esta lista não conhece, como veio.</summary>
    public static string ErrorText(string code)
        => Errors.GetValueOrDefault(code, code);

    private static string Time(long milliseconds)
    {
        var time = TimeSpan.FromMilliseconds(milliseconds);
        var text = $"{time.Hours:00}:{time.Minutes:00}:{time.Seconds:00}";

        return time.Milliseconds == 0 ? text : $"{text}.{time.Milliseconds:000}";
    }

    /// <summary>`hh:mm`, `hh:mm:ss` ou `hh:mm:ss.f…`, com os segundos sempre.</summary>
    private static string TimeOf(string time)
        => time.Length == 5 ? $"{time}:00" : time;

    private static bool IsDate(string text)
        => DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    [GeneratedRegex(@"\[(?:h+|m+|s+)\]", RegexOptions.IgnoreCase)]
    private static partial Regex Elapsed();

    /// <summary>O que não conta no código: o texto entre aspas, o caractere depois de `\`, `_` e `*`, e o que está entre colchetes.</summary>
    [GeneratedRegex(@"""[^""]*""|\\.|_.|\*.|\[[^\]]*\]")]
    private static partial Regex Stripped();

    [GeneratedRegex(@"AM/PM|A/P", RegexOptions.IgnoreCase)]
    private static partial Regex AmPm();

    [GeneratedRegex(@"d+|m+|y+|h+|s+", RegexOptions.IgnoreCase)]
    private static partial Regex Letters();

    [GeneratedRegex(@"^(?<date>[0-9]{4}-[0-9]{2}-[0-9]{2})(?:T(?<time>[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?)(?<zone>Z|[+-][0-9]{2}(?::?[0-9]{2})?)?)?\z")]
    private static partial Regex IsoDate();

    [GeneratedRegex(@"^(?<time>[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?)(?<zone>Z|[+-][0-9]{2}(?::?[0-9]{2})?)?\z")]
    private static partial Regex IsoTime();
}
