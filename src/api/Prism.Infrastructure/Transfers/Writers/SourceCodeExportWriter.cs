using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-010, "Código fonte": um array do PHP, como o DBeaver. `&lt;?php`, `$pedido = array(`, um `array(` por linha com `"id" =&gt; 1,` por coluna,
/// `),` no fim de cada linha, `);` e `?&gt;`, com tabulação de recuo e LF (e uma quebra de linha depois do `?&gt;`, que o PHP ignora). No "PHP 5.4 ou mais
/// novo", `[` e `]` no lugar de `array(` e `)`. Sem linhas, `$pedido = array();` (`$pedido = [];`). O número e o booleano seguem as regras do JSON, o
/// nulo é `null`, e o texto é o literal do PHP nas aspas escolhidas (<see cref="ExportText.PhpString"/>). As chaves são os nomes das colunas, com o
/// mesmo escape, e o nome repetido ganha `_2`. O caractere de direção que não tem escape (nas aspas simples e no nome da variável) é tirado e contado.
/// </summary>
internal sealed class SourceCodeExportWriter : TextExportWriter
{
    private readonly SourceCodeExportOptions _options;
    private readonly string _variable;
    private readonly IReadOnlyList<string> _keys;
    private long _rows;

    public SourceCodeExportWriter(ExportWriterContext context, Stream output)
        : base(context, output)
    {
        _options = (SourceCodeExportOptions)context.Options;
        _variable = ExportText.PhpVariable(context.SourceName, out var removed);
        Counts.RemovedCharacters += removed;

        // As chaves são as mesmas em toda linha: o que elas perdem conta uma vez.
        _keys = [.. ExportText.UniqueKeys([.. context.Columns.Select(column => column.Name)]).Select(Literal)];
    }

    private string Open => _options.ShortArrays ? "[" : "array(";

    private string Close => _options.ShortArrays ? "]" : ")";

    public override void Begin()
        => Output.Write("<?php\n");

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        if (_rows++ == 0)
            Output.Write($"${_variable} = {Open}\n");

        Output.Write($"\t{Open}\n");
        for (var index = 0; index < row.Count; index++)
            Output.Write($"\t\t{_keys[index]} => {ValueOf(row[index], Columns[index])},\n");

        Output.Write($"\t{Close},\n");
    }

    public override void End()
    {
        Output.Write(_rows == 0 ? $"${_variable} = {Open}{Close};\n" : $"{Close};\n");
        Output.Write("?>\n");
        Output.Flush();
    }

    private string ValueOf(ExportCell cell, ExportColumn column)
    {
        if (TextOf(cell) is not { } text)
            return "null";

        if (ExportText.IsBareJsonValue(column.Kind, text))
            return text;

        return Literal(_options.IsoDates && column.Kind == "datetime" ? ExportText.IsoDateTime(text) : text);
    }

    private string Literal(string text)
    {
        var literal = ExportText.PhpString(text, _options.SingleQuotes, out var removed);
        Counts.RemovedCharacters += removed;

        return literal;
    }
}
