using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Text;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-012, DbUnit: o `&lt;dataset&gt;` do DbUnit, com um elemento vazio por linha, de nome igual ao da tabela ("Tabela", já resolvida por quem
/// começa a exportação), e um atributo por coluna. Com "Nomes em maiúsculas", o da tabela e os das colunas vão em maiúsculas sem cultura
/// (`ToUpperInvariant`) ANTES da regra do nome do XML (<see cref="ExportText.XmlName"/>), para o `_x0020_` não virar `_X0020_`; o atributo repetido
/// ganha `_2`, `_3`…, como a chave do JSON. O nulo omite o atributo, ou, com "Escrever [NULL]", é `[NULL]`. O valor escapa o do texto, a aspa, a
/// tabulação e a quebra de linha, e o que o XML 1.0 não aceita é tirado e contado. Recuo de 4 espaços e LF, com a quebra de linha no fim; sem linhas,
/// `&lt;dataset/&gt;`.
/// </summary>
internal sealed class DbUnitExportWriter : TextExportWriter
{
    /// <summary>O texto que o `ReplacementDataSet` do DbUnit troca de volta por nulo.</summary>
    private const string NullMark = "[NULL]";

    private readonly DbUnitExportOptions _options;
    private readonly string _element;
    private readonly IReadOnlyList<string> _attributes;
    private long _rows;

    public DbUnitExportWriter(ExportWriterContext context, Stream output)
        : base(context, output)
    {
        _options = (DbUnitExportOptions)context.Options;
        _element = ExportText.XmlName(Cased(_options.Table));
        _attributes = ExportText.UniqueKeys([.. context.Columns.Select(column => ExportText.XmlName(Cased(column.Name)))]);
    }

    public override void Begin()
        => Output.Write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");

    public override void Write(IReadOnlyList<ExportCell> row)
    {
        if (_rows++ == 0)
            Output.Write("<dataset>\n");

        var line = new StringBuilder("    <").Append(_element);
        for (var index = 0; index < row.Count; index++)
        {
            string value;
            if (TextOf(row[index]) is { } text)
            {
                value = ExportText.XmlAttribute(text, out var removed);
                Counts.RemovedCharacters += removed;
            }
            else if (_options.MarkNulls)
            {
                value = NullMark;
            }
            else
            {
                continue;
            }

            line.Append(' ').Append(_attributes[index]).Append("=\"").Append(value).Append('"');
        }

        Output.Write(line.Append("/>\n").ToString());
    }

    public override void End()
    {
        Output.Write(_rows == 0 ? "<dataset/>\n" : "</dataset>\n");
        Output.Flush();
    }

    private string Cased(string name)
        => _options.UpperCase ? name.ToUpperInvariant() : name;
}
