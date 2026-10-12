using System.Text;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O texto de um comando SQL, lido como o banco o leria: sem os espaços, os comentários e os `;` soltos. É o que basta para recusar
/// controle de transação (RN-SQL-003) e o envio com mais de um comando (RN-SQL-001), e para saber se vale tentar o comando como
/// leitura (RN-SQL-013). O comando em si nunca é alterado nem dividido; só no Db2 e no Informix os `;` soltos em volta dele ficam de
/// fora do que é enviado (<see cref="Statement"/>). No Db2 o envio com mais de um comando e a leitura são conferidos também como
/// o driver da IBM lê o texto: é ele quem divide o envio, e não encerra o comentário de bloco onde o banco encerra.
/// </summary>
internal static class SqlText
{
    /// <summary>
    /// RN-SQL-003: `BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`, `RELEASE` e `PREPARE TRANSACTION` como
    /// primeira palavra do comando. `START` pede `TRANSACTION` depois. `PREPARE TRANSACTION` só é a confirmação em duas fases quando o
    /// que vem depois é o identificador dela, uma constante de texto: `PREPARE transaction AS SELECT 1` prepara uma consulta chamada
    /// `transaction`.
    /// </summary>
    public static bool IsTransactionControl(string sql)
        => IsTransactionControl(sql, ESqlDialect.PostgreSql);

    /// <summary>
    /// A mesma recusa, como cada banco escreve o comando. O que muda é o que vem antes da primeira palavra (o Informix também pula
    /// comentário entre chaves) e, no Db2, duas formas que não são controle de transação: `BEGIN` seguido de mais alguma coisa é um
    /// bloco composto (`BEGIN ATOMIC ... END`), que o banco executa e confirma inteiro, e `RELEASE` sem `SAVEPOINT` solta uma conexão,
    /// e não um ponto de salvamento.
    /// </summary>
    public static bool IsTransactionControl(string sql, ESqlDialect dialect)
    {
        var (first, second, next) = Scan(sql, dialect);

        if (dialect == ESqlDialect.Db2 && ((first == "BEGIN" && second is not ("" or "WORK" or "TRANSACTION")) || (first == "RELEASE" && second is not ("SAVEPOINT" or "TO"))))
            return false;

        return first is "BEGIN" or "COMMIT" or "END" or "ROLLBACK" or "ABORT" or "SAVEPOINT" or "RELEASE"
            || (first == "START" && second == "TRANSACTION")
            || (first == "PREPARE" && second == "TRANSACTION" && IsTextConstantAt(sql, next));
    }

    /// <summary>
    /// RN-SQL-013: o comando começa por `WITH`, com ou sem parênteses na frente, e tem `INSERT`, `UPDATE`, `DELETE` ou `MERGE` como
    /// palavra inteira, fora de texto entre aspas simples, de `$marca$ ... $marca$`, de identificador entre aspas duplas e de comentário.
    /// É um comando que grava, mesmo começando como leitura. `updated_at`, `is_deleted` e `"update"` são nomes, e não contam.
    ///
    /// Quando erra, erra para o lado seguro: um `FOR UPDATE` ou uma coluna chamada `update` sem aspas fazem a leitura rodar até o fim,
    /// sem cursor, e nada se perde. O contrário (não ver a palavra) deixaria só a tentativa de leitura, em que o banco recusa a
    /// gravação em tabela comum.
    /// </summary>
    public static bool WithModifiesData(string sql)
    {
        // A consulta pode vir entre parênteses, `(WITH ... )`: eles não mudam o que ela faz.
        var position = SkipBlanks(sql, 0, ESqlDialect.PostgreSql);
        while (position < sql.Length && sql[position] == '(')
            position = SkipBlanks(sql, position + 1, ESqlDialect.PostgreSql);

        if (ReadWord(sql, ref position) != "WITH")
            return false;

        while (position < sql.Length)
        {
            var current = sql[position];

            if (current == '\'' || current == '"')
                position = SkipQuoted(sql, position, backslashEscapes: false);
            else if (current == '$')
                position = SkipDollarQuoted(sql, position);
            else if (StartsAt(sql, position, "--") || StartsAt(sql, position, "/*"))
                position = SkipBlanks(sql, position, ESqlDialect.PostgreSql);
            else if (!IsWordCharacter(current))
                position++;
            else
            {
                var word = ReadWord(sql, ref position);
                if (word is "INSERT" or "UPDATE" or "DELETE" or "MERGE")
                    return true;

                // `E'...'`: o texto em que a barra invertida escapa a aspa.
                if (word == "E" && position < sql.Length && sql[position] == '\'')
                    position = SkipQuoted(sql, position, backslashEscapes: true);
            }
        }

        return false;
    }

    /// <summary>
    /// RN-SQL-013, para o banco que não tem transação só de leitura (Db2 e Informix), em que quem diz se o comando grava é o texto:
    /// ele é uma leitura só, que pode ficar com o cursor aberto entre as páginas? Começa por `SELECT`, `WITH`, `VALUES` ou parêntese,
    /// é um comando só (<see cref="HasSeveralStatements"/>) e não tem `INSERT`, `UPDATE`, `DELETE` nem `MERGE` como palavra inteira
    /// (no Db2 um `SELECT` grava por `FROM FINAL TABLE (UPDATE ...)`). No Db2 também não tem `TABLE (`: é como se chama uma função
    /// de tabela, e a que foi criada com `MODIFIES SQL DATA` grava sem que o texto do `SELECT` mostre. No Informix a função de
    /// tabela não grava: o banco a recusa. Tudo fora de texto, de identificador entre aspas e de comentário.
    ///
    /// No Db2 isso vale nas duas leituras do comentário de bloco, a do banco e a do driver (<see cref="HasSeveralStatements"/>):
    /// com um comentário aninhado, o que uma lê como leitura a outra pode ler como gravação, e só é leitura o que as duas leem assim.
    ///
    /// Quando erra, erra para o lado seguro: um `FOR UPDATE`, uma coluna chamada `update` sem aspas ou uma função de tabela que só
    /// lê fazem a leitura rodar até o fim, sem cursor, e nada se perde.
    /// </summary>
    public static bool IsSingleRead(string sql, ESqlDialect dialect)
        => !HasSeveralStatements(sql, dialect) && IsRead(sql, dialect, asTheDriver: false) && (dialect != ESqlDialect.Db2 || IsRead(Statement(sql, dialect), dialect, asTheDriver: true));

    /// <summary>O texto começa como leitura e não tem palavra de gravação (nem, no Db2, `TABLE (`), na leitura pedida do comentário de bloco?</summary>
    private static bool IsRead(string sql, ESqlDialect dialect, bool asTheDriver)
    {
        var tokens = Tokens(sql, dialect, asTheDriver).Select(token => token.Token).ToArray();

        return tokens.FirstOrDefault(token => token != ";") is "SELECT" or "WITH" or "VALUES" or "("
            && !tokens.Any(token => token is "INSERT" or "UPDATE" or "DELETE" or "MERGE")
            && !(dialect == ESqlDialect.Db2 && tokens.Zip(tokens.Skip(1)).Any(pair => pair is ("TABLE", "(")));
    }

    /// <summary>
    /// RN-SQL-001, no Db2 e no Informix: o envio tem mais de um comando? É o que tem outro comando depois de um `;`, fora de texto, de
    /// identificador entre aspas e de comentário; o `;` do fim e o comentário depois dele não são um segundo comando. O driver da IBM
    /// executaria os comandos um por um, cada um com a própria confirmação: um erro no meio deixaria gravado o que veio antes, e um
    /// `BEGIN WORK` no fim deixaria a conexão dentro de uma transação.
    ///
    /// O bloco que tem `;` no corpo é um comando só. No Db2, o que começa por `CREATE [OR REPLACE] PROCEDURE`, `FUNCTION` ou `TRIGGER`,
    /// a rotina acrescentada a um módulo (`ALTER MODULE ... ADD` ou `PUBLISH PROCEDURE` ou `FUNCTION`) e o bloco composto
    /// (`BEGIN ... END`): o driver manda o texto que começa assim inteiro, e o banco, que só executa um comando por envio, recusa
    /// o que vier depois do fim do bloco sem executar nada.
    ///
    /// No Db2 quem divide o envio é o driver, e ele não lê o comentário de bloco como o banco: o banco aceita um comentário
    /// dentro de outro, e o driver encerra o comentário no primeiro `*/`. Com um comentário aninhado antes das palavras do bloco
    /// (ou entre `CREATE` e `PROCEDURE`), o banco vê o bloco e o driver não: ele divide no `;` e executa os pedaços. Por isso ali
    /// valem as duas leituras do texto que vai ao driver (<see cref="Statement"/>): só é bloco o que as duas começam pelas
    /// palavras dele, e fora do bloco basta uma delas ver um `;` ao lado de um comando para o envio ser mais de um. Nada legítimo
    /// se perde: o bloco com um comentário aninhado na frente já não era executado.
    ///
    /// No Informix, `CREATE [OR REPLACE] [DBA] PROCEDURE` e
    /// `FUNCTION`, até o `END PROCEDURE` ou `END FUNCTION`: o servidor executa o que vier depois, e por isso depois do fim o `;` volta
    /// a separar. A rotina externa do Informix (`EXTERNAL NAME '...'` no cabeçalho, a única forma que o banco aceita) não tem corpo
    /// nem fim: nela todo `;` separa, mesmo que o envio tenha, mais adiante, o `END PROCEDURE` de outra rotina. O par sem o texto
    /// entre aspas depois não é rotina externa: `SELECT external name FROM t` lê a coluna `external` com o apelido `name`. O
    /// gatilho do Informix não tem `;` no corpo.
    /// </summary>
    public static bool HasSeveralStatements(string sql, ESqlDialect dialect)
    {
        if (dialect == ESqlDialect.Db2)
        {
            var sent = Statement(sql, dialect);

            return !(StartsADb2Block(sent, asTheDriver: false) && StartsADb2Block(sent, asTheDriver: true))
                && (HasSemicolonBesideAStatement(sent, asTheDriver: false) || HasSemicolonBesideAStatement(sent, asTheDriver: true));
        }

        // O cabeçalho: o que vem antes do primeiro `;`, sem os soltos da frente.
        var header = Tokens(sql, dialect).Select(token => token.Token).SkipWhile(token => token == ";").TakeWhile(token => token != ";").ToArray();

        // As duas primeiras palavras, sem o que fica entre `CREATE` e o tipo do objeto.
        var words = header.Where(token => token is not ("OR" or "REPLACE" or "DBA")).Take(2).ToArray();
        var routine = words is ["CREATE", "PROCEDURE" or "FUNCTION"] && !header.Zip(header.Skip(1), header.Skip(2)).Any(triple => triple is ("EXTERNAL", "NAME", "'"));

        // `routine` daqui em diante: dentro do corpo de uma rotina do Informix, onde o `;` ainda não separa comandos.
        var afterSemicolon = false;
        var semicolonInTheBody = false;
        var started = false;
        var previous = string.Empty;

        foreach (var (token, _, _) in Tokens(sql, dialect))
        {
            if (token == ";")
            {
                afterSemicolon = started;
                continue;
            }

            if (afterSemicolon && !routine)
                return true;

            semicolonInTheBody |= afterSemicolon;
            afterSemicolon = false;
            started = true;

            if (previous == "END" && token is "PROCEDURE" or "FUNCTION")
                routine = false;

            previous = token;
        }

        return routine && semicolonInTheBody;
    }

    /// <summary>
    /// O texto que vai ao driver começa pelas palavras de um bloco do Db2, na leitura pedida do comentário de bloco? São as que
    /// fazem o driver mandar o envio inteiro, sem dividir: `CREATE [OR REPLACE] PROCEDURE`, `FUNCTION` ou `TRIGGER`, `BEGIN` e
    /// `ALTER MODULE ... ADD` ou `PUBLISH PROCEDURE` ou `FUNCTION`.
    /// </summary>
    private static bool StartsADb2Block(string sent, bool asTheDriver)
    {
        // O cabeçalho: o que vem antes do primeiro `;`.
        var header = Tokens(sent, ESqlDialect.Db2, asTheDriver).Select(token => token.Token).TakeWhile(token => token != ";").ToArray();

        // As duas primeiras palavras, sem o que fica entre `CREATE` e o tipo do objeto.
        var words = header.Where(token => token is not ("OR" or "REPLACE")).Take(2).ToArray();

        // ponytail: o bloco inteiro é um comando porque o driver não divide o texto que começa por essas palavras (conferido com
        // espaços, quebras de linha e comentários entre elas; com um comentário aninhado ali ele não as reconhece, e por isso a
        // pergunta é feita nas duas leituras). Se uma versão dele passar a dividir, contar a profundidade de `BEGIN` e `END` para
        // achar o fim do bloco.
        return words is ["CREATE", "PROCEDURE" or "FUNCTION" or "TRIGGER"] or ["BEGIN", ..]
            || (header is ["ALTER", "MODULE", ..] && header.Zip(header.Skip(1)).Any(pair => pair is ("ADD" or "PUBLISH", "PROCEDURE" or "FUNCTION")));
    }

    /// <summary>
    /// O texto que vai ao driver do Db2 tem, na leitura pedida do comentário de bloco, um `;` e um comando? Sem os `;` das pontas
    /// (<see cref="Statement"/>), o que sobra separa dois comandos, ou é um `;` que só uma das duas leituras vê fora de comentário.
    /// </summary>
    private static bool HasSemicolonBesideAStatement(string sent, bool asTheDriver)
    {
        var tokens = Tokens(sent, ESqlDialect.Db2, asTheDriver).Select(token => token.Token).ToArray();

        return tokens.Contains(";") && tokens.Any(token => token != ";");
    }

    /// <summary>
    /// O comando como vai ao driver da IBM: sem os `;` soltos da frente (e o que há antes deles) e sem o `;` do fim e o que vem depois
    /// dele. O driver manda cada pedaço entre dois `;` como um comando: o pedaço vazio da frente faz o banco recusar o envio, e o
    /// comentário depois do `;` do fim é recusado depois de o comando já estar executado e confirmado. O comentário sem `;` antes
    /// fica: no Db2 o do fim pode ser uma orientação ao otimizador. Sem comando nenhum, o texto volta como veio, e quem responde é o
    /// banco. Os `;` são os que o banco vê fora de comentário; o que o driver do Db2 vê a mais, dentro de um comentário aninhado,
    /// fica no texto, e é a <see cref="HasSeveralStatements"/> que recusa o envio.
    /// </summary>
    public static string Statement(string sql, ESqlDialect dialect)
    {
        var start = 0;
        var end = sql.Length;
        var started = false;

        foreach (var (token, tokenStart, tokenEnd) in Tokens(sql, dialect))
        {
            if (token != ";")
            {
                started = true;
                end = sql.Length;
            }
            else if (!started)
                start = tokenEnd;
            else if (end == sql.Length)
                end = tokenStart;
        }

        return started ? sql[start..end] : sql;
    }

    /// <summary>
    /// As duas primeiras palavras, em maiúsculas; vazio onde o que vem não é palavra. Um parêntese na frente conta como a primeira (é como
    /// começa uma consulta entre parênteses).
    /// </summary>
    public static (string First, string Second) LeadingWords(string sql)
    {
        var (first, second, _) = Scan(sql, ESqlDialect.PostgreSql);

        return (first, second);
    }

    /// <summary>As duas primeiras palavras e a posição do que vem depois delas, já sem os espaços e comentários do meio.</summary>
    private static (string First, string Second, int Next) Scan(string sql, ESqlDialect dialect)
    {
        var position = SkipBlanks(sql, 0, dialect);
        if (position < sql.Length && sql[position] == '(')
            return ("(", string.Empty, position);

        var first = ReadWord(sql, ref position);
        if (first.Length == 0)
            return (string.Empty, string.Empty, position);

        position = SkipBlanks(sql, position, dialect);
        var second = ReadWord(sql, ref position);

        return (first, second, SkipBlanks(sql, position, dialect));
    }

    /// <summary>
    /// O texto fora de comentário, pedaço por pedaço e com a posição de cada um: a palavra (em maiúsculas), o texto ou o
    /// identificador entre aspas (que sai como `'`, seja qual for o conteúdo) e cada outro caractere que não é espaço. Para o Db2 e
    /// o Informix: as outras formas de texto do PostgreSQL (`$marca$`, `E'...'`) não entram aqui.
    /// </summary>
    /// <param name="asTheDriver">O comentário de bloco como o driver da IBM o lê, e não como o banco (<see cref="SkipComment"/>).</param>
    private static IEnumerable<(string Token, int Start, int End)> Tokens(string sql, ESqlDialect dialect, bool asTheDriver = false)
    {
        var position = 0;

        while (position < sql.Length)
        {
            var start = position;

            if (sql[position] is '\'' or '"')
            {
                position = SkipQuoted(sql, position, backslashEscapes: false);

                yield return ("'", start, position);
            }
            else if (SkipComment(sql, position, dialect, asTheDriver) is var afterComment && afterComment > position)
                position = afterComment;
            else if (char.IsWhiteSpace(sql[position]))
                position++;
            else if (IsWordCharacter(sql[position]))
                yield return (ReadWord(sql, ref position), start, position);
            else
                yield return (sql[position++].ToString(), start, position);
        }
    }

    /// <summary>Começa aqui uma constante de texto, em qualquer das formas do PostgreSQL: `'...'`, `$marca$...$marca$`, `E'...'` ou `U&amp;'...'`.</summary>
    private static bool IsTextConstantAt(string sql, int position)
        => position < sql.Length && (sql[position] is '\'' or '$' || StartsAt(sql, position, "E'") || StartsAt(sql, position, "U&'"));

    /// <summary>
    /// Letra, dígito e `_` do ASCII, e todo caractere a partir de U+0080: é como o PostgreSQL lê um identificador e a marca de um
    /// `$marca$` (para ele, todo byte acima de 127 é letra). `é$a$` é um nome, e `$é$ ... $é$` é um texto.
    /// </summary>
    private static bool IsWordCharacter(char character)
        => char.IsAsciiLetterOrDigit(character) || character == '_' || character >= '\u0080';

    /// <summary>
    /// A palavra em maiúsculas, quando é toda do ASCII. O banco só iguala maiúsculas e minúsculas do ASCII: uma palavra com caractere de
    /// fora dele nunca é palavra reservada, e volta como foi escrita (em maiúsculas, `begın`, com o i sem pingo do turco, viraria `BEGIN`).
    /// </summary>
    private static string ReadWord(string sql, ref int position)
    {
        var start = position;
        while (position < sql.Length && IsWordCharacter(sql[position]))
            position++;

        var word = sql[start..position];

        return Ascii.IsValid(word) ? word.ToUpperInvariant() : word;
    }

    /// <summary>Pula um texto entre aspas simples ou um identificador entre aspas duplas, a partir da aspa que abre. A aspa dobrada é a própria aspa; sem fecho, vai até o fim.</summary>
    private static int SkipQuoted(string sql, int position, bool backslashEscapes)
    {
        var quote = sql[position];

        for (position++; position < sql.Length; position++)
        {
            if (backslashEscapes && sql[position] == '\\')
                position++;
            else if (sql[position] == quote && (position + 1 >= sql.Length || sql[position + 1] != quote))
                return position + 1;
            else if (sql[position] == quote)
                position++;
        }

        return sql.Length;
    }

    /// <summary>
    /// Pula um texto `$marca$ ... $marca$` do PostgreSQL, a partir do `$` que abre; a marca pode ser vazia (`$$`) e tem os caracteres de
    /// um identificador, inclusive os de fora do ASCII (`$é$`). Um `$1` é parâmetro, e não texto, e um `$` logo depois de um caractere
    /// de palavra faz parte do identificador (`k$a$b`, `é$a$`): nos dois casos só o `$` é pulado.
    /// </summary>
    private static int SkipDollarQuoted(string sql, int position)
    {
        var tagEnd = position + 1;
        while (tagEnd < sql.Length && IsWordCharacter(sql[tagEnd]))
            tagEnd++;

        if ((position > 0 && IsWordCharacter(sql[position - 1])) || tagEnd >= sql.Length || sql[tagEnd] != '$' || (tagEnd > position + 1 && char.IsAsciiDigit(sql[position + 1])))
            return position + 1;

        var tag = sql[position..(tagEnd + 1)];
        var close = sql.IndexOf(tag, tagEnd + 1, StringComparison.Ordinal);

        return close < 0 ? sql.Length : close + tag.Length;
    }

    /// <summary>Pula o que o banco pula antes de um comando: espaços, `;` soltos (um comando vazio) e comentários.</summary>
    private static int SkipBlanks(string sql, int position, ESqlDialect dialect)
    {
        while (position < sql.Length)
        {
            if (char.IsWhiteSpace(sql[position]) || sql[position] == ';')
                position++;
            else if (SkipComment(sql, position, dialect) is var afterComment && afterComment > position)
                position = afterComment;
            else
                break;
        }

        return position;
    }

    /// <summary>
    /// O fim do comentário que começa aqui, ou a mesma posição quando o que começa aqui não é comentário: de linha (`--`, que acaba na
    /// quebra de linha e, no PostgreSQL, também no retorno de carro; o Db2, o Informix e o driver deles só o encerram na quebra de
    /// linha), de bloco (`/* */`, que no PostgreSQL e no Db2 pode ter outro dentro, e no Informix acaba no primeiro `*/`) e, só no
    /// Informix, entre chaves (`{ ... }`). Sem fecho, vai até o fim.
    /// </summary>
    /// <param name="asTheDriver">
    /// A leitura do driver da IBM, que no Db2 difere da do banco num ponto: ele encerra o comentário de bloco no primeiro `*/`,
    /// mesmo com outro dentro. É ele quem divide o envio nos `;`.
    /// </param>
    private static int SkipComment(string sql, int position, ESqlDialect dialect, bool asTheDriver = false)
    {
        if (StartsAt(sql, position, "--"))
            return (dialect == ESqlDialect.PostgreSql ? sql.IndexOfAny(['\r', '\n'], position) : sql.IndexOf('\n', position)) is var lineEnd and >= 0 ? lineEnd + 1 : sql.Length;

        if (StartsAt(sql, position, "/*"))
            return dialect == ESqlDialect.Informix || asTheDriver ? EndOf(sql, "*/", position + 2) : SkipBlockComment(sql, position);

        return dialect == ESqlDialect.Informix && sql[position] == '{' ? EndOf(sql, "}", position + 1) : position;
    }

    /// <summary>A posição depois do primeiro fecho que aparece a partir daqui; sem fecho, o fim do texto.</summary>
    private static int EndOf(string sql, string close, int from)
        => sql.IndexOf(close, from, StringComparison.Ordinal) is var found and >= 0 ? found + close.Length : sql.Length;

    private static int SkipBlockComment(string sql, int position)
    {
        var depth = 0;

        while (position < sql.Length)
        {
            if (StartsAt(sql, position, "/*"))
            {
                depth++;
                position += 2;
            }
            else if (StartsAt(sql, position, "*/"))
            {
                position += 2;
                if (--depth == 0)
                    break;
            }
            else
                position++;
        }

        return position;
    }

    /// <summary>Sem diferenciar maiúsculas: `e'...'` é o mesmo que `E'...'`.</summary>
    private static bool StartsAt(string sql, int position, string token)
        => string.Compare(sql, position, token, 0, token.Length, StringComparison.OrdinalIgnoreCase) == 0;
}
