using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-002 e 003: o que se edita num resultado de uma tabela só, a partir da leitura do comando (<see cref="EditableSql"/>), das
/// colunas que o banco devolveu e do catálogo da tabela. No PostgreSQL de onde vem cada coluna é o banco que diz, na resposta (a tabela
/// e o número da coluna, <see cref="ColumnOrigin"/>); no Db2 e no Informix é a lista do `SELECT`, e o resultado tem de bater com ela (o
/// número de colunas e o nome de cada uma, como o banco os devolve): se não bate, o resultado inteiro é só leitura.
///
/// A tabela se edita quando é tabela (e não visão, visão materializada, tabela estrangeira, sinônimo ou apelido) e tem uma chave inteira
/// no resultado: a primária, ou uma restrição ou índice único sem condição, só de colunas e com todas elas não nulas. A coluna se edita
/// quando vem da tabela que se edita e não é calculada no comando, gerada sempre pelo banco, binária nem de um tipo que o Prism ainda não
/// converte naquele banco.
/// </summary>
internal static class EditTargetResolver
{
    private const string Computed = "coluna calculada";
    private const string GeneratedByTheDatabase = "gerada pelo banco";
    private const string Binary = "coluna binária";
    private const string UnsupportedType = "o Prism ainda não edita este tipo neste banco";

    public static Result<EditTarget, DatabaseFailure> Resolve(ESqlDialect dialect, ResultSource source, IReadOnlyList<QueryColumn> columns, EditCatalogTable? catalog)
    {
        if (source.Reason is not null || source.Table is not { } table)
            return NotEditable(source.Reason ?? EditableSql.UnknownOrigin);

        var origins = catalog is null ? new ColumnInfo?[columns.Count] : Origins(dialect, source, columns, catalog);
        if (origins is null)
            return NotEditable(EditableSql.UnknownOrigin);

        var name = catalog?.Name ?? table.Name;
        var tableReason = catalog?.Kind switch
        {
            null => $"{name} não é uma tabela",
            "table" => null,
            "view" => $"{name} é uma visão",
            "materializedView" => $"{name} é uma visão materializada",
            "foreign" => $"{name} é uma tabela estrangeira",
            _ => $"{name} não é uma tabela"
        };

        IReadOnlyList<int> key = [];
        if (tableReason is null)
            (key, tableReason) = KeyOf(dialect, name, catalog!, origins, columns);

        var editable = tableReason is null;
        var editColumns = columns.Select((column, index) => origins[index] is { } origin
            ? new EditColumn(0, origin.Name, editable && ColumnReason(dialect, origin, column) is null, editable ? ColumnReason(dialect, origin, column) : tableReason, origin.IsNullable, origin.Generated, origin.Type)
            : new EditColumn(null, null, false, editable ? Computed : tableReason, true, null, null));

        return new EditTarget([new EditTable(catalog?.Schema ?? table.Schema ?? string.Empty, name, key, editable, tableReason)], [.. editColumns], editable, catalog?.OneAtATime ?? false);
    }

    /// <summary>O alvo de agora é o mesmo do da consulta: a tabela, a chave e o que cada coluna é. É o que o "Salvar" confere no catálogo, dentro da transação.</summary>
    public static bool Same(EditTarget before, EditTarget now)
        => before.RowOperations == now.RowOperations
           && before.OneAtATime == now.OneAtATime
           && before.Tables.Count == now.Tables.Count
           && before.Tables.Zip(now.Tables).All(pair => pair.First.Schema == pair.Second.Schema && pair.First.Name == pair.Second.Name && pair.First.Editable == pair.Second.Editable && pair.First.Key.SequenceEqual(pair.Second.Key))
           && before.Columns.SequenceEqual(now.Columns);

    private static Result<EditTarget, DatabaseFailure> NotEditable(string reason)
        => new DatabaseFailure(EDatabaseFailure.ResultNotEditable, $"Somente leitura: {reason}.", Reason: reason);

    /// <summary>
    /// A coluna da tabela de onde vem cada coluna do resultado, ou nulo na calculada. Nulo no todo quando o resultado não bate com a
    /// lista do `SELECT` (Db2 e Informix): o Prism não sabe de onde vêm as colunas.
    /// </summary>
    private static ColumnInfo?[]? Origins(ESqlDialect dialect, ResultSource source, IReadOnlyList<QueryColumn> columns, EditCatalogTable catalog)
    {
        if (dialect == ESqlDialect.PostgreSql)
            return [.. columns.Select(column => column.Origin is { } origin && origin.Table == catalog.Id ? catalog.Columns.FirstOrDefault(info => info.Position == origin.Column) : null)];

        var expanded = new List<(ColumnInfo? Column, string? Name)>();
        foreach (var item in source.Items)
        {
            switch (item)
            {
                case SelectItem.All:
                    expanded.AddRange(catalog.Columns.Select(column => ((ColumnInfo?)column, (string?)column.Name)));
                    break;
                case SelectItem.AllOf all when Names(source, catalog, all.Qualifier):
                    expanded.AddRange(catalog.Columns.Select(column => ((ColumnInfo?)column, (string?)column.Name)));
                    break;
                case SelectItem.AllOf:
                    return null;
                case SelectItem.Column column when (column.Qualifier.Count == 0 || Names(source, catalog, column.Qualifier)) && catalog.Columns.FirstOrDefault(info => info.Name == column.Name) is { } info:
                    expanded.Add((info, column.OutputName));
                    break;
                default:
                    expanded.Add((null, null));
                    break;
            }
        }

        if (expanded.Count != columns.Count || expanded.Where((item, index) => item.Name is not null && item.Name != columns[index].Name).Any())
            return null;

        return [.. expanded.Select(item => item.Column)];
    }

    /// <summary>O qualificador é o apelido do `FROM`, quando há um; sem ele, o nome da tabela, com ou sem o esquema.</summary>
    private static bool Names(ResultSource source, EditCatalogTable catalog, IReadOnlyList<string> qualifier)
        => source.Alias is { } alias ? qualifier is [var only] && only == alias : qualifier switch
        {
            [var name] => name == catalog.Name,
            [var schema, var name] => schema == catalog.Schema && name == catalog.Name,
            _ => false
        };

    /// <summary>A primeira chave da tabela inteira no resultado, a primária antes; sem nenhuma, o motivo.</summary>
    private static (IReadOnlyList<int> Key, string? Reason) KeyOf(ESqlDialect dialect, string name, EditCatalogTable catalog, ColumnInfo?[] origins, IReadOnlyList<QueryColumn> columns)
    {
        var candidates = catalog.Keys
            .OrderByDescending(key => key.Primary)
            .Where(key => key.Columns.Count > 0 && key.Columns.All(column => catalog.Columns.Any(info => info.Name == column && !info.IsNullable)))
            .ToList();

        if (candidates.Count == 0)
            return ([], $"{name} não tem chave primária nem chave única de colunas não nulas");

        foreach (var key in candidates)
        {
            var positions = key.Columns.Select(column => Array.FindIndex(origins, origin => origin?.Name == column)).ToList();
            if (positions.Any(position => position < 0))
                continue;

            if (positions.Any(position => EditValues.TypeOf(dialect, origins[position]!.Type, columns[position].Kind) is EEditType.Binary or EEditType.Unsupported))
                continue;

            return (positions, null);
        }

        var missing = candidates[0].Columns.Where(column => !origins.Any(origin => origin?.Name == column)).ToList();

        return missing.Count > 0
            ? ([], $"a chave de {name} não está inteira no resultado: faltam {string.Join(", ", missing)}")
            : ([], $"a chave de {name} tem coluna de um tipo que o Prism ainda não edita neste banco");
    }

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
