using Prism.Application.Transfers.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using System.Resources;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// RN-IMPORT-014 e as notas da seção 36, o primeiro passo das rotas da importação: a forma do pedido e as faixas, todas recusadas de uma vez com
/// `IMPORT_OPTIONS_INVALID` no campo, pelo caminho que a tela lê (`fileID`, `format`, `reader.encoding`, `values.decimal`, `target.schema`, `mapping`).
/// O que depende do arquivo e da tabela (a posição além das colunas do arquivo, a coluna que a tabela não tem) é `IMPORT_MAPPING_INVALID`, depois.
/// </summary>
internal static partial class ImportRequestRules
{
    /// <summary>Os textos, no idioma do pedido: <c>ImportRequestRules.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ImportRequestRules));

    /// <summary>As notas da seção 36: o esquema, a tabela e o nome de cada coluna da tabela têm de 1 a 256 caracteres.</summary>
    public const int MaxNameLength = 256;

    /// <summary>RN-IMPORT-008: o mapeamento tem até 16.384 colunas (as colunas do arquivo, no máximo).</summary>
    public const int MaxMapping = 16384;

    /// <summary>A forma do arquivo e do leitor: o identificador que o processo principal deu, o formato e as opções do leitor dele.</summary>
    public static IReadOnlyList<(string Field, string Message)> FileRefusals(string? fileID, string? format, JsonElement? reader, bool keys)
    {
        var refusals = new List<(string, string)>();
        if (!IsFileID(fileID))
            refusals.Add(("fileID", Texts.Get("FileIdInvalid")));

        if (!ImportFormats.Exists(format))
            refusals.Add(("format", Texts.Get("FormatInvalid")));
        else
            refusals.AddRange(ImportReaderOptionsReader.Read(format!, reader, keys).Errors.Select(error => (error.Field, error.Message)));

        return refusals;
    }

    /// <summary>RN-IMPORT-007: os formatos dos valores; o ausente é o padrão.</summary>
    public static IReadOnlyList<(string Field, string Message)> ValuesRefusals(ImportValuesDto? values)
    {
        var refusals = new List<(string, string)>();
        if (values is null)
            return refusals;

        if (values.Decimal is not (null or "point" or "comma"))
            refusals.Add(("values.decimal", Texts.Get("DecimalInvalid")));

        if (values.ThousandsDot && values.Decimal != "comma")
            refusals.Add(("values.thousandsDot", Texts.Get("ThousandsDotInvalid")));

        if (values.Dates is not (null or "iso" or "dayMonthYear"))
            refusals.Add(("values.dates", Texts.Get("DatesInvalid")));

        return refusals;
    }

    /// <summary>As notas da seção 36: a tabela de destino, com o esquema e o nome de 1 a 256 caracteres, sem U+0000.</summary>
    public static IReadOnlyList<(string Field, string Message)> TargetRefusals(ImportTargetDto? target)
    {
        if (target is null)
            return [("target", Texts.Get("TargetRequired"))];

        var refusals = new List<(string, string)>();
        if (target.ConnectionID == Guid.Empty)
            refusals.Add(("target.connectionID", Texts.Get("TargetConnectionRequired")));

        if (!IsName(target.Schema))
            refusals.Add(("target.schema", Texts.Get("SchemaNameLength", MaxNameLength)));

        if (!IsName(target.Table))
            refusals.Add(("target.table", Texts.Get("TableNameLength", MaxNameLength)));

        return refusals;
    }

    /// <summary>RN-IMPORT-009 e as notas da seção 36: de 1 a 16.384 entradas, a posição a partir de 0 e a coluna da tabela de 1 a 256 caracteres, as duas sem repetir.</summary>
    public static IReadOnlyList<(string Field, string Message)> MappingRefusals(IReadOnlyList<ImportMappingDto?>? mapping, bool required)
    {
        if (mapping is null)
            return required ? [("mapping", Texts.Get("MappingRequired"))] : [];

        if (mapping.Count is 0 or > MaxMapping)
            return [("mapping", Texts.Get("MappingCount"))];

        var refusals = new List<(string, string)>();
        var sources = new HashSet<int>();
        var targets = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < mapping.Count; index++)
        {
            if (mapping[index] is not { } entry)
            {
                refusals.Add(($"mapping[{index}]", Texts.Get("MappingEntryShape")));
                continue;
            }

            if (entry.Source < 0)
                refusals.Add(($"mapping[{index}].source", Texts.Get("MappingSourceNegative")));
            else if (!sources.Add(entry.Source))
                refusals.Add(($"mapping[{index}].source", Texts.Get("MappingSourceDuplicate")));

            if (!IsName(entry.Target))
                refusals.Add(($"mapping[{index}].target", Texts.Get("MappingTargetNameLength", MaxNameLength)));
            else if (!targets.Add(entry.Target!))
                refusals.Add(($"mapping[{index}].target", Texts.Get("MappingTargetDuplicate")));
        }

        return refusals;
    }

    /// <summary>
    /// RN-IMPORT-012 e as notas da seção 36: a carga, `{ empty, commitEvery, check }`, lida à mão do corpo (como as opções do leitor), para o tipo errado
    /// ser a recusa no campo: `empty` booleano, falso por padrão; `commitEvery` de 1 a 1.000.000, ou nulo para "Tudo numa transação só" (ausente, o padrão
    /// de 10.000); `check` booleano, verdadeiro por padrão, só na importação (na cópia, presente é recusado).
    /// </summary>
    public static (LoadSettings? Load, IReadOnlyList<(string Field, string Message)> Errors) Load(JsonElement? load, bool copy)
    {
        if (load is not { ValueKind: JsonValueKind.Object } body)
            return (null, [("load", Texts.Get("LoadRequired"))]);

        var errors = new List<(string, string)>();
        var empty = false;
        if (body.TryGetProperty("empty", out var emptyValue))
        {
            if (emptyValue.ValueKind is JsonValueKind.True or JsonValueKind.False)
                empty = emptyValue.GetBoolean();
            else
                errors.Add(("load.empty", Texts.Get("LoadEmptyInvalid")));
        }

        int? commitEvery = LoadSettings.DefaultCommitEvery;
        if (body.TryGetProperty("commitEvery", out var every))
        {
            if (every.ValueKind == JsonValueKind.Null)
                commitEvery = null;
            else if (every.ValueKind == JsonValueKind.Number && every.TryGetInt32(out var rows) && rows is >= 1 and <= LoadSettings.MaxCommitEvery)
                commitEvery = rows;
            else
                errors.Add(("load.commitEvery", Texts.Get("LoadCommitEvery")));
        }

        var check = !copy;
        if (body.TryGetProperty("check", out var checkValue))
        {
            if (copy)
                errors.Add(("load.check", Texts.Get("LoadCheckCopy")));
            else if (checkValue.ValueKind is JsonValueKind.True or JsonValueKind.False)
                check = checkValue.GetBoolean();
            else
                errors.Add(("load.check", Texts.Get("LoadCheckInvalid")));
        }

        return errors.Count == 0 ? (new LoadSettings(empty, commitEvery, check), []) : (null, errors);
    }

    /// <summary>RN-EXPORT-016: o número da janela que começou o trabalho.</summary>
    public static IReadOnlyList<(string Field, string Message)> WindowRefusals(long windowID)
        => windowID <= 0 ? [("windowID", Texts.Get("WindowInvalid"))] : [];

    /// <summary>
    /// RN-IMPORT-009 e 027: a posição do mapeamento além das colunas pedidas (as do arquivo que a prévia leu, ou as da origem em `columns`, na cópia):
    /// `IMPORT_MAPPING_INVALID` no campo `mapping[3].source`. Nula quando todas existem.
    /// </summary>
    public static (string Field, string Message)? SourceRefusal(IReadOnlyList<ImportMappingDto?>? mapping, int columns)
    {
        for (var index = 0; index < (mapping?.Count ?? 0); index++)
        {
            if (mapping![index] is { } entry && entry.Source >= columns)
                return ($"mapping[{index}].source", Texts.Get(columns == 1 ? "SourceColumnMissingOne" : "SourceColumnMissingMany", ImportText.Thousands(entry.Source + 1L), ImportText.Thousands(columns)));
        }

        return null;
    }

    /// <summary>O mapeamento do pedido já conferido.</summary>
    public static IReadOnlyList<ImportMappingEntry> MappingOf(IReadOnlyList<ImportMappingDto?> mapping)
        => [.. mapping.Select(entry => new ImportMappingEntry(entry!.Source, entry.Target!))];

    /// <summary>Os formatos dos valores do pedido já conferido; o ausente é o padrão.</summary>
    public static ImportValueFormats Formats(ImportValuesDto? values)
        => values is null ? ImportValueFormats.Default : new ImportValueFormats(values.Decimal == "comma" ? EImportDecimal.Comma : EImportDecimal.Point, values.ThousandsDot, values.Dates == "dayMonthYear" ? EImportDates.DayMonthYear : EImportDates.Iso);

    /// <summary>As notas da seção 36: o `fileId` do processo principal, 36 caracteres em minúsculas com os hifens, conferido antes de virar nome de arquivo.</summary>
    public static bool IsFileID(string? value)
        => value is not null && FileID().IsMatch(value);

    private static bool IsName(string? name)
        => name is { Length: >= 1 and <= MaxNameLength } && !name.Contains('\0');

    [GeneratedRegex(@"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z")]
    private static partial Regex FileID();
}
