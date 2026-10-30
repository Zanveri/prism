using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Journal.Models;
using static Prism.Infrastructure.Databases.Clients.EditableSql;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-AUDIT-005, RN-AUDIT-006 e RN-AUDIT-007: classifica o nível de perigo, o motivo em português e a ação principal de um comando SQL.
/// Usa o mesmo leitor de <see cref="EditableSql.Lex"/> e <see cref="ReadOnlySql"/>, mantendo o nível Crítico alinhado ao leitor de irreversível da tela.
/// </summary>
public static class CommandDanger
{
    private static readonly HashSet<string> BlockStarts = [";", "BEGIN", "ATOMIC"];

    private static readonly HashSet<string> ExplainedWords = ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES", "WITH", "TABLE", "EXECUTE", "CREATE", "DECLARE"];

    private static readonly HashSet<string> ObjectModifiers =
    [
        "OR", "REPLACE", "TEMP", "TEMPORARY", "UNIQUE", "CONCURRENTLY", "IF", "EXISTS", "ONLY", "EXTERNAL", "GLOBAL", "LOCAL", "UNLOGGED"
    ];

    private static readonly HashSet<string> DdlObjects =
    [
        "TABLE", "VIEW", "INDEX", "SEQUENCE", "SCHEMA", "FUNCTION", "PROCEDURE", "ROUTINE", "TRIGGER", "TYPE", "DOMAIN", "DATABASE", "USER", "ROLE", "SYNONYM",
        "ALIAS", "EXTENSION", "TABLESPACE", "MODULE", "NICKNAME", "VARIABLE", "PACKAGE", "SERVER", "PUBLICATION", "SUBSCRIPTION", "POLICY", "RULE"
    ];

    private static readonly HashSet<string> ObjectWords =
    [
        "TABLE", "VIEW", "INDEX", "SEQUENCE", "SCHEMA", "FUNCTION", "PROCEDURE", "ROUTINE", "TRIGGER", "TYPE", "DOMAIN", "DATABASE", "USER", "ROLE", "SYNONYM",
        "ALIAS", "EXTENSION", "TABLESPACE", "MODULE", "NICKNAME", "VARIABLE", "PACKAGE", "SERVER", "PUBLICATION", "SUBSCRIPTION", "POLICY", "RULE", "AGGREGATE",
        "OPERATOR", "COLLATION", "STATISTICS", "LANGUAGE", "CAST", "EVENT", "MATERIALIZED", "FOREIGN", "DATA", "WRAPPER", "TEMPORARY", "TEMP", "UNIQUE", "IF",
        "EXISTS", "CONCURRENTLY", "ONLY", "FROM", "COLUMN", "CONSTRAINT"
    ];

    private static readonly HashSet<string> KnownMaintenanceVerbs =
    [
        "SET", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "LOCK", "VACUUM", "ANALYZE", "ANALYSE", "REINDEX", "DECLARE", "FETCH", "CLOSE", "MOVE", "DATABASE", "END"
    ];

    private static readonly HashSet<string> LockWords = ["UPDATE", "SHARE", "EXCLUSIVE"];
    private static readonly HashSet<string> LockLeads = ["FOR", "KEY", "KEEP"];

    /// <summary>RN-AUDIT-005 a 007: devolve o nível de perigo, o motivo e a ação principal do comando para o banco indicado.</summary>
    public static (EJournalLevel Level, string Reason, string Action) Classify(string sql, EDatabaseEngine engine)
    {
        var dialect = ReadOnlySql.DialectOf(engine);
        var tokens = Lex(sql, dialect).ToList();
        if (tokens.Count == 0 || tokens.All(token => token.Kind != ETokenKind.Word))
            return (EJournalLevel.Info, "Leitura.", "SQL");

        if (FindCritical(sql, tokens) is { } critical)
            return critical;

        var statements = SplitStatements(tokens);
        var best = (Level: EJournalLevel.Info, Reason: "Leitura.", Action: "SQL");
        var first = true;

        foreach (var statement in statements)
        {
            var current = ClassifyNonCriticalStatement(statement, dialect);
            if (first || current.Level > best.Level)
            {
                best = current;
                first = false;
            }
        }

        return best;
    }

    private static (EJournalLevel Level, string Reason, string Action)? FindCritical(string sql, List<Token> list)
    {
        var depths = DepthsOf(list);
        var firstWord = list.FindIndex(token => token.Kind == ETokenKind.Word);
        if (firstWord < 0 || list[firstWord].IsWord("CREATE"))
            return null;

        var explainHead = -1;
        if (list[firstWord].IsWord("EXPLAIN"))
        {
            var inner = FindExplainInner(list, depths, firstWord);
            var analyze = HasAnalyzeBetween(list, firstWord + 1, inner < 0 ? list.Count : inner);
            if (!analyze || inner < 0)
                return null;

            explainHead = inner;
        }

        for (var index = firstWord; index < list.Count; index++)
        {
            var token = list[index];
            if (token.Kind != ETokenKind.Word)
                continue;

            var previous = index > 0 ? list[index - 1].Upper : string.Empty;
            var previousSymbol = index > 0 ? list[index - 1].Text : string.Empty;
            var opens = index == firstWord || index == explainHead || index > 0 && (BlockStarts.Contains(previous) || BlockStarts.Contains(previousSymbol));
            var dml = token.Upper is "DELETE" or "UPDATE" && (opens || previousSymbol is "(" or ")");
            if (!opens && !dml)
                continue;

            var target = NameAt(sql, list, index + 1);
            var action = ActionAt(list, index);

            switch (token.Upper)
            {
                case "DROP":
                    return (EJournalLevel.Critical, $"DROP: exclui {target ?? "um objeto do banco"}.", action);
                case "TRUNCATE":
                    return (EJournalLevel.Critical, $"TRUNCATE: apaga todas as linhas de {target ?? "uma tabela"}.", "TRUNCATE");
                case "ALTER":
                    if (HasWordAnywhere(list, depths, index, "DROP"))
                        return (EJournalLevel.Critical, HasWordAnywhere(list, depths, index, "COLUMN") ? $"DROP COLUMN dentro de {action}." : $"DROP dentro de {action}.", action);
                    break;
                case "DELETE":
                    if (!HasWordAtTop(list, depths, index, "WHERE"))
                        return (EJournalLevel.Critical, $"DELETE sem WHERE: apaga todas as linhas de {target ?? "uma tabela"}.", "DELETE");
                    break;
                case "UPDATE":
                    if (!(index + 1 < list.Count && list[index + 1].IsWord("STATISTICS")) && !HasWordAtTop(list, depths, index, "WHERE"))
                        return (EJournalLevel.Critical, $"UPDATE sem WHERE: altera todas as linhas de {target ?? "uma tabela"}.", "UPDATE");
                    break;
            }
        }

        return null;
    }

    private static (EJournalLevel Level, string Reason, string Action) ClassifyNonCriticalStatement(List<Token> tokens, ESqlDialect dialect)
    {
        var start = 0;
        while (start < tokens.Count && tokens[start].Is("("))
            start++;

        if (start >= tokens.Count || tokens[start].Kind != ETokenKind.Word)
            return (EJournalLevel.Info, "Leitura.", "SQL");

        var first = tokens[start].Upper;
        var action = ActionAt(tokens, start);

        if (IsSingleStatementRead(tokens, start, dialect))
            return (EJournalLevel.Info, "Leitura.", action);

        switch (first)
        {
            case "CREATE":
                return (EJournalLevel.High, $"Criação de estrutura ({action}).", action);
            case "ALTER":
                return (EJournalLevel.High, $"Alteração de estrutura ({action}).", action);
            case "RENAME":
                return (EJournalLevel.High, "Renomeação de objeto (RENAME).", "RENAME");
            case "GRANT":
                return (EJournalLevel.High, "Concessão de permissão (GRANT).", "GRANT");
            case "REVOKE":
                return (EJournalLevel.High, "Revogação de permissão (REVOKE).", "REVOKE");
            case "COMMENT":
                return (EJournalLevel.High, "Comentário no catálogo (COMMENT).", "COMMENT");
            case "INSERT":
                return (EJournalLevel.Warning, "INSERT grava linhas.", "INSERT");
            case "UPDATE":
                return action == "UPDATE STATISTICS"
                    ? (EJournalLevel.Warning, "Comando de sessão ou manutenção (UPDATE STATISTICS).", "UPDATE STATISTICS")
                    : (EJournalLevel.Warning, "UPDATE com WHERE.", "UPDATE");
            case "DELETE":
                return (EJournalLevel.Warning, "DELETE com WHERE.", "DELETE");
            case "MERGE":
                return (EJournalLevel.Warning, "MERGE grava linhas.", "MERGE");
            case "CALL" or "EXECUTE":
                return (EJournalLevel.Warning, $"Execução de rotina ({first}).", first);
            case "EXPLAIN":
                return (EJournalLevel.Warning, "EXPLAIN com gravação ou execução.", action);
        }

        if (first is "SELECT" or "WITH" or "VALUES" or "TABLE")
            return ClassifyNonPureQuery(tokens, start, action, dialect);

        if (KnownMaintenanceVerbs.Contains(first))
            return (EJournalLevel.Warning, $"Comando de sessão ou manutenção ({action}).", action);

        return (EJournalLevel.Warning, "Comando não reconhecido pelo leitor: classificado como Atenção.", action);
    }

    private static (EJournalLevel Level, string Reason, string Action) ClassifyNonPureQuery(List<Token> tokens, int start, string action, ESqlDialect dialect)
    {
        var words = tokens.Skip(start + 1).Where(token => token.Kind == ETokenKind.Word).Select(token => token.Upper).ToList();

        for (var index = 0; index < words.Count; index++)
        {
            var word = words[index];
            var previous = index > 0 ? words[index - 1] : string.Empty;

            if (LockWords.Contains(word) && LockLeads.Contains(previous))
                return (EJournalLevel.Warning, "Leitura com trava de linha.", action);

            if (word == "DELETE")
                return (EJournalLevel.Warning, "DELETE com WHERE.", action);

            if (word == "UPDATE")
                return (EJournalLevel.Warning, "UPDATE com WHERE.", action);

            if (word == "INSERT")
                return (EJournalLevel.Warning, "INSERT grava linhas.", action);

            if (word == "MERGE")
                return (EJournalLevel.Warning, "MERGE grava linhas.", action);

            if (word == "INTO")
                return (EJournalLevel.Warning, "SELECT INTO grava numa tabela.", action);

            if (word == "NEXTVAL" || word == "VALUE" && previous == "NEXT")
                return (EJournalLevel.Warning, "Avança sequência.", action);
        }

        if (dialect == ESqlDialect.Db2 && tokens.Skip(start).Zip(tokens.Skip(start + 1)).Any(pair => pair.First.IsWord("TABLE") && pair.Second.Is("(")))
            return (EJournalLevel.Warning, "Função de tabela no Db2 pode gravar.", action);

        return (EJournalLevel.Warning, "Comando não reconhecido pelo leitor: classificado como Atenção.", action);
    }

    private static bool IsSingleStatementRead(List<Token> tokens, int start, ESqlDialect dialect)
    {
        var first = tokens[start].Upper;
        var postgres = dialect == ESqlDialect.PostgreSql;

        if (first == "EXPLAIN" && postgres)
            return !tokens.Any(token => token.IsWord("ANALYZE") || token.IsWord("ANALYSE"));

        if (first == "EXPLAIN" && dialect == ESqlDialect.Db2)
            return false;

        if (postgres && first == "SHOW")
            return true;

        if (first is not ("SELECT" or "WITH" or "VALUES") && !(postgres && first == "TABLE"))
            return false;

        var words = tokens.Skip(start + 1).Where(token => token.Kind == ETokenKind.Word).Select(token => token.Upper).ToList();
        for (var index = 0; index < words.Count; index++)
        {
            var word = words[index];
            var previous = index > 0 ? words[index - 1] : string.Empty;

            if (LockWords.Contains(word) && LockLeads.Contains(previous))
                return false;

            if (word is "INSERT" or "UPDATE" or "DELETE" or "MERGE" or "INTO")
                return false;

            if (word == "NEXTVAL" || word == "VALUE" && previous == "NEXT")
                return false;
        }

        if (dialect == ESqlDialect.Db2 && tokens.Skip(start).Zip(tokens.Skip(start + 1)).Any(pair => pair.First.IsWord("TABLE") && pair.Second.Is("(")))
            return false;

        return true;
    }

    private static List<List<Token>> SplitStatements(List<Token> tokens)
    {
        var firstWord = tokens.FindIndex(token => token.Kind == ETokenKind.Word);
        if (firstWord >= 0 && tokens[firstWord].IsWord("CREATE"))
            return [tokens];

        var statements = new List<List<Token>> { new() };
        foreach (var token in tokens)
        {
            if (token.Is(";"))
                statements.Add([]);
            else
                statements[^1].Add(token);
        }

        statements.RemoveAll(statement => statement.Count == 0 || statement.All(token => token.Kind != ETokenKind.Word));

        return statements.Count == 0 ? [tokens] : statements;
    }

    private static string ActionAt(List<Token> list, int head)
    {
        var verb = list[head].Upper;
        if (verb is "CREATE" or "ALTER" or "DROP")
        {
            var index = head + 1;
            while (index < list.Count && list[index].Kind == ETokenKind.Word && ObjectModifiers.Contains(list[index].Upper))
                index++;

            if (index + 1 < list.Count && list[index].IsWord("MATERIALIZED") && list[index + 1].IsWord("VIEW"))
                return $"{verb} MATERIALIZED VIEW";

            if (index < list.Count && list[index].Kind == ETokenKind.Word && DdlObjects.Contains(list[index].Upper))
                return $"{verb} {list[index].Upper}";

            return verb;
        }

        if (verb == "UPDATE" && head + 1 < list.Count && list[head + 1].IsWord("STATISTICS"))
            return "UPDATE STATISTICS";

        if (verb == "EXPLAIN" && list.Skip(head + 1).Any(token => token.IsWord("ANALYZE") || token.IsWord("ANALYSE")))
            return "EXPLAIN ANALYZE";

        return verb;
    }

    private static string? NameAt(string sql, List<Token> list, int from)
    {
        var at = from;
        while (at < list.Count && list[at].Kind == ETokenKind.Word && ObjectWords.Contains(list[at].Upper))
            at++;

        if (at >= list.Count || list[at].Kind is not (ETokenKind.Word or ETokenKind.Identifier or ETokenKind.Text))
            return null;

        var first = list[at];
        var last = first;
        for (var next = at + 1; next + 1 < list.Count && list[next].Is(".") && list[next + 1].Kind is ETokenKind.Word or ETokenKind.Identifier or ETokenKind.Text; next += 2)
            last = list[next + 1];

        return sql[first.Start..last.End];
    }

    private static int[] DepthsOf(List<Token> list)
    {
        var depths = new int[list.Count];
        var depth = 0;

        for (var index = 0; index < list.Count; index++)
        {
            if (list[index].Is(")") && depth > 0)
                depth--;

            depths[index] = depth;
            if (list[index].Is("("))
                depth++;
        }

        return depths;
    }

    private static int EndOf(List<Token> list, int[] depths, int head)
    {
        for (var at = head + 1; at < list.Count; at++)
        {
            if (depths[at] < depths[head] || depths[at] == depths[head] && list[at].Is(";"))
                return at;
        }

        return list.Count;
    }

    private static bool HasWordAtTop(List<Token> list, int[] depths, int head, string word)
    {
        var end = EndOf(list, depths, head);
        for (var at = head + 1; at < end; at++)
        {
            if (depths[at] == depths[head] && list[at].IsWord(word))
                return true;
        }

        return false;
    }

    private static bool HasWordAnywhere(List<Token> list, int[] depths, int head, string word)
    {
        var end = EndOf(list, depths, head);
        for (var at = head + 1; at < end; at++)
        {
            if (list[at].IsWord(word))
                return true;
        }

        return false;
    }

    private static int FindExplainInner(List<Token> list, int[] depths, int firstWord)
    {
        for (var index = firstWord + 1; index < list.Count; index++)
        {
            if (list[index].Kind == ETokenKind.Word && depths[index] == depths[firstWord] && ExplainedWords.Contains(list[index].Upper))
                return index;
        }

        return -1;
    }

    private static bool HasAnalyzeBetween(List<Token> list, int from, int to)
    {
        for (var index = from; index < to; index++)
        {
            if (list[index].IsWord("ANALYZE") || list[index].IsWord("ANALYSE"))
                return true;
        }

        return false;
    }
}
