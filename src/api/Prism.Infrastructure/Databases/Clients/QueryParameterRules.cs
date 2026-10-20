using Prism.Infrastructure.Databases.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-VAR-032: os `params` de um comando (`POST .../queries` e o `source.params` da exportação e da cópia): a forma que a API confere antes de qualquer coisa
/// ir ao banco, a leitura dos valores já conferidos e o que depende do banco (os dígitos que o decimal guarda, o expoente que o `double` aguenta, o fuso do
/// instante). Pública, como o `ExportSql`: os validators e os handlers da Application a usam. Nenhum valor entra numa mensagem (RN-VAR-036).
/// </summary>
public static partial class QueryParameterRules
{
    /// <summary>RN-VAR-013 e 032: as entradas da lista.</summary>
    public const int MaxCount = 10_000;

    /// <summary>RN-VAR-032: os caracteres de um `text`.</summary>
    public const int MaxTextCharacters = 1_000_000;

    /// <summary>RN-VAR-032: o texto de todos os valores juntos, em UTF-8.</summary>
    public const int MaxBytes = 4 * 1024 * 1024;

    /// <summary>RN-VAR-032: os caracteres de um `number`.</summary>
    public const int MaxNumberCharacters = 100;

    /// <summary>O decimal que o Db2 guarda, e o que o Informix guarda pelo driver (a sonda S-VAR-1 provou 31 nos dois, e não 32).</summary>
    public const int MaxDecimalDigits = 31;

    private static readonly string[] TypeNames = ["text", "number", "boolean", "date", "timestamp"];

    [GeneratedRegex(@"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex NumberForm();

    [GeneratedRegex(@"^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2})(\.[0-9]{1,6})?(Z|[+-]([0-9]{2})(:([0-9]{2}))?)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex TimestampForm();

    /// <summary>
    /// A recusa de forma dos `params` (ou do `source.params`, em `field`), campo por campo: `field` quando é a lista, `field[3].value` e `field[3].type` quando é
    /// uma entrada. Nulo, ausente e vazio são a falta dos parâmetros (o comando vai como antes). A entrada que não é um objeto com as duas chaves, e só elas, o
    /// `type` fora da lista, o `value` que não é texto nem nulo e a forma de cada tipo (RN-VAR-032). O valor nunca vai na mensagem.
    /// </summary>
    public static IReadOnlyList<(string Field, string Message)> Refusals(JsonElement? parameters, string field)
    {
        if (parameters is null or { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined })
            return [];

        var list = parameters.Value;
        if (list.ValueKind != JsonValueKind.Array)
            return [(field, "Informe os valores como uma lista de { type, value }.")];

        if (list.GetArrayLength() > MaxCount)
            return [(field, "O comando leva até 10.000 valores.")];

        var refusals = new List<(string, string)>();
        long bytes = 0;
        var index = 0;
        foreach (var entry in list.EnumerateArray())
        {
            var path = $"{field}[{index++}]";
            if (entry.ValueKind != JsonValueKind.Object || !HasOnlyTheTwoKeys(entry))
            {
                refusals.Add((path, "Cada valor é um objeto com type e value."));
                continue;
            }

            var typeElement = entry.GetProperty("type");
            var valueElement = entry.GetProperty("value");
            var type = typeElement.ValueKind == JsonValueKind.String && TryGetText(typeElement, out var typeName) ? TypeNames.AsSpan().IndexOf(typeName) : -1;
            if (type < 0)
            {
                refusals.Add(($"{path}.type", "O tipo é text, number, boolean, date ou timestamp."));
                continue;
            }

            if (valueElement.ValueKind == JsonValueKind.Null)
                continue;

            if (valueElement.ValueKind != JsonValueKind.String)
            {
                refusals.Add(($"{path}.value", "O valor é um texto, ou nulo."));
                continue;
            }

            // A metade de um par UTF-16 e o UTF-8 inválido chegam como o JSON os escreveu, e ler o texto lança: é a recusa do campo, e nunca o 500.
            if (!TryGetText(valueElement, out var value))
            {
                refusals.Add(($"{path}.value", "O texto tem metade de um par UTF-16 ou UTF-8 inválido, que o banco não guarda."));
                continue;
            }

            if (FormRefusal((EQueryParameterType)type, value) is { } message)
                refusals.Add(($"{path}.value", message));
            else
                bytes += Encoding.UTF8.GetByteCount(value);
        }

        if (bytes > MaxBytes)
            refusals.Add((field, "Os valores do comando passam de 4 MiB."));

        return refusals;
    }

    /// <summary>
    /// O texto do valor, ou nada quando o JSON o escreve com a metade de um par UTF-16 (`\uD800`) ou com UTF-8 inválido: o `GetString()` lança `InvalidOperationException`, e o
    /// <c>System.Text.Json</c> não tem uma versão `Try`. É a única captura deste arquivo, em volta de uma leitura que não faz mais nada.
    /// </summary>
    private static bool TryGetText(JsonElement element, out string text)
    {
        try
        {
            text = element.GetString()!;

            return true;
        }
        catch (InvalidOperationException)
        {
            text = string.Empty;

            return false;
        }
    }

    /// <summary>Os valores já conferidos (<see cref="Refusals"/> vazio): na ordem. Sem lista, nulo ou vazia, nenhum.</summary>
    public static IReadOnlyList<QueryParameter> Read(JsonElement? parameters)
    {
        if (parameters is not { ValueKind: JsonValueKind.Array } list)
            return [];

        return [.. list.EnumerateArray().Select(entry =>
        {
            var value = entry.GetProperty("value");

            return new QueryParameter((EQueryParameterType)TypeNames.AsSpan().IndexOf(entry.GetProperty("type").GetString()!), value.ValueKind == JsonValueKind.Null ? null : value.GetString());
        })];
    }

    /// <summary>O texto de todos os valores, em bytes de UTF-8: o teto de memória de um resultado (RN-VAR-036) e o do pedido.</summary>
    public static long Bytes(IReadOnlyList<QueryParameter> parameters)
        => parameters.Sum(parameter => parameter.Value is null ? 0 : Encoding.UTF8.GetByteCount(parameter.Value));

    /// <summary>
    /// O que só o banco decide, antes de qualquer coisa ir a ele: no Db2 e no Informix, o decimal com mais de 31 dígitos ("O número tem 35 dígitos, e o Db2
    /// guarda até 31.", e no Informix "... guarda até 31 pelo driver."), o número com expoente que o `double` não guarda (a infinidade) e o instante com fuso, que só o PostgreSQL entende. O primeiro que não
    /// serve, no campo `field[i].value`. No PostgreSQL o valor vai como texto, e o servidor diz o que não cabe (o erro do banco, como veio).
    /// </summary>
    public static (string Field, string Message)? EngineRefusal(EDatabaseEngine engine, IReadOnlyList<QueryParameter> parameters, string field)
    {
        if (engine == EDatabaseEngine.PostgreSql)
            return null;

        var name = engine == EDatabaseEngine.Db2 ? "o Db2" : "o Informix";
        for (var index = 0; index < parameters.Count; index++)
        {
            var parameter = parameters[index];
            if (parameter.Value is null)
                continue;

            if (parameter.Type == EQueryParameterType.Timestamp && TimestampForm().Match(parameter.Value).Groups[4].Success)
                return ($"{field}[{index}].value", $"O instante com fuso só vale no PostgreSQL; {name} guarda o instante sem fuso.");

            if (parameter.Type != EQueryParameterType.Number)
                continue;

            switch (Classify(parameter.Value))
            {
                case ENumberClass.Decimal when DecimalDigits(parameter.Value) is var digits and > MaxDecimalDigits:
                    return ($"{field}[{index}].value", $"O número tem {digits} dígitos, e {name} guarda até {MaxDecimalDigits}{(engine == EDatabaseEngine.Informix ? " pelo driver" : string.Empty)}.");
                case ENumberClass.Double when !double.IsFinite(double.Parse(parameter.Value, NumberStyles.Float, CultureInfo.InvariantCulture)):
                    return ($"{field}[{index}].value", $"O número passa do que {name} guarda em um DOUBLE.");
            }
        }

        return null;
    }

    /// <summary>RN-VAR-032 e RN-GRADE-011: o filtro do resultado de um comando com `params` não leva marcador, porque os marcadores e os valores ficam na ordem do comando.</summary>
    public const string FilterMarker = "O filtro não pode ter marcador de parâmetro ($1 ou ?).";

    /// <summary>O filtro tem marcador de parâmetro (`$n` no PostgreSQL, `?` no Db2 e no Informix), fora de texto, de nome entre aspas e de comentário?</summary>
    public static bool FilterHasMarker(string filter, EDatabaseEngine engine)
        => ParameterMarkers.Count(filter, ReadOnlySql.DialectOf(engine)) > 0;

    /// <summary>
    /// RN-VAR-032: a recusa do comando montado com os `params`, antes de qualquer coisa ir ao banco: os marcadores do texto não batem com os valores
    /// (<see cref="EDatabaseFailure.ParametersMismatch"/>, com `Markers` e `Values`) ou um valor que o banco não guarda (<see cref="EDatabaseFailure.QueryInvalid"/>, no
    /// campo `field[i].value`). Sem valores, o comando vai como veio e não há o que conferir.
    /// </summary>
    public static DatabaseFailure? Refusal(string sql, EDatabaseEngine engine, IReadOnlyList<QueryParameter> parameters, string field)
    {
        if (parameters.Count == 0)
            return null;

        if (ParameterMarkers.Mismatch(sql, ReadOnlySql.DialectOf(engine), parameters.Count) is { } mismatch)
            return new DatabaseFailure(EDatabaseFailure.ParametersMismatch, mismatch.Message, Markers: mismatch.Markers, Values: mismatch.Values);

        return EngineRefusal(engine, parameters, field) is { } refusal ? new DatabaseFailure(EDatabaseFailure.QueryInvalid, refusal.Message, Field: refusal.Field) : null;
    }

    /// <summary>Como o número entra no Db2 e no Informix (RN-VAR-017): o inteiro que cabe em 64 bits, o decimal pelo texto exato, ou o `double` do que tem expoente.</summary>
    internal enum ENumberClass
    {
        Integer,
        Decimal,
        Double
    }

    internal static ENumberClass Classify(string number)
    {
        if (number.Contains('e') || number.Contains('E'))
            return ENumberClass.Double;

        if (!number.Contains('.') && long.TryParse(number, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out _))
            return ENumberClass.Integer;

        return ENumberClass.Decimal;
    }

    /// <summary>Os dígitos do decimal como o banco os conta: os da parte inteira sem os zeros da frente, mais todos os das casas (`12.5000` tem 6).</summary>
    internal static int DecimalDigits(string number)
    {
        var unsigned = number.TrimStart('-');
        var dot = unsigned.IndexOf('.');
        var integer = (dot < 0 ? unsigned : unsigned[..dot]).TrimStart('0');

        return integer.Length + (dot < 0 ? 0 : unsigned.Length - dot - 1);
    }

    private static bool HasOnlyTheTwoKeys(JsonElement entry)
    {
        var count = 0;
        var type = false;
        var value = false;
        foreach (var property in entry.EnumerateObject())
        {
            count++;
            type |= property.NameEquals("type");
            value |= property.NameEquals("value");
        }

        return count == 2 && type && value;
    }

    /// <summary>A forma do valor de cada tipo (RN-VAR-032), ou o motivo de recusar. Sem o valor na mensagem.</summary>
    private static string? FormRefusal(EQueryParameterType type, string value)
        => type switch
        {
            EQueryParameterType.Number => value.Length > MaxNumberCharacters || !NumberForm().IsMatch(value) ? "O número é escrito como 12, -3.5 ou 1e10, com até 100 caracteres." : null,
            EQueryParameterType.Boolean => value is "true" or "false" ? null : "O booleano é true ou false.",
            EQueryParameterType.Date => IsDate(value) ? null : "A data é aaaa-mm-dd, e tem de existir.",
            EQueryParameterType.Timestamp => IsTimestamp(value) ? null : "O instante é aaaa-mm-dd hh:mm:ss, com até 6 casas depois de um ponto e, no PostgreSQL, o fuso no fim.",
            _ => TextRefusal(value)
        };

    private static string? TextRefusal(string value)
    {
        if (value.Length > MaxTextCharacters)
            return "O texto pode ter até 1.000.000 de caracteres.";

        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (character == '\0')
                return "O texto não pode ter o caractere U+0000.";

            if (char.IsHighSurrogate(character) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                index++;
            else if (char.IsSurrogate(character))
                return "O texto tem metade de um par UTF-16, que o banco não guarda.";
        }

        return null;
    }

    private static bool IsDate(string value)
        => value.Length == 10 && DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static bool IsTimestamp(string value)
    {
        var match = TimestampForm().Match(value);
        if (!match.Success)
            return false;

        if (!DateTime.TryParseExact($"{match.Groups[1].Value} {match.Groups[2].Value}", "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            return false;

        // O fuso, como o servidor o escreve: `Z`, `+00`, `-03`, `-03:00`; até 15:59, a faixa do PostgreSQL.
        return !match.Groups[5].Success || (int.Parse(match.Groups[5].Value, CultureInfo.InvariantCulture) <= 15 && (!match.Groups[7].Success || int.Parse(match.Groups[7].Value, CultureInfo.InvariantCulture) <= 59));
    }
}
