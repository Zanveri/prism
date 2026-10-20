using Prism.Infrastructure.Databases.Models;
using System.Text;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-002 e 003: a leitura do texto do comando para a edição, sem consultar o banco (RN-EDIT-010). Diz quando o resultado inteiro
/// é só leitura, com o motivo da regra, e, quando não é, cada tabela do `FROM`, com o apelido, na ordem em que aparece, e de onde vem
/// cada item da lista do `SELECT`. O que conta é o nível de fora do comando: dentro de parênteses (uma subconsulta do `WHERE` ou do
/// `ON`, os argumentos de uma função), de texto, de identificador entre aspas e de comentário nada muda a decisão. Comentário e texto
/// são lidos como cada banco os lê (<see cref="SqlText"/>).
///
/// O `FROM` é uma lista de `[esquema.]tabela [[AS] apelido]` ligadas por vírgula, por `[INNER | LEFT | RIGHT | FULL [OUTER]] JOIN ...
/// ON` ou `USING (...)`, `CROSS JOIN`, `NATURAL ... JOIN` e, no Informix, `, OUTER tabela`. O que ela não reconhece deixa o resultado
/// inteiro só leitura (o Prism só edita quando sabe de onde vem cada coluna): a junção entre parênteses, o `OUTER (...)` do Informix,
/// `LATERAL`, função, três partes, `banco:tabela`, a lista de nomes de coluna depois do apelido. No Db2 e no Informix, o `*` sobre um
/// `NATURAL JOIN` ou um `USING` também, porque a coluna da junção aparece uma vez só e a lista do `SELECT` não diz de que tabela.
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
    public const string WroteRows = "o comando gravou e devolveu linhas";
    public const string UnknownOrigin = "o Prism não conseguiu saber de onde vêm as colunas";

    /// <summary>RN-GRADE-011: o filtro embrulhou um comando que a leitura aceitaria, mas cujas cláusulas a junção do filtro não conhece.</summary>
    public const string FilteredOutside = "o filtro foi aplicado por fora do comando";

    /// <summary>As palavras que encerram o `FROM` no nível de fora. O `WITH` do fim é o nível de isolamento do Db2 (`WITH UR`).</summary>
    private static readonly HashSet<string> FromEnd = ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", "UNION", "INTERSECT", "EXCEPT", "MINUS", "WINDOW", "WITH", "INTO"];

    /// <summary>As palavras de junção, inclusive o `, OUTER tabela` do Informix e o `LATERAL` do PostgreSQL.</summary>
    private static readonly HashSet<string> JoinWords = ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER", "LATERAL"];

    /// <summary>As palavras que começam uma junção depois de uma tabela (e encerram o `ON` da anterior).</summary>
    private static readonly HashSet<string> JoinStart = ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL"];

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
            else if (depth == 0 && token.Kind == ETokenKind.Word && FromEnd.Contains(token.Upper) && !tokens[fromEnd - 1].Is("."))
                break;
        }

        var read = ReadFrom(tokens[(from + 1)..fromEnd], dialect);
        if (read.Reason is { } reason)
            return ResultSource.ReadOnly(reason);

        var items = Split(tokens[listStart..from]).Select(item => ReadItem(item, dialect)).ToList();

        // A coluna da junção por `USING` e `NATURAL` aparece uma vez só no `*`, e a lista do `SELECT` não diz de que tabela (no
        // PostgreSQL é o banco quem diz).
        if (read.Merged && dialect != ESqlDialect.PostgreSql && items.Any(item => item is SelectItem.All))
            return ResultSource.ReadOnly(UnknownOrigin);

        return new ResultSource(null, read.Tables, items);
    }

    /// <summary>
    /// RN-SQL-024: o comando pode ter trocado a tabela que um nome escrito sem esquema leva, no Db2 e no Informix: começa, depois dos
    /// comentários, dos `;` soltos e dos parênteses de abertura (o leitor da RN-PROT-005), por `SET` (`SET SCHEMA`, `SET CURRENT SCHEMA`,
    /// `SET CURRENT SQLID`, `SET SESSION AUTHORIZATION`...), `CALL` ou `EXECUTE` (a rotina pode trocá-lo por dentro) e, no Informix,
    /// `DATABASE`. No Db2 vale a leitura do comentário de bloco do banco e a do driver: basta uma delas. Na dúvida, sim: todo `SET` conta.
    /// </summary>
    internal static bool MayChangeTheCurrentSchema(string sql, ESqlDialect dialect)
        => StartsBySchemaChange(Lex(sql, dialect), dialect) || (dialect == ESqlDialect.Db2 && StartsBySchemaChange(Lex(sql, dialect, asTheDriver: true), dialect));

    private static bool StartsBySchemaChange(IEnumerable<Token> tokens, ESqlDialect dialect)
    {
        var first = tokens.FirstOrDefault(token => !token.Is("(") && !token.Is(";"));

        return first.Kind == ETokenKind.Word && (first.Upper is "SET" or "CALL" or "EXECUTE" || (dialect == ESqlDialect.Informix && first.Upper == "DATABASE"));
    }

    /// <summary>
    /// As tabelas do `FROM`, na ordem em que aparecem, ou o motivo de o resultado inteiro ficar só leitura. `Merged` diz se há `USING` ou
    /// `NATURAL`, que juntam as colunas da junção numa só.
    /// </summary>
    private static (IReadOnlyList<FromTable> Tables, bool Merged, string? Reason) ReadFrom(List<Token> tokens, ESqlDialect dialect)
    {
        var tables = new List<FromTable>();
        var merged = false;
        var position = 0;

        if (ReadTable(tokens, ref position, dialect) is not { } first)
            return Refused(tokens, position);

        tables.Add(first);
        while (position < tokens.Count)
        {
            if (tokens[position].Is(","))
            {
                position++;

                // O `, OUTER tabela` do Informix; o `OUTER (...)`, com parênteses, não é reconhecido.
                if (dialect == ESqlDialect.Informix && position < tokens.Count && tokens[position].IsWord("OUTER"))
                {
                    position++;
                    if (position < tokens.Count && tokens[position].Is("("))
                        return ([], false, UnknownOrigin);
                }

                if (ReadTable(tokens, ref position, dialect) is not { } listed)
                    return Refused(tokens, position);

                tables.Add(listed);
                continue;
            }

            if (!IsJoinStart(tokens, position))
                return ([], false, UnknownOrigin);

            var natural = tokens[position].IsWord("NATURAL");
            if (natural)
                position++;

            var cross = position < tokens.Count && tokens[position].IsWord("CROSS");
            if (position < tokens.Count && tokens[position].Kind == ETokenKind.Word && tokens[position].Upper is "INNER" or "CROSS")
                position++;
            else if (position < tokens.Count && tokens[position].Kind == ETokenKind.Word && tokens[position].Upper is "LEFT" or "RIGHT" or "FULL")
            {
                position++;
                if (position < tokens.Count && tokens[position].IsWord("OUTER"))
                    position++;
            }

            if (position >= tokens.Count || !tokens[position].IsWord("JOIN"))
                return ([], false, UnknownOrigin);

            position++;
            if (ReadTable(tokens, ref position, dialect) is not { } joined)
                return Refused(tokens, position);

            tables.Add(joined);
            merged |= natural;
            if (natural || cross)
                continue;

            if (position < tokens.Count && tokens[position].IsWord("ON"))
                position = SkipCondition(tokens, position + 1);
            else if (position + 1 < tokens.Count && tokens[position].IsWord("USING") && tokens[position + 1].Is("("))
            {
                merged = true;
                position = SkipCondition(tokens, position + 1);
            }
            else
                return ([], false, UnknownOrigin);
        }

        return (tables, merged, null);
    }

    /// <summary>A tabela que não se leu: entre parênteses, uma subconsulta (ou um `WITH`, um `VALUES`) é a regra; o resto, o Prism não reconhece.</summary>
    private static (IReadOnlyList<FromTable>, bool, string?) Refused(List<Token> tokens, int position)
        => ([], false, position + 1 < tokens.Count && tokens[position].Is("(") && (tokens[position + 1].Upper is "SELECT" or "WITH" or "VALUES" || tokens[position + 1].Is("(")) ? SubqueryOrWith : UnknownOrigin);

    /// <summary>A palavra começa uma junção: não é nome qualificado (`p.left`, `left.x`) nem as funções `left(...)` e `right(...)`.</summary>
    private static bool IsJoinStart(List<Token> tokens, int position)
        => tokens[position].Kind == ETokenKind.Word
           && JoinStart.Contains(tokens[position].Upper)
           && (position == 0 || !tokens[position - 1].Is("."))
           && (position + 1 >= tokens.Count || !tokens[position + 1].Is(".") && !(tokens[position + 1].Is("(") && tokens[position].Upper is "LEFT" or "RIGHT"));

    /// <summary>A condição do `ON` (ou a lista do `USING`), até a próxima junção ou vírgula do nível de fora: devolve a posição dela.</summary>
    private static int SkipCondition(List<Token> tokens, int position)
    {
        var depth = 0;
        for (; position < tokens.Count; position++)
        {
            var token = tokens[position];
            if (token.Is("("))
                depth++;
            else if (token.Is(")"))
                depth--;
            else if (depth == 0 && (token.Is(",") || IsJoinStart(tokens, position)))
                break;
        }

        return position;
    }

    /// <summary>
    /// `[esquema.]tabela [[AS] apelido]`, a partir de `position`, que fica depois dela. Três partes, o `banco:tabela` do Informix, uma
    /// função e a lista de nomes de coluna depois do apelido não são reconhecidos (nulo).
    /// </summary>
    private static FromTable? ReadTable(List<Token> tokens, ref int position, ESqlDialect dialect)
    {
        var parts = ReadDotted(tokens, ref position, dialect);
        if (parts is not { Count: 1 or 2 } || position < tokens.Count && (tokens[position].Is(".") || tokens[position].Is("(")))
            return null;

        string? alias = null;
        if (position < tokens.Count && tokens[position].IsWord("AS"))
            position++;

        if (position < tokens.Count && IsName(tokens[position]))
            alias = Fold(tokens[position++], dialect);

        if (position < tokens.Count && !tokens[position].Is(",") && !IsJoinStart(tokens, position) && !tokens[position].IsWord("ON") && !tokens[position].IsWord("USING"))
            return null;

        var schema = parts.Count == 2 ? parts[0] : null;
        var written = string.Join('.', parts.Select(Quote));

        return new FromTable(new EditTableName(schema, parts[^1], written), alias);
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
    /// `$marca$` do PostgreSQL) e cada outro caractere que não é espaço, com a posição de cada um no texto. É também o leitor do filtro
    /// do resultado (<see cref="SqlFilter"/>), que junta o filtro ao comando pelas posições, e o da leitura do somente leitura (<see cref="ReadOnlySql"/>).
    /// </summary>
    /// <param name="asTheDriver">O comentário de bloco como o driver da IBM o lê, e não como o banco (<see cref="SqlText.SkipComment"/>): no Db2 as duas leituras divergem.</param>
    internal static IEnumerable<Token> Lex(string sql, ESqlDialect dialect, bool asTheDriver = false)
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

            if (SqlText.SkipComment(sql, position, dialect, asTheDriver) is var afterComment && afterComment > position)
            {
                position = afterComment;
                continue;
            }

            var start = position;
            if (character == '\'')
            {
                position = SqlText.SkipQuoted(sql, position, backslashEscapes: false);
                yield return new Token(ETokenKind.Text, sql[start..position], string.Empty, start, position);
            }
            else if (character == '"')
            {
                position = SqlText.SkipQuoted(sql, position, backslashEscapes: false);
                var closed = position - 1 > start && sql[position - 1] == '"';
                var content = sql[(start + 1)..(closed ? position - 1 : position)];
                yield return new Token(ETokenKind.Identifier, content.Replace("\"\"", "\"", StringComparison.Ordinal), string.Empty, start, position);
            }
            else if (dialect == ESqlDialect.PostgreSql && character == '$' && SqlText.SkipDollarQuoted(sql, position) is var afterDollar && afterDollar > position + 1)
            {
                position = afterDollar;
                yield return new Token(ETokenKind.Text, sql[start..position], string.Empty, start, position);
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
                    yield return new Token(ETokenKind.Text, sql[start..position], string.Empty, start, position);
                }
                else if (word is "U" or "u" && position + 1 < sql.Length && sql[position] == '&' && sql[position + 1] == '\'')
                {
                    position = SqlText.SkipQuoted(sql, position + 1, backslashEscapes: false);
                    yield return new Token(ETokenKind.Text, sql[start..position], string.Empty, start, position);
                }
                else
                    yield return new Token(ETokenKind.Word, word, Ascii.IsValid(word) ? word.ToUpperInvariant() : word, start, position);
            }
            else
            {
                position++;
                yield return new Token(ETokenKind.Symbol, character.ToString(), character.ToString(), start, position);
            }
        }
    }

    internal enum ETokenKind
    {
        Word,
        Identifier,
        Text,
        Symbol
    }

    /// <param name="Upper">A palavra em maiúsculas, quando é toda do ASCII: só assim ela pode ser palavra reservada.</param>
    /// <param name="Start">Onde o pedaço começa no texto lido.</param>
    /// <param name="End">Onde ele acaba (a posição depois do último caractere).</param>
    internal readonly record struct Token(ETokenKind Kind, string Text, string Upper, int Start, int End)
    {
        public bool Is(string symbol)
            => Kind == ETokenKind.Symbol && Text == symbol;

        public bool IsWord(string word)
            => Kind == ETokenKind.Word && Upper == word;
    }
}
