using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using System.Globalization;
using static Prism.Infrastructure.Databases.Clients.EditableSql;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-018, 020 e 023: a coluna inteira (`updateAll`) em cada banco, pura. O alvo é o resultado como ele é no momento do "Salvar": o comando que a API
/// executou para ele, com o filtro já junto (`<Q>`), sem o que vem depois do fim dele (o `;`, os comentários e os espaços), sempre seguido de uma quebra
/// de linha, para um `--` no fim dele não engolir o resto. Os nomes vão entre aspas duplas, a tabela com o esquema (no Informix, o dono), e os valores
/// em parâmetros, convertidos como os da edição por linha (RN-EDIT-006).
///
/// Três formas, escolhidas pelo comando e pelo banco, e nunca pela tela:
///
/// - **a direta**, do `SELECT` de uma tabela só, sem apelido, sem limite de linhas no nível de fora, em que o texto depois do nome da tabela é, por
///   inteiro, `[WHERE <condição>] [ORDER BY <lista>]` (o leitor do comando, RN-PROT-005, sem texto nem comentário). O comando é refeito com as partes e
///   conferido, sem espaços e sem comentários, contra o `<Q>`; qualquer dúvida vai para a forma pela chave. `SELECT COUNT(*) FROM "s"."t" WHERE <c>` e
///   `UPDATE "s"."t" SET "c" = ? WHERE <c>`, sem `WHERE` quando o leitor provou que não há nenhum no nível de fora;
/// - **a pela chave**, nos outros: o `<Q>` numa tabela derivada (`AS "q"`), a contagem das linhas dela, e o `UPDATE` pela chave da tabela, com cada
///   coluna da chave pelo nome que ela tem no resultado e SEMPRE com `"q".` na frente: sem ele, a coluna que o `<Q>` não devolve é procurada na tabela
///   do `UPDATE`, sem erro, e o `IN` casa com todas as linhas (provado nos três bancos). Uma coluna, `IN`; várias, `EXISTS` com a tabela como `"u"`;
/// - **o caminho por lotes do Informix**, quando o comando tem `LIMIT`, `OFFSET` ou `FETCH` no fim, no nível de fora, que a tabela derivada do
///   Informix recusa (-201): a contagem lê as chaves do próprio `<Q>` (até 1.000.000), e o `UPDATE` vai em lotes de até 1.000 chaves, como
///   parâmetros. O `LIMIT` logo depois do `SELECT` (`SELECT LIMIT 5 * ...`) é como o `FIRST`: a tabela derivada o aceita (sonda S-COL-1).
/// </summary>
internal static class WholeColumnSql
{
    /// <summary>As chaves de um lote do caminho por lotes: longe do teto do driver da IBM, que recusa 32.768 parâmetros ou mais.</summary>
    public const int KeysPerBatch = 1000;

    /// <summary>As chaves que o caminho por lotes guarda na memória, no máximo.</summary>
    public const int MaxKeys = 1_000_000;

    public const string CountNote = "A contagem confere, antes do UPDATE, que o comando ainda devolve as linhas confirmadas.";
    public const string BatchNote = "As chaves vão em lotes de até 1.000.";

    public const string JoinReason = "num resultado de junção, a coluna inteira não se altera: escolha as células da coluna (arraste, ou Shift+clique), e a edição vale para elas";
    public const string NotReadReason = "a coluna inteira executa de novo o comando do resultado, e ele não é só de leitura";
    public const string LimitReason = "o comando limita as linhas sem uma ordem, e o banco pode escolher outras linhas ao executar de novo: acrescente um ORDER BY, ou escolha as células da coluna";
    public const string SampleReason = "o comando sorteia as linhas, e o banco escolheria outras ao executar de novo: escolha as células da coluna";
    public const string TooManyKeysReason = "o comando devolve mais de 1.000.000 de linhas, e neste banco a coluna inteira de um comando com limite de linhas lê as chaves antes: tire o limite do comando, ou altere por partes";

    private const string QAlias = "\"q\"";
    private const string UAlias = "\"u\"";

    /// <summary>O que encerra a condição da forma direta no nível de fora: o que vier, e não for a condição, leva à forma pela chave.</summary>
    private static readonly HashSet<string> NotInTheCondition = ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", "UNION", "INTERSECT", "EXCEPT", "MINUS", "WINDOW", "WITH", "INTO", "OPTIMIZE", "TABLESAMPLE", "ONLY", "QUALIFY", "SKIP", "FIRST"];

    /// <summary>O mesmo para a lista do `ORDER BY` da forma direta. O `FIRST` só vale ali depois de `NULLS`.</summary>
    private static readonly HashSet<string> NotInTheOrder = ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "FETCH", "FOR", "UNION", "INTERSECT", "EXCEPT", "MINUS", "WINDOW", "WITH", "INTO", "OPTIMIZE", "TABLESAMPLE", "ONLY", "QUALIFY", "SKIP"];

    /// <summary>Os modificadores do Informix entre o `SELECT` e a lista, cada um com um número depois.</summary>
    private static readonly HashSet<string> InformixHead = ["SKIP", "FIRST", "LIMIT", "MIDDLE"];

    /// <summary>RN-EDIT-018: a coluna da chave na coluna inteira deixaria todas as linhas com a mesma chave.</summary>
    public static string KeyReason(string column, string table)
        => $"{column} é da chave de {table}: na coluna inteira, todas as linhas ficariam com a mesma chave";

    /// <summary>RN-EDIT-018 e 020: com o nome repetido no resultado, `"q"."id"` é ambíguo.</summary>
    public static string RepeatedKeyReason(string column, string table)
        => $"{column}, da chave de {table}, aparece com o mesmo nome em mais de uma coluna do resultado";

    /// <summary>RN-EDIT-021: a contagem do "Salvar" não deu as linhas confirmadas; nada foi executado.</summary>
    public static string CountChanged(long counted, long confirmed)
        => $"O resultado mudou desde a contagem: o comando devolve agora {Lines(counted)}, e não {Confirmed(confirmed)}. Nada foi gravado; salve de novo para contar outra vez.";

    /// <summary>RN-EDIT-021: o `UPDATE` não alterou as linhas confirmadas; tudo o que o "Salvar" fez foi desfeito.</summary>
    public static string UpdateChanged(long affected, long confirmed)
        => $"O resultado mudou desde a contagem: o comando alterou {Lines(affected)}, e não {Confirmed(confirmed)}. Nada foi gravado; salve de novo para contar outra vez. Se o número se repetir nas tentativas seguintes, o motivo pode ser um gatilho, uma regra ou uma cascata do banco, que a contagem não vê.";

    /// <summary>RN-EDIT-021: no Informix sem log, o `UPDATE` (ou um lote) alterou outro número de linhas, e ficou gravado.</summary>
    public static string WrittenAnyway(long affected, long confirmed)
        => $"A coluna inteira foi alterada em {Lines(affected)}, e não {(confirmed == 1 ? "na 1 contada" : $"nas {Number(confirmed)} contadas")}: o resultado mudou desde a contagem. Este banco não tem log de transação, e a alteração ficou gravada.";

    /// <summary>RN-EDIT-023: a recusa da coluna inteira, com o motivo da regra no `reason`, a posição dela no pedido e, quando é de uma coluna, a dela.</summary>
    public static DatabaseFailure NotSupported(string reason, int change, int? column = null)
        => new(EDatabaseFailure.EditAllRowsNotSupported, $"A coluna inteira não se altera neste resultado: {reason}.", Reason: reason, Change: change, Column: column);

    /// <summary>RN-EDIT-023: a posição da coluna inteira no pedido, ou nula sem ela. Há no máximo uma por pedido: a segunda é `EditInvalid`, com a posição dela.</summary>
    public static Result<int?, DatabaseFailure> Find(IReadOnlyList<EditChange> changes)
    {
        int? found = null;
        for (var index = 0; index < changes.Count; index++)
        {
            if (changes[index].Kind != EEditKind.UpdateAll)
                continue;

            if (found is not null)
                return new DatabaseFailure(EDatabaseFailure.EditInvalid, "O pedido tem mais de uma alteração da coluna inteira: mande uma só, com todas as colunas no set.", Change: index);

            found = index;
        }

        return found;
    }

    /// <summary>
    /// RN-EDIT-023: o pedido da contagem leva só a coluna inteira. Outra alteração na lista é `EditInvalid` com a posição dela; nenhuma coluna inteira, `EditInvalid`
    /// sem posição.
    /// </summary>
    public static Result<int, DatabaseFailure> OnlyOne(IReadOnlyList<EditChange> changes)
    {
        for (var index = 0; index < changes.Count; index++)
        {
            if (changes[index].Kind != EEditKind.UpdateAll)
                return new DatabaseFailure(EDatabaseFailure.EditInvalid, "A contagem leva só a alteração da coluna inteira (updateAll).", Change: index);
        }

        var found = Find(changes);
        if (found.IsFailure)
            return found.Error;

        return found.Value is { } position ? position : new DatabaseFailure(EDatabaseFailure.EditInvalid, "A contagem precisa da alteração da coluna inteira (updateAll).");
    }

    /// <summary>
    /// RN-EDIT-020: o `<Q>`: o comando como a API o executou, sem os `;` soltos nas pontas e sem o que o leitor do comando acha depois do último pedaço de
    /// código (comentários e espaços). O que vem antes do primeiro pedaço também sai: comentário e espaço, que não mudam nada.
    /// </summary>
    public static string Cleaned(string sql, ESqlDialect dialect)
    {
        var tokens = Lex(sql, dialect).ToList();
        var first = tokens.FindIndex(token => !token.Is(";"));
        var last = tokens.FindLastIndex(token => !token.Is(";"));

        return first < 0 ? string.Empty : sql[tokens[first].Start..tokens[last].End];
    }

    /// <summary>
    /// RN-EDIT-020 e 021: a coluna inteira pronta para ir ao banco, ou a recusa antes de qualquer comando (RN-EDIT-023): `EditInvalid` (a tabela, as
    /// colunas, o valor que não converte e, no "Salvar", o `rows` que falta ou não é um inteiro de 0 em diante) e `EditAllRowsNotSupported`, na ordem da
    /// RN-EDIT-018.
    /// </summary>
    /// <param name="sql">O comando do resultado como a API o executou, com o filtro junto; nulo quando ela não o tem (não é leitura).</param>
    /// <param name="read">A página do resultado disse que o comando é uma leitura e não gravou (o `read` da seção 6).</param>
    /// <param name="requiresRows">É o "Salvar": a alteração tem de trazer o número de linhas confirmado.</param>
    public static Result<WholeColumnPlan, DatabaseFailure> Plan(ESqlDialect dialect, string? sql, bool read, EditTarget target, IReadOnlyList<QueryColumn> columns, EditChange change, int index, bool requiresRows, IReadOnlyList<QueryParameter>? parameters = null)
    {
        if (requiresRows && change.Rows is null)
            return new DatabaseFailure(EDatabaseFailure.EditInvalid, "Informe quantas linhas a contagem deu (rows).", Change: index);

        if (requiresRows && change.Rows < 0)
            return new DatabaseFailure(EDatabaseFailure.EditInvalid, "O número de linhas (rows) tem de ser um inteiro de 0 em diante.", Change: index);

        var shaped = Shape(dialect, sql, read, target, columns, change, index, parameters);
        if (shaped.IsFailure)
            return shaped.Error;

        var shape = shaped.Value;
        var writer = new EditPlanner.Writer(dialect, preview: false);
        var assigned = Assignments(shape, writer, index);
        if (assigned.IsFailure)
            return assigned.Error;

        // RN-VAR-033: o caminho por lotes lê as chaves do próprio `<Q>`, com os valores dele; os lotes levam só o `SET` e as chaves.
        if (shape.Form == EForm.Batches)
            return new WholeColumnPlan(index, change.Rows, shape.Q, null, shape.Table.Key, keys => Batches(dialect, shape, keys, index), shape.Parameters);

        var statements = Statements(shape, assigned.Value, writer.Parameters.Count);

        return new WholeColumnPlan(index, change.Rows, statements.Count, new EditCommand(index, statements.Update, [.. writer.Parameters, .. statements.UpdateValues.Select(value => new EditParameter(null, Query: value))]), CountParameters: statements.CountValues);
    }

    /// <summary>
    /// RN-EDIT-008 e 023: o "Ver SQL" da coluna inteira, sem executar nada: a contagem e o `UPDATE`, com o valor como literal (ou `?`, com o valor em
    /// `values`, quando ele não tem literal). No caminho por lotes, o comando que lê as chaves (o próprio `<Q>`) e o `UPDATE` do primeiro lote, com `?`
    /// no lugar das chaves.
    /// </summary>
    public static Result<IReadOnlyList<EditStatement>, DatabaseFailure> Preview(ESqlDialect dialect, string? sql, bool read, EditTarget target, IReadOnlyList<QueryColumn> columns, EditChange change, int index, IReadOnlyList<QueryParameter>? parameters = null)
    {
        var shaped = Shape(dialect, sql, read, target, columns, change, index, parameters);
        if (shaped.IsFailure)
            return shaped.Error;

        var shape = shaped.Value;
        var writer = new EditPlanner.Writer(dialect, preview: true);
        var assigned = Assignments(shape, writer, index);
        if (assigned.IsFailure)
            return assigned.Error;

        if (shape.Form == EForm.Batches)
        {
            var keys = shape.Table.Key.Select(position => EditPlanner.Quote(target.Columns[position].BaseColumn!)).ToList();
            var condition = keys.Count == 1 ? $"{keys[0]} IN (?, ?, …)" : $"({string.Join(" AND ", keys.Select(key => $"{key} = ?"))}) OR …";

            var reading = Literals(shape, 0, shape.Q.Length);

            return Result.Success<IReadOnlyList<EditStatement>, DatabaseFailure>([new EditStatement(reading.Text, reading.Unwritten, CountNote), new EditStatement($"UPDATE {shape.Name} SET {assigned.Value} WHERE {condition}", writer.Unwritten, BatchNote)]);
        }

        var statements = Statements(shape, assigned.Value, setCount: 0, preview: true);

        return Result.Success<IReadOnlyList<EditStatement>, DatabaseFailure>([new EditStatement(statements.Count, statements.CountUnwritten, CountNote), new EditStatement(statements.Update, [.. writer.Unwritten, .. statements.UpdateUnwritten])]);
    }

    /// <summary>A forma que o comando leva, pelo texto e pelo banco (RN-EDIT-020). Para os testes do leitor, sem o resto do plano.</summary>
    internal static EForm FormOf(string sql, ESqlDialect dialect, bool singleTableWithoutAlias)
        => Read(Cleaned(sql, dialect), dialect, singleTableWithoutAlias).Form;

    /// <summary>A condição da forma direta, como a pessoa a escreveu, ou nula (sem `WHERE`, ou outra forma). Para os testes do leitor.</summary>
    internal static string? DirectConditionOf(string sql, ESqlDialect dialect)
        => Read(Cleaned(sql, dialect), dialect, singleTableWithoutAlias: true).Condition;

    /// <summary>As recusas da RN-EDIT-018, na ordem dela, e a forma do comando.</summary>
    private static Result<WholeColumnShape, DatabaseFailure> Shape(ESqlDialect dialect, string? sql, bool read, EditTarget target, IReadOnlyList<QueryColumn> columns, EditChange change, int index, IReadOnlyList<QueryParameter>? parameters)
    {
        DatabaseFailure Invalid(string message, int? column = null)
            => new(EDatabaseFailure.EditInvalid, message, Change: index, Column: column);

        if (change.Table < 0 || change.Table >= target.Tables.Count)
            return Invalid("A tabela da alteração não existe neste resultado.");

        var table = target.Tables[change.Table];
        if (!table.Editable)
            return Invalid($"A tabela da alteração não se edita: {table.Reason}.");

        if (!target.RowOperations)
            return NotSupported(JoinReason, index);

        if (change.Values.Count == 0)
            return Invalid("A alteração da coluna inteira não tem nenhuma coluna.");

        var set = new List<(EditColumn Column, int Position, string? Value)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in change.Values)
        {
            if (value.Column < 0 || value.Column >= target.Columns.Count || value.Column >= columns.Count)
                return Invalid("A coluna não existe no resultado.", value.Column);

            var column = target.Columns[value.Column];
            if (column.Editable && column.Table != change.Table)
                return Invalid("A coluna não é da tabela da alteração.", value.Column);

            if (!column.Editable)
                return Invalid($"A coluna não se edita: {column.Reason}.", value.Column);

            if (!seen.Add(column.BaseColumn!))
                return Invalid("A mesma coluna aparece duas vezes na alteração.", value.Column);

            if (table.Key.Any(position => target.Columns[position].BaseColumn == column.BaseColumn))
                return NotSupported(KeyReason(column.BaseColumn!, table.Name), index, value.Column);

            set.Add((column, value.Column, value.Value));
        }

        foreach (var position in table.Key)
        {
            if (columns.Count(column => column.Name == columns[position].Name) > 1)
                return NotSupported(RepeatedKeyReason(columns[position].Name, table.Name), index, position);
        }

        var q = sql is null ? string.Empty : Cleaned(sql, dialect);
        if (!read || q.Length == 0 || ReadOnlySql.Refusal(q, dialect, singleStatement: true) is not null)
            return NotSupported(NotReadReason, index);

        var command = Read(q, dialect, singleTableWithoutAlias: target.Tables.Count == 1);
        if (command.LimitWithoutOrder)
            return NotSupported(LimitReason, index);

        if (command.Sample)
            return NotSupported(SampleReason, index);

        // RN-VAR-033: cada marcador do `<Q>`, com a posição, para numerar de novo os que ficam em cada forma.
        var values = parameters ?? [];

        return new WholeColumnShape(dialect, table, target, columns, set, q, command.Form, command.Condition, command.ConditionStart, values, values.Count == 0 ? [] : ParameterMarkers.Find(q, dialect));
    }

    /// <summary>O `SET`: uma atribuição por coluna, na ordem do pedido, com o valor em parâmetro (ou como literal, no "Ver SQL").</summary>
    private static Result<string, DatabaseFailure> Assignments(WholeColumnShape shape, EditPlanner.Writer writer, int index)
    {
        var assigned = new List<string>();
        foreach (var (column, position, value) in shape.Set)
        {
            var written = writer.Value(column, shape.Columns[position].Kind, value);
            if (written.IsFailure)
                return new DatabaseFailure(EDatabaseFailure.EditInvalid, written.Error, Change: index, Column: position);

            assigned.Add($"{EditPlanner.Quote(column.BaseColumn!)} = {written.Value}");
        }

        return string.Join(", ", assigned);
    }

    /// <summary>
    /// A contagem e o `UPDATE` da forma direta e da forma pela chave, com os parâmetros do `<Q>` numerados de novo, na ordem do texto final (RN-VAR-033): no
    /// PostgreSQL, os do `SET` são `$1` a `$k` e os do `<Q>` que ficam passam a `$k+1` em diante, sem buraco (na forma direta, só a condição fica, e os marcadores
    /// fora dela, no `SELECT` por exemplo, saem com os valores); a contagem não tem `SET`, e a dela começa em `$1`. No Db2 e no Informix, os `?` do `SET` e depois os
    /// do `<Q>` que ficaram, na ordem. No "Ver SQL" (`preview`) cada marcador vira o literal do valor, ou `?` com o valor ao lado quando ele não tem literal.
    /// </summary>
    private static StatementSet Statements(WholeColumnShape shape, string assignments, int setCount, bool preview = false)
    {
        if (shape.Form == EForm.Direct)
        {
            if (shape.Condition is not { } condition)
                return new StatementSet($"SELECT COUNT(*) FROM {shape.Name}", $"UPDATE {shape.Name} SET {assignments}", [], [], [], []);

            var end = shape.ConditionStart + condition.Length;
            var counting = preview ? Literals(shape, shape.ConditionStart, end) : Numbered(shape, shape.ConditionStart, end, offset: 0);
            var updating = preview ? counting : Numbered(shape, shape.ConditionStart, end, offset: setCount);

            return new StatementSet($"SELECT COUNT(*) FROM {shape.Name} WHERE {counting.Text}\n", $"UPDATE {shape.Name} SET {assignments} WHERE {updating.Text}\n", counting.Values, updating.Values, counting.Unwritten, updating.Unwritten);
        }

        // A contagem leva o `<Q>` inteiro como está, com todos os valores; o `UPDATE`, o `<Q>` com os marcadores numerados depois dos do `SET`.
        var counted = preview ? Literals(shape, 0, shape.Q.Length) : new Numbering(shape.Q, shape.Parameters, []);
        var updated = preview ? counted : Numbered(shape, 0, shape.Q.Length, offset: setCount);
        var countDerived = $"(\n{counted.Text}\n) AS {QAlias}";
        var updateDerived = $"(\n{updated.Text}\n) AS {QAlias}";
        var count = $"SELECT COUNT(*) FROM {countDerived}";
        var keys = shape.Table.Key.Select(position => (Base: EditPlanner.Quote(shape.Target.Columns[position].BaseColumn!), Output: $"{QAlias}.{EditPlanner.Quote(shape.Columns[position].Name)}")).ToList();

        if (keys.Count == 1)
            return new StatementSet(count, $"UPDATE {shape.Name} SET {assignments}\nWHERE {keys[0].Base} IN (SELECT {keys[0].Output} FROM {updateDerived})", counted.Values, updated.Values, counted.Unwritten, updated.Unwritten);

        return new StatementSet(count, $"UPDATE {shape.Name} AS {UAlias} SET {assignments}\nWHERE EXISTS (SELECT 1 FROM {updateDerived} WHERE {string.Join(" AND ", keys.Select(key => $"{key.Output} = {UAlias}.{key.Base}"))})", counted.Values, updated.Values, counted.Unwritten, updated.Unwritten);
    }

    /// <summary>
    /// RN-VAR-033: o pedaço `[from, to)` do `<Q>` (ele todo, ou a condição da forma direta) com os marcadores numerados de novo depois dos `offset` do `SET`, e os valores
    /// deles, na ordem dos números novos. No PostgreSQL a ordem é a da primeira vez que cada `$n` aparece no pedaço (os repetidos ficam repetidos, com o mesmo número); no
    /// Db2 e no Informix, o texto não muda e os valores são os dos `?` do pedaço, pela posição de cada um no `<Q>` inteiro.
    /// </summary>
    private static Numbering Numbered(WholeColumnShape shape, int from, int to, int offset)
    {
        var inside = shape.Markers.Where(marker => marker.Start >= from && marker.End <= to).ToList();
        if (inside.Count == 0)
            return new Numbering(shape.Q[from..to], [], []);

        if (shape.Dialect != ESqlDialect.PostgreSql)
            return new Numbering(shape.Q[from..to], [.. inside.Select(marker => shape.Parameters[marker.Index])], []);

        var order = ParameterMarkers.DistinctNumbers(inside);
        var numbers = order.Select((number, position) => (number, position)).ToDictionary(item => item.number, item => offset + item.position + 1);
        var text = ParameterMarkers.Rewrite(shape.Q[from..to], [.. inside.Select(marker => marker with { Start = marker.Start - from, End = marker.End - from })], marker => $"${numbers[marker.Number]}");

        return new Numbering(text, [.. order.Select(number => shape.Parameters[number - 1])], []);
    }

    /// <summary>RN-EDIT-008 e RN-VAR-033: o mesmo pedaço para o "Ver SQL", cada marcador com o literal do valor; sem literal, `?` e o valor em `Unwritten`.</summary>
    private static Numbering Literals(WholeColumnShape shape, int from, int to)
    {
        var inside = shape.Markers.Where(marker => marker.Start >= from && marker.End <= to).ToList();
        var unwritten = new List<string?>();
        var text = ParameterMarkers.Rewrite(shape.Q[from..to], [.. inside.Select(marker => marker with { Start = marker.Start - from, End = marker.End - from })], marker =>
        {
            var parameter = shape.Parameters[shape.Dialect == ESqlDialect.PostgreSql ? marker.Number - 1 : marker.Index];
            if (QueryParameterBinding.Literal(shape.Dialect, parameter) is { } literal)
                return literal;

            unwritten.Add(parameter.Value);

            return "?";
        });

        return new Numbering(text, [], unwritten);
    }

    /// <summary>
    /// RN-EDIT-020: os lotes do caminho por chaves, das chaves lidas (os textos como a grade os escreve, convertidos de volta como as chaves da edição por
    /// linha): cada lote com o `SET` e até 1.000 chaves, todos os valores em parâmetros.
    /// </summary>
    private static Result<IReadOnlyList<WholeColumnBatch>, DatabaseFailure> Batches(ESqlDialect dialect, WholeColumnShape shape, IReadOnlyList<IReadOnlyList<string>> keys, int index)
    {
        var batches = new List<WholeColumnBatch>();
        var names = shape.Table.Key.Select(position => EditPlanner.Quote(shape.Target.Columns[position].BaseColumn!)).ToList();

        foreach (var chunk in keys.Chunk(KeysPerBatch))
        {
            var writer = new EditPlanner.Writer(dialect, preview: false);
            var assigned = Assignments(shape, writer, index);
            if (assigned.IsFailure)
                return assigned.Error;

            var conditions = new List<string>();
            foreach (var key in chunk)
            {
                var parts = new List<string>();
                for (var part = 0; part < names.Count; part++)
                {
                    var position = shape.Table.Key[part];
                    var written = writer.Value(shape.Target.Columns[position], shape.Columns[position].Kind, key[part]);
                    if (written.IsFailure)
                        return new DatabaseFailure(EDatabaseFailure.EditInvalid, written.Error, Change: index, Column: position);

                    parts.Add(names.Count == 1 ? written.Value : $"{names[part]} = {written.Value}");
                }

                conditions.Add(names.Count == 1 ? parts[0] : $"({string.Join(" AND ", parts)})");
            }

            var where = names.Count == 1 ? $"{names[0]} IN ({string.Join(", ", conditions)})" : string.Join(" OR ", conditions);
            batches.Add(new WholeColumnBatch(new EditCommand(index, $"UPDATE {shape.Name} SET {assigned.Value} WHERE {where}", writer.Parameters), chunk.Length));
        }

        return batches;
    }

    /// <summary>
    /// O que o leitor do comando (RN-PROT-005) diz do `<Q>`: o limite de linhas sem `ORDER BY` no mesmo nível (no de fora ou dentro de parênteses), o
    /// `TABLESAMPLE` e a forma. Uma palavra qualificada (`t.limit`) não conta, e o que está em texto, identificador entre aspas ou comentário também não.
    /// </summary>
    private static CommandRead Read(string q, ESqlDialect dialect, bool singleTableWithoutAlias)
    {
        var tokens = Lex(q, dialect).ToList();
        var scopes = new Stack<Scope>();
        var outer = new Scope();
        scopes.Push(outer);
        var limitWithoutOrder = false;
        var sample = false;

        for (var index = 0; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token.Is("("))
            {
                scopes.Push(new Scope());
                continue;
            }

            if (token.Is(")"))
            {
                if (scopes.Count > 1 && scopes.Pop() is var closed)
                    limitWithoutOrder |= closed.Limit && !closed.Order;

                continue;
            }

            if (token.Kind != ETokenKind.Word || Qualified(tokens, index))
                continue;

            var scope = scopes.Peek();
            switch (token.Upper)
            {
                case "ORDER" when NextIs(tokens, index, "BY"):
                    scope.Order = true;
                    break;
                case "LIMIT" or "OFFSET":
                case "FETCH" when NextIs(tokens, index, "FIRST") || NextIs(tokens, index, "NEXT"):
                    scope.Limit = scope.Tail = true;
                    break;
                case "TABLESAMPLE":
                    sample = true;
                    break;
                case "SELECT" when dialect == ESqlDialect.Informix:
                    // `SELECT SKIP 2 FIRST 5 ...` e `SELECT LIMIT 5 ...`: os modificadores da cabeça, cada um com um número depois. A tabela derivada os
                    // aceita, também o `LIMIT` da cabeça (provado na sonda S-COL-1), e eles não levam ao caminho por lotes.
                    while (index + 2 < tokens.Count && tokens[index + 1].Kind == ETokenKind.Word && InformixHead.Contains(tokens[index + 1].Upper) && IsCount(tokens[index + 2]))
                    {
                        scope.Limit = true;
                        index += 2;
                    }

                    break;
            }
        }

        limitWithoutOrder |= outer.Limit && !outer.Order;

        if (dialect == ESqlDialect.Informix && outer.Tail)
            return new CommandRead(limitWithoutOrder, sample, EForm.Batches, null, 0);

        if (singleTableWithoutAlias && !outer.Limit && !sample && Direct(q, tokens, dialect) is { Valid: true } direct)
            return new CommandRead(limitWithoutOrder, sample, EForm.Direct, direct.Condition, direct.ConditionStart);

        return new CommandRead(limitWithoutOrder, sample, EForm.Key, null, 0);
    }

    /// <summary>
    /// A forma direta, que falha para o lado seguro: o texto depois do nome da tabela é, por inteiro e no nível de fora, `[WHERE <condição>] [ORDER BY
    /// <lista>]`, sem apelido; o comando refeito com as partes é o `<Q>`, sem espaços e sem comentários; e, no Db2, a leitura do driver vê os mesmos
    /// pedaços que a do banco. A condição é nula sem `WHERE`.
    /// </summary>
    private static DirectRead Direct(string q, List<Token> tokens, ESqlDialect dialect)
    {
        if (tokens.Count == 0 || !tokens[0].IsWord("SELECT"))
            return DirectRead.None;

        if (dialect == ESqlDialect.Db2 && !Lex(q, dialect, asTheDriver: true).Select(Piece).SequenceEqual(tokens.Select(Piece)))
            return DirectRead.None;

        var from = DepthZero(tokens, 1).FirstOrDefault(position => tokens[position].IsWord("FROM") && !Qualified(tokens, position), -1);
        if (from < 0)
            return DirectRead.None;

        // O nome da tabela, `tabela` ou `esquema.tabela`, sem nada além dele antes do `WHERE` ou do `ORDER BY`.
        var position = from + 1;
        if (position >= tokens.Count || !IsName(tokens[position]))
            return DirectRead.None;

        position++;
        if (position + 1 < tokens.Count && tokens[position].Is(".") && IsName(tokens[position + 1]))
            position += 2;

        var tableEnd = position;
        int? where = null;
        int? order = null;
        if (position < tokens.Count && tokens[position].IsWord("WHERE"))
        {
            where = position;
            order = DepthZero(tokens, position + 1).Where(index => IsOrderBy(tokens, index)).Select(index => (int?)index).FirstOrDefault();
        }
        else if (position < tokens.Count && IsOrderBy(tokens, position))
            order = position;
        else if (position < tokens.Count)
            return DirectRead.None;

        string? condition = null;
        var conditionStart = 0;
        if (where is { } whereAt)
        {
            var end = order ?? tokens.Count;
            if (end <= whereAt + 1 || DepthZero(tokens, whereAt + 1, end).Any(index => tokens[index].Kind == ETokenKind.Word && !Qualified(tokens, index) && NotInTheCondition.Contains(tokens[index].Upper)))
                return DirectRead.None;

            conditionStart = tokens[whereAt + 1].Start;
            condition = q[conditionStart..tokens[end - 1].End];
        }

        string? list = null;
        if (order is { } orderAt)
        {
            if (orderAt + 2 >= tokens.Count || DepthZero(tokens, orderAt + 2).Any(index => tokens[index].Kind == ETokenKind.Word && !Qualified(tokens, index) && (NotInTheOrder.Contains(tokens[index].Upper) || tokens[index].Upper == "FIRST" && !tokens[index - 1].IsWord("NULLS"))))
                return DirectRead.None;

            list = q[tokens[orderAt + 2].Start..tokens[^1].End];
        }

        // O comando refeito com as partes achadas tem de ser o mesmo, pedaço por pedaço: o que o leitor pulou (ou leu errado) leva à forma pela chave.
        var rebuilt = q[..tokens[tableEnd - 1].End] + (condition is null ? string.Empty : $"\nWHERE {condition}") + (list is null ? string.Empty : $"\nORDER BY {list}");
        if (!Lex(rebuilt, dialect).Select(Piece).SequenceEqual(tokens.Select(Piece)))
            return DirectRead.None;

        return new DirectRead(true, condition, conditionStart);
    }

    private static string Lines(long count)
        => count == 1 ? "1 linha" : $"{Number(count)} linhas";

    private static string Confirmed(long count)
        => count == 1 ? "a 1 confirmada" : $"as {Number(count)} confirmadas";

    /// <summary>O número como a tela o escreve, com o ponto separando os milhares.</summary>
    private static string Number(long count)
        => count.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', '.');

    /// <summary>Um pedaço do texto como o banco o compara: a palavra sem diferença de maiúsculas (o `WHERE` refeito vale pelo `where` escrito), o resto como está.</summary>
    private static (ETokenKind Kind, string Text) Piece(Token token)
        => (token.Kind, token.Kind == ETokenKind.Word ? token.Upper : token.Text);

    /// <summary>As posições do nível de fora, de `start` até antes de `end`.</summary>
    private static IEnumerable<int> DepthZero(List<Token> tokens, int start, int? end = null)
    {
        var depth = 0;
        for (var index = start; index < (end ?? tokens.Count); index++)
        {
            if (tokens[index].Is("("))
                depth++;
            else if (tokens[index].Is(")"))
                depth--;
            else if (depth == 0)
                yield return index;
        }
    }

    private static bool IsOrderBy(List<Token> tokens, int index)
        => tokens[index].IsWord("ORDER") && NextIs(tokens, index, "BY") && !Qualified(tokens, index);

    private static bool NextIs(List<Token> tokens, int index, string word)
        => index + 1 < tokens.Count && tokens[index + 1].IsWord(word);

    /// <summary>A palavra é parte de um nome qualificado (`t.limit`, `limit.x`), e não palavra do comando.</summary>
    private static bool Qualified(List<Token> tokens, int index)
        => index > 0 && tokens[index - 1].Is(".") || index + 1 < tokens.Count && tokens[index + 1].Is(".");

    private static bool IsName(Token token)
        => token.Kind == ETokenKind.Identifier || token.Kind == ETokenKind.Word && token.Upper is not ("WHERE" or "ORDER" or "ONLY" or "TABLE" or "LATERAL");

    /// <summary>O número de um modificador do Informix: uma constante ou um parâmetro.</summary>
    private static bool IsCount(Token token)
        => token.Kind == ETokenKind.Word && char.IsAsciiDigit(token.Text[0]) || token.Is("?");

    internal enum EForm
    {
        Direct,
        Key,
        Batches
    }

    private sealed class Scope
    {
        public bool Limit;
        public bool Order;

        /// <summary>`LIMIT`, `OFFSET` ou `FETCH` depois da lista.</summary>
        public bool Tail;
    }

    private sealed record DirectRead(bool Valid, string? Condition, int ConditionStart)
    {
        public static readonly DirectRead None = new(false, null, 0);
    }

    private sealed record CommandRead(bool LimitWithoutOrder, bool Sample, EForm Form, string? Condition, int ConditionStart);

    /// <summary>RN-VAR-033: um pedaço do `&lt;Q&gt;` com os marcadores numerados de novo, os valores deles (na ordem) e, no "Ver SQL", os valores dos `?` sem literal. Não se imprime.</summary>
    private sealed record Numbering(string Text, IReadOnlyList<QueryParameter> Values, IReadOnlyList<string?> Unwritten)
    {
        public override string ToString() => nameof(Numbering);
    }

    /// <summary>A contagem e o `UPDATE`, com os valores do `&lt;Q&gt;` de cada um (e, no "Ver SQL", os dos `?` sem literal). Não se imprime.</summary>
    private sealed record StatementSet(string Count, string Update, IReadOnlyList<QueryParameter> CountValues, IReadOnlyList<QueryParameter> UpdateValues, IReadOnlyList<string?> CountUnwritten, IReadOnlyList<string?> UpdateUnwritten)
    {
        public override string ToString() => nameof(StatementSet);
    }

    /// <summary>A coluna inteira já conferida: a tabela, as colunas do `SET` (com a posição no resultado e o valor), o `<Q>` e a forma.</summary>
    private sealed record WholeColumnShape(ESqlDialect Dialect, EditTable Table, EditTarget Target, IReadOnlyList<QueryColumn> Columns, IReadOnlyList<(EditColumn Column, int Position, string? Value)> Set, string Q, EForm Form, string? Condition, int ConditionStart, IReadOnlyList<QueryParameter> Parameters, IReadOnlyList<ParameterMarker> Markers)
    {
        public string Name => $"{EditPlanner.Quote(Table.Schema)}.{EditPlanner.Quote(Table.Name)}";

        /// <summary>RN-LOG-001: o comando e os valores não se imprimem.</summary>
        public override string ToString()
            => nameof(WholeColumnShape);
    }
}
