using Prism.Infrastructure.Databases.Models;
using System.Text;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-002 e 003: a leitura do texto do comando para a edição, sem consultar o banco (RN-EDIT-010). Diz quando o resultado inteiro
/// é só leitura, com o motivo da regra, e, quando ele lê uma tabela só, qual é ela, com o apelido, e de onde vem cada item da lista do
/// `SELECT`. O que conta é o nível de fora do comando: dentro de parênteses (uma subconsulta do `WHERE`, os argumentos de uma função),
/// de texto, de identificador entre aspas e de comentário nada muda a decisão. Comentário e texto são lidos como cada banco os lê
/// (<see cref="SqlText"/>).
///
/// Nesta leitura a junção ainda deixa o resultado só leitura (a edição entrou pelos Registros, que leem uma tabela só), e o que ela
/// não reconhece também: o resultado só se edita quando o Prism sabe de onde vem cada coluna.
/// </summary>
internal static class EditableSql
{
    public const string NotASelect = "o comando não é um SELECT";
    public const string NoTable = "o comando não lê uma tabela";
    public const string Union = "união de consultas";
    public const string Distinct = "DISTINCT";
    public const string Grouping = "agrupamento";
    public const string ForUpdate = "SELECT ... FOR UPDATE";
    public const string SubqueryOrWith = "subconsulta ou WITH no FROM";
    public const string Join = "junção de tabelas";
    public const string WroteRows = "o comando gravou e devolveu linhas";
    public const string UnknownOrigin = "o Prism não conseguiu saber de onde vêm as colunas";

    /// <summary>As palavras que encerram o `FROM` no nível de fora. O `WITH` do fim é o nível de isolamento do Db2 (`WITH UR`).</summary>
    private static readonly HashSet<string> FromEnd = ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", "UNION", "INTERSECT", "EXCEPT", "MINUS", "WINDOW", "WITH", "INTO"];

    /// <summary>As palavras de junção, inclusive o `, OUTER tabela` do Informix e o `LATERAL` do PostgreSQL.</summary>
    private static readonly HashSet<string> JoinWords = ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER", "LATERAL"];

    /// <summary>O que não é nome de tabela nem apelido, logo no começo ou depois do nome.</summary>
    private static readonly HashSet<string> NotAName = ["ONLY", "TABLE", "ON", "USING", "TABLESAMPLE", .. FromEnd, .. JoinWords];

    /// <summary>As palavras que, sozinhas e sem aspas na lista do `SELECT`, são um valor, e não uma coluna.</summary>
    private static readonly HashSet<string> ValueWords = ["NULL", "TRUE", "FALSE", "DEFAULT", "CURRENT", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "LOCALTIME", "LOCALTIMESTAMP", "CURRENT_USER", "SESSION_USER", "USER", "TODAY", "SYSDATE"];

    /// <summary>Os modificadores do Informix entre o `SELECT` e a lista, cada um com um valor depois.</summary>
    private static readonly HashSet<string> InformixModifiers = ["SKIP", "FIRST", "LIMIT", "MIDDLE"];

    public static ResultSource Read(string sql, ESqlDialect dialect)
    {
        var tokens = Lex(sql, dialect).ToList();
        while (tokens.Count > 0 && tokens[^1].Is(";"))
            tokens.RemoveAt(tokens.Count - 1);
        while (tokens.Count > 0 && tokens[0].Is(";"))
            tokens.RemoveAt(0);

        if (tokens.Count == 0)
            return ResultSource.ReadOnly(NotASelect);

        if (tokens[0].Is("("))
            return ResultSource.ReadOnly(UnknownOrigin);

        if (tokens[0].IsWord("WITH"))
            return ResultSource.ReadOnly(SubqueryOrWith);

        if (!tokens[0].IsWord("SELECT"))
            return ResultSource.ReadOnly(NotASelect);

        var from = -1;
        var depth = 0;
        for (var index = 1; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;

            if (depth > 0 || token.Kind != ETokenKind.Word && !token.Is(";"))
                continue;

            if (token.Is(";"))
                return ResultSource.ReadOnly(NotASelect);

            if (token.Upper is "UNION" or "INTERSECT" or "EXCEPT" or "MINUS")
                return ResultSource.ReadOnly(Union);

            if (token.Upper is "GROUP" or "HAVING")
                return ResultSource.ReadOnly(Grouping);

            if (token.Upper == "FOR" && index + 1 < tokens.Count && tokens[index + 1].Upper is "UPDATE" or "SHARE" or "NO" or "KEY")
                return ResultSource.ReadOnly(ForUpdate);

            // `SELECT ... INTO` grava (PostgreSQL, `INTO TEMP` do Informix) e não devolve linhas.
            if (token.Upper == "INTO")
                return ResultSource.ReadOnly(NotASelect);

            if (token.Upper == "FROM" && from < 0)
                from = index;
        }

        var listStart = 1;
        while (listStart < tokens.Count)
        {
            var token = tokens[listStart];
            if (token.IsWord("ALL"))
                listStart++;
            else if (token.IsWord("DISTINCT") || dialect == ESqlDialect.Informix && token.IsWord("UNIQUE"))
                return ResultSource.ReadOnly(Distinct);
            else if (dialect == ESqlDialect.Informix && token.Kind == ETokenKind.Word && InformixModifiers.Contains(token.Upper) && listStart + 2 < (from < 0 ? tokens.Count : from))
                listStart += 2;
            else
                break;
        }

        if (from < 0)
            return ResultSource.ReadOnly(NoTable);

        var fromEnd = from + 1;
        depth = 0;
        for (; fromEnd < tokens.Count; fromEnd++)
        {
            var token = tokens[fromEnd];
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;
            else if (depth == 0 && token.Kind == ETokenKind.Word && FromEnd.Contains(token.Upper))
                break;
        }

        var fromTokens = tokens[(from + 1)..fromEnd];
        depth = 0;
        foreach (var token in fromTokens)
        {
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;
            else if (depth == 0 && (token.Is(",") || token.Kind == ETokenKind.Word && JoinWords.Contains(token.Upper)))
                return ResultSource.ReadOnly(Join);
        }

        if (fromTokens.FindIndex(token => token.Is("(")) is var open and >= 0)
            return ResultSource.ReadOnly(open + 1 < fromTokens.Count && (fromTokens[open + 1].Upper is "SELECT" or "WITH" or "VALUES" || fromTokens[open + 1].Is("(")) ? SubqueryOrWith : UnknownOrigin);

        if (ReadTable(fromTokens, dialect) is not { } table)
            return ResultSource.ReadOnly(UnknownOrigin);

        var items = Split(tokens[listStart..from]).Select(item => ReadItem(item, dialect)).ToList();

        return new ResultSource(null, table.Name, table.Alias, items);
    }

    /// <summary>`[esquema.]tabela [[AS] apelido]`, e nada mais. Três partes, o `banco:tabela` do Informix e o que sobrar depois do apelido não são reconhecidos.</summary>
    private static (EditTableName Name, string? Alias)? ReadTable(List<Token> tokens, ESqlDialect dialect)
    {
        var position = 0;
        var parts = ReadDotted(tokens, ref position, dialect);
        if (parts is not { Count: 1 or 2 } || position < tokens.Count && tokens[position].Is("."))
            return null;

        string? alias = null;
        if (position < tokens.Count && tokens[position].IsWord("AS"))
            position++;

        if (position < tokens.Count && IsName(tokens[position]))
            alias = Fold(tokens[position++], dialect);

        if (position != tokens.Count)
            return null;

        var schema = parts.Count == 2 ? parts[0] : null;
        var name = parts[^1];
        var written = string.Join('.', parts.Select(Quote));

        return (new EditTableName(schema, name, written), alias);
    }

    /// <summary>Um item da lista do `SELECT`, sem a vírgula.</summary>
    private static SelectItem ReadItem(List<Token> tokens, ESqlDialect dialect)
    {
        if (tokens is [{ Kind: ETokenKind.Symbol, Text: "*" }])
            return new SelectItem.All();

        // Um número e uma palavra de valor (`NULL`, `CURRENT_DATE`) são constantes, e não nome de coluna.
        if (tokens[0].Kind == ETokenKind.Word && (char.IsAsciiDigit(tokens[0].Text[0]) || ValueWords.Contains(tokens[0].Upper) && (tokens.Count == 1 || !tokens[1].Is("."))))
            return new SelectItem.Computed();

        var position = 0;
        if (ReadDotted(tokens, ref position, dialect) is not { Count: > 0 } parts)
            return new SelectItem.Computed();

        if (position + 2 == tokens.Count && tokens[position].Is(".") && tokens[position + 1].Is("*"))
            return new SelectItem.AllOf(parts);

        string? output = null;
        if (position < tokens.Count && tokens[position].IsWord("AS"))
            position++;

        if (position < tokens.Count && IsName(tokens[position]))
            output = Fold(tokens[position++], dialect);

        return position == tokens.Count ? new SelectItem.Column(parts[..^1], parts[^1], output ?? parts[^1]) : new SelectItem.Computed();
    }

    /// <summary>Nomes separados por ponto, já com a regra de maiúsculas do banco. Para no primeiro que não for nome.</summary>
    private static List<string>? ReadDotted(List<Token> tokens, ref int position, ESqlDialect dialect)
    {
        if (position >= tokens.Count || !IsName(tokens[position]))
            return null;

        var parts = new List<string> { Fold(tokens[position++], dialect) };
        while (position + 1 < tokens.Count && tokens[position].Is(".") && IsName(tokens[position + 1]))
        {
            parts.Add(Fold(tokens[position + 1], dialect));
            position += 2;
        }

        return parts;
    }

    private static bool IsName(Token token)
        => token.Kind == ETokenKind.Identifier || token.Kind == ETokenKind.Word && !NotAName.Contains(token.Upper);

    /// <summary>
    /// O nome como o banco o guarda: entre aspas, como está; sem aspas, em minúsculas no PostgreSQL (só as letras do ASCII, como ele
    /// faz num banco UTF-8) e no Informix, e em maiúsculas no Db2.
    /// </summary>
    private static string Fold(Token token, ESqlDialect dialect)
    {
        if (token.Kind == ETokenKind.Identifier)
            return token.Text;

        return dialect switch
        {
            ESqlDialect.Db2 => token.Text.ToUpperInvariant(),
            ESqlDialect.Informix => token.Text.ToLowerInvariant(),
            _ => string.Create(token.Text.Length, token.Text, (characters, text) =>
            {
                for (var index = 0; index < text.Length; index++)
                    characters[index] = char.IsAsciiLetterUpper(text[index]) ? (char)(text[index] + 32) : text[index];
            })
        };
    }

    private static string Quote(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>Os itens separados pelas vírgulas do nível de fora.</summary>
    private static IEnumerable<List<Token>> Split(List<Token> tokens)
    {
        var item = new List<Token>();
        var depth = 0;

        foreach (var token in tokens)
        {
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;

            if (depth == 0 && token.Is(","))
            {
                yield return item;
                item = [];
            }
            else
                item.Add(token);
        }

        if (item.Count > 0)
            yield return item;
    }

    /// <summary>
    /// O texto fora de comentário, pedaço por pedaço: a palavra (com `$` no meio, como os três bancos aceitam num nome), o identificador
    /// entre aspas (com o conteúdo, a aspa dobrada desfeita), o texto (em qualquer forma: `'...'`, `E'...'`, `X'...'`, `U&amp;'...'` e o
    /// `$marca$` do PostgreSQL) e cada outro caractere que não é espaço.
    /// </summary>
    private static IEnumerable<Token> Lex(string sql, ESqlDialect dialect)
    {
        var position = 0;

        while (position < sql.Length)
        {
            var character = sql[position];
            if (char.IsWhiteSpace(character))
            {
                position++;
                continue;
            }

            if (SqlText.SkipComment(sql, position, dialect) is var afterComment && afterComment > position)
            {
                position = afterComment;
                continue;
            }

            var start = position;
            if (character == '\'')
            {
                position = SqlText.SkipQuoted(sql, position, backslashEscapes: false);
                yield return new Token(ETokenKind.Text, sql[start..position], string.Empty);
            }
            else if (character == '"')
            {
                position = SqlText.SkipQuoted(sql, position, backslashEscapes: false);
                var closed = position - 1 > start && sql[position - 1] == '"';
                var content = sql[(start + 1)..(closed ? position - 1 : position)];
                yield return new Token(ETokenKind.Identifier, content.Replace("\"\"", "\"", StringComparison.Ordinal), string.Empty);
            }
            else if (dialect == ESqlDialect.PostgreSql && character == '$' && SqlText.SkipDollarQuoted(sql, position) is var afterDollar && afterDollar > position + 1)
            {
                position = afterDollar;
                yield return new Token(ETokenKind.Text, sql[start..position], string.Empty);
            }
            else if (SqlText.IsWordCharacter(character))
            {
                while (position < sql.Length && (SqlText.IsWordCharacter(sql[position]) || sql[position] == '$'))
                    position++;

                var word = sql[start..position];

                // O prefixo de um texto (`E'...'`, `N'...'`, `X'...'`, `B'...'`, `U&'...'`): o texto vai junto, e a barra só escapa no `E` do PostgreSQL.
                if (word.Length == 1 && position < sql.Length && sql[position] == '\'')
                {
                    position = SqlText.SkipQuoted(sql, position, backslashEscapes: dialect == ESqlDialect.PostgreSql && word is "E" or "e");
                    yield return new Token(ETokenKind.Text, sql[start..position], string.Empty);
                }
                else if (word is "U" or "u" && position + 1 < sql.Length && sql[position] == '&' && sql[position + 1] == '\'')
                {
                    position = SqlText.SkipQuoted(sql, position + 1, backslashEscapes: false);
                    yield return new Token(ETokenKind.Text, sql[start..position], string.Empty);
                }
                else
                    yield return new Token(ETokenKind.Word, word, Ascii.IsValid(word) ? word.ToUpperInvariant() : word);
            }
            else
            {
                position++;
                yield return new Token(ETokenKind.Symbol, character.ToString(), character.ToString());
            }
        }
    }

    private enum ETokenKind
    {
        Word,
        Identifier,
        Text,
        Symbol
    }

    /// <param name="Upper">A palavra em maiúsculas, quando é toda do ASCII: só assim ela pode ser palavra reservada.</param>
    private readonly record struct Token(ETokenKind Kind, string Text, string Upper)
    {
        public bool Is(string symbol)
            => Kind == ETokenKind.Symbol && Text == symbol;

        public bool IsWord(string word)
            => Kind == ETokenKind.Word && Upper == word;
    }
}
