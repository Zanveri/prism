using System.Globalization;
using System.Text.Json;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-010, etapa 7: o conteúdo aberto de um arquivo da exportação, lido campo a campo. Só é arquivo inválido a falta ou o tipo errado de `folders`
/// ou `connections` (listas), de um item delas (um objeto), ou de `key`, `parentKey` ou `folderKey` num item (a `key` é texto; a `parentKey` e a `folderKey`,
/// texto ou nulo, e vêm sempre): sem eles a árvore não se monta. Todo outro campo é guardado como veio (<see cref="FileValue"/>), e o tipo errado ou a falta
/// dele torna só aquele item não importável, com o motivo (`ImportAnalysis`): é o que deixa o resto de um arquivo de um Prism mais novo importável. A leitura
/// ignora o campo que não conhece, e os nomes são os da RN-TRANSF-007, em camelCase.
///
/// Roda dentro do client do arquivo, sobre o buffer em claro, que é zerado assim que ela volta: o que fica do conteúdo é o que ela guarda aqui. RN-LOG-001:
/// todos sobrescrevem o `ToString()` (o gerado imprimiria nomes, hosts e senhas).
/// </summary>
internal sealed record ImportedFile(IReadOnlyList<ImportedFolder> Folders, IReadOnlyList<ImportedConnection> Connections)
{
    /// <summary>
    /// A leitura, em duas passadas. A primeira só confere a forma de todos os itens (barata, sem guardar nada); a segunda, depois das contagens, guarda os
    /// campos de no máximo 2.000 pastas e 2.000 conexões. O arquivo de 5 MiB pode ter muito mais itens que isso, e guardar todos para depois recusá-los
    /// custaria memória à toa.
    /// </summary>
    public static ImportedFileRead Read(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !TryGetArray(root, "folders", out var folders) || !TryGetArray(root, "connections", out var connections))
            return new ImportedFileRead(EImportedFileRead.Invalid, null);

        if (!folders.EnumerateArray().All(item => HasTheShape(item, "parentKey")) || !connections.EnumerateArray().All(item => HasTheShape(item, "folderKey")))
            return new ImportedFileRead(EImportedFileRead.Invalid, null);

        if (folders.GetArrayLength() > TransferLimits.MaxFolders || connections.GetArrayLength() > TransferLimits.MaxConnections)
            return new ImportedFileRead(EImportedFileRead.LimitsExceeded, null);

        var file = new ImportedFile([.. folders.EnumerateArray().Select(ReadFolder)], [.. connections.EnumerateArray().Select(ReadConnection)]);

        return new ImportedFileRead(EImportedFileRead.Read, file);
    }

    public override string ToString()
        => nameof(ImportedFile);

    private static bool TryGetArray(JsonElement root, string name, out JsonElement array)
        => root.TryGetProperty(name, out array) && array.ValueKind == JsonValueKind.Array;

    /// <summary>Um objeto, com a `key` em texto e o pai (`parentKey` na pasta, `folderKey` na conexão) presente, em texto ou nulo.</summary>
    private static bool HasTheShape(JsonElement item, string parentName)
        => item.ValueKind == JsonValueKind.Object
            && item.TryGetProperty("key", out var key) && key.ValueKind == JsonValueKind.String
            && item.TryGetProperty(parentName, out var parent) && parent.ValueKind is JsonValueKind.String or JsonValueKind.Null;

    private static ImportedFolder ReadFolder(JsonElement item)
        => new(
            item.GetProperty("key").GetString()!,
            item.GetProperty("parentKey").GetString(),
            FileValue.Of(item, "name"),
            FileValue.Of(item, "color"),
            FileValue.Of(item, "environmentName"),
            FileValue.Of(item, "environmentColor"),
            FileValue.Of(item, "confirmCommands"),
            FileValue.Of(item, "readOnly"),
            FileEffective.Of(item));

    private static ImportedConnection ReadConnection(JsonElement item)
        => new(
            item.GetProperty("key").GetString()!,
            item.GetProperty("folderKey").GetString(),
            FileValue.Of(item, "name"),
            FileValue.Of(item, "engine"),
            FileValue.Of(item, "host"),
            FileValue.Of(item, "port"),
            FileValue.Of(item, "database"),
            FileValue.Of(item, "userName"),
            FileValue.Of(item, "password"),
            FileValue.Of(item, "environmentName"),
            FileValue.Of(item, "environmentColor"),
            FileValue.Of(item, "confirmCommands"),
            FileValue.Of(item, "readOnly"),
            FileValue.Of(item, "verificationEnabled"),
            FileValue.Of(item, "verificationInterval"),
            FileValue.Of(item, "verificationQuery"),
            FileEffective.Of(item));
}

/// <summary>O que a leitura do conteúdo aberto achou: a forma certa (com o arquivo), a forma errada (`IMPORT_FILE_INVALID`) ou itens demais (`IMPORT_LIMITS_EXCEEDED`).</summary>
internal sealed record ImportedFileRead(EImportedFileRead Outcome, ImportedFile? File)
{
    public override string ToString()
        => nameof(ImportedFileRead);
}

internal enum EImportedFileRead
{
    Read,
    Invalid,
    LimitsExceeded
}

/// <summary>Uma pasta do arquivo: a chave e o pai, que a forma garante, e os outros campos como vieram.</summary>
internal sealed record ImportedFolder(string Key, string? ParentKey, FileValue Name, FileValue Color, FileValue EnvironmentName, FileValue EnvironmentColor, FileValue ConfirmCommands, FileValue ReadOnly, FileEffective Effective)
{
    public override string ToString()
        => nameof(ImportedFolder);
}

/// <summary>Uma conexão do arquivo: a chave e a pasta, que a forma garante, e os outros campos como vieram, a senha do banco inclusive.</summary>
internal sealed record ImportedConnection(string Key, string? FolderKey, FileValue Name, FileValue Engine, FileValue Host, FileValue Port, FileValue Database, FileValue UserName, FileValue Password, FileValue EnvironmentName, FileValue EnvironmentColor, FileValue ConfirmCommands, FileValue ReadOnly, FileValue VerificationEnabled, FileValue VerificationInterval, FileValue VerificationQuery, FileEffective Effective)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o host, o usuário e a senha do banco.</summary>
    public override string ToString()
        => nameof(ImportedConnection);
}

/// <summary>
/// O `effective` de um item (RN-TRANSF-007): ausente ou nulo não acrescenta nada (RN-TRANSF-013); objeto, com os campos dele como vieram; qualquer outra
/// coisa é o tipo errado, e tira o item. A pasta só tem o somente leitura e a confirmação; a conexão tem também o ambiente.
/// </summary>
internal sealed record FileEffective(JsonValueKind Kind, FileValue ReadOnly, FileValue ConfirmCommands, FileValue EnvironmentName, FileValue EnvironmentColor)
{
    public static FileEffective Of(JsonElement item)
    {
        if (!item.TryGetProperty("effective", out var effective))
            return new FileEffective(JsonValueKind.Undefined, FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent);

        if (effective.ValueKind != JsonValueKind.Object)
            return new FileEffective(effective.ValueKind, FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent);

        return new FileEffective(JsonValueKind.Object, FileValue.Of(effective, "readOnly"), FileValue.Of(effective, "confirmCommands"), FileValue.Of(effective, "environmentName"), FileValue.Of(effective, "environmentColor"));
    }

    public bool IsMissing
        => Kind is JsonValueKind.Undefined or JsonValueKind.Null;

    public override string ToString()
        => nameof(FileEffective);
}

/// <summary>
/// Um campo de um item do arquivo como veio: o tipo do JSON (`Undefined` é o campo ausente) e, no texto e no número, o texto dele (o número como foi escrito,
/// para a regra dizer se ele é inteiro e o motivo poder citá-lo). O verdadeiro e o falso estão no próprio tipo. Pode ser a senha do banco: o `ToString()`
/// gerado a imprimiria.
/// </summary>
internal readonly record struct FileValue(JsonValueKind Kind, string? Text)
{
    public static readonly FileValue Absent = new(JsonValueKind.Undefined, null);

    public static FileValue Of(JsonElement item, string name)
    {
        if (!item.TryGetProperty(name, out var value))
            return Absent;

        return value.ValueKind switch
        {
            JsonValueKind.String => new FileValue(JsonValueKind.String, value.GetString()),
            JsonValueKind.Number => new FileValue(JsonValueKind.Number, value.GetRawText()),
            _ => new FileValue(value.ValueKind, null)
        };
    }

    /// <summary>Ausente ou nulo: "não veio", que é o padrão nos opcionais e a falta nos obrigatórios.</summary>
    public bool IsMissing
        => Kind is JsonValueKind.Undefined or JsonValueKind.Null;

    public bool IsText
        => Kind == JsonValueKind.String;

    public bool? Boolean
        => Kind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };

    /// <summary>
    /// O inteiro que cabe num `int`, escrito como inteiro (só dígitos: sem sinal, casas nem expoente); senão nulo. A porta e o intervalo da verificação são
    /// positivos, e "5432.0", "-1" e "1e3" são o tipo errado, com a frase da regra.
    /// </summary>
    public int? Integer
        => Kind == JsonValueKind.Number && int.TryParse(Text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? value : null;

    public override string ToString()
        => nameof(FileValue);
}
