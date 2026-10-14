using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using System.Text;
using static Prism.Infrastructure.Databases.Clients.EditableSql;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-GRADE-011: o filtro do resultado da aba de consulta junto ao comando dela. O filtro é o texto do campo, como nos Registros
/// (RN-TABELA-010): uma condição, uma ordem (`ORDER BY ...`) ou as duas, nessa ordem. Tudo é lido pelo mesmo leitor da edição
/// (<see cref="EditableSql.Lex"/>), com as aspas, os comentários e o `$marca$` de cada banco; o que conta é o nível de fora, e o que
/// está entre parênteses, entre aspas ou em comentário não decide nada.
///
/// Quando o comando é um `SELECT` só, com `FROM`, e as cláusulas de fora são as que a junção conhece, na ordem do banco (`WHERE`,
/// `WINDOW`, `ORDER BY` e o fim: os limites de linhas, as travas, o nível de isolamento e o `OPTIMIZE FOR`), o filtro entra nele
/// (<see cref="EFilterApplied.Merged"/>): a condição vai para o `WHERE`, `WHERE (<o que havia>) AND (<condição>)` ou
/// `WHERE (<condição>)`, e a ordem troca o `ORDER BY`, ou entra antes do fim (`LIMIT`, `OFFSET`, `FETCH FIRST`, `FOR UPDATE`,
/// `FOR READ ONLY`, `WITH UR`, `OPTIMIZE FOR`). O `SKIP`, o `FIRST` e o `LIMIT` do Informix ficam na cabeça do `SELECT`, onde
/// estão, e valem depois da ordem nova. O resto do texto (os comentários, o `;` do fim) fica onde estava, e o que se acrescenta entra
/// logo depois do último pedaço de código da cláusula: um `-- comentário` no fim não engole o filtro.
///
/// Os outros comandos (as uniões, `GROUP BY`, `HAVING`, `WITH`, o `SELECT` sem `FROM`, o que começa por parêntese, o `INTO` e o que
/// não é `SELECT`) vão por fora (<see cref="EFilterApplied.Wrapped"/>): `SELECT * FROM (<comando>) prism_filtro WHERE <condição>
/// ORDER BY <ordem>`. Conferido nos três bancos: a tabela derivada aceita `ORDER BY` e limites de linhas dentro (no Db2, `FETCH
/// FIRST`, `LIMIT` e `OFFSET`; no Informix, `SKIP`, `FIRST` e `LIMIT` na cabeça), e também `GROUP BY`, as uniões e o `WITH`. O que o
/// Db2 e o Informix não aceitam dentro dela é o fim do comando inteiro (`FOR READ ONLY`, `FOR UPDATE`, `OPTIMIZE FOR`): ele sai do
/// parêntese e vai depois da ordem, onde vale para o comando todo, como valia. O que mais o banco não aceitar, ele recusa.
/// </summary>
internal static class SqlFilter
{
    public const string Terminator = "O filtro não pode ter ponto e vírgula.";
    public const string OpenQuote = "O filtro tem aspas sem fechar.";
    public const string OpenComment = "O filtro tem um comentário sem fechar.";
    public const string EndsInComment = "O filtro tem de terminar em código, e não em comentário.";
    public const string Parentheses = "O filtro tem parênteses sem par.";
    public const string SeveralOrders = "O filtro tem mais de um ORDER BY.";
    public const string SeveralStatements = "Com filtro, execute um comando só.";

    /// <summary>O apelido da tabela derivada do embrulho.</summary>
    private const string Alias = "prism_filtro";

    /// <summary>As palavras de fora que levam ao embrulho em qualquer ponto do comando: as uniões, o `HAVING` e o `INTO`. O `GROUP` só com `BY` depois (o `WITHIN GROUP` é de uma função).</summary>
    private static readonly HashSet<string> Wrapping = ["UNION", "INTERSECT", "EXCEPT", "MINUS", "HAVING", "INTO"];

    /// <summary>Os limites de linhas depois da ordem: ficam dentro da tabela derivada do embrulho, que os aceita.</summary>
    private static readonly HashSet<string> Limits = ["LIMIT", "OFFSET", "FETCH"];

    /// <summary>
    /// O que vem depois de `FOR` no fim do comando: as travas (`FOR UPDATE`, `FOR SHARE`, `FOR NO KEY UPDATE`, `FOR KEY SHARE`) e o
    /// `FOR READ ONLY` ou `FOR FETCH ONLY`. O `FOR SYSTEM_TIME` de uma tabela temporal do Db2 é do `FROM`.
    /// </summary>
    private static readonly HashSet<string> AfterFor = ["READ", "FETCH", "UPDATE", "SHARE", "NO", "KEY"];

    /// <summary>O nível de isolamento do Db2 no fim do comando (`WITH UR`): só com um desses depois o `WITH` é do fim, e não o `WITH ORDINALITY` de uma função do `FROM`.</summary>
    private static readonly HashSet<string> Isolation = ["UR", "CS", "RS", "RR"];

    /// <summary>A recusa do filtro, ou nulo quando ele pode entrar no comando. O filtro vazio ou só de espaços é a falta dele.</summary>
    public static string? Refusal(string? filter, ESqlDialect dialect)
        => string.IsNullOrWhiteSpace(filter) ? null : Read(filter, dialect).Refusal;

    /// <summary>
    /// O comando que roda, com o filtro junto ou por fora, e como ele entrou. Recusa o filtro que não se junta com segurança
    /// (<see cref="EDatabaseFailure.FilterInvalid"/>) e o envio de mais de um comando (<see cref="EDatabaseFailure.MultipleStatementsNotSupported"/>):
    /// não se sabe a qual deles o filtro iria.
    /// </summary>
    public static Result<FilteredSql, DatabaseFailure> Apply(string sql, string filter, ESqlDialect dialect)
    {
        var (condition, order, refusal) = Read(filter, dialect);
        if (refusal is not null)
            return new DatabaseFailure(EDatabaseFailure.FilterInvalid, refusal);

        var tokens = Lex(sql, dialect).ToList();
        while (tokens.Count > 0 && tokens[^1].Is(";"))
            tokens.RemoveAt(tokens.Count - 1);
        while (tokens.Count > 0 && tokens[0].Is(";"))
            tokens.RemoveAt(0);

        if (tokens.Any(token => token.Is(";")))
            return new DatabaseFailure(EDatabaseFailure.MultipleStatementsNotSupported, SeveralStatements);

        return Merge(sql, tokens, condition, order) is { } merged
            ? new FilteredSql(merged, EFilterApplied.Merged)
            : new FilteredSql(Wrap(sql, tokens, condition, order), EFilterApplied.Wrapped);
    }

    /// <summary>
    /// A condição e a ordem do filtro, como foram escritas (do primeiro ao último pedaço de código de cada uma), ou a recusa. A ordem é
    /// o que vem depois do `ORDER BY` de fora; sem nada depois, vazia, e quem responde é o banco.
    /// </summary>
    private static (string? Condition, string? Order, string? Refusal) Read(string filter, ESqlDialect dialect)
    {
        // Aberto é o que engole o que vem depois: com uma linha a mais no fim, o último pedaço tem de ser o que ela trouxe. O que ficou
        // aberto e chega ao fim como pedaço é texto ou identificador entre aspas; o que não chega como pedaço nenhum é comentário.
        var probe = Lex($"{filter}\n1", dialect).LastOrDefault();
        if (probe.Start != filter.Length + 1)
            return (null, null, probe.End == filter.Length + 2 && probe.Kind is ETokenKind.Text or ETokenKind.Identifier ? OpenQuote : OpenComment);

        var tokens = Lex(filter, dialect).ToList();
        if (tokens.Any(token => token.Is(";")))
            return (null, null, Terminator);

        if (tokens.Count == 0 || tokens[^1].End != filter.TrimEnd().Length)
            return (null, null, EndsInComment);

        var depth = 0;
        var orders = new List<int>();
        for (var index = 0; index < tokens.Count; index++)
        {
            if (tokens[index].Is("("))
                depth++;
            else if (tokens[index].Is(")") && --depth < 0)
                return (null, null, Parentheses);
            else if (depth == 0 && IsOrderBy(tokens, index))
                orders.Add(index);
        }

        if (depth != 0)
            return (null, null, Parentheses);

        return orders switch
        {
            [] => (filter[tokens[0].Start..tokens[^1].End], null, null),
            [var order] => (order > 0 ? filter[tokens[0].Start..tokens[order - 1].End] : null, order + 2 < tokens.Count ? filter[tokens[order + 2].Start..tokens[^1].End] : string.Empty, null),
            _ => (null, null, SeveralOrders)
        };
    }

    /// <summary>
    /// O comando com o filtro dentro, ou nulo quando ele não é um `SELECT` cujas cláusulas de fora a junção conhece, na ordem em que o
    /// banco as quer: `FROM`, `WHERE`, `WINDOW`, `ORDER BY` e o fim (limites, travas, isolamento).
    /// </summary>
    private static string? Merge(string sql, List<Token> tokens, string? condition, string? order)
    {
        if (tokens.Count == 0 || !tokens[0].IsWord("SELECT"))
            return null;

        var (from, where, window, orderBy, tail) = (-1, -1, -1, -1, -1);
        var depth = 0;
        for (var index = 1; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;

            if (depth > 0 || token.Kind != ETokenKind.Word || tokens[index - 1].Is("."))
                continue;

            if (Wrapping.Contains(token.Upper) || token.Upper == "GROUP" && index + 1 < tokens.Count && tokens[index + 1].IsWord("BY"))
                return null;

            if (from < 0)
            {
                if (token.Upper == "FROM")
                    from = index;
            }
            else if (token.Upper == "WHERE")
            {
                if (where >= 0 || window >= 0 || orderBy >= 0 || tail >= 0)
                    return null;

                where = index;
            }
            else if (token.Upper == "WINDOW")
            {
                if (window >= 0 || orderBy >= 0 || tail >= 0)
                    return null;

                window = index;
            }
            else if (IsOrderBy(tokens, index))
            {
                if (orderBy >= 0 || tail >= 0)
                    return null;

                orderBy = index;
            }
            else if (tail < 0 && (Limits.Contains(token.Upper) || IsStatementEnd(tokens, index)))
                tail = index;
        }

        // O `FROM` sem tabela, e o `WHERE` sem condição, não são comandos que se completem: o banco diz o que falta, no embrulho.
        var afterWhere = First(window, orderBy, tail, tokens.Count);
        if (from < 0 || First(where, afterWhere) == from + 1 || where >= 0 && afterWhere == where + 1)
            return null;

        var edits = new List<(int Position, int Length, string Text)>();
        if (condition is not null && where >= 0)
        {
            edits.Add((tokens[where + 1].Start, 0, "("));
            edits.Add((tokens[afterWhere - 1].End, 0, $") AND ({condition})"));
        }
        else if (condition is not null)
            edits.Add((tokens[afterWhere - 1].End, 0, $" WHERE ({condition})"));

        var afterOrder = First(tail, tokens.Count);
        if (order is not null && orderBy >= 0)
            edits.Add((tokens[orderBy].Start, tokens[afterOrder - 1].End - tokens[orderBy].Start, $"ORDER BY {order}"));
        else if (order is not null)
            edits.Add((tokens[afterOrder - 1].End, 0, $" ORDER BY {order}"));

        // Na mesma posição, a condição vem antes da ordem: é a ordem em que foram acrescentadas, e a ordenação é estável.
        var text = new StringBuilder(sql.Length + edits.Sum(edit => edit.Text.Length));
        var at = 0;
        foreach (var (position, length, insert) in edits.OrderBy(edit => edit.Position))
        {
            text.Append(sql, at, position - at).Append(insert);
            at = position + length;
        }

        return text.Append(sql, at, sql.Length - at).ToString();
    }

    /// <summary>
    /// O comando por fora, como tabela derivada: ele vai do primeiro ao último pedaço de código, sem os `;` e os comentários das pontas
    /// (um `-- comentário` no fim engoliria o fecho do parêntese), e com quebras de linha em volta. O fim do comando inteiro (travas,
    /// `FOR READ ONLY`, isolamento, `OPTIMIZE FOR`), que a tabela derivada não aceita, sai dela e vai por último.
    /// </summary>
    private static string Wrap(string sql, List<Token> tokens, string? condition, string? order)
    {
        var depth = 0;
        var end = tokens.Count;
        for (var index = 0; index < tokens.Count && end == tokens.Count; index++)
        {
            if (tokens[index].Is("("))
                depth++;
            else if (tokens[index].Is(")"))
                depth--;
            else if (depth == 0 && index > 0 && IsStatementEnd(tokens, index))
                end = index;
        }

        var text = new StringBuilder($"SELECT * FROM (\n{(tokens.Count == 0 ? string.Empty : sql[tokens[0].Start..tokens[end - 1].End])}\n) {Alias}");
        if (condition is not null)
            text.Append($"\nWHERE {condition}");
        if (order is not null)
            text.Append($"\nORDER BY {order}");
        if (end < tokens.Count)
            text.Append($"\n{sql[tokens[end].Start..tokens[^1].End]}");

        return text.ToString();
    }

    /// <summary>`ORDER BY` de verdade: as duas palavras, e não o nome qualificado `x.order`.</summary>
    private static bool IsOrderBy(List<Token> tokens, int index)
        => tokens[index].IsWord("ORDER") && index + 1 < tokens.Count && tokens[index + 1].IsWord("BY") && (index == 0 || !tokens[index - 1].Is("."));

    /// <summary>Começa aqui o fim do comando inteiro: `FOR UPDATE` e as outras travas, `FOR READ ONLY`, `WITH UR` e o `OPTIMIZE FOR` do Db2.</summary>
    private static bool IsStatementEnd(List<Token> tokens, int index)
    {
        var next = index + 1 < tokens.Count && tokens[index + 1].Kind == ETokenKind.Word ? tokens[index + 1].Upper : string.Empty;

        return tokens[index].Kind == ETokenKind.Word && !tokens[index - 1].Is(".") && (tokens[index].Upper == "OPTIMIZE" || tokens[index].Upper == "FOR" && AfterFor.Contains(next) || tokens[index].Upper == "WITH" && Isolation.Contains(next));
    }

    /// <summary>A primeira posição que existe (as que não existem são -1); a última da lista é sempre uma.</summary>
    private static int First(params int[] positions)
        => positions.First(position => position >= 0);
}

/// <summary>RN-GRADE-011: o comando que roda, com o filtro, e como o filtro entrou nele. Não é impresso: leva o SQL do usuário.</summary>
internal sealed record FilteredSql(string Sql, EFilterApplied Applied)
{
    public override string ToString() => nameof(FilteredSql);
}
