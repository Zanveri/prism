using Prism.Application.Scripts.Models;
using Prism.Application.Transfers.Features.StartExport;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Transfers.Writers;
using System.Globalization;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// RN-EXPORT-016, o primeiro passo: a forma do pedido e as faixas que não dependem do banco, todas recusadas com `EXPORT_OPTIONS_INVALID` no campo, pelo
/// caminho que a tela lê (`source.sql`, `columns`, `format`, `options.minWidth`, `output.entryName`, `windowID`). As que dependem do banco da conexão (mais
/// de um comando, o filtro, a leitura, as linhas por comando no Informix) são do handler, depois da conexão.
/// </summary>
internal static class ExportRequestRules
{
    /// <summary>Seção 6: as colunas de um pedido, no máximo.</summary>
    public const int MaxColumns = 32767;

    /// <summary>Seção 6: o esquema, a tabela, o nome da origem e o de cada coluna têm de 1 a 256 caracteres.</summary>
    public const int MaxNameLength = 256;

    /// <summary>Seção 6: o nome do arquivo dentro do .zip tem de 1 a 128 caracteres.</summary>
    public const int MaxEntryNameLength = 128;

    /// <summary>RN-EXPORT-013: as colunas de uma planilha do Excel, no máximo (A a XFD).</summary>
    public const int MaxSheetColumns = 16384;

    public static IReadOnlyList<(string Field, string Message)> Refusals(StartExportCommand request)
    {
        var refusals = new List<(string, string)>();
        var source = request.Source;
        refusals.AddRange(SourceRefusals(source));

        var columns = request.Columns;
        refusals.AddRange(ColumnsRefusals(columns));

        var format = request.Format;
        if (!ExportFormats.Exists(format))
            refusals.Add(("format", $"O formato deve ser um destes: {string.Join(", ", ExportFormats.All)}."));
        else
            refusals.AddRange(ExportOptionsReader.Read(format!, request.Options, DefaultTable(source)).Errors.Select(error => (error.Field, error.Message)));

        if (!refusals.Any(refusal => refusal.Item1 == "columns") && FormatColumnsRefusal(format, columns!) is { } formatColumns)
            refusals.Add(("columns", formatColumns));

        var output = request.Output ?? new();
        if (format == ExportFormats.Xlsx)
        {
            if (output.Bom)
                refusals.Add(("output.bom", "O XLSX não é texto: não leva BOM."));

            if (output.Zip)
                refusals.Add(("output.zip", "O XLSX já é um arquivo compactado."));

            if (output.Clipboard)
                refusals.Add(("output.clipboard", "O XLSX não é texto: não vai para a área de transferência."));
        }
        else if (output.Clipboard)
        {
            if (output.Bom)
                refusals.Add(("output.bom", "Com a área de transferência, o texto não leva BOM."));

            if (output.Zip)
                refusals.Add(("output.zip", "Com a área de transferência, o texto não vai num .zip."));
        }

        if (output.Zip && !IsEntryName(output.EntryName))
            refusals.Add(("output.entryName", $"O nome do arquivo dentro do .zip tem de 1 a {MaxEntryNameLength} caracteres, sem / nem \\, sem caractere de controle nem marca de direção, e não é . nem ..."));
        else if (!output.Zip && output.EntryName is not null)
            refusals.Add(("output.entryName", "O nome do arquivo dentro do .zip só vale com o .zip."));

        if (request.WindowID <= 0)
            refusals.Add(("windowID", "O número da janela é um inteiro positivo."));

        return refusals;
    }

    /// <summary>
    /// RN-EXPORT-002 e seção 6: a origem (a tabela pelo navegador, ou o comando dos Registros e do resultado), a mesma na exportação e na cópia para outro
    /// banco (RN-IMPORT-027), que a recusa com o código dela.
    /// </summary>
    public static IReadOnlyList<(string Field, string Message)> SourceRefusals(ExportSourceDto? source)
    {
        var refusals = new List<(string, string)>();
        if (source is null)
            refusals.Add(("source", "Informe a origem da exportação."));
        else if (source.Kind == "table")
        {
            if (!IsName(source.Schema))
                refusals.Add(("source.schema", NameMessage("O esquema")));

            if (!IsName(source.Table))
                refusals.Add(("source.table", NameMessage("A tabela")));
        }
        else if (source.Kind == "query")
        {
            if (string.IsNullOrWhiteSpace(source.Sql))
                refusals.Add(("source.sql", "Informe o comando da origem."));
            else if (!ScriptRules.FitsTheLimit(source.Sql))
                refusals.Add(("source.sql", "O comando pode ter até 1 MB."));

            if (source.Name is not null && !IsName(source.Name))
                refusals.Add(("source.name", NameMessage("O nome da origem")));
        }
        else
        {
            refusals.Add(("source.kind", "A origem deve ser table ou query."));
        }

        return refusals;
    }

    /// <summary>RN-EXPORT-005 e seção 6: as colunas marcadas na Extração, de 1 a 32.767, cada uma com a posição a partir de 0, sem repetir, e o nome.</summary>
    public static IReadOnlyList<(string Field, string Message)> ColumnsRefusals(IReadOnlyList<ExportColumnDto>? columns)
    {
        if (columns is null || columns.Count is 0 or > MaxColumns)
            return [("columns", "Marque de 1 a 32.767 colunas.")];

        if (columns.Any(column => column is null || column.Position < 0) || columns.Select(column => column.Position).Distinct().Count() != columns.Count)
            return [("columns", "Cada coluna tem uma posição a partir de 0, sem repetir.")];

        return columns.Any(column => !IsName(column.Name)) ? [("columns", NameMessage("O nome de cada coluna"))] : [];
    }

    /// <summary>
    /// RN-EXPORT-011 e 013: o que o formato não aceita nas colunas marcadas, que o assistente já não deixa passar da Extração. No SQL, duas colunas com o
    /// mesmo nome fariam um `INSERT` que o banco recusa; no XLSX, uma planilha do Excel tem no máximo 16.384 colunas.
    /// </summary>
    private static string? FormatColumnsRefusal(string? format, IReadOnlyList<ExportColumnDto> columns)
    {
        if (format == ExportFormats.Sql && columns.GroupBy(column => column?.Name, StringComparer.Ordinal).FirstOrDefault(group => group.Key is not null && group.Count() > 1) is { } repeated)
            return $"O resultado tem duas colunas chamadas {repeated.Key}: deixe uma de fora na Extração.";

        if (format == ExportFormats.Xlsx && columns.Count > MaxSheetColumns)
            return $"Uma planilha do Excel tem no máximo 16.384 colunas: deixe {Thousands(columns.Count - MaxSheetColumns)} de fora na Extração, ou escolha outro formato.";

        return null;
    }

    /// <summary>O número com o ponto de milhar do português ("1.234"), sem depender da cultura da máquina.</summary>
    private static string Thousands(int value)
        => value.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', '.');

    /// <summary>RN-EXPORT-011 e 012: a tabela de destino do SQL e do DbUnit, quando ela não vem: a da origem (`source.table`, ou `source.name` nos Registros).</summary>
    public static string? DefaultTable(Dtos.ExportSourceDto? source)
        => source?.Kind == "table" ? source.Table : source?.Name;

    private static bool IsName(string? name)
        => name is { Length: >= 1 and <= MaxNameLength } && !name.Contains('\0');

    private static string NameMessage(string what)
        => $"{what} tem de 1 a {MaxNameLength} caracteres, sem U+0000.";

    /// <summary>Seção 6: o nome dentro do .zip, pelas regras do nome do arquivo (RN-EXPORT-014).</summary>
    private static bool IsEntryName(string? name)
        => name is { Length: >= 1 and <= MaxEntryNameLength } and not ("." or "..") && !name.Any(character => character is '/' or '\\' || char.IsControl(character) || IsDirectionMark(character));

    private static bool IsDirectionMark(char character)
        => character is (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069') or '\u200E' or '\u200F' or '\u061C';
}
