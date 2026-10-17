using Prism.Infrastructure.Transfers.Models;
using System.Text.Json;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>Uma opção recusada, com o caminho do campo como a tela o lê (`options.rowsPerStatement`) e o motivo.</summary>
public sealed record ExportOptionError(string Field, string Message);

/// <summary>
/// RN-EXPORT-006 a 013 e as notas da seção 6: lê as opções do formato do corpo do pedido (`options`, um objeto JSON), com o padrão do Prism no que não
/// veio, e recusa o valor fora da lista ou da faixa, e também o do tipo errado, no campo (`EXPORT_OPTIONS_INVALID`). A chave que o formato não tem é
/// ignorada. Lê o JSON à mão, e não por um record do MVC, para o tipo errado ser a mesma recusa no campo, e não o 400 do MVC em outro formato. As faixas
/// que dependem do banco (as linhas por comando no Informix) são de quem começa a exportação.
/// </summary>
public static class ExportOptionsReader
{
    /// <summary>RN-EXPORT-007 e 009: o texto do "Nulo como" tem até 100 caracteres.</summary>
    public const int MaxNullText = 100;

    /// <summary>RN-EXPORT-011: o esquema e a tabela de destino do SQL e do DbUnit têm até 128 caracteres.</summary>
    public const int MaxTableName = 128;

    private static readonly string[] Delimiters = [";", ",", "\t", "|"];
    private static readonly string[] LineBreaks = ["crlf", "lf"];
    private static readonly string[] Quotings = ["auto", "text", "all"];
    private static readonly string[] Binaries = ["hex", "null"];
    private static readonly string[] SqlBinaries = ["literal", "null"];

    /// <param name="defaultTable">A tabela de destino do SQL e do DbUnit quando ela não vem: a da origem (`source.table`, ou `source.name` nos Registros).</param>
    public static (ExportFormatOptions? Options, IReadOnlyList<ExportOptionError> Errors) Read(string format, JsonElement? options, string? defaultTable)
    {
        var errors = new List<ExportOptionError>();
        if (options is { ValueKind: not (JsonValueKind.Object or JsonValueKind.Null or JsonValueKind.Undefined) })
            return (null, [new ExportOptionError("options", "As opções do formato vêm num objeto.")]);

        var reader = new Reader(options, errors);
        ExportFormatOptions? read = format switch
        {
            ExportFormats.Csv => new CsvExportOptions(reader.Choice("delimiter", Delimiters, ";", "O separador deve ser ;, a vírgula, a tabulação ou |."), reader.Bool("header", true), Quoting(reader.Choice("quoting", Quotings, "auto", "As aspas devem ser auto, text ou all.")), reader.Bool("formulaGuard", true), LineBreak(reader), NullText(reader), Binary(reader)),
            ExportFormats.Txt => Txt(reader),
            ExportFormats.Html => new HtmlExportOptions(reader.Bool("title", true), reader.Bool("columnNames", true), Binary(reader)),
            ExportFormats.Markdown => new MarkdownExportOptions(reader.Bool("alignmentLine", true), NullText(reader), Binary(reader)),
            ExportFormats.Json => new JsonExportOptions(reader.Bool("wrap", true), reader.Bool("isoDates", true), Binary(reader)),
            ExportFormats.SourceCode => new SourceCodeExportOptions(reader.Choice("php", ["legacy", "short"], "legacy", "A versão do PHP deve ser legacy ou short.") == "short", reader.Choice("quote", ["double", "single"], "double", "As aspas devem ser double ou single.") == "single", reader.Bool("isoDates", true), Binary(reader)),
            ExportFormats.Sql => new SqlExportOptions(reader.Name("schema"), Table(reader, defaultTable), reader.Bool("omitSchema", false), reader.Int("rowsPerStatement", 1, 1000, 10, "As linhas por comando devem ser um número inteiro de 1 a 1.000."), reader.Choice("binary", SqlBinaries, "literal", "O binário deve ser literal ou null.") == "null" ? EExportBinary.Null : EExportBinary.Literal),
            ExportFormats.Xml => new XmlExportOptions(reader.Bool("doctype", false), Binary(reader)),
            ExportFormats.DbUnit => new DbUnitExportOptions(Table(reader, defaultTable), reader.Bool("upperCase", true), reader.Choice("nulls", ["omit", "mark"], "omit", "O nulo deve ser omit ou mark.") == "mark", Binary(reader)),
            ExportFormats.Xlsx => new XlsxExportOptions(Binary(reader)),
            _ => null
        };

        return errors.Count == 0 ? (read, []) : (null, errors);
    }

    private static TxtExportOptions Txt(Reader reader)
    {
        var minWidth = reader.Int("minWidth", 1, 1000, 3, "A largura mínima deve ser um número inteiro de 1 a 1.000.");
        var maxWidth = reader.Int("maxWidth", 0, 100000, 0, "A largura máxima deve ser um número inteiro de 0 (sem limite) a 100.000.");
        if (maxWidth > 0 && maxWidth < minWidth)
            reader.Refuse("maxWidth", "A largura máxima não pode ser menor que a mínima.");

        return new TxtExportOptions(reader.Bool("header", true), reader.Bool("headerLine", true), reader.Bool("edgeDelimiters", true), minWidth, maxWidth, reader.Bool("showNull", false), LineBreak(reader), Binary(reader));
    }

    private static ECsvQuoting Quoting(string quoting)
        => quoting switch
        {
            "text" => ECsvQuoting.Text,
            "all" => ECsvQuoting.All,
            _ => ECsvQuoting.Auto
        };

    private static string LineBreak(Reader reader)
        => reader.Choice("lineBreak", LineBreaks, "crlf", "A quebra de linha deve ser crlf ou lf.") == "lf" ? "\n" : "\r\n";

    private static EExportBinary Binary(Reader reader)
        => reader.Choice("binary", Binaries, "hex", "O binário deve ser hex ou null.") == "null" ? EExportBinary.Null : EExportBinary.Hex;

    private static string NullText(Reader reader)
    {
        var text = reader.Text("nullText", string.Empty);
        if (text.Length > MaxNullText)
            reader.Refuse("nullText", $"O texto do nulo pode ter até {MaxNullText} caracteres.");
        else if (text.Any(char.IsControl))
            reader.Refuse("nullText", "O texto do nulo não pode ter caractere de controle.");

        return text;
    }

    /// <summary>RN-EXPORT-011: a tabela de destino; ausente ou vazia, a da origem; sem nenhuma das duas, a recusa no campo.</summary>
    private static string Table(Reader reader, string? defaultTable)
    {
        var table = reader.Name("table");
        if (!string.IsNullOrEmpty(table))
            return table;

        if (!string.IsNullOrEmpty(defaultTable))
            return defaultTable;

        reader.Refuse("table", "Informe a tabela de destino.");

        return string.Empty;
    }

    /// <summary>A leitura de cada opção: o valor do tipo e da faixa certos, ou o padrão com a recusa anotada.</summary>
    private sealed class Reader(JsonElement? options, List<ExportOptionError> errors)
    {
        public void Refuse(string name, string message)
            => errors.Add(new ExportOptionError($"options.{name}", message));

        public bool Bool(string name, bool fallback)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return value.GetBoolean();

            Refuse(name, $"A opção {name} deve ser true ou false.");

            return fallback;
        }

        public string Choice(string name, IReadOnlyList<string> allowed, string fallback, string message)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind == JsonValueKind.String && allowed.Contains(value.GetString()!, StringComparer.Ordinal))
                return value.GetString()!;

            Refuse(name, message);

            return fallback;
        }

        public int Int(string name, int min, int max, int fallback, string message)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number >= min && number <= max)
                return number;

            Refuse(name, message);

            return fallback;
        }

        public string Text(string name, string fallback)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind == JsonValueKind.String)
                return value.GetString()!;

            Refuse(name, $"A opção {name} deve ser um texto.");

            return fallback;
        }

        /// <summary>RN-EXPORT-011: um nome de esquema ou de tabela como está no banco: até 128 caracteres, sem caractere de controle; vazio é a falta dele.</summary>
        public string? Name(string name)
        {
            var text = Text(name, string.Empty);
            if (text.Length > MaxTableName)
                Refuse(name, $"O nome pode ter até {MaxTableName} caracteres.");
            else if (text.Any(char.IsControl))
                Refuse(name, "O nome não pode ter caractere de controle.");

            return text.Length == 0 ? null : text;
        }

        private JsonElement? Get(string name)
            => options is { ValueKind: JsonValueKind.Object } element && element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;
    }
}
