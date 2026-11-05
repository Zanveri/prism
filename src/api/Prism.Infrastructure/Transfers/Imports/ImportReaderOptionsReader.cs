using System.Text.Json;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>Uma opção do leitor recusada, com o caminho do campo como a tela o lê (`reader.nullText`) e o motivo.</summary>
public sealed record ImportOptionError(string Field, string Message);

/// <summary>
/// RN-IMPORT-004 a 006 e as notas da seção 36: lê as opções do leitor do corpo do pedido (`reader`, um objeto JSON), com o padrão do Prism no que não veio,
/// e recusa o valor fora da lista ou da faixa, e também o do tipo errado, no campo (`IMPORT_OPTIONS_INVALID`). A chave que o formato não tem é ignorada.
/// Lê o JSON à mão, como o `ExportOptionsReader`, para o tipo errado ser a mesma recusa no campo, e não o 400 do MVC.
/// </summary>
public static class ImportReaderOptionsReader
{
    /// <summary>RN-IMPORT-004: o texto do nulo tem até 100 caracteres.</summary>
    public const int MaxNullText = 100;

    /// <summary>RN-IMPORT-006: o nome de uma planilha tem de 1 a 31 caracteres.</summary>
    public const int MaxSheetName = 31;

    private static readonly string[] Delimiters = ["auto", ";", ",", "\t", "|"];

    /// <param name="keys">As chaves do JSON valem neste pedido (`imports/preview` e `imports`); no `imports/read`, que as acha, são ignoradas.</param>
    public static (ImportReaderOptions? Options, IReadOnlyList<ImportOptionError> Errors) Read(string format, JsonElement? reader, bool keys)
    {
        var errors = new List<ImportOptionError>();
        if (reader is { ValueKind: not (JsonValueKind.Object or JsonValueKind.Null or JsonValueKind.Undefined) })
            return (null, [new ImportOptionError("reader", ImportText.Say("ReaderObject"))]);

        var options = new Reader(reader, errors);
        ImportReaderOptions? read = format switch
        {
            ImportFormats.Csv or ImportFormats.Tsv => Csv(options, format == ImportFormats.Tsv),
            ImportFormats.Json => new JsonImportOptions(keys ? options.Keys() : null),
            ImportFormats.Xlsx => new XlsxImportOptions(options.Sheet(), options.Bool("header", true), options.Bool("skipEmptyLines", true)),
            _ => null
        };

        return errors.Count == 0 ? (read, []) : (null, errors);
    }

    private static CsvImportOptions Csv(Reader options, bool tsv)
    {
        var encoding = options.Choice("encoding", ImportEncodings.All, ImportEncodings.Auto, ImportText.Say("EncodingChoice"));
        var delimiter = tsv
            ? options.Choice("delimiter", ["\t"], "\t", ImportText.Say("DelimiterTsv"))
            : options.Choice("delimiter", Delimiters, "auto", ImportText.Say("DelimiterChoice"));
        var quote = options.Choice("quote", ["double", "none"], "double", ImportText.Say("QuoteChoice"));
        var nullText = options.Text("nullText", string.Empty);
        if (nullText.Length > MaxNullText)
            options.Refuse("nullText", ImportText.Say("NullTextMax", MaxNullText));
        else if (nullText.Any(char.IsControl))
            options.Refuse("nullText", ImportText.Say("NullTextControl"));

        return new CsvImportOptions(encoding, delimiter == "auto" ? null : delimiter, options.Bool("header", true), quote == "double", nullText, options.Bool("emptyAsNull", false), options.Bool("trim", false), options.Bool("skipEmptyLines", true), options.Bool("unguardFormulas", true));
    }

    /// <summary>A leitura de cada opção: o valor do tipo e da faixa certos, ou o padrão com a recusa anotada.</summary>
    private sealed class Reader(JsonElement? options, List<ImportOptionError> errors)
    {
        public void Refuse(string name, string message)
            => errors.Add(new ImportOptionError($"reader.{name}", message));

        public bool Bool(string name, bool fallback)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return value.GetBoolean();

            Refuse(name, ImportText.Say("OptionBool", name));

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

        public string Text(string name, string fallback)
        {
            if (Get(name) is not { } value)
                return fallback;

            if (value.ValueKind == JsonValueKind.String)
                return value.GetString()!;

            Refuse(name, ImportText.Say("OptionText", name));

            return fallback;
        }

        /// <summary>RN-IMPORT-006: a planilha pelo nome, de 1 a 31 caracteres; ausente, a primeira que não é oculta.</summary>
        public string? Sheet()
        {
            if (Get("sheet") is not { } value)
                return null;

            if (value.ValueKind == JsonValueKind.String && value.GetString() is { Length: >= 1 and <= MaxSheetName } sheet)
                return sheet;

            Refuse("sheet", ImportText.Say("SheetName", MaxSheetName));

            return null;
        }

        /// <summary>RN-IMPORT-005: as chaves que o `imports/read` achou, de 1 a 16.384 nomes de até 256 caracteres, sem repetir; ausentes, a leitura as acha.</summary>
        public IReadOnlyList<string>? Keys()
        {
            if (Get("keys") is not { } value)
                return null;

            var message = ImportText.Say("KeysList");
            if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is 0 or > 16384 || value.EnumerateArray().Any(key => key.ValueKind != JsonValueKind.String || key.GetString()!.Length > 256))
            {
                Refuse("keys", message);

                return null;
            }

            var keys = value.EnumerateArray().Select(key => key.GetString()!).ToList();
            if (keys.Distinct(StringComparer.Ordinal).Count() != keys.Count)
            {
                Refuse("keys", message);

                return null;
            }

            return keys;
        }

        private JsonElement? Get(string name)
            => options is { ValueKind: JsonValueKind.Object } element && element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;
    }
}
