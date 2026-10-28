using Prism.Infrastructure.Databases.Models;
using static Prism.Infrastructure.Databases.Clients.EditableSql;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-PROT-005: o que é leitura numa conexão somente leitura (RN-PROT-002) e numa consulta de verificação (RN-VERIF-001), pelo texto, sem ir ao banco.
/// O texto é lido pelo leitor da edição e do filtro (<see cref="EditableSql.Lex"/>), com as aspas, os comentários e o `$marca$` de cada banco; no Db2,
/// nas duas leituras do comentário de bloco, a do banco e a do driver (<see cref="SqlText.HasSeveralStatements"/>), e basta uma ver o que não é leitura.
/// Cada comando separado por `;` tem de ser uma leitura.
///
/// É uma lista do que passa, e não do que é recusado: leitura é o que começa (depois dos parênteses de abertura) por `SELECT`, `WITH` ou `VALUES` (e, no
/// PostgreSQL, `TABLE`, `SHOW` e `EXPLAIN` sem `ANALYZE`) e não tem, como palavra inteira, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `INTO`, trava de linha
/// nem o próximo valor de uma sequência; no Db2, nem função de tabela (`TABLE (`), que pode gravar sem que o texto mostre. Na dúvida não é leitura: uma
/// coluna chamada `update` sem aspas é recusada. Quem afrouxar esta lista abre a porta da conexão somente leitura no Db2 e no Informix, em que só o texto
/// a guarda (no PostgreSQL o banco também recusa, na transação só de leitura).
///
/// Pública, como o `VaultFileName.IsAllowed`: os validators da Application a reaproveitam para a consulta de verificação, e o registro de sessões a aplica
/// antes de qualquer comando de uma conexão somente leitura.
/// </summary>
public static class ReadOnlySql
{
    /// <summary>RN-PROT-002: a recusa das rotas da edição de registros numa conexão somente leitura.</summary>
    public const string EditsRefusal = "A conexão é somente leitura: nada se grava nela, e a edição de registros não vale. Nada foi enviado ao banco.";

    /// <summary>RN-EDIT-002: o motivo do resultado inteiro só leitura de uma conexão somente leitura, que a grade mostra.</summary>
    public const string ResultReason = "a conexão é somente leitura";

    private const string WithoutAReadMessage = "o comando não começa por SELECT, WITH ou VALUES";
    private const string IntoMessage = "o SELECT ... INTO grava o resultado numa tabela";
    private const string LockMessage = "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas";
    private const string SequenceMessage = "avançar uma sequência (NEXT VALUE FOR, NEXTVAL) não volta atrás";
    private const string Db2TableFunctionMessage = "no Db2, uma função de tabela (TABLE (...)) pode gravar sem que o comando mostre";
    private const string Db2ExplainMessage = "no Db2, o EXPLAIN grava nas tabelas de explicação";
    private const string ExplainAnalyzeMessage = "o EXPLAIN ANALYZE executa o comando";
    private const string SeveralStatementsMessage = "o texto tem mais de um comando";

    /// <summary>As palavras que gravam, em qualquer lugar do comando: o `WITH` que grava do PostgreSQL e o `FROM FINAL TABLE (UPDATE ...)` do Db2 também.</summary>
    private static readonly HashSet<string> WriteWords = ["INSERT", "UPDATE", "DELETE", "MERGE"];

    /// <summary>A palavra da trava de linha e as que vêm antes dela: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` e o `KEEP UPDATE LOCKS` do Db2.</summary>
    private static readonly HashSet<string> LockWords = ["UPDATE", "SHARE", "EXCLUSIVE"];
    private static readonly HashSet<string> LockLeads = ["FOR", "KEY", "KEEP"];

    /// <summary>
    /// RN-PROT-002: por que o comando não é uma leitura no banco dado, ou nulo quando é. O texto sem comando nenhum (só comentários, só `;`) não é
    /// recusado: quem responde é o banco.
    /// </summary>
    public static string? Refusal(string sql, EDatabaseEngine engine)
        => Refusal(sql, DialectOf(engine));

    /// <summary>RN-VERIF-001: por que a consulta de verificação não é uma leitura só (um comando só, e leitura), ou nula quando é.</summary>
    public static string? VerificationRefusal(string sql, EDatabaseEngine engine)
        => Refusal(sql, DialectOf(engine), singleStatement: true);

    /// <summary>RN-PROT-002: a recusa de `CONNECTION_READ_ONLY`, com o motivo da <see cref="Refusal(string, EDatabaseEngine)"/>.</summary>
    public static string Message(string reason)
        => $"A conexão é somente leitura, e só leituras são executadas nela: {reason}. Nada foi enviado ao banco.";

    /// <summary>
    /// RN-EXPORT-002: por que o comando não se exporta, ou nulo quando se exporta. Exportar executa o comando de novo, numa conexão à parte, e só vale para
    /// uma leitura só, pela mesma lista do somente leitura: é o que diz o `read` da página do resultado e o que o começo da exportação confere de novo.
    /// </summary>
    public static string? ExportRefusal(string sql, EDatabaseEngine engine)
        => Refusal(sql, DialectOf(engine), singleStatement: true);

    /// <summary>
    /// RN-EXPORT-016: o texto tem mais de um comando, separados por `;` fora de aspas e de comentário, como o banco os lê (no Db2, em qualquer das duas
    /// leituras do comentário de bloco). Os `;` soltos nas pontas não contam. É a recusa `MULTIPLE_STATEMENTS_NOT_SUPPORTED`, que vem antes da de leitura.
    /// </summary>
    public static bool HasSeveralStatements(string sql, EDatabaseEngine engine)
    {
        var dialect = DialectOf(engine);

        return StatementsOf(Lex(sql, dialect)).Count > 1 || (dialect == ESqlDialect.Db2 && StatementsOf(Lex(sql, dialect, asTheDriver: true)).Count > 1);
    }

    internal static string? Refusal(string sql, ESqlDialect dialect, bool singleStatement = false)
        => Read(Lex(sql, dialect), dialect, singleStatement) ?? (dialect == ESqlDialect.Db2 ? Read(Lex(sql, dialect, asTheDriver: true), dialect, singleStatement) : null);

    internal static ESqlDialect DialectOf(EDatabaseEngine engine)
        => engine switch
        {
            EDatabaseEngine.PostgreSql => ESqlDialect.PostgreSql,
            EDatabaseEngine.Db2 => ESqlDialect.Db2,
            EDatabaseEngine.Informix => ESqlDialect.Informix,
            _ => ESqlDialect.Db2
        };

    private static string? Read(IEnumerable<Token> tokens, ESqlDialect dialect, bool singleStatement)
    {
        var statements = StatementsOf(tokens);
        if (singleStatement && statements.Count > 1)
            return SeveralStatementsMessage;

        return statements.Select(statement => StatementRefusal(statement, dialect)).FirstOrDefault(reason => reason is not null);
    }

    /// <summary>Os comandos do texto, divididos nos `;` do nível de código, sem os vazios.</summary>
    private static List<List<Token>> StatementsOf(IEnumerable<Token> tokens)
    {
        var statements = new List<List<Token>> { new() };
        foreach (var token in tokens)
        {
            if (token.Is(";"))
                statements.Add([]);
            else
                statements[^1].Add(token);
        }

        statements.RemoveAll(statement => statement.Count == 0);

        return statements;
    }

    private static string? StatementRefusal(List<Token> tokens, ESqlDialect dialect)
    {
        // A consulta entre parênteses, `(SELECT ...)`: eles não mudam o que ela faz.
        var start = 0;
        while (start < tokens.Count && tokens[start].Is("("))
            start++;

        if (start == tokens.Count || tokens[start].Kind != ETokenKind.Word)
            return WithoutAReadMessage;

        var first = tokens[start].Upper;
        var postgres = dialect == ESqlDialect.PostgreSql;

        // O `EXPLAIN` sem `ANALYZE` só planeja: não executa o comando, nem o de um `DELETE`. Com `ANALYZE` (também entre as opções, e na grafia
        // britânica), executa. No Db2 ele grava o plano nas tabelas de explicação.
        if (first == "EXPLAIN" && postgres)
            return tokens.Any(token => token.IsWord("ANALYZE") || token.IsWord("ANALYSE")) ? ExplainAnalyzeMessage : null;

        if (first == "EXPLAIN" && dialect == ESqlDialect.Db2)
            return Db2ExplainMessage;

        if (postgres && first == "SHOW")
            return null;

        if (first is not ("SELECT" or "WITH" or "VALUES") && !(postgres && first == "TABLE"))
            return $"um {first} não é leitura";

        var words = tokens.Skip(start + 1).Where(token => token.Kind == ETokenKind.Word).Select(token => token.Upper).ToList();

        for (var index = 0; index < words.Count; index++)
        {
            var word = words[index];
            var previous = index > 0 ? words[index - 1] : string.Empty;

            if (LockWords.Contains(word) && LockLeads.Contains(previous))
                return LockMessage;

            if (WriteWords.Contains(word))
                return $"o comando tem um {word}, que grava";

            if (word == "INTO")
                return IntoMessage;

            if (word == "NEXTVAL" || (word == "VALUE" && previous == "NEXT"))
                return SequenceMessage;
        }

        // A função de tabela do Db2, com qualquer espaço ou comentário entre as duas partes (o leitor já os pulou). Vem depois das palavras que gravam:
        // `FROM FINAL TABLE (UPDATE ...)` é dito pelo `UPDATE`.
        if (dialect == ESqlDialect.Db2 && tokens.Skip(start).Zip(tokens.Skip(start + 1)).Any(pair => pair.First.IsWord("TABLE") && pair.Second.Is("(")))
            return Db2TableFunctionMessage;

        return null;
    }
}
