using static Prism.Infrastructure.Databases.Clients.EditableSql;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// Um marcador de parâmetro do texto: onde começa e termina (`$12` ou `?`), no PostgreSQL o número (no Db2 e no Informix é 0) e a posição dele entre os marcadores
/// do texto, a partir de 0.
/// </summary>
internal readonly record struct ParameterMarker(int Start, int End, int Number, int Index);

/// <summary>
/// RN-VAR-032: os marcadores de parâmetro de um comando, contados pelo leitor do texto da API, o de cada banco, que não conta texto entre aspas simples (também o
/// `E'...'` com a barra, o `U&amp;'...'` e o `N'...'`), identificador entre aspas duplas, comentário (os de cada banco: `--`, `/* */` com ou sem outro dentro e,
/// no Informix, `{ }`) nem `$marca$ ... $marca$` (RN-PROT-005). No PostgreSQL o marcador é o `$n` (o `?` é o operador do `jsonb`), e um `$` que fecha um
/// nome (`k$1`) é do nome; no Db2 e no Informix é o `?`. A tela conta o texto com a regra deste mesmo leitor (as fixtures `src/test-fixtures/variables/markers*.json`
/// são lidas pelos dois).
/// </summary>
internal static class ParameterMarkers
{
    /// <summary>O maior número de marcador que se lê: acima disso o número é lido como o teto, e o PostgreSQL recusa o comando (o limite dele é 65.535).</summary>
    private const int NumberCap = 1_000_000;

    /// <summary>Os marcadores do texto, na ordem em que aparecem.</summary>
    public static List<ParameterMarker> Find(string sql, ESqlDialect dialect)
    {
        var markers = new List<ParameterMarker>();
        var position = 0;

        while (position < sql.Length)
        {
            var character = sql[position];

            if (SqlText.SkipComment(sql, position, dialect) is var afterComment && afterComment > position)
                position = afterComment;
            else if (character == '\'' || character == '"')
                position = SqlText.SkipQuoted(sql, position, backslashEscapes: false);
            else if (character == '?' && dialect != ESqlDialect.PostgreSql)
            {
                markers.Add(new ParameterMarker(position, position + 1, 0, markers.Count));
                position++;
            }
            else if (character == '$' && dialect == ESqlDialect.PostgreSql)
            {
                if (SqlText.SkipDollarQuoted(sql, position) is var afterText && afterText > position + 1)
                    position = afterText;
                else
                    position = ReadParameter(sql, position, markers);
            }
            else if (SqlText.IsWordCharacter(character))
            {
                // O nome com `$` no meio (`k$1`, `é$a$`) é um nome só; o prefixo de um texto (`E'...'`, `N'...'`, `X'...'`, `B'...'`, `U&'...'`) leva o texto junto.
                var start = position;
                while (position < sql.Length && (SqlText.IsWordCharacter(sql[position]) || sql[position] == '$'))
                    position++;

                if (position - start == 1 && position < sql.Length && sql[position] == '\'')
                    position = SqlText.SkipQuoted(sql, position, backslashEscapes: dialect == ESqlDialect.PostgreSql && sql[start] is 'E' or 'e');
                else if (position - start == 1 && sql[start] is 'U' or 'u' && position + 1 < sql.Length && sql[position] == '&' && sql[position + 1] == '\'')
                    position = SqlText.SkipQuoted(sql, position + 1, backslashEscapes: false);
            }
            else
                position++;
        }

        return markers;
    }

    /// <summary>Quantos marcadores o texto tem.</summary>
    public static int Count(string sql, ESqlDialect dialect)
        => Find(sql, dialect).Count;

    /// <summary>
    /// RN-VAR-032: o texto bate com `values` valores? No PostgreSQL os `$n` têm de ser exatamente `$1` a `$N`, cada um ao menos uma vez, com N os valores; no Db2
    /// e no Informix o número de `?` é o dos valores. A recusa leva os dois números (`markers` e `values` da resposta) e a frase.
    /// </summary>
    public static ParameterMismatch? Mismatch(string sql, ESqlDialect dialect, int values)
    {
        var markers = Find(sql, dialect);
        if (dialect != ESqlDialect.PostgreSql)
            return markers.Count == values ? null : new ParameterMismatch(markers.Count, values, Sentence(markers.Count, values));

        var numbers = markers.Select(marker => marker.Number).ToHashSet();
        if (numbers.Contains(0))
            return new ParameterMismatch(numbers.Count, values, "O marcador $0 não existe: os do PostgreSQL começam em $1.");

        var highest = numbers.Count == 0 ? 0 : numbers.Max();
        if (Enumerable.Range(1, highest).FirstOrDefault(number => !numbers.Contains(number)) is var hole and > 0)
            return new ParameterMismatch(numbers.Count, values, $"Os marcadores do comando têm de ir de $1 ao último sem pular nenhum, e falta o ${hole}.");

        return highest == values ? null : new ParameterMismatch(highest, values, Sentence(highest, values));
    }

    /// <summary>
    /// Os números dos `$n` do texto na ordem da primeira vez que aparecem, sem repetir. É a ordem em que a coluna inteira numera de novo os da condição (RN-VAR-033):
    /// sem buraco, porque o PostgreSQL não aceita um `$n` que o texto não usa.
    /// </summary>
    public static List<int> DistinctNumbers(IEnumerable<ParameterMarker> markers)
        => [.. markers.Select(marker => marker.Number).Distinct()];

    /// <summary>
    /// O texto com cada marcador trocado: `Replace` recebe o marcador e diz o que escrever no lugar dele (o `$n` novo, ou um literal). O que não é marcador fica como está.
    /// </summary>
    public static string Rewrite(string sql, IReadOnlyList<ParameterMarker> markers, Func<ParameterMarker, string> replace)
    {
        if (markers.Count == 0)
            return sql;

        var text = new System.Text.StringBuilder(sql.Length + markers.Count * 4);
        var at = 0;
        foreach (var marker in markers)
        {
            text.Append(sql, at, marker.Start - at).Append(replace(marker));
            at = marker.End;
        }

        return text.Append(sql, at, sql.Length - at).ToString();
    }

    /// <summary>O marcador que começa no token da posição `index` do leitor da edição (`$` e o número no PostgreSQL, `?` nos outros), ou nulo.</summary>
    public static bool IsMarkerAt(List<Token> tokens, int index, ESqlDialect dialect)
        => dialect == ESqlDialect.PostgreSql
            ? tokens[index].Is("$") && index + 1 < tokens.Count && tokens[index + 1].Kind == ETokenKind.Word && tokens[index + 1].Start == tokens[index].End && char.IsAsciiDigit(tokens[index + 1].Text[0])
            : tokens[index].Is("?");

    private static int ReadParameter(string sql, int dollar, List<ParameterMarker> markers)
    {
        var end = dollar + 1;
        long number = 0;
        while (end < sql.Length && char.IsAsciiDigit(sql[end]))
        {
            number = Math.Min(NumberCap, number * 10 + (sql[end] - '0'));
            end++;
        }

        if (end == dollar + 1)
            return end;

        markers.Add(new ParameterMarker(dollar, end, (int)number, markers.Count));

        return end;
    }

    private static string Sentence(int markers, int values)
        => $"O comando tem {markers} {(markers == 1 ? "marcador" : "marcadores")}, e {(values == 1 ? "veio 1 valor" : $"vieram {values} valores")}.";
}

/// <summary>RN-VAR-032: os marcadores do comando não batem com os valores. `Markers` e `Values` vão na resposta (`QUERY_PARAMETERS_MISMATCH`).</summary>
internal sealed record ParameterMismatch(int Markers, int Values, string Message);
