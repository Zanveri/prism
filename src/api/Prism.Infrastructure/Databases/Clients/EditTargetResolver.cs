using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-002 e 003: o que se edita num resultado, tabela por tabela do `FROM` e coluna por coluna, a partir da leitura do comando
/// (<see cref="EditableSql"/>), das colunas que o banco devolveu e do catálogo de cada tabela. No PostgreSQL de onde vem cada coluna é o
/// banco que diz, na resposta (a tabela e o número da coluna, <see cref="ColumnOrigin"/>); no Db2 e no Informix é a lista do `SELECT`
/// (`*` são as colunas de cada tabela na ordem do catálogo, tabela por tabela, na ordem do `FROM`; a coluna sem tabela é da única tabela
/// que a tem), e o resultado tem de bater com ela (o número de colunas e o nome de cada uma, como o banco os devolve): se não bate, o
/// resultado inteiro é só leitura.
///
/// Cada tabela se edita quando é tabela (e não visão, visão materializada, tabela estrangeira, sinônimo ou apelido), aparece uma vez só no
/// `FROM` (pelo nome: a mesma tabela duas vezes, ou duas de mesmo nome em esquemas diferentes, ficam só leitura) e tem uma chave inteira
/// no resultado, como colunas dela: a primária, ou uma restrição ou índice único sem condição, só de colunas e com todas elas não nulas. A
/// coluna se edita quando vem de uma tabela que se edita e não é calculada no comando, gerada sempre pelo banco, binária, de um tipo que o
/// Prism ainda não converte naquele banco nem, num resultado de junção, uma coluna da chave. Adicionar, duplicar e excluir linha, só no
/// resultado de uma tabela só.
/// </summary>
internal static class EditTargetResolver
{
    private const string Computed = "coluna calculada";
    private const string GeneratedByTheDatabase = "gerada pelo banco";
    private const string Binary = "coluna binária";
    private const string UnsupportedType = "o Prism ainda não edita este tipo neste banco";
    private const string KeyInAJoin = "coluna da chave numa junção";
    private const string Ambiguous = "a coluna sem tabela pode ser de mais de uma tabela do comando";

    /// <param name="catalogs">O que o catálogo achou de cada tabela do `FROM`, na mesma ordem; nulo na que ele não acha como tabela nem visão. Nulo no todo: o catálogo não foi consultado (o resultado inteiro é só leitura).</param>
    public static Result<EditTarget, DatabaseFailure> Resolve(ESqlDialect dialect, ResultSource source, IReadOnlyList<QueryColumn> columns, IReadOnlyList<EditCatalogTable?>? catalogs)
    {
        if (source.Reason is not null || source.Tables.Count == 0 || catalogs is null || catalogs.Count != source.Tables.Count)
            return NotEditable(source.Reason ?? EditableSql.UnknownOrigin);

        // O resultado de uma tabela só que o catálogo não achou (um sinônimo): todas as colunas são dela, e só leitura.
        var origins = catalogs is [null] ? [.. columns.Select(_ => new Origin(0, null, null))] : dialect == ESqlDialect.PostgreSql ? PostgresOrigins(columns, catalogs) : SelectListOrigins(source, columns, catalogs);
        if (origins is null)
            return NotEditable(EditableSql.UnknownOrigin);

        var join = source.Tables.Count > 1;
        var names = source.Tables.Select((table, index) => catalogs[index]?.Name ?? table.Name.Name).ToList();
        var tables = new List<EditTable>();
        for (var index = 0; index < source.Tables.Count; index++)
        {
            var catalog = catalogs[index];
            var name = names[index];
            var kind = KindOf(catalog);
            var reason = kind switch
            {
                EditTableKind.Table => null,
                EditTableKind.View => $"{name} é uma visão",
                EditTableKind.MaterializedView => $"{name} é uma visão materializada",
                EditTableKind.Foreign => $"{name} é uma tabela estrangeira",
                EditTableKind.Elsewhere => $"{name}, escrita sem esquema, leva agora a outra tabela na sessão",
                _ => $"{name} não é uma tabela"
            };

            if (reason is null && names.Count(other => other == name) > 1)
                reason = $"{name} aparece mais de uma vez no comando";

            // RN-GRADE-020: a chave pelo nome, para o "Gerar SQL": a que a edição usa, quando ela acha uma; senão, a primeira candidata.
            IReadOnlyList<int> key = [];
            IReadOnlyList<string> keyColumns = kind == EditTableKind.Table ? CandidateKeys(catalog!).FirstOrDefault()?.Columns ?? [] : [];
            if (reason is null)
            {
                var table = index;
                (key, var used, reason) = KeyOf(dialect, name, catalog!, [.. origins.Select(origin => origin.Table == table ? origin.Column : null)], columns);
                keyColumns = used?.Columns ?? keyColumns;
            }

            tables.Add(new EditTable(catalog?.Schema ?? source.Tables[index].Name.Schema ?? string.Empty, name, key, reason is null, reason, kind, keyColumns));
        }

        var editColumns = columns.Select((column, index) =>
        {
            var (table, origin, why) = origins[index];
            // Num resultado de uma tabela só que não se edita, a calculada também diz o motivo da tabela.
            if (table is not { } position)
                return new EditColumn(null, null, false, why ?? (join || tables[0].Editable ? Computed : tables[0].Reason), true, null, null);

            if (origin is null)
                return new EditColumn(position, null, false, tables[position].Reason, true, null, null);

            var reason = tables[position].Reason ?? ColumnReason(dialect, origin, column);
            if (reason is null && join && tables[position].Key.Any(key => origins[key].Column?.Name == origin.Name))
                reason = KeyInAJoin;

            return new EditColumn(position, origin.Name, reason is null, reason, origin.IsNullable, GenerationOf(dialect, origin), origin.Type);
        });

        return new EditTarget(tables, [.. editColumns], !join && tables[0].Editable, catalogs.Any(catalog => catalog?.OneAtATime == true));
    }

    /// <summary>
    /// RN-GRADE-020 e RN-PROT-002: o alvo do "Gerar SQL" numa conexão somente leitura. As tabelas, as chaves e as colunas são as de uma conexão comum, e nada
    /// se edita: todas as tabelas e colunas com o motivo, e sem "Adicionar linha", "Duplicar linha" e "Excluir linha". A chave da edição (`Key`) fica como
    /// estava; quem a usaria é o "Salvar", que a conexão recusa.
    /// </summary>
    public static EditTarget ReadOnly(EditTarget target, string reason)
        => target with
        {
            Tables = [.. target.Tables.Select(table => table with { Editable = false, Reason = reason })],
            Columns = [.. target.Columns.Select(column => column with { Editable = false, Reason = reason })],
            RowOperations = false
        };

    /// <summary>O alvo de agora é o mesmo do da consulta: as tabelas, as chaves e o que cada coluna é. É o que o "Salvar" confere no catálogo, dentro da transação.</summary>
    public static bool Same(EditTarget before, EditTarget now)
        => before.RowOperations == now.RowOperations
           && before.OneAtATime == now.OneAtATime
           && before.Tables.Count == now.Tables.Count
           && before.Tables.Zip(now.Tables).All(pair => pair.First.Schema == pair.Second.Schema && pair.First.Name == pair.Second.Name && pair.First.Editable == pair.Second.Editable && pair.First.Key.SequenceEqual(pair.Second.Key))
           && before.Columns.SequenceEqual(now.Columns);

    private static Result<EditTarget, DatabaseFailure> NotEditable(string reason)
        => new DatabaseFailure(EDatabaseFailure.ResultNotEditable, $"Somente leitura: {reason}.", Reason: reason);

    /// <summary>
    /// De onde vem uma coluna do resultado: a tabela (a posição dela no `FROM`) e a coluna dela no catálogo. Sem tabela é coluna
    /// calculada, ou a que não se sabe de que tabela é (`Reason`); com tabela e sem coluna, a tabela é uma que o catálogo não achou.
    /// </summary>
    private readonly record struct Origin(int? Table, ColumnInfo? Column, string? Reason);

    /// <summary>
    /// No PostgreSQL, pelo identificador da tabela e o número da coluna que a resposta do comando traz. A tabela que aparece duas vezes
    /// fica com a primeira posição (as duas ficam só leitura); a coluna de uma tabela que não está no `FROM` é calculada.
    /// </summary>
    private static Origin[] PostgresOrigins(IReadOnlyList<QueryColumn> columns, IReadOnlyList<EditCatalogTable?> catalogs)
        => [.. columns.Select(column =>
        {
            if (column.Origin is not { Table: not 0 } origin)
                return default;

            for (var index = 0; index < catalogs.Count; index++)
            {
                if (catalogs[index] is { } catalog && catalog.Id == origin.Table)
                    return catalog.Columns.FirstOrDefault(info => info.Position == origin.Column) is { } info ? new Origin(index, info, null) : default;
            }

            return default;
        })];

    /// <summary>
    /// No Db2 e no Informix, pela lista do `SELECT`. Nulo no todo quando o resultado não bate com ela, quando o qualificador de um `*` não
    /// é de nenhuma tabela do `FROM`, ou quando um `*` passa por uma tabela que o catálogo não achou (não se sabe quantas colunas ela tem):
    /// o Prism não sabe de onde vêm as colunas.
    /// </summary>
    private static Origin[]? SelectListOrigins(ResultSource source, IReadOnlyList<QueryColumn> columns, IReadOnlyList<EditCatalogTable?> catalogs)
    {
        var expanded = new List<(Origin Origin, string? Name)>();
        bool AddAllOf(int table)
        {
            if (catalogs[table] is not { } catalog)
                return false;

            expanded.AddRange(catalog.Columns.Select(column => (new Origin(table, column, null), (string?)column.Name)));

            return true;
        }

        foreach (var item in source.Items)
        {
            switch (item)
            {
                case SelectItem.All:
                    for (var table = 0; table < source.Tables.Count; table++)
                    {
                        if (!AddAllOf(table))
                            return null;
                    }

                    break;
                case SelectItem.AllOf all:
                    if (TableOf(source, catalogs, all.Qualifier) is not { } named || !AddAllOf(named))
                        return null;

                    break;
                case SelectItem.Column { Qualifier.Count: > 0 } column:
                    expanded.Add(QualifiedOrigin(source, catalogs, column));
                    break;
                case SelectItem.Column column:
                    expanded.Add(UnqualifiedOrigin(catalogs, column));
                    break;
                default:
                    expanded.Add((default, null));
                    break;
            }
        }

        if (expanded.Count != columns.Count || expanded.Where((item, index) => item.Name is not null && item.Name != columns[index].Name).Any())
            return null;

        return [.. expanded.Select(item => item.Origin)];
    }

    /// <summary>`tabela.coluna` ou `apelido.coluna`. O qualificador que não é de nenhuma tabela do `FROM` (`sequencia.NEXTVAL`) é coluna calculada.</summary>
    private static (Origin, string?) QualifiedOrigin(ResultSource source, IReadOnlyList<EditCatalogTable?> catalogs, SelectItem.Column column)
    {
        if (TableOf(source, catalogs, column.Qualifier) is not { } table)
            return (default, null);

        if (catalogs[table] is not { } catalog)
            return (new Origin(table, null, null), column.OutputName);

        return catalog.Columns.FirstOrDefault(info => info.Name == column.Name) is { } info ? (new Origin(table, info, null), column.OutputName) : (default, null);
    }

    /// <summary>
    /// A coluna sem tabela é da única tabela do `FROM` que tem uma coluna com esse nome. A que está em mais de uma (ou pode estar numa que
    /// o catálogo não achou) não se edita; a que não está em nenhuma é calculada (`TODAY`, `USER`).
    /// </summary>
    private static (Origin, string?) UnqualifiedOrigin(IReadOnlyList<EditCatalogTable?> catalogs, SelectItem.Column column)
    {
        var having = Enumerable.Range(0, catalogs.Count).Where(table => catalogs[table]?.Columns.Any(info => info.Name == column.Name) != false).ToList();

        return having switch
        {
            [] => (default, null),
            [var only] when catalogs[only] is { } catalog => (new Origin(only, catalog.Columns.First(info => info.Name == column.Name), null), column.OutputName),
            _ => (new Origin(null, null, Ambiguous), column.OutputName)
        };
    }

    /// <summary>
    /// A tabela do `FROM` que o qualificador nomeia: o apelido, quando ela tem um; sem ele, o nome da tabela, com ou sem o esquema (o do
    /// catálogo, quando ele a achou). Nulo quando não é nenhuma.
    /// </summary>
    private static int? TableOf(ResultSource source, IReadOnlyList<EditCatalogTable?> catalogs, IReadOnlyList<string> qualifier)
    {
        for (var index = 0; index < source.Tables.Count; index++)
        {
            var table = source.Tables[index];
            var schema = catalogs[index]?.Schema ?? table.Name.Schema;
            var name = catalogs[index]?.Name ?? table.Name.Name;
            var named = table.Alias is { } alias ? qualifier is [var only] && only == alias : qualifier switch
            {
                [var single] => single == name,
                [var owner, var single] => owner == schema && single == name,
                _ => false
            };

            if (named)
                return index;
        }

        return null;
    }

    /// <summary>
    /// RN-GRADE-020: o tipo de cada tabela como a tela o lê. A que o catálogo não acha (um sinônimo, um apelido de tabela) e o tipo que ele não conhece são
    /// `other`.
    /// </summary>
    private static string KindOf(EditCatalogTable? catalog)
        => catalog?.Kind is EditTableKind.Table or EditTableKind.View or EditTableKind.MaterializedView or EditTableKind.Foreign or EditTableKind.Elsewhere ? catalog.Kind : EditTableKind.Other;

    /// <summary>As chaves que servem (RN-EDIT-002): a primária antes, e só as de colunas não nulas.</summary>
    private static List<EditKey> CandidateKeys(EditCatalogTable catalog)
        => [.. catalog.Keys
            .OrderByDescending(key => key.Primary)
            .Where(key => key.Columns.Count > 0 && key.Columns.All(column => catalog.Columns.Any(info => info.Name == column && !info.IsNullable)))];

    /// <summary>A primeira chave da tabela inteira no resultado, como colunas dela, a primária antes, e qual ela é; sem nenhuma, o motivo.</summary>
    private static (IReadOnlyList<int> Key, EditKey? Used, string? Reason) KeyOf(ESqlDialect dialect, string name, EditCatalogTable catalog, ColumnInfo?[] origins, IReadOnlyList<QueryColumn> columns)
    {
        var candidates = CandidateKeys(catalog);
        if (candidates.Count == 0)
            return ([], null, $"{name} não tem chave primária nem chave única de colunas não nulas");

        foreach (var key in candidates)
        {
            var positions = key.Columns.Select(column => Array.FindIndex(origins, origin => origin?.Name == column)).ToList();
            if (positions.Any(position => position < 0))
                continue;

            if (positions.Any(position => EditValues.TypeOf(dialect, origins[position]!.Type, columns[position].Kind) is EEditType.Binary or EEditType.Unsupported))
                continue;

            return (positions, key, null);
        }

        var missing = candidates[0].Columns.Where(column => !origins.Any(origin => origin?.Name == column)).ToList();

        return missing.Count > 0
            ? ([], null, $"a chave de {name} não está inteira no resultado: faltam {string.Join(", ", missing)}")
            : ([], null, $"a chave de {name} tem coluna de um tipo que o Prism ainda não edita neste banco");
    }

    /// <summary>
    /// RN-EDIT-016: quem preenche o valor da coluna na linha nova, que o "Duplicar linha" da tela não copia. No PostgreSQL, a coluna cujo padrão é o
    /// próximo valor de uma sequência (`nextval(...)`: o `serial` e o `bigserial`) é "por padrão", como a identidade "por padrão": o banco a preenche
    /// quando o valor não vem. Só no alvo da edição: o catálogo continua a mostrá-la como padrão, e não como coluna gerada (RN-CAT-001).
    /// </summary>
    private static string? GenerationOf(ESqlDialect dialect, ColumnInfo origin)
        => origin.Generated is null && dialect == ESqlDialect.PostgreSql && IsNextValue(origin.DefaultValue) ? ColumnGeneration.ByDefault : origin.Generated;

    /// <summary>O padrão é uma chamada de `nextval`, como o `pg_get_expr` o escreve (`nextval('loja.pedido_id_seq'::regclass)`).</summary>
    private static bool IsNextValue(string? expression)
        => expression?.Trim() is { } text && text.StartsWith("nextval(", StringComparison.OrdinalIgnoreCase) && text.EndsWith(')');

    private static string? ColumnReason(ESqlDialect dialect, ColumnInfo origin, QueryColumn column)
    {
        if (origin.Generated == ColumnGeneration.Always)
            return GeneratedByTheDatabase;

        return EditValues.TypeOf(dialect, origin.Type, column.Kind) switch
        {
            EEditType.Binary => Binary,
            EEditType.Unsupported => UnsupportedType,
            _ => null
        };
    }
}
