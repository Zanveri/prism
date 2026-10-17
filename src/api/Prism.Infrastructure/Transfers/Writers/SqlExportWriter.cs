using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Globalization;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-011: comandos `INSERT`, com os nomes entre aspas duplas, os valores como literais do banco da origem e as palavras-chave em maiúsculas.
/// Com várias linhas por comando, a primeira linha do comando é `INSERT INTO "esquema"."tabela" ("a", "b") VALUES` e cada linha vem na seguinte, com
/// dois espaços de recuo, separadas por vírgula, até o `;`; um comando que acabou com uma linha só (o último, ou o que uma linha sem literal fechou) tem
/// a mesma forma. Com uma linha por comando (sempre, no Informix), cada `INSERT` fica numa linha só, como no "Gerar SQL". Cada comando termina em `;`, e o
/// arquivo, em LF; sem linhas, o arquivo fica vazio.
///
/// A linha com um valor sem literal (<see cref="ESqlSkipReason"/>) não sai: o comando em andamento fecha com `;` antes dela, e no lugar dela vai um
/// comentário de uma frase fixa, com o número da linha na ordem da origem e nenhum dado do banco; as linhas seguintes começam outro `INSERT`, e a
/// contagem do aviso do fim sobe (<see cref="ExportCounts.SkippedRows"/>). O binário com "NULL" nem é pedido ao leitor: chega nulo e sai `NULL`.
/// </summary>
internal sealed class SqlExportWriter : TextExportWriter
{
    private readonly string _insert;
    private readonly int _rowsPerStatement;
    private long _row;
    private int _open;

    public SqlExportWriter(ExportWriterContext context, Stream output)
        : base(context, output)
    {
        var options = (SqlExportOptions)context.Options;
        var table = ExportText.QualifiedTable(options.OmitSchema ? null : options.Schema, options.Table);
        _insert = $"INSERT INTO {table} ({string.Join(", ", context.Columns.Select(column => ExportText.QuoteIdentifier(column.Name)))}) VALUES";

        // O Informix não aceita várias linhas num `INSERT … VALUES`: quem começa a exportação já recusa mais de uma, e o escritor não as junta.
        _rowsPerStatement = context.Engine == EDatabaseEngine.Informix ? 1 : options.RowsPerStatement;
    }

    public override void Begin()
    {
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        _row++;
        var literals = new string[row.Count];
        for (var index = 0; index < row.Count; index++)
        {
            if (LiteralOf(row[index], Columns[index], out var reason) is { } literal)
            {
                literals[index] = literal;
                continue;
            }

            Close();
            Output.Write($"-- Linha {_row.ToString(CultureInfo.InvariantCulture)} não exportada: {SentenceOf(reason)}\n");
            Counts.SkippedRows++;

            return;
        }

        var values = $"({string.Join(", ", literals)})";
        if (_rowsPerStatement == 1)
        {
            Output.Write($"{_insert} {values};\n");

            return;
        }

        Output.Write(_open == 0 ? $"{_insert}\n  {values}" : $",\n  {values}");
        if (++_open == _rowsPerStatement)
            Close();
    }

    public override void End()
    {
        Close();
        Output.Flush();
    }

    /// <summary>Fecha o comando de várias linhas em andamento, se há um.</summary>
    private void Close()
    {
        if (_open == 0)
            return;

        Output.Write(";\n");
        _open = 0;
    }

    private string? LiteralOf(ExportCell cell, ExportColumn column, out ESqlSkipReason reason)
    {
        reason = default;
        if (cell.IsNull)
            return "NULL";

        if (cell.Bytes is { } bytes)
        {
            reason = ESqlSkipReason.InformixBinary;

            return ExportText.BinaryLiteral(Context.Engine, bytes, column.Type);
        }

        var text = cell.Text!;
        var literal = ExportText.ScriptLiteral(Context.Engine, text, column.Kind);
        if (literal is null)
            reason = ExportText.SkipReasonOf(text);

        return literal;
    }

    /// <summary>As frases fixas do comentário: uma quebra de linha num nome ou num valor encerraria o comentário, e o resto viraria código.</summary>
    private static string SentenceOf(ESqlSkipReason reason)
        => reason switch
        {
            ESqlSkipReason.InformixBinary => "o Informix não tem literal para binário.",
            ESqlSkipReason.Control => "um valor tem caractere de controle que não vira literal.",
            _ => "no Informix, a data e hora tem mais de cinco casas de segundo."
        };
}
