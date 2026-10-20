using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-010 (etapa 7) e RN-TRANSF-014: o que o arquivo aberto traz, conferido. Primeiro a estrutura, que recusa o arquivo inteiro, nesta ordem e antes
/// de qualquer caminho pela árvore: as chaves (de 1 a 64 caracteres, únicas no conjunto das pastas e das conexões, comparação exata), as referências (toda
/// `parentKey` e toda `folderKey` aponta para uma pasta do arquivo) e os ciclos (`IMPORT_FILE_INVALID`), e depois os níveis (até 32, a pasta da raiz do
/// arquivo é o nível 1: `IMPORT_LIMITS_EXCEEDED`). Depois cada item, com as regras da criação e a normalização dela, as mesmas do formulário e num lugar
/// só com elas (`FolderRules`, `ConnectionRules`, `EnvironmentRules`, `ProtectionRules`): o item que não passa não é importado, com a frase da regra, e a
/// pasta que não passa leva junto o que está dentro dela. Nada é confiado por ter vindo cifrado: o arquivo que alguém abriu, mudou e cifrou de novo com a
/// senha passa pela cifra.
///
/// E, de cada item que passa, o que valia nele na origem (RN-TRANSF-013): o mais forte entre o `effective` do arquivo e o que as pastas do arquivo dão.
/// </summary>
internal sealed class ImportAnalysis
{
    private ImportAnalysis(IReadOnlyList<ImportFolderItem> folders, IReadOnlyList<ImportConnectionItem> connections)
    {
        Folders = folders;
        Connections = connections;
        FoldersByKey = folders.ToDictionary(folder => folder.Key, StringComparer.Ordinal);
        ConnectionsByKey = connections.ToDictionary(connection => connection.Key, StringComparer.Ordinal);
    }

    /// <summary>As pastas do arquivo, cada uma depois da pasta dela (pelo nível, e na ordem do arquivo dentro de um nível).</summary>
    public IReadOnlyList<ImportFolderItem> Folders { get; }

    /// <summary>As conexões do arquivo, na ordem dele.</summary>
    public IReadOnlyList<ImportConnectionItem> Connections { get; }

    public IReadOnlyDictionary<string, ImportFolderItem> FoldersByKey { get; }

    public IReadOnlyDictionary<string, ImportConnectionItem> ConnectionsByKey { get; }

    /// <summary>Quantos itens do arquivo não podem ser importados (RN-TRANSF-014), para o log.</summary>
    public int InvalidCount
        => Folders.Count(folder => folder.Invalid is not null) + Connections.Count(connection => connection.Invalid is not null);

    public override string ToString()
        => nameof(ImportAnalysis);

    /// <param name="checkDepth">
    /// Falso na contagem do "Importar do DBeaver" (RN-DBEAVER-007): ela não confere os limites, só diz quantas conexões o Prism importa de cada projeto. Os níveis das pastas
    /// continuam conferidos no arquivo do Prism (RN-TRANSF-010) e na prévia e na importação do DBeaver.
    /// </param>
    public static Result<ImportAnalysis, ApiErrorDto> Analyze(ImportedFile file, bool checkDepth = true)
    {
        var keys = new HashSet<string>(StringComparer.Ordinal);

        // As chaves, as referências e os ciclos: a estrutura que fecha. Sem ela a árvore não se monta, e o arquivo inteiro é recusado. As chaves vêm antes
        // de qualquer dicionário: uma chave repetida é recusa do arquivo, e não exceção.
        if (!file.Folders.Select(folder => folder.Key).Concat(file.Connections.Select(connection => connection.Key)).All(key => key.Length is >= 1 and <= TransferLimits.MaxKeyLength && keys.Add(key)))
            return TransferErrors.FileInvalid();

        var folders = file.Folders.ToDictionary(folder => folder.Key, StringComparer.Ordinal);

        if (file.Folders.Any(folder => folder.ParentKey is { } parent && !folders.ContainsKey(parent)) || file.Connections.Any(connection => connection.FolderKey is { } parent && !folders.ContainsKey(parent)))
            return TransferErrors.FileInvalid();

        if (Depths(file.Folders, folders) is not { } depths)
            return TransferErrors.FileInvalid();

        if (checkDepth && depths.Values.Any(depth => depth > TransferLimits.MaxDepth))
            return TransferErrors.ImportLimitsExceeded();

        // Cada pasta depois da pasta dela: a que não passa leva junto o que está dentro dela, e o que valia na origem desce pelo caminho.
        var checkedFolders = new Dictionary<string, ImportFolderItem>(StringComparer.Ordinal);
        foreach (var folder in file.Folders.Select((folder, index) => (folder, index)).OrderBy(entry => depths[entry.folder.Key]).ThenBy(entry => entry.index).Select(entry => entry.folder))
            checkedFolders[folder.Key] = CheckFolder(folder, depths[folder.Key], folder.ParentKey is { } parent ? checkedFolders[parent] : null);

        var checkedConnections = file.Connections.Select(connection => CheckConnection(connection, connection.FolderKey is { } parent ? checkedFolders[parent] : null)).ToList();

        return new ImportAnalysis([.. checkedFolders.Values], checkedConnections);
    }

    /// <summary>
    /// O nível de cada pasta (a da raiz do arquivo é o 1), ou nulo quando alguma fica dentro dela mesma ou de uma descendente (um ciclo de qualquer tamanho).
    /// Cada caminho sobe até uma pasta de nível já conhecido, ou até a raiz, e os níveis do caminho são guardados na volta: o arquivo inteiro custa uma
    /// passada, e não a profundidade de cada pasta.
    /// </summary>
    private static Dictionary<string, int>? Depths(IReadOnlyList<ImportedFolder> list, IReadOnlyDictionary<string, ImportedFolder> folders)
    {
        var depths = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var folder in list)
        {
            var path = new List<string>();
            var onPath = new HashSet<string>(StringComparer.Ordinal);
            string? current = folder.Key;

            while (current is not null && !depths.ContainsKey(current))
            {
                if (!onPath.Add(current))
                    return null;

                path.Add(current);
                current = folders[current].ParentKey;
            }

            var depth = current is null ? 0 : depths[current];
            for (var index = path.Count - 1; index >= 0; index--)
                depths[path[index]] = ++depth;
        }

        return depths;
    }

    private static ImportFolderItem CheckFolder(ImportedFolder folder, int depth, ImportFolderItem? parent)
    {
        var display = folder.Name.IsText ? TextRules.Cut(folder.Name.Text!, TransferLimits.InvalidTextLength) : folder.Key;

        if (FolderRefusal(folder, out var candidate) is { } refusal)
            return new ImportFolderItem(folder.Key, folder.ParentKey, depth, folder, null, null, null, refusal, display);

        // RN-TRANSF-014: a pasta que não passa leva junto o que está dentro dela. O motivo cita a pasta mais próxima acima que não passou pelo próprio motivo.
        if (parent is { Invalid: not null } || parent is { Origin: null } || candidate is null)
            return new ImportFolderItem(folder.Key, folder.ParentKey, depth, folder, null, null, null, Blocked(parent!.BlockingName), parent.BlockingName);

        // RN-TRANSF-013: o que valia na pasta na origem, o mais forte entre o `effective` dela e o que as pastas do arquivo dão (o que valia na pasta de cima
        // já inclui as de cima dela). O ambiente não desce para as subpastas (RN-PASTA-005): só o que uma conexão sem ambiente próprio herdaria.
        var origin = new ImportOrigin(
            candidate.ReadOnly || candidate.EffectiveReadOnly || parent?.Origin?.ReadOnly == true,
            Strongest(candidate.ConfirmCommands, candidate.EffectiveConfirmCommands, parent?.Origin?.ConfirmCommands),
            null);
        var inherited = candidate.EnvironmentName is { } name ? new ShownEnvironment(name, candidate.EnvironmentColor) : parent?.InheritedEnvironment;

        return new ImportFolderItem(folder.Key, folder.ParentKey, depth, folder, candidate, origin, inherited, null, display);
    }

    private static ImportConnectionItem CheckConnection(ImportedConnection connection, ImportFolderItem? folder)
    {
        if (connection.SourceRefusal is { } sourceRefusal)
            return new ImportConnectionItem(connection.Key, connection.FolderKey, connection, null, null, sourceRefusal);

        if (ConnectionRefusal(connection, out var candidate) is { } refusal)
            return new ImportConnectionItem(connection.Key, connection.FolderKey, connection, null, null, refusal);

        if (folder is { Invalid: not null } || folder is { Origin: null } || candidate is null)
            return new ImportConnectionItem(connection.Key, connection.FolderKey, connection, null, null, Blocked(folder!.BlockingName));

        // RN-TRANSF-013: o ambiente que ela mostrava na origem é o próprio; sem ele, o do `effective` do arquivo; sem ele, o da pasta mais próxima acima, no
        // arquivo, que tenha um. Num arquivo que o Prism gerou os dois últimos são iguais.
        var environment = candidate.EnvironmentName is { } own
            ? new ShownEnvironment(own, candidate.EnvironmentColor)
            : candidate.EffectiveEnvironmentName is { } effective ? new ShownEnvironment(effective, candidate.EffectiveEnvironmentColor) : folder?.InheritedEnvironment;
        var origin = new ImportOrigin(
            candidate.ReadOnly || candidate.EffectiveReadOnly || folder?.Origin?.ReadOnly == true,
            Strongest(candidate.ConfirmCommands, candidate.EffectiveConfirmCommands, folder?.Origin?.ConfirmCommands),
            environment);

        return new ImportConnectionItem(connection.Key, connection.FolderKey, connection, candidate, origin, null);
    }

    private static string Blocked(string folderName)
        => $"A pasta {folderName} não pode ser importada.";

    /// <summary>RN-PROT-001 e 004: a confirmação mais alta entre as que vieram, nula quando é "Não".</summary>
    private static string? Strongest(params string?[] confirmations)
        => confirmations.OrderByDescending(ProtectionRules.Rank).FirstOrDefault(confirmation => ProtectionRules.Rank(confirmation) > 0);

    /// <summary>RN-PASTA-001, RN-PASTA-005, RN-PASTA-007 e RN-PROT-001 e 002: as regras da criação da pasta, a primeira recusa.</summary>
    private static string? FolderRefusal(ImportedFolder folder, out FolderCandidate? candidate)
    {
        candidate = null;

        if (TextRule(folder.Name, "o nome da pasta", required: true, FolderRules.NameRefusal, out var name) is { } nameRefusal)
            return nameRefusal;

        if (TextRule(folder.Color, "a cor da pasta", required: false, EnvironmentRules.ColorRefusal, out var color) is { } colorRefusal)
            return colorRefusal;

        if (Environment(folder.EnvironmentName, folder.EnvironmentColor, "da pasta", out var environmentName, out var environmentColor) is { } environmentRefusal)
            return environmentRefusal;

        if (Confirmation(folder.ConfirmCommands, "a confirmação da pasta", out var confirm) is { } confirmRefusal)
            return confirmRefusal;

        if (Flag(folder.ReadOnly, "o somente leitura da pasta", fallback: false, out var readOnly) is { } readOnlyRefusal)
            return readOnlyRefusal;

        if (Effective(folder.Effective, "o que valia na pasta", withEnvironment: false, out var effective) is { } effectiveRefusal)
            return effectiveRefusal;

        candidate = new FolderCandidate(name.NormalizeName(), EnvironmentRules.NormalizeColor(color), environmentName, environmentColor, ProtectionRules.NormalizeConfirmation(confirm), readOnly, effective.ReadOnly, effective.ConfirmCommands);

        return null;
    }

    /// <summary>RN-CONN-010, RN-PROT-001 e 002, RN-VERIF-001 e RN-TRANSF-015: as regras da criação da conexão, menos o usuário e a senha, que podem faltar.</summary>
    private static string? ConnectionRefusal(ImportedConnection connection, out ConnectionCandidate? candidate)
    {
        candidate = null;

        if (TextRule(connection.Name, "o nome da conexão", required: true, ConnectionRules.NameRefusal, out var name) is { } nameRefusal)
            return nameRefusal;

        if (EngineRefusal(connection.Engine, out var engine) is { } engineRefusal)
            return engineRefusal;

        if (TextRule(connection.Host, "o host", required: true, ConnectionRules.HostRefusal, out var host) is { } hostRefusal)
            return hostRefusal;

        if (connection.Port.IsMissing)
            return Missing("a porta");

        // A porta é um inteiro de 1 a 65535: o texto, o número com casas e o negativo dão a frase da regra.
        if (connection.Port.Integer is not { } port || ConnectionRules.PortRefusal(port) is not null)
            return ConnectionRules.PortRefusal(0);

        if (TextRule(connection.Database, "o banco de dados", required: true, ConnectionRules.DatabaseRefusal, out var database) is { } databaseRefusal)
            return databaseRefusal;

        if (TextRule(connection.UserName, "o usuário do banco", required: false, userName => ConnectionRules.UserNameRefusal(userName, required: false), out var userName) is { } userRefusal)
            return userRefusal;

        if (TextRule(connection.Password, "a senha do banco", required: false, ConnectionRules.PasswordRefusal, out var password) is { } passwordRefusal)
            return passwordRefusal;

        // RN-TRANSF-007: o `password` só vem com o `userName`.
        if (!string.IsNullOrEmpty(password) && string.IsNullOrWhiteSpace(userName))
            return "A senha do banco veio sem o usuário.";

        if (Environment(connection.EnvironmentName, connection.EnvironmentColor, "da conexão", out var environmentName, out var environmentColor) is { } environmentRefusal)
            return environmentRefusal;

        if (Confirmation(connection.ConfirmCommands, "a confirmação da conexão", out var confirm) is { } confirmRefusal)
            return confirmRefusal;

        if (Flag(connection.ReadOnly, "o somente leitura da conexão", fallback: false, out var readOnly) is { } readOnlyRefusal)
            return readOnlyRefusal;

        if (Flag(connection.VerificationEnabled, "a verificação da conexão", fallback: true, out var verificationEnabled) is { } enabledRefusal)
            return enabledRefusal;

        var interval = ConnectionRules.VerificationIntervalDefault;
        if (!connection.VerificationInterval.IsMissing)
        {
            if (connection.VerificationInterval.Integer is not { } value || !ConnectionRules.VerificationIntervalIsValid(value))
                return ConnectionRules.VerificationIntervalMessage;

            interval = value;
        }

        // RN-VERIF-001: até 1.000 caracteres e uma leitura só no banco da conexão, com a caixa "Manter as consultas de verificação do arquivo" marcada ou não:
        // ela roda sozinha a cada intervalo depois de conectar, com as credenciais da conexão.
        if (TextRule(connection.VerificationQuery, "a consulta de verificação", required: false, query => ConnectionRules.VerificationQueryRefusal(query, engine), out var query) is { } queryRefusal)
            return queryRefusal;

        if (Effective(connection.Effective, "o que valia na conexão", withEnvironment: true, out var effective) is { } effectiveRefusal)
            return effectiveRefusal;

        candidate = new ConnectionCandidate(
            name.NormalizeName(), engine, host!.Trim(), port, database!.Trim(), userName?.Trim() ?? string.Empty, password ?? string.Empty, environmentName, environmentColor,
            ProtectionRules.NormalizeConfirmation(confirm), readOnly, verificationEnabled, interval, ConnectionRules.NormalizeVerificationQuery(query),
            effective.ReadOnly, effective.ConfirmCommands, effective.EnvironmentName, effective.EnvironmentColor);

        return null;
    }

    /// <summary>Os bancos que este Prism conhece, escritos como o arquivo os escreve (RN-TRANSF-007): pelo nome, exato, e não pelo número da API.</summary>
    private static readonly IReadOnlyDictionary<string, EDatabaseEngine> Engines = new Dictionary<string, EDatabaseEngine>(StringComparer.Ordinal)
    {
        [nameof(EDatabaseEngine.PostgreSql)] = EDatabaseEngine.PostgreSql,
        [nameof(EDatabaseEngine.Db2)] = EDatabaseEngine.Db2,
        [nameof(EDatabaseEngine.Informix)] = EDatabaseEngine.Informix
    };

    /// <summary>O banco do arquivo, quando este Prism o conhece; a prévia o mostra também no item que não pode ser importado por outro motivo.</summary>
    public static EDatabaseEngine? EngineOf(FileValue engine)
        => engine.IsText && Engines.TryGetValue(engine.Text!, out var known) ? known : null;

    private static string? EngineRefusal(FileValue value, out EDatabaseEngine engine)
    {
        engine = default;
        if (value.IsMissing)
            return Missing("o banco da conexão");

        if (EngineOf(value) is { } known)
        {
            engine = known;

            return null;
        }

        // O número (o da API) e o nome que este Prism não conhece, citados como vieram: um arquivo de um Prism mais novo pode trazer um banco a mais.
        return value.Kind is JsonValueKind.String or JsonValueKind.Number ? $"Este Prism não conhece o banco {TextRules.Cut(value.Text!, TransferLimits.InvalidTextLength)}." : WrongType("o banco da conexão");
    }

    /// <summary>O ambiente (nome e cor), opcional, com as regras e a normalização do ambiente (RN-PASTA-005 e RN-CONN-010).</summary>
    private static string? Environment(FileValue name, FileValue color, string owner, out string? environmentName, out string? environmentColor)
    {
        environmentName = null;
        environmentColor = null;

        if (TextRule(name, $"o ambiente {owner}", required: false, EnvironmentRules.NameRefusal, out var nameText) is { } nameRefusal)
            return nameRefusal;

        if (TextRule(color, $"a cor do ambiente {owner}", required: false, EnvironmentRules.ColorRefusal, out var colorText) is { } colorRefusal)
            return colorRefusal;

        environmentName = EnvironmentRules.NormalizeName(nameText);
        environmentColor = EnvironmentRules.NormalizeColor(colorText);

        return null;
    }

    /// <summary>RN-PROT-001: `none`, `irreversible` ou `all`, como a API os escreve; nulo ou em branco é "Não".</summary>
    private static string? Confirmation(FileValue value, string label, out string? confirm)
    {
        if (Text(value, label, required: false, out confirm) is { } refusal)
            return refusal;

        return ProtectionRules.ConfirmationIsValid(confirm) ? null : "Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.";
    }

    /// <summary>
    /// O `effective` (RN-TRANSF-007): ausente ou nulo não acrescenta nada; objeto, com o somente leitura (verdadeiro, falso ou nulo), a confirmação e, na
    /// conexão, o ambiente, cada um com a regra da criação, porque é o que a importação pode gravar no item (RN-TRANSF-013).
    /// </summary>
    private static string? Effective(FileEffective value, string label, bool withEnvironment, out ImportFileEffective effective)
    {
        effective = ImportFileEffective.None;
        if (value.IsMissing)
            return null;

        if (value.Kind != JsonValueKind.Object)
            return WrongType(label);

        if (Flag(value.ReadOnly, label, fallback: false, out var readOnly) is { } readOnlyRefusal)
            return readOnlyRefusal;

        if (Confirmation(value.ConfirmCommands, label, out var confirm) is { } confirmRefusal)
            return confirmRefusal;

        string? environmentName = null;
        string? environmentColor = null;
        if (withEnvironment && Environment(value.EnvironmentName, value.EnvironmentColor, "que valia na conexão", out environmentName, out environmentColor) is { } environmentRefusal)
            return environmentRefusal;

        effective = new ImportFileEffective(readOnly, ProtectionRules.NormalizeConfirmation(confirm), environmentName, environmentColor);

        return null;
    }

    /// <summary>Um texto (<see cref="Text"/>) e, quando ele veio, a regra da criação sobre ele: a primeira recusa, ou nula.</summary>
    private static string? TextRule(FileValue value, string label, bool required, Func<string?, string?> rule, out string? text)
        => Text(value, label, required, out text) ?? (text is null ? null : rule(text));

    /// <summary>Um texto: ausente ou nulo é "não veio" (a falta, quando é obrigatório); outro tipo é o tipo errado. Devolve a recusa, ou nula.</summary>
    private static string? Text(FileValue value, string label, bool required, out string? text)
    {
        text = null;
        if (value.IsMissing)
            return required ? Missing(label) : null;

        if (!value.IsText)
            return WrongType(label);

        text = value.Text;

        return null;
    }

    /// <summary>Verdadeiro, falso, ou ausente e nulo (o padrão, <paramref name="fallback"/>); outro tipo é o tipo errado ("o readOnly que não é verdadeiro, falso nem nulo").</summary>
    private static string? Flag(FileValue value, string label, bool fallback, out bool flag)
    {
        flag = fallback;
        if (value.IsMissing)
            return null;

        if (value.Boolean is not { } boolean)
            return WrongType(label);

        flag = boolean;

        return null;
    }

    private static string Missing(string label)
        => $"Falta {label} no arquivo.";

    private static string WrongType(string label)
        => $"{char.ToUpperInvariant(label[0])}{label[1..]} não está no formato que este Prism lê.";
}

/// <summary>Uma pasta do arquivo conferida: o que ela traz já normalizado (`Candidate`), ou o motivo de não poder ser importada (`Invalid`).</summary>
/// <param name="Origin">O que valia nela na origem (RN-TRANSF-013); nulo na que não pode ser importada.</param>
/// <param name="InheritedEnvironment">O ambiente que uma conexão sem ambiente próprio herdaria nela, no arquivo (RN-PASTA-005).</param>
/// <param name="BlockingName">O nome, cortado, que o motivo das que estão dentro dela cita, se ela não pode ser importada: o dela, ou o da pasta acima que a levou junto.</param>
internal sealed record ImportFolderItem(string Key, string? ParentKey, int Depth, ImportedFolder Raw, FolderCandidate? Candidate, ImportOrigin? Origin, ShownEnvironment? InheritedEnvironment, string? Invalid, string BlockingName)
{
    public override string ToString()
        => nameof(ImportFolderItem);
}

/// <summary>Uma conexão do arquivo conferida, como a pasta (`ImportFolderItem`).</summary>
internal sealed record ImportConnectionItem(string Key, string? FolderKey, ImportedConnection Raw, ConnectionCandidate? Candidate, ImportOrigin? Origin, string? Invalid)
{
    public override string ToString()
        => nameof(ImportConnectionItem);
}

/// <summary>A pasta que pode ser importada, com o que ela traz normalizado como a criação normaliza, e o `effective` do arquivo.</summary>
internal sealed record FolderCandidate(string Name, string? Color, string? EnvironmentName, string? EnvironmentColor, string? ConfirmCommands, bool ReadOnly, bool EffectiveReadOnly, string? EffectiveConfirmCommands)
{
    public override string ToString()
        => nameof(FolderCandidate);
}

/// <summary>A conexão que pode ser importada, normalizada como a criação normaliza. O usuário e a senha vazios são os que não vieram (RN-TRANSF-015).</summary>
internal sealed record ConnectionCandidate(
    string Name, EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string? EnvironmentName, string? EnvironmentColor,
    string? ConfirmCommands, bool ReadOnly, bool VerificationEnabled, int VerificationInterval, string? VerificationQuery,
    bool EffectiveReadOnly, string? EffectiveConfirmCommands, string? EffectiveEnvironmentName, string? EffectiveEnvironmentColor)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o host, o usuário, a senha do banco e a consulta de verificação.</summary>
    public override string ToString()
        => nameof(ConnectionCandidate);
}

/// <summary>O `effective` de um item do arquivo, conferido e normalizado.</summary>
internal sealed record ImportFileEffective(bool ReadOnly, string? ConfirmCommands, string? EnvironmentName, string? EnvironmentColor)
{
    public static readonly ImportFileEffective None = new(false, null, null, null);
}

/// <summary>RN-TRANSF-013: o que valia num item na origem, o somente leitura, a confirmação (nula é "Não") e, na conexão, o ambiente que ela mostrava.</summary>
internal sealed record ImportOrigin(bool ReadOnly, string? ConfirmCommands, ShownEnvironment? Environment);
