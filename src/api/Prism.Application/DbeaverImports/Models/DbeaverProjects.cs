using Prism.Application.Common.Texts;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Core.Extensions;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Vault.Models;
using System.Security.Cryptography;
using System.Text.Json;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-007 e 008: a leitura de cada projeto da cópia, nos três pedidos (a contagem, a prévia e a importação). `project-settings.json` primeiro
/// (`secureProject` e `useProjectPassword`); depois cada `data-sources*.json` com o `System.Text.Json`, até 64 níveis e sem comentários, e o `credentials-config`
/// que faz par com ele pelo sufixo, decifrado em memória (RN-DBEAVER-008). Nada fica guardado de um pedido para o outro.
/// </summary>
internal static class DbeaverProjects
{
    private const string DefaultStorage = "data-sources.json";
    private const string StoragePrefix = "data-sources";
    private const string CredentialsPrefix = "credentials-config";
    private const string Extension = ".json";

    public const string DuplicatedIDMessage = "O ID desta conexão se repete no projeto.";

    /// <summary>
    /// O mais que um caminho de pastas pode ter para ser aberto em seus pais: bem acima dos 32 níveis (RN-TRANSF-010) e do tamanho de qualquer nome de pasta. O que passa disso
    /// não é aberto em prefixos (um `data-sources.json` hostil faria memória e CPU crescerem com o quadrado do tamanho do caminho): o projeto fica acima dos limites.
    /// </summary>
    public const int MaxPathSegments = 64;

    public const int MaxPathLength = 4096;

    public const string PathTooDeepMessage = "A pasta desta conexão tem níveis demais.";

    /// <summary>
    /// RN-DBEAVER-006: o nome do projeto que o Prism não aceita: vazio, com mais de 255 caracteres (a origem guarda o nome inteiro, RN-DBEAVER-018) ou com
    /// caractere de controle ou de direção do texto (RN-PASTA-001). A API confere isso; o processo principal escreve o nome como está.
    /// </summary>
    public static bool NameIsInvalid(string name)
    {
        var normalized = name.NormalizeName();

        return normalized.Length == 0 || name.Length > VaultConnectionOrigin.ProjectMaxLength || TextRules.HasControlOrDirection(normalized);
    }

    public static DbeaverProjectModel Read(IDbeaverSourceService source, DbeaverProjectFiles project)
    {
        var invalidName = NameIsInvalid(project.Name);
        var display = invalidName ? $"Projeto {project.Position}" : project.Name;
        var files = project.Files.ToDictionary(file => file.Name, StringComparer.Ordinal);

        // O nome que não serve deixa as conexões de fora: nem o arquivo é aberto.
        if (invalidName)
            return new DbeaverProjectModel(project.Position, project.Name, display, NameInvalid: true, Protected: false, Readable: false, CredentialsProtected: false, CredentialsUnreadable: false, 0, [], []);

        // `project-settings.json` que não existe, ou que não é um JSON, é ignorado.
        var settings = files.GetValueOrDefault("project-settings.json") is { Content: { } settingsContent }
            ? source.ReadJson(settingsContent, root => (Secure: Flag(root, "secureProject"), UseProjectPassword: Flag(root, "useProjectPassword")))
            : default;
        var secure = settings.HasValue && settings.Value.Secure;
        var useProjectPassword = settings.HasValue && settings.Value.UseProjectPassword;

        // `secureProject`: o próprio `data-sources.json` é cifrado com a senha do projeto, e o projeto não é lido.
        if (secure)
            return new DbeaverProjectModel(project.Position, project.Name, display, NameInvalid: false, Protected: true, Readable: false, CredentialsProtected: false, CredentialsUnreadable: false, 0, [], []);

        var storages = files.Keys.Where(IsStorage).OrderBy(name => name == DefaultStorage ? 0 : 1).ThenBy(name => name, StringComparer.Ordinal).ToList();
        var folders = new SortedSet<string>(StringComparer.Ordinal);
        var connections = new List<DbeaverConnectionModel>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var unreadableFiles = 0;
        var readableFiles = 0;
        var credentialsUnreadable = false;
        var pathsOverLimit = false;

        foreach (var storage in storages)
        {
            var content = files[storage].Content;
            if (content is null)
            {
                unreadableFiles++;

                continue;
            }

            // O `credentials-config` do par: `data-sources-X.json` com `credentials-config-X.json`. Aberto antes, porque o JSON do arquivo de conexões só vive dentro da leitura.
            var suffix = storage[StoragePrefix.Length..^Extension.Length];
            var logins = Logins(source, files, $"{CredentialsPrefix}{suffix}{Extension}", useProjectPassword, out var unreadable);
            credentialsUnreadable |= unreadable;

            var read = source.ReadJson(content, root => ReadStorage(root, storage == DefaultStorage, logins));
            if (read.HasNoValue || read.Value is not { } parsed)
            {
                unreadableFiles++;

                continue;
            }

            readableFiles++;
            foreach (var path in parsed.Folders)
                pathsOverLimit |= !AddWithParents(folders, path);

            foreach (var connection in parsed.Connections)
            {
                // O caminho que não coube não vira pastas: a conexão fica sem pasta e não é importável, e o projeto passa dos limites (a prévia e a importação o recusam).
                var placed = connection;
                if (!AddWithParents(folders, connection.FolderPath))
                {
                    pathsOverLimit = true;
                    placed = connection with { FolderPath = string.Empty, Refusal = connection.Refusal ?? PathTooDeepMessage };
                }

                connections.Add(seen.Add(placed.ID) ? placed : placed with { Refusal = DuplicatedIDMessage });
            }
        }

        return new DbeaverProjectModel(project.Position, project.Name, display, NameInvalid: false, Protected: false, Readable: readableFiles > 0, CredentialsProtected: useProjectPassword, credentialsUnreadable, unreadableFiles, [.. folders], connections, pathsOverLimit);
    }

    private sealed record Storage(IReadOnlyList<string> Folders, IReadOnlyList<DbeaverConnectionModel> Connections)
    {
        public override string ToString()
            => nameof(Storage);
    }

    /// <summary>
    /// Um `data-sources*.json`: as pastas (só o `data-sources.json` as tem, no DBeaver), os tipos de conexão (`connection-types`, do próprio arquivo) e as
    /// conexões, na ordem do arquivo. O que não é um objeto JSON não é lido (o chamador o conta). O resto do arquivo (`virtual-models`, `network-profiles`,
    /// `auth-profiles`, `saved-filters`, `drivers`, `external-configurations`) é ignorado.
    /// </summary>
    private static Storage? ReadStorage(JsonElement root, bool isDefault, IReadOnlyDictionary<string, DbeaverLogin> logins)
    {
        if (root.ValueKind != JsonValueKind.Object)
            return null;

        var folders = new List<string>();
        if (isDefault && root.TryGetProperty("folders", out var folderObject) && folderObject.ValueKind == JsonValueKind.Object)
            foreach (var folder in folderObject.EnumerateObject())
            {
                // A forma antiga: a chave é só o nome e o `parent` traz o caminho do pai; a de agora, a chave é o caminho inteiro.
                var parent = Text(folder.Value, "parent");
                folders.Add(string.IsNullOrWhiteSpace(parent) ? folder.Name : $"{parent}/{folder.Name}");
            }

        var types = new Dictionary<string, DbeaverType>(StringComparer.Ordinal);
        if (root.TryGetProperty("connection-types", out var typeObject) && typeObject.ValueKind == JsonValueKind.Object)
            foreach (var type in typeObject.EnumerateObject())
                types[type.Name] = new DbeaverType(
                    type.Name, Text(type.Value, "name"), Text(type.Value, "color"), OptionalFlag(type.Value, "confirm-execute"), OptionalFlag(type.Value, "confirm-data-change"),
                    DbeaverConnections.HasPermissionRestriction(Child(type.Value, "security")));

        var connections = new List<DbeaverConnectionModel>();
        if (root.TryGetProperty("connections", out var connectionObject) && connectionObject.ValueKind == JsonValueKind.Object)
            foreach (var connection in connectionObject.EnumerateObject())
            {
                if (connection.Value.ValueKind != JsonValueKind.Object)
                    continue;

                var model = DbeaverConnections.Map(connection.Name, connection.Value, NormalizePath(Text(connection.Value, "folder")), types, logins.GetValueOrDefault(connection.Name));
                if (model is not null)
                    connections.Add(model);
            }

        return new Storage(folders, connections);
    }

    /// <summary>
    /// RN-DBEAVER-008: o usuário e a senha de cada conexão do `credentials-config` do par. O que não existe, ou tem 0 byte, não é erro nem aviso; o protegido por
    /// senha de projeto não é aberto; o que não decifra, não é um JSON nessa forma ou ninguém deixa ler marca as credenciais do projeto como não lidas.
    /// </summary>
    private static IReadOnlyDictionary<string, DbeaverLogin> Logins(IDbeaverSourceService source, IReadOnlyDictionary<string, DbeaverFile> files, string name, bool useProjectPassword, out bool unreadable)
    {
        unreadable = false;
        if (useProjectPassword || !files.TryGetValue(name, out var file))
            return new Dictionary<string, DbeaverLogin>();

        if (file.Content is null)
        {
            unreadable = true;

            return new Dictionary<string, DbeaverLogin>();
        }

        if (file.Content.Length == 0)
            return new Dictionary<string, DbeaverLogin>();

        var decrypted = source.DecryptCredentials(file.Content, ReadLogins);

        // O arquivo cifrado não é o segredo, mas quem o tem abre as senhas com a chave pública: a cópia na memória é zerada assim que foi lida.
        CryptographicOperations.ZeroMemory(file.Content);
        unreadable = decrypted.IsFailure;

        return decrypted.IsSuccess ? decrypted.Value : new Dictionary<string, DbeaverLogin>();
    }

    /// <summary>`{ "&lt;ID&gt;": { "#connection": { "user": "…", "password": "…" }, … } }`. Do nó `#connection`, só `user` e `password`; os nós `network/…` (o túnel SSH) e as entradas `profile:…` são ignorados.</summary>
    private static IReadOnlyDictionary<string, DbeaverLogin> ReadLogins(JsonElement root)
    {
        var logins = new Dictionary<string, DbeaverLogin>(StringComparer.Ordinal);
        foreach (var entry in root.EnumerateObject())
        {
            if (entry.Name.StartsWith("profile:", StringComparison.Ordinal) || entry.Value.ValueKind != JsonValueKind.Object)
                continue;

            var node = Child(entry.Value, "#connection");
            if (node.ValueKind == JsonValueKind.Object)
                logins[entry.Name] = new DbeaverLogin(Text(node, "user"), Text(node, "password"));
        }

        return logins;
    }

    /// <summary>`data-sources.json` e `data-sources-&lt;sufixo&gt;.json`.</summary>
    private static bool IsStorage(string name)
        => name == DefaultStorage || (name.StartsWith(StoragePrefix + "-", StringComparison.Ordinal) && name.EndsWith(Extension, StringComparison.Ordinal));

    /// <summary>O caminho de pastas do DBeaver (`a/b/c`) sem as partes vazias (`a//b` é `a/b`); vazio sem pasta.</summary>
    public static string NormalizePath(string? path)
        => string.IsNullOrEmpty(path) ? string.Empty : string.Join('/', path.Split('/', StringSplitOptions.RemoveEmptyEntries));

    /// <summary>
    /// O caminho e os dos pais (`a/b/c` traz `a`, `a/b` e `a/b/c`): o DBeaver cria os pais implicitamente. Falso quando o caminho passa de <see cref="MaxPathSegments"/> níveis ou de
    /// <see cref="MaxPathLength"/> caracteres (nada é aberto em pais), ou quando as pastas do projeto já passam do limite de 2.000 e o caminho traria uma pasta nova.
    /// </summary>
    private static bool AddWithParents(SortedSet<string> folders, string path)
    {
        var normalized = NormalizePath(path);
        if (normalized.Length == 0)
            return true;

        if (normalized.Length > MaxPathLength || normalized.Count(character => character == '/') + 1 > MaxPathSegments)
            return false;

        var end = -1;
        while ((end = normalized.IndexOf('/', end + 1)) >= 0)
            if (!AddFolder(folders, normalized[..end]))
                return false;

        return AddFolder(folders, normalized);
    }

    /// <summary>Uma pasta a mais; depois de uma além do limite de pastas (RN-TRANSF-010) o conjunto deixa de crescer, e o que já está nele continua valendo.</summary>
    private static bool AddFolder(SortedSet<string> folders, string path)
    {
        if (folders.Count > TransferLimits.MaxFolders)
            return folders.Contains(path);

        folders.Add(path);

        return true;
    }

    private static string? Text(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool Flag(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static bool? OptionalFlag(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.ValueKind == JsonValueKind.True : null;

    private static JsonElement Child(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : default;
}
