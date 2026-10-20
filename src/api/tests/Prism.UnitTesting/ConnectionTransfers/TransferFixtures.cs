using Microsoft.Extensions.Options;
using Prism.Infrastructure.ConnectionFiles.Clients;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Serilog.Core;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// O que os testes da exportação e da importação de conexões (seção 34) usam: registros do cofre com dados inventados (os hosts no domínio reservado
/// `.invalid`), o serviço do arquivo de verdade com uma derivação barata no lugar do Argon2id (a costura `deriveKey`), e o arquivo montado à mão, para a
/// importação receber o que um arquivo editado traria.
/// </summary>
internal static class TransferFixtures
{
    public const string Passphrase = "senha de exportação fictícia";

    public static readonly DateTime CreatedAt = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);

    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    public static VaultFolderRecord Folder(string name, Guid? parentID = null, string? environmentName = null, string? environmentColor = null, string? color = null, string? confirmCommands = null, bool readOnly = false)
        => new(Guid.CreateVersion7(), parentID, name, CreatedAt, CreatedAt, environmentName, environmentColor, color, confirmCommands, readOnly ? true : null);

    public static VaultConnectionRecord Connection(string name, Guid? folderID = null, EDatabaseEngine engine = EDatabaseEngine.Informix, string host = "informix-prd.exemplo.invalid", int port = 9089, string database = "estoque", string userName = "datafix", string password = "senha-ficticia-do-banco", string? environmentName = null, string? environmentColor = null, string? confirmCommands = null, bool readOnly = false, bool? verificationEnabled = null, int? verificationInterval = null, string? verificationQuery = null)
        => new(Guid.CreateVersion7(), folderID, name, engine, host, port, database, userName, password, environmentName, environmentColor, CreatedAt, CreatedAt, confirmCommands, readOnly ? true : null, verificationEnabled, verificationInterval, verificationQuery);

    public static VaultDocument Document(IReadOnlyList<VaultFolderRecord>? folders = null, IReadOnlyList<VaultConnectionRecord>? connections = null)
        => new("marina.costa", folders ?? [], connections ?? [], [], VaultWorkspaceRecord.Empty, []);

    /// <summary>
    /// Uma pasta de scripts (RN-SCRIPT-007): é da seção Scripts, e não uma pasta de conexões. A exportação e a importação de conexões não a levam nem a tocam
    /// (exportar scripts e pastas de scripts fica para depois, seção 34).
    /// </summary>
    public static VaultScriptFolderRecord ScriptFolder(string name, Guid? parentID = null)
        => new(Guid.CreateVersion7(), parentID, name, CreatedAt, CreatedAt);

    /// <summary>Um script salvo, na pasta de scripts dada (RN-SCRIPT-007) ou na raiz da seção Scripts.</summary>
    public static VaultScriptRecord Script(string name, string sql, Guid? folderID = null, Guid? connectionID = null)
        => new(Guid.CreateVersion7(), name, sql, connectionID, null, CreatedAt, CreatedAt, FolderID: folderID);

    /// <summary>A derivação barata: a chave sai da senha e de todos os valores do cabeçalho, como a de verdade, e muda com qualquer um deles.</summary>
    public static byte[] Derive(string passphrase, VaultKdf kdf)
        => SHA256.HashData(Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{passphrase}|{kdf.Algorithm}|{kdf.MemoryKiB}|{kdf.Iterations}|{kdf.Parallelism}|{Convert.ToBase64String(kdf.Salt)}")));

    public static IConnectionFileService CreateFileService(Func<string, VaultKdf, byte[]>? deriveKey = null)
        => new ConnectionFileService(new ConnectionFileClient(Logger.None), Options.Create(new ConnectionFileOptions { MemoryKiB = 8192, Iterations = 1, Parallelism = 1 }), deriveKey ?? Derive);

    /// <summary>Abre o arquivo e devolve o conteúdo em claro como JSON, para o teste conferir o que foi nele.</summary>
    public static async Task<JsonElement> OpenAsync(string content, string passphrase = Passphrase)
    {
        var opened = await CreateFileService().OpenAsync(content, passphrase, root => root.Clone(), CancellationToken.None);
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.ToString() : null);

        return opened.Value;
    }

    /// <summary>Um arquivo de exportação com o conteúdo dado, cifrado como o Prism cifra: o arquivo editado por alguém que tinha a senha (RN-TRANSF-010).</summary>
    public static Task<string> SealAsync(JsonNode content, string passphrase = Passphrase)
        => CreateFileService().SealAsync(content, passphrase, CancellationToken.None);

    /// <summary>Uma pasta do conteúdo do arquivo, na forma da RN-TRANSF-007.</summary>
    public static JsonObject FileFolder(string key, string? parentKey, string name, string? environmentName = null, string? environmentColor = null, string? color = null, string? confirmCommands = null, bool readOnly = false, JsonObject? effective = null)
        => new()
        {
            ["key"] = key,
            ["parentKey"] = parentKey,
            ["name"] = name,
            ["color"] = color,
            ["environmentName"] = environmentName,
            ["environmentColor"] = environmentColor,
            ["confirmCommands"] = confirmCommands,
            ["readOnly"] = readOnly,
            ["effective"] = effective ?? new JsonObject { ["readOnly"] = readOnly, ["confirmCommands"] = confirmCommands }
        };

    /// <summary>Uma conexão do conteúdo do arquivo, na forma da RN-TRANSF-007. O usuário e a senha só aparecem quando vêm.</summary>
    public static JsonObject FileConnection(string key, string? folderKey, string name, string engine = "Informix", string host = "informix-prd.exemplo.invalid", int port = 9089, string database = "estoque", string? userName = "datafix", string? password = "senha-ficticia-do-banco", string? environmentName = null, string? environmentColor = null, string? confirmCommands = null, bool readOnly = false, bool verificationEnabled = true, int verificationInterval = 30, string? verificationQuery = null, JsonObject? effective = null)
    {
        var connection = new JsonObject
        {
            ["key"] = key,
            ["folderKey"] = folderKey,
            ["name"] = name,
            ["engine"] = engine,
            ["host"] = host,
            ["port"] = port,
            ["database"] = database
        };

        if (userName is not null)
            connection["userName"] = userName;

        if (password is not null)
            connection["password"] = password;

        connection["environmentName"] = environmentName;
        connection["environmentColor"] = environmentColor;
        connection["confirmCommands"] = confirmCommands;
        connection["readOnly"] = readOnly;
        connection["verificationEnabled"] = verificationEnabled;
        connection["verificationInterval"] = verificationInterval;
        connection["verificationQuery"] = verificationQuery;
        connection["effective"] = effective ?? new JsonObject { ["readOnly"] = readOnly, ["confirmCommands"] = confirmCommands, ["environmentName"] = environmentName, ["environmentColor"] = environmentColor };

        return connection;
    }

    public static JsonObject FileContent(IEnumerable<JsonObject>? folders = null, IEnumerable<JsonObject>? connections = null)
        => new() { ["folders"] = new JsonArray([.. folders ?? []]), ["connections"] = new JsonArray([.. connections ?? []]) };

    /// <summary>O conteúdo como JSON, para a leitura da importação (`ImportedFile.Read`) sem passar pela cifra.</summary>
    public static JsonElement Parse(JsonNode content)
        => JsonDocument.Parse(content.ToJsonString(WebOptions)).RootElement.Clone();
}
