using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>RN-EXPORT-016: por que o comando da exportação é recusado antes de o trabalho começar, sem ir ao banco.</summary>
public enum EExportSqlRefusal
{
    /// <summary>422 `MULTIPLE_STATEMENTS_NOT_SUPPORTED`: o texto tem mais de um comando.</summary>
    MultipleStatements,

    /// <summary>422 `FILTER_INVALID`: o filtro do resultado não se junta ao comando com segurança (RN-GRADE-011).</summary>
    FilterInvalid,

    /// <summary>422 `EXPORT_SOURCE_NOT_READ`: o comando montado não é uma leitura pela regra do somente leitura (RN-PROT-005).</summary>
    NotRead
}

/// <summary>A recusa do comando da exportação: o tipo e o motivo, que vai para o detalhe (no `NotRead`, o motivo da RN-PROT-005, "um DELETE não é leitura").</summary>
public sealed record ExportSqlRefusal(EExportSqlRefusal Kind, string Reason);

/// <summary>
/// RN-EXPORT-002 e 016: o comando que a exportação executa, montado e conferido antes do 202, pelo dialeto do banco da conexão e sem ir ao banco. É público,
/// como o `ReadOnlySql`, porque quem começa a exportação é a Application.
/// </summary>
public static class ExportSql
{
    private const string SeveralStatementsMessage = "Cada exportação executa um comando só, e o texto enviado tem mais de um; nada foi executado.";

    /// <summary>
    /// Os Registros e o resultado: o comando como foi executado, com o filtro do resultado junto como no `queries` (RN-GRADE-011). Mais de um comando,
    /// o filtro que não se junta e o comando montado que não é uma leitura são recusados, nessa ordem.
    /// </summary>
    public static Result<string, ExportSqlRefusal> Query(string sql, string? filter, EDatabaseEngine engine)
    {
        if (ReadOnlySql.HasSeveralStatements(sql, engine))
            return new ExportSqlRefusal(EExportSqlRefusal.MultipleStatements, SeveralStatementsMessage);

        var sent = sql;
        if (!string.IsNullOrWhiteSpace(filter))
        {
            var filtered = SqlFilter.Apply(sql, filter, ReadOnlySql.DialectOf(engine));
            if (filtered.IsFailure)
                return new ExportSqlRefusal(filtered.Error.Kind == EDatabaseFailure.FilterInvalid ? EExportSqlRefusal.FilterInvalid : EExportSqlRefusal.MultipleStatements, filtered.Error.Message);

            sent = filtered.Value.Sql;
        }

        // Na dúvida não é leitura: a coluna `update` sem aspas também não se exporta.
        return ReadOnlySql.ExportRefusal(sent, engine) is { } reason ? new ExportSqlRefusal(EExportSqlRefusal.NotRead, reason) : sent;
    }

    /// <summary>
    /// A tabela ou a visão pelo navegador: todas as linhas, só das colunas marcadas, na ordem dada, com os nomes entre aspas duplas e a aspa de dentro
    /// dobrada, como nos Registros (RN-TABELA-002): `SELECT "id", "cliente" FROM "estoque"."pedido"`, sem filtro nem ordem.
    /// </summary>
    public static string Table(string schema, string table, IEnumerable<string> columns)
        => $"SELECT {string.Join(", ", columns.Select(Quote))} FROM {Quote(schema)}.{Quote(table)}";

    private static string Quote(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
}
