using Prism.Infrastructure.Databases.Models;
using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-VAR-035: como a coluna de um valor é comparada na conferência (`values/check`), pelo tipo do catálogo. O inteiro tem a faixa do tamanho dele, para o
/// valor que não cabe não chegar ao banco (o PostgreSQL recusaria o comando inteiro).
/// </summary>
internal enum EColumnValueClass
{
    SmallInteger,
    Integer,
    BigInteger,
    Decimal,
    Float,

    /// <summary>O texto de tamanho fixo (`CHAR`), comparado sem os espaços do fim.</summary>
    FixedText,
    Text,
    Date,
    Timestamp,

    /// <summary>O instante com fuso do PostgreSQL (`timestamptz`).</summary>
    TimestampWithZone,
    Boolean
}

/// <summary>
/// RN-VAR-035: a conferência montada. `Keys` tem a chave de cada valor pedido, na ordem, nula no que não converte para o tipo da coluna; `Sql` e `Parameters` são o
/// `IN` com os valores que convertem, um por chave, como vão ao banco (nulo quando nenhum converte, e nada vai ao banco). Leva valores: o `ToString()` escreve só
/// o nome do tipo (RN-VAR-036).
/// </summary>
internal sealed record ColumnValuesCheck(EColumnValueClass Class, IReadOnlyList<string?> Keys, string? Sql, IReadOnlyList<QueryParameter> Parameters)
{
    public override string ToString()
        => nameof(ColumnValuesCheck);
}

/// <summary>
/// RN-VAR-035: os valores de uma coluna e a conferência deles, sem ir ao banco: a recusa pelo catálogo, o texto de cada banco (o da sonda S-VAR-2), a busca
/// escapada e a comparação pelo valor. Os nomes vêm do catálogo da sessão e só entram no texto depois de conferidos, entre aspas duplas com a aspa dobrada, como
/// nos Registros (RN-TABELA-002); a busca e os valores vão como parâmetros. Só o PostgreSQL, o Db2 e o Informix têm o texto: nos outros bancos a rota é
/// recusada, sem ir ao banco.
/// </summary>
internal static partial class ColumnValuesSql
{
    /// <summary>RN-VAR-035: a descrição de um valor chega cortada nisto.</summary>
    public const int MaxDescriptionLength = 200;

    public const string NotAvailableMessage = "Os valores de uma coluna só se listam no PostgreSQL, no Db2 e no Informix.";

    /// <summary>RN-VAR-035: o caractere de escape do `LIKE`. Não quer dizer nada num texto de nenhum dos três bancos; a barra quereria no PostgreSQL com `standard_conforming_strings` desligado.</summary>
    private const char LikeEscape = '!';

    /// <summary>O expoente de um número que a conferência leva ao banco, no máximo: acima disso nenhuma coluna de número guarda o valor.</summary>
    private const int MaxExponent = 1000;

    private const string TimestampFormat = "yyyy-MM-dd HH:mm:ss.ffffff";

    [GeneratedRegex(@"^([+-]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]{1,6}))?\z", RegexOptions.CultureInvariant)]
    private static partial Regex NumberText();

    /// <summary>A data, e a hora com segundos e até 12 casas opcionais, e o fuso como o PostgreSQL o escreve (`-03`, `+05:30`, `+00:53:28`) ou `Z`.</summary>
    [GeneratedRegex(@"^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:[ T]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,12}))?)?)?(Z|([+-])([0-9]{2})(?::?([0-9]{2})(?::?([0-9]{2}))?)?)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex TimestampText();

    public static bool IsAvailable(EDatabaseEngine engine)
        => engine is EDatabaseEngine.PostgreSql or EDatabaseEngine.Db2 or EDatabaseEngine.Informix;

    /// <summary>
    /// A recusa pelo catálogo da sessão (as colunas que a rota de colunas devolve): sem coluna nenhuma, a tabela ou a visão não existe (`ValuesTableNotFound`); a
    /// coluna ou a descrição que não é da tabela, a binária ou de objeto grande e a descrição igual à coluna são `ValuesInvalid`, no campo. Nula quando servem.
    /// </summary>
    public static DatabaseFailure? Refusal(IReadOnlyList<ColumnInfo> columns, EDatabaseEngine engine, string column, string? description)
    {
        if (columns.Count == 0)
            return new DatabaseFailure(EDatabaseFailure.ValuesTableNotFound, "A tabela ou a visão não está no catálogo da sessão.");

        if (Find(columns, column) is not { } found)
            return Invalid("column", "A coluna não é da tabela.");

        if (IsBinaryOrLarge(found.Type, engine))
            return Invalid("column", "A coluna é binária ou de objeto grande, e os valores dela não se listam.");

        if (description is null)
            return null;

        if (string.Equals(description, column, StringComparison.Ordinal))
            return Invalid("description", "A descrição é outra coluna da tabela, e não a própria coluna dos valores.");

        if (Find(columns, description) is not { } described)
            return Invalid("description", "A coluna da descrição não é da tabela.");

        return IsBinaryOrLarge(described.Type, engine) ? Invalid("description", "A coluna da descrição é binária ou de objeto grande.") : null;
    }

    /// <summary>A coluna do catálogo pelo nome, como o catálogo o guarda.</summary>
    public static ColumnInfo? Find(IReadOnlyList<ColumnInfo> columns, string name)
        => columns.FirstOrDefault(candidate => string.Equals(candidate.Name, name, StringComparison.Ordinal));

    /// <summary>
    /// RN-VAR-035: os valores diferentes e não nulos da coluna, com a descrição quando há, em ordem crescente, lendo `limit` mais um para o `hasMore`; com a busca,
    /// o valor ou a descrição que contém o texto, sem diferenciar maiúsculas. O texto de cada banco é o da regra; o número de marcadores da busca acompanha o texto
    /// (no PostgreSQL o `$1` serve às duas colunas; no Db2 e no Informix vai um `?` por coluna). Nulo fora dos três bancos.
    /// </summary>
    public static (string Sql, IReadOnlyList<QueryParameter> Parameters)? Values(EDatabaseEngine engine, string schema, string table, ColumnValuesRequest request)
    {
        if (!IsAvailable(engine))
            return null;

        var column = Quote(request.Column);
        var selected = request.Description is null ? column : $"{column}, {Quote(request.Description)}";
        var (search, parameters) = Search(engine, request);
        var from = $"FROM {Quote(schema)}.{Quote(table)} WHERE {column} IS NOT NULL{search}";
        var rows = request.Limit + 1;

        var sql = engine switch
        {
            EDatabaseEngine.PostgreSql => $"SELECT DISTINCT {selected} {from} ORDER BY {column} LIMIT {rows} OFFSET {request.Offset}",
            EDatabaseEngine.Db2 => $"SELECT DISTINCT {selected} {from} ORDER BY {column} OFFSET {request.Offset} ROWS FETCH FIRST {rows} ROWS ONLY",
            _ => $"SELECT SKIP {request.Offset} FIRST {rows} DISTINCT {selected} {from} ORDER BY {column}"
        };

        return (sql, parameters);
    }

    /// <summary>RN-VAR-035: o `total`, quantos valores diferentes e não nulos há, com a mesma busca. Nulo fora dos três bancos.</summary>
    public static (string Sql, IReadOnlyList<QueryParameter> Parameters)? Total(EDatabaseEngine engine, string schema, string table, ColumnValuesRequest request)
    {
        if (!IsAvailable(engine))
            return null;

        var column = Quote(request.Column);
        var (search, parameters) = Search(engine, request);

        return ($"SELECT COUNT(DISTINCT {column}) FROM {Quote(schema)}.{Quote(table)} WHERE {column} IS NOT NULL{search}", parameters);
    }

    /// <summary>
    /// RN-VAR-035: a página, das linhas lidas (`limit` mais uma): o valor no texto da grade com o corte de 10.000 caracteres (`truncated`), a descrição cortada em
    /// 200, o `kind` da coluna como na página, e `hasMore` pela linha a mais.
    /// </summary>
    public static ColumnValuesPage Page(FullRows rows, int limit, long? total)
    {
        var values = new List<ColumnValue>(Math.Min(rows.Rows.Count, limit));
        foreach (var row in rows.Rows.Take(limit))
        {
            var value = CellFormatter.Format(row[0], out var truncated) ?? string.Empty;
            values.Add(new ColumnValue(value, row.Length > 1 ? Cut(row[1]) : null, truncated));
        }

        return new ColumnValuesPage(rows.Columns[0].Kind, values, rows.Rows.Count > limit, total);
    }

    /// <summary>A descrição em até 200 caracteres, sem deixar pela metade um caractere fora do plano básico (um emoji ocupa dois `char`).</summary>
    private static string? Cut(string? description)
    {
        if (description is null || description.Length <= MaxDescriptionLength)
            return description;

        return description[..(char.IsHighSurrogate(description[MaxDescriptionLength - 1]) ? MaxDescriptionLength - 1 : MaxDescriptionLength)];
    }

    /// <summary>RN-VAR-035: o padrão do `LIKE` da busca: o texto entre `%`, com o `!`, o `%` e o `_` dele escapados com `!`.</summary>
    public static string LikePattern(string search)
    {
        var pattern = new StringBuilder(search.Length + 2).Append('%');
        foreach (var character in search)
        {
            if (character is LikeEscape or '%' or '_')
                pattern.Append(LikeEscape);

            pattern.Append(character);
        }

        return pattern.Append('%').ToString();
    }

    /// <summary>
    /// RN-VAR-035: a conferência dos valores na coluna (`values/check`). Cada valor vira a chave do tipo da coluna (o número pelo valor, `7` e `7.0` iguais; o `CHAR`
    /// sem os espaços do fim; a data pelo dia; o instante pelo instante), e o que não converte fica sem chave: não vai ao banco (o PostgreSQL recusaria o comando
    /// inteiro) e não existe. Os que convertem vão no `SELECT DISTINCT "c" FROM "s"."t" WHERE "c" IN (…)`, um parâmetro por chave, já no tipo da coluna. Nula fora
    /// dos três bancos.
    /// </summary>
    public static ColumnValuesCheck? Check(EDatabaseEngine engine, string schema, string table, ColumnInfo column, IReadOnlyList<QueryParameter> values)
    {
        if (!IsAvailable(engine))
            return null;

        var kind = ClassOf(column.Type, engine);
        var keys = new string?[values.Count];
        var parameters = new List<QueryParameter>();
        var sent = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < values.Count; index++)
        {
            if (values[index].Value is not { } text || ValueKey(kind, text) is not { } key || Sent(engine, kind, text, key) is not { } parameter)
                continue;

            keys[index] = key;
            if (sent.Add(key))
                parameters.Add(parameter);
        }

        if (parameters.Count == 0)
            return new ColumnValuesCheck(kind, keys, null, []);

        var quoted = Quote(column.Name);
        var markers = string.Join(", ", Enumerable.Range(1, parameters.Count).Select(position => engine == EDatabaseEngine.PostgreSql ? $"${position}" : "?"));

        return new ColumnValuesCheck(kind, keys, $"SELECT DISTINCT {quoted} FROM {Quote(schema)}.{Quote(table)} WHERE {quoted} IN ({markers})", parameters);
    }

    /// <summary>RN-VAR-035: os índices dos valores pedidos que não existem, na ordem: os sem chave e os cuja chave nenhum valor achado pelo banco tem.</summary>
    public static IReadOnlyList<int> Missing(ColumnValuesCheck check, IEnumerable<string?> found)
    {
        var existing = new HashSet<string>(found.Where(value => value is not null).SelectMany(value => RowKeys(check.Class, value!)), StringComparer.Ordinal);

        return Enumerable.Range(0, check.Keys.Count).Where(index => check.Keys[index] is not { } key || !existing.Contains(key)).ToList();
    }

    /// <summary>O tipo do catálogo sem o tamanho (`numeric(12,2)`, `timestamp(3) with time zone`, `DATETIME YEAR TO FRACTION(3)`), em maiúsculas.</summary>
    internal static string BaseType(string type)
    {
        var open = type.IndexOf('(');
        var close = open < 0 ? -1 : type.IndexOf(')', open);
        var name = close < 0 ? type : type.Remove(open, close - open + 1);

        return string.Join(' ', name.ToUpperInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    internal static EColumnValueClass ClassOf(string type, EDatabaseEngine engine)
        => BaseType(type) switch
        {
            "SMALLINT" => EColumnValueClass.SmallInteger,
            "INTEGER" or "INT" or "SERIAL" => EColumnValueClass.Integer,
            "BIGINT" or "INT8" or "SERIAL8" or "BIGSERIAL" => EColumnValueClass.BigInteger,
            "NUMERIC" or "DECIMAL" or "DECFLOAT" => EColumnValueClass.Decimal,

            // O `money` do PostgreSQL sai com o símbolo da moeda da sessão: fica com o texto. O `MONEY` do Informix chega como decimal.
            "MONEY" when engine == EDatabaseEngine.Informix => EColumnValueClass.Decimal,
            "REAL" or "DOUBLE PRECISION" or "DOUBLE" or "FLOAT" or "SMALLFLOAT" => EColumnValueClass.Float,
            "CHARACTER" or "CHAR" or "NCHAR" or "GRAPHIC" => EColumnValueClass.FixedText,
            "DATE" or "DATETIME YEAR TO DAY" => EColumnValueClass.Date,
            "TIMESTAMP" or "TIMESTAMP WITHOUT TIME ZONE" or "DATETIME YEAR TO HOUR" or "DATETIME YEAR TO MINUTE" or "DATETIME YEAR TO SECOND" or "DATETIME YEAR TO FRACTION" => EColumnValueClass.Timestamp,
            "TIMESTAMP WITH TIME ZONE" => EColumnValueClass.TimestampWithZone,
            "BOOLEAN" => EColumnValueClass.Boolean,

            // ponytail: o resto (uuid, intervalo, hora, json...) compara pelo texto da grade, e no PostgreSQL o valor que não converte (um uuid malformado) é a
            // recusa do banco, e não um valor que falta. Um tipo novo entra aqui com a chave dele quando a conferência dele importar.
            _ => EColumnValueClass.Text
        };

    /// <summary>A chave de um valor pedido no tipo da coluna, ou nula quando ele não converte.</summary>
    internal static string? ValueKey(EColumnValueClass kind, string text)
        => kind switch
        {
            EColumnValueClass.SmallInteger => IntegerKey(text, short.MinValue, short.MaxValue),
            EColumnValueClass.Integer => IntegerKey(text, int.MinValue, int.MaxValue),
            EColumnValueClass.BigInteger => IntegerKey(text, long.MinValue, long.MaxValue),
            EColumnValueClass.Decimal => DecimalKey(text),
            EColumnValueClass.Float => FloatKey(text),
            EColumnValueClass.FixedText => text.TrimEnd(' '),
            EColumnValueClass.Date => ReadTimestamp(text) is { } date ? date.Wall.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null,
            EColumnValueClass.Timestamp => ReadTimestamp(text) is { Offset: null } instant ? Wall(instant) : null,
            EColumnValueClass.TimestampWithZone => ReadTimestamp(text) is { } instant ? instant.Offset is null ? Wall(instant) : Instant(instant) : null,
            EColumnValueClass.Boolean => BooleanKey(text),
            _ => text
        };

    /// <summary>
    /// As chaves de um valor que o banco devolveu. O instante com fuso tem duas: o instante, para o valor pedido com fuso, e a hora no fuso da sessão (a que o
    /// banco escreveu), para o pedido sem fuso, que o banco leu no fuso da sessão.
    /// </summary>
    private static IEnumerable<string> RowKeys(EColumnValueClass kind, string text)
    {
        if (kind == EColumnValueClass.TimestampWithZone)
        {
            if (ReadTimestamp(text) is not { } instant)
                yield break;

            yield return Wall(instant);
            if (instant.Offset is not null)
                yield return Instant(instant);

            yield break;
        }

        if (ValueKey(kind, text) is { } key)
            yield return key;
    }

    /// <summary>
    /// O parâmetro com que o valor convertido vai ao banco, já no tipo da coluna: o número escrito sem expoente (o decimal) ou como o `double` o escreve, a data e o
    /// instante no formato dos `params`, o booleano em `true`/`false`, e o texto como veio. Nulo no que o banco não guarda pelo driver (o decimal de mais de 31
    /// dígitos no Db2 e no Informix): não existe.
    /// </summary>
    private static QueryParameter? Sent(EDatabaseEngine engine, EColumnValueClass kind, string text, string key)
        => kind switch
        {
            EColumnValueClass.SmallInteger or EColumnValueClass.Integer or EColumnValueClass.BigInteger or EColumnValueClass.Float => new QueryParameter(EQueryParameterType.Number, key),
            EColumnValueClass.Decimal => PlainDecimal(key) is { } plain && (engine == EDatabaseEngine.PostgreSql || QueryParameterRules.DecimalDigits(plain) <= QueryParameterRules.MaxDecimalDigits) ? new QueryParameter(EQueryParameterType.Number, plain) : null,
            EColumnValueClass.Date => new QueryParameter(EQueryParameterType.Date, key),
            EColumnValueClass.Timestamp => new QueryParameter(EQueryParameterType.Timestamp, key),

            // Só no PostgreSQL: o texto vai sem tipo, e o servidor o lê como o instante da coluna (no fuso da sessão, quando o valor não diz o dele).
            EColumnValueClass.TimestampWithZone => new QueryParameter(EQueryParameterType.Text, text.Trim()),
            EColumnValueClass.Boolean => new QueryParameter(EQueryParameterType.Boolean, key),
            _ => new QueryParameter(EQueryParameterType.Text, text)
        };

    /// <summary>RN-TABELA-002: o nome entre aspas duplas, com a aspa de dentro dobrada.</summary>
    private static string Quote(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>A condição da busca e os parâmetros dela; sem busca, nada.</summary>
    private static (string Condition, IReadOnlyList<QueryParameter> Parameters) Search(EDatabaseEngine engine, ColumnValuesRequest request)
    {
        if (string.IsNullOrEmpty(request.Search))
            return (string.Empty, []);

        string[] names = request.Description is null ? [Quote(request.Column)] : [Quote(request.Column), Quote(request.Description)];
        var conditions = names.Select(name => engine switch
        {
            EDatabaseEngine.PostgreSql => $"{name}::text ILIKE $1 ESCAPE '{LikeEscape}'",
            EDatabaseEngine.Db2 => $"LOWER(VARCHAR({name})) LIKE LOWER(?) ESCAPE '{LikeEscape}'",
            _ => $"LOWER({name}::LVARCHAR) LIKE LOWER(?) ESCAPE '{LikeEscape}'"
        });

        var pattern = new QueryParameter(EQueryParameterType.Text, LikePattern(request.Search));
        IReadOnlyList<QueryParameter> parameters = engine == EDatabaseEngine.PostgreSql ? [pattern] : [.. names.Select(_ => pattern)];

        return ($" AND ({string.Join(" OR ", conditions)})", parameters);
    }

    private static DatabaseFailure Invalid(string field, string message)
        => new(EDatabaseFailure.ValuesInvalid, message, Field: field);

    private static bool IsBinaryOrLarge(string type, EDatabaseEngine engine)
        => (engine, BaseType(type)) switch
        {
            (EDatabaseEngine.PostgreSql, "BYTEA") => true,
            (EDatabaseEngine.Db2, "BLOB" or "CLOB" or "DBCLOB" or "BINARY" or "VARBINARY") => true,
            (EDatabaseEngine.Informix, "BYTE" or "TEXT" or "BLOB" or "CLOB") => true,
            _ => false
        };

    /// <summary>O número como sinal, algarismos sem os zeros das pontas e expoente (`7`, `7.0` e `0.7e1` dão `7e0`), ou nulo quando o texto não é um número.</summary>
    private static (bool Negative, string Digits, int Exponent)? ReadNumber(string text)
    {
        var match = NumberText().Match(text.Trim());
        if (!match.Success || match.Groups[2].Length + match.Groups[3].Length == 0)
            return null;

        var fraction = match.Groups[3].Value;
        var exponent = (match.Groups[4].Success ? int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture) : 0) - fraction.Length;
        var digits = (match.Groups[2].Value + fraction).TrimStart('0');
        var significant = digits.TrimEnd('0');
        exponent += digits.Length - significant.Length;

        if (significant.Length == 0)
            return (false, "0", 0);

        return Math.Abs(exponent) > MaxExponent ? null : (match.Groups[1].Value == "-", significant, exponent);
    }

    private static string? DecimalKey(string text)
        => ReadNumber(text) is { } number ? $"{(number.Negative ? "-" : string.Empty)}{number.Digits}e{number.Exponent}" : null;

    /// <summary>O inteiro que cabe na faixa da coluna, escrito sem casas; o número com casas que não são zero não é inteiro.</summary>
    private static string? IntegerKey(string text, long minimum, long maximum)
    {
        if (ReadNumber(text) is not { } number || number.Exponent < 0 || number.Digits.Length + number.Exponent > 20)
            return null;

        var value = BigInteger.Parse(number.Digits, CultureInfo.InvariantCulture) * BigInteger.Pow(10, number.Exponent) * (number.Negative ? -1 : 1);

        return value >= minimum && value <= maximum ? value.ToString(CultureInfo.InvariantCulture) : null;
    }

    /// <summary>O ponto flutuante pelo valor do `double`, escrito do jeito mais curto que volta a ele; o que passa do `double` não converte.</summary>
    private static string? FloatKey(string text)
    {
        if (ReadNumber(text) is null || !double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || !double.IsFinite(value))
            return null;

        return (value == 0 ? 0d : value).ToString("R", CultureInfo.InvariantCulture);
    }

    /// <summary>A chave de <see cref="DecimalKey"/> escrita sem expoente (`12.5`, `-0.03`, `700`), como o decimal vai ao banco.</summary>
    private static string? PlainDecimal(string key)
    {
        var mark = key.LastIndexOf('e');
        if (mark < 0)
            return key;

        var negative = key[0] == '-';
        var digits = key[(negative ? 1 : 0)..mark];
        var exponent = int.Parse(key[(mark + 1)..], CultureInfo.InvariantCulture);
        var plain = exponent >= 0
            ? digits + new string('0', exponent)
            : digits.PadLeft(1 - exponent, '0').Insert(Math.Max(digits.Length, 1 - exponent) + exponent, ".");

        return negative ? $"-{plain}" : plain;
    }

    private static string? BooleanKey(string text)
        => text.Trim().ToLowerInvariant() switch
        {
            "true" or "t" or "1" => "true",
            "false" or "f" or "0" => "false",
            _ => null
        };

    /// <summary>A data e a hora (até o microssegundo; as casas abaixo dele têm de ser zero) e o fuso, quando o texto diz.</summary>
    private static (DateTime Wall, TimeSpan? Offset)? ReadTimestamp(string text)
    {
        var match = TimestampText().Match(text.Trim());
        if (!match.Success || !DateTime.TryParseExact(match.Groups[1].Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return null;

        var hour = Part(match, 2);
        var minute = Part(match, 3);
        var second = Part(match, 4);
        var fraction = match.Groups[5].Value.PadRight(12, '0');
        if (hour > 23 || minute > 59 || second > 59 || fraction[6..].Any(digit => digit != '0'))
            return null;

        var wall = day.AddHours(hour).AddMinutes(minute).AddSeconds(second).AddTicks(long.Parse(fraction[..6], CultureInfo.InvariantCulture) * 10);
        if (!match.Groups[6].Success)
            return (wall, null);

        if (match.Groups[6].Value == "Z")
            return (wall, TimeSpan.Zero);

        var offset = new TimeSpan(Part(match, 8), Part(match, 9), Part(match, 10));

        return (wall, match.Groups[7].Value == "-" ? -offset : offset);
    }

    private static int Part(Match match, int group)
        => match.Groups[group].Success ? int.Parse(match.Groups[group].Value, CultureInfo.InvariantCulture) : 0;

    private static string Wall((DateTime Wall, TimeSpan? Offset) instant)
        => instant.Wall.ToString(TimestampFormat, CultureInfo.InvariantCulture);

    private static string Instant((DateTime Wall, TimeSpan? Offset) instant)
        => $"{(instant.Wall - instant.Offset!.Value).ToString(TimestampFormat, CultureInfo.InvariantCulture)}Z";
}
