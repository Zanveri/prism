using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Text;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-012, XML: o formato do DBeaver. A declaração, a raiz com o nome da origem, um `DATA_RECORD` por linha e, dentro dele, um elemento por
/// coluna, com o nome dela, na ordem do resultado (o nome repetido aparece repetido). Os nomes passam pela regra do .NET (<see cref="ExportText.XmlName"/>),
/// e a volta é exata. O nulo e o texto vazio são o elemento vazio (`&lt;cliente/&gt;`), como no DBeaver; o texto escapa `&amp;`, `&lt;`, `&gt;` e o
/// retorno de carro, e o que o XML 1.0 não aceita é tirado e contado. Recuo de 2 espaços e LF, com a quebra de linha no fim. Sem linhas, a raiz vazia
/// (`&lt;pedido/&gt;`). Com "Declaração DOCTYPE", o `&lt;!DOCTYPE&gt;` do DBeaver vem antes da raiz, com os elementos da raiz, do `DATA_RECORD` e de cada
/// coluna, cada nome declarado uma vez.
/// </summary>
internal sealed class XmlExportWriter(ExportWriterContext context, Stream output) : TextExportWriter(context, output)
{
    /// <summary>O elemento de cada linha, o do DBeaver.</summary>
    private const string Record = "DATA_RECORD";

    private readonly XmlExportOptions _options = (XmlExportOptions)context.Options;

    private readonly string _root = ExportText.XmlName(context.SourceName);

    private readonly IReadOnlyList<string> _names = [.. context.Columns.Select(column => ExportText.XmlName(column.Name))];

    private long _rows;

    public override void Begin()
    {
        Output.Write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        if (_options.Doctype)
            Output.Write(Doctype());
    }

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        if (_rows++ == 0)
            Output.Write($"<{_root}>\n");

        Output.Write($"  <{Record}>\n");
        for (var index = 0; index < row.Count; index++)
        {
            var text = string.Empty;
            if (TextOf(row[index]) is { } value)
            {
                text = ExportText.XmlText(value, out var removed);
                Counts.RemovedCharacters += removed;
            }

            Output.Write(text.Length == 0 ? $"    <{_names[index]}/>\n" : $"    <{_names[index]}>{text}</{_names[index]}>\n");
        }

        Output.Write($"  </{Record}>\n");
    }

    public override void End()
    {
        Output.Write(_rows == 0 ? $"<{_root}/>\n" : $"</{_root}>\n");
        Output.Flush();
    }

    /// <summary>
    /// O `DOCTYPE` do DBeaver: a raiz tem `DATA_RECORD`s, o `DATA_RECORD` tem cada coluna (opcional, na ordem), e cada coluna tem texto. Um nome que já
    /// foi declarado (a coluna repetida, ou a que se chama como a raiz ou `DATA_RECORD`) não é declarado de novo.
    /// </summary>
    private string Doctype()
    {
        var declared = new HashSet<string>(StringComparer.Ordinal) { _root, Record };
        var doctype = new StringBuilder()
            .Append($"<!DOCTYPE {_root} [\n")
            .Append($"  <!ELEMENT {_root} ({Record}*)>\n")
            .Append($"  <!ELEMENT {Record} ({string.Join(',', _names.Select(name => $"{name}?"))})+>\n");

        foreach (var name in _names.Where(declared.Add))
            doctype.Append($"  <!ELEMENT {name} (#PCDATA)>\n");

        return doctype.Append("]>\n").ToString();
    }
}
