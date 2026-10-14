using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-EDIT-005 e 008: os comandos do "Salvar" a partir das pendências, na ordem da regra: primeiro as exclusões, depois as alterações,
/// depois as linhas novas, cada grupo na ordem em que veio. Cada alteração e cada exclusão é um comando pela chave da tabela dela (numa
/// junção, as alterações de uma linha da grade em duas tabelas são duas alterações, cada uma com a sua tabela), com os valores que a
/// grade leu; a linha nova leva só as colunas preenchidas. Os valores vão como parâmetros (`$1` no PostgreSQL, `?` no Db2
/// e no Informix), nunca dentro do texto, e os nomes entre aspas duplas (RN-TABELA-002). O "Ver SQL" é o mesmo comando, com os valores
/// escritos como literais do banco para leitura.
///
/// O que não se aplica ao resultado, e o texto que não converte para a coluna (RN-EDIT-006), é recusado antes de qualquer comando ir ao
/// banco, com a posição da alteração no pedido e a da coluna no resultado.
/// </summary>
internal static class EditPlanner
{
    public static Result<IReadOnlyList<EditCommand>, DatabaseFailure> Plan(ESqlDialect dialect, EditTarget target, IReadOnlyList<QueryColumn> columns, IReadOnlyList<EditChange> changes)
    {
        var commands = new List<EditCommand>();

        foreach (var (change, index) in Ordered(changes))
        {
            var planned = Build(dialect, target, columns, change, index, preview: false);
            if (planned.IsFailure)
                return planned.Error;

            commands.Add(new EditCommand(index, planned.Value.Sql, planned.Value.Parameters));
        }

        return commands;
    }

    public static Result<EditPreview, DatabaseFailure> Preview(ESqlDialect dialect, EditTarget target, IReadOnlyList<QueryColumn> columns, IReadOnlyList<EditChange> changes)
    {
        var statements = new List<EditStatement>();

        foreach (var (change, index) in Ordered(changes))
        {
            var planned = Build(dialect, target, columns, change, index, preview: true);
            if (planned.IsFailure)
                return planned.Error;

            statements.Add(new EditStatement(planned.Value.Sql, planned.Value.Unwritten));
        }

        return new EditPreview(statements, target.OneAtATime);
    }

    /// <summary>A ordem da RN-EDIT-005, estável dentro de cada grupo, com a posição de cada alteração no pedido.</summary>
    private static IEnumerable<(EditChange Change, int Index)> Ordered(IReadOnlyList<EditChange> changes)
        => changes.Select((change, index) => (change, index)).OrderBy(item => item.change.Kind switch
        {
            EEditKind.Delete => 0,
            EEditKind.Update => 1,
            _ => 2
        });

    private static Result<(string Sql, IReadOnlyList<EditParameter> Parameters, IReadOnlyList<string?> Unwritten), DatabaseFailure> Build(ESqlDialect dialect, EditTarget target, IReadOnlyList<QueryColumn> columns, EditChange change, int index, bool preview)
    {
        DatabaseFailure Invalid(string message, int? column = null)
            => new(EDatabaseFailure.EditInvalid, message, Change: index, Column: column);

        if (change.Table < 0 || change.Table >= target.Tables.Count)
            return Invalid("A tabela da alteração não existe neste resultado.");

        var table = target.Tables[change.Table];
        if (!table.Editable)
            return Invalid($"A tabela da alteração não se edita: {table.Reason}.");

        if (change.Kind != EEditKind.Update && !target.RowOperations)
            return Invalid("Este resultado não aceita linha nova nem exclusão de linha.");

        var writer = new Writer(dialect, preview);

        if (change.Kind != EEditKind.Insert && (change.Key.Count != table.Key.Count || change.Key.Any(value => value is null)))
            return Invalid("A chave da linha não tem os valores das colunas da chave.");

        if (change.Kind != EEditKind.Delete && change.Values.Count == 0)
            return Invalid(change.Kind == EEditKind.Insert ? "A linha nova não tem nenhuma coluna preenchida." : "A alteração não tem nenhuma coluna.");

        var assigned = new List<(string Name, string Value)>();
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

            var written = writer.Value(column, columns[value.Column].Kind, value.Value);
            if (written.IsFailure)
                return Invalid(written.Error, value.Column);

            assigned.Add((Quote(column.BaseColumn!), written.Value));
        }

        var conditions = new List<string>();
        if (change.Kind != EEditKind.Insert)
        {
            for (var position = 0; position < table.Key.Count; position++)
            {
                var keyColumn = table.Key[position];
                var written = writer.Value(target.Columns[keyColumn], columns[keyColumn].Kind, change.Key[position]);
                if (written.IsFailure)
                    return Invalid(written.Error, keyColumn);

                conditions.Add($"{Quote(target.Columns[keyColumn].BaseColumn!)} = {written.Value}");
            }
        }

        var name = $"{Quote(table.Schema)}.{Quote(table.Name)}";
        var where = string.Join(" AND ", conditions);
        var sql = change.Kind switch
        {
            EEditKind.Delete => $"DELETE FROM {name} WHERE {where}",
            EEditKind.Update => $"UPDATE {name} SET {string.Join(", ", assigned.Select(item => $"{item.Name} = {item.Value}"))} WHERE {where}",
            _ => $"INSERT INTO {name} ({string.Join(", ", assigned.Select(item => item.Name))}) VALUES ({string.Join(", ", assigned.Select(item => item.Value))})"
        };

        return (sql, writer.Parameters, writer.Unwritten);
    }

    private static string Quote(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>
    /// Escreve cada valor no lugar dele, na ordem do texto: no comando, o marcador do parâmetro (e o valor convertido vai para a lista);
    /// no "Ver SQL", o literal, ou `?` com o valor ao lado quando ele não tem literal.
    /// </summary>
    private sealed class Writer(ESqlDialect dialect, bool preview)
    {
        private readonly List<EditParameter> _parameters = [];
        private readonly List<string?> _unwritten = [];

        public IReadOnlyList<EditParameter> Parameters => _parameters;

        public IReadOnlyList<string?> Unwritten => _unwritten;

        public Result<string, string> Value(EditColumn column, string kind, string? text)
        {
            var type = EditValues.TypeOf(dialect, column.Type ?? string.Empty, kind);
            var converted = EditValues.Convert(dialect, type, text);
            if (converted.IsFailure)
                return Result.Failure<string, string>(converted.Error);

            if (preview)
            {
                if (EditValues.Literal(dialect, type, kind, text) is { } literal)
                    return Result.Success<string, string>(literal);

                _unwritten.Add(text);

                return Result.Success<string, string>("?");
            }

            _parameters.Add(converted.Value);

            return Result.Success<string, string>(dialect == ESqlDialect.PostgreSql ? $"${_parameters.Count}" : "?");
        }
    }
}
