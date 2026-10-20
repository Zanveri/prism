using Prism.Application.Common.Texts;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.Folders.Models;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using System.Globalization;
using System.Text.Json;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-009 a 013: o objeto de uma conexão do `data-sources*.json` do DBeaver (e o usuário e a senha dela, do `credentials-config.json`) traduzido para o
/// que o Prism grava, na forma do arquivo do Prism (`FileValue`). O banco pelo `provider` e pelo `driver`; o host, a porta, o banco de dados e o servidor Informix
/// pelos campos ou pela URL JDBC; o ambiente e as proteções pelo tipo de conexão; e o que o Prism não grava, para a prévia dizer. Os campos de texto passam depois
/// pelas regras da criação (`ImportAnalysis`): o que aqui se recusa é só o que o DBeaver sabe (o banco, a URL, a variável, o que falta).
/// </summary>
internal static class DbeaverConnections
{
    /// <summary>O corte do nome do banco que o Prism não tem e do modelo de autenticação, quando aparecem na frase ou na prévia.</summary>
    private const int ShownNameLength = 60;

    /// <summary>RN-DBEAVER-018: o ID do DBeaver é gravado na origem da conexão (até 128 caracteres); o vazio, o maior e o com caractere de controle ou de direção do texto não são gravados.</summary>
    public const string IDInvalidMessage = "O ID desta conexão no DBeaver não serve para o Prism.";

    private static readonly FileValue True = new(JsonValueKind.True, null);
    private static readonly FileValue False = new(JsonValueKind.False, null);

    /// <summary>
    /// A conexão traduzida, ou nula quando não entra nem aparece: a que tem `origin` (vem de uma fonte externa do DBeaver, e não do arquivo, RN-DBEAVER-007).
    /// <paramref name="folderPath"/> é o caminho da pasta já montado (o `folder` da conexão), e <paramref name="login"/>, o que o `credentials-config` traz dela.
    /// </summary>
    public static DbeaverConnectionModel? Map(string id, JsonElement connection, string folderPath, IReadOnlyDictionary<string, DbeaverType> fileTypes, DbeaverLogin? login)
    {
        if (connection.TryGetProperty("origin", out var origin) && origin.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
            return null;

        var provider = Text(connection, "provider");
        var driver = Text(connection, "driver");
        var name = Text(connection, "name");
        var savePassword = Flag(connection, "save-password");
        var configuration = Child(connection, "configuration");

        // O tipo de conexão: o ambiente, o "Confirmar execução SQL" e as restrições de permissão do tipo (RN-DBEAVER-012).
        var environment = DbeaverEnvironments.Resolve(Text(configuration, "type"), Text(configuration, "color"), fileTypes);
        var permissionRestricted = environment.PermissionRestricted || HasPermissionRestriction(Child(connection, "security"));
        var readOnly = Flag(connection, "read-only") || permissionRestricted;

        var authModel = Blank(Text(configuration, "auth-model"));
        var nonNative = authModel is not null && !string.Equals(authModel, "native", StringComparison.OrdinalIgnoreCase);
        var user = nonNative && !string.Equals(authModel, "postgres_pgpass", StringComparison.OrdinalIgnoreCase)
            ? null
            : Blank(Text(configuration, "user")) ?? Blank(login?.User);

        // O DBeaver aplica por último o usuário e a senha não vazios do próprio `configuration` (#6564). A senha sem usuário não vem (RN-TRANSF-015), e o
        // `postgres_pgpass` traz o usuário, sem a senha, que vinha do arquivo pgpass.
        var password = nonNative ? null : NotEmpty(Text(configuration, "password")) ?? NotEmpty(login?.Password);
        if (user is null)
            password = null;

        var engine = EngineOf(provider, driver);
        var leftOut = LeftOut(connection, configuration, environment, permissionRestricted, authModel, nonNative);

        var resolved = engine is null ? Unresolved() : ResolveServer(engine.Value, configuration);
        var refusal = IDIsInvalid(id)
            ? IDInvalidMessage
            : engine is null
                ? $"O Prism ainda não tem este banco ({UnknownEngineName(provider, driver)})."
                : resolved.Refusal ?? VariableRefusal(user);

        var model = new DbeaverConnectionModel(
            id, folderPath, refusal, engine,
            name is null || string.IsNullOrWhiteSpace(name) ? FileValue.Absent : Of(name),
            engine is { } known ? Of(known.ToString()) : FileValue.Absent,
            resolved.Host is null ? FileValue.Absent : Of(resolved.Host),
            resolved.PortValue,
            resolved.Database is null ? FileValue.Absent : Of(resolved.Database),
            user is null ? FileValue.Absent : Of(user),
            password is null ? FileValue.Absent : Of(password),
            environment.Name is null ? FileValue.Absent : Of(environment.Name),
            environment.Color is null ? FileValue.Absent : Of(environment.Color),
            environment.ConfirmAll ? Of("all") : FileValue.Absent,
            readOnly ? True : False,
            engine == EDatabaseEngine.Informix ? DbeaverJdbcUrl.PortNumber(resolved.PortText) : null,
            engine == EDatabaseEngine.Informix ? resolved.InformixServer : null,
            environment.DbeaverType,
            nonNative ? TextRules.Cut(authModel!, ShownNameLength) : null,
            engine is null ? [] : leftOut(resolved),
            savePassword,
            password is not null);

        return model;
    }

    private static bool IDIsInvalid(string id)
        => id.Length is 0 or > VaultConnectionOrigin.IDMaxLength || TextRules.HasControlOrDirection(id);

    /// <summary>RN-DBEAVER-009: o banco pelo `provider` e pelo `driver` da conexão (nunca pelo começo do ID dela, que é só o driver de quando foi criada).</summary>
    public static EDatabaseEngine? EngineOf(string? provider, string? driver)
    {
        if (Is(provider, "postgresql") && (Is(driver, "postgres-jdbc") || Is(driver, "postgresql")))
            return EDatabaseEngine.PostgreSql;

        if (Is(provider, "db2") && Is(driver, "db2"))
            return EDatabaseEngine.Db2;

        if (Is(provider, "generic") && Is(driver, "informix"))
            return EDatabaseEngine.Informix;

        return null;
    }

    /// <summary>
    /// O nome do banco que o Prism não tem, para a frase "O Prism ainda não tem este banco (MySQL).": o que o Prism conhece pelo driver e, senão, o `driver` como veio
    /// (ou o provedor, sem ele), cortado em 60 e sem caractere de controle nem de direção do texto.
    /// </summary>
    public static string UnknownEngineName(string? provider, string? driver)
    {
        var key = $"{provider}|{driver}".ToLowerInvariant();
        (string Contains, string Name)[] known =
        [
            ("db2_zos", "Db2 for z/OS"), ("db2_i", "Db2 for IBM i"), ("iseries", "Db2 for IBM i"), ("as400", "Db2 for IBM i"),
            ("mysql", "MySQL"), ("mariadb", "MariaDB"), ("oracle", "Oracle"), ("sqlserver", "SQL Server"), ("mssql", "SQL Server"), ("sqlite", "SQLite"),
            ("greenplum", "Greenplum"), ("redshift", "Redshift"), ("cockroach", "CockroachDB"), ("timescale", "TimescaleDB"), ("h2", "H2"), ("derby", "Derby"), ("mongo", "MongoDB")
        ];

        foreach (var (contains, name) in known)
            if (key.Contains(contains, StringComparison.Ordinal))
                return name;

        var raw = Blank(driver) ?? Blank(provider) ?? "desconhecido";
        var clean = new string([.. raw.Where(character => !TextRules.IsControlOrDirection(character))]);

        return TextRules.Cut(clean.Length == 0 ? "desconhecido" : clean, ShownNameLength);
    }

    /// <summary>O host, a porta, o banco de dados e o servidor Informix já escolhidos entre os campos e a URL, e o motivo de não servir (nulo quando serve).</summary>
    private sealed record ResolvedServer(string? Host, string? PortText, FileValue PortValue, string? Database, string? InformixServer, string? Refusal);

    private static ResolvedServer Unresolved()
        => new(null, null, FileValue.Absent, null, null, null);

    /// <summary>
    /// RN-DBEAVER-010: com `MANUAL` ou sem tipo, os campos; com `URL`, a URL; e, com host, porta, servidor e banco de dados todos vazios e a URL preenchida, a
    /// URL, como no DBeaver. A porta ausente é a padrão do banco (5432 no PostgreSQL e 50000 no Db2); no Informix, a conexão não é importável. O banco de dados
    /// ausente: `postgres` no PostgreSQL; no Db2 e no Informix, a conexão não é importável.
    /// </summary>
    private static ResolvedServer ResolveServer(EDatabaseEngine engine, JsonElement configuration)
    {
        var host = Blank(Text(configuration, "host"));
        var portText = Blank(PortText(configuration));
        var database = Blank(Text(configuration, "database"));
        var server = Blank(Text(configuration, "server"));
        var url = Blank(Text(configuration, "url"));
        var configurationType = Blank(Text(configuration, "configurationType"));

        var manual = configurationType is null || string.Equals(configurationType, "MANUAL", StringComparison.OrdinalIgnoreCase);
        var useUrl = url is not null && (string.Equals(configurationType, "URL", StringComparison.OrdinalIgnoreCase) || (manual && host is null && portText is null && database is null && server is null));

        if (useUrl)
        {
            var parsed = DbeaverJdbcUrl.TryParse(engine, url!);
            if (parsed is null)
            {
                var beginning = DbeaverJdbcUrl.Beginning(url!);

                return Unresolved() with { Refusal = beginning.Length == 0 ? "Não foi possível ler a URL JDBC desta conexão." : $"Não foi possível ler a URL JDBC desta conexão ({beginning})." };
            }

            host = parsed.Host;
            portText = parsed.Port;
            database = parsed.Database;
            server = parsed.Server;
        }

        // A variável do DBeaver (`${…}`) no host, na porta ou no banco de dados: o Prism não as tem. O usuário é conferido adiante.
        if (HasVariable(host) || HasVariable(portText) || HasVariable(database))
            return Unresolved() with { Refusal = VariablesMessage };

        if (host is null)
            return Unresolved() with { Refusal = "A conexão não tem host." };

        FileValue port;
        if (portText is not null)
            port = DbeaverJdbcUrl.PortNumber(portText) is not null ? new FileValue(JsonValueKind.Number, portText) : Of(portText);
        else if (engine == EDatabaseEngine.Informix)
            return Unresolved() with { Host = host, Refusal = "A conexão não tem porta." };
        else
        {
            portText = engine == EDatabaseEngine.PostgreSql ? "5432" : "50000";
            port = new FileValue(JsonValueKind.Number, portText);
        }

        if (database is null)
        {
            if (engine != EDatabaseEngine.PostgreSql)
                return Unresolved() with { Host = host, Refusal = "A conexão não tem banco de dados: o Prism precisa de um." };

            database = "postgres";
        }

        return new ResolvedServer(host, portText, port, database, engine == EDatabaseEngine.Informix ? server : null, null);
    }

    private const string VariablesMessage = "A conexão usa variáveis do DBeaver (${…}), que o Prism não tem.";

    /// <summary>O usuário com uma variável do DBeaver também deixa a conexão não importável (RN-DBEAVER-010).</summary>
    private static string? VariableRefusal(string? user)
        => HasVariable(user) ? VariablesMessage : null;

    private static bool HasVariable(string? text)
        => text is not null && text.Contains("${", StringComparison.Ordinal);

    /// <summary>
    /// RN-DBEAVER-013: o que o Prism não grava, na ordem da especificação. Devolve a função porque o servidor Informix só se sabe depois de escolhidos os campos ou
    /// a URL.
    /// </summary>
    private static Func<ResolvedServer, IReadOnlyList<string>> LeftOut(JsonElement connection, JsonElement configuration, DbeaverEnvironments.Resolved environment, bool permissionRestricted, string? authModel, bool nonNative)
    {
        var handlers = Child(configuration, "handlers");
        var tunnel = false;
        var proxy = false;
        if (handlers.ValueKind == JsonValueKind.Object)
            foreach (var handler in handlers.EnumerateObject())
            {
                // O DBeaver só grava os ligados; o `enabled` falso explícito não conta.
                if (handler.Value.ValueKind != JsonValueKind.Object || (handler.Value.TryGetProperty("enabled", out var enabled) && enabled.ValueKind == JsonValueKind.False))
                    continue;

                var type = Text(handler.Value, "type");
                var key = handler.Name.ToLowerInvariant();
                if (string.Equals(type, "PROXY", StringComparison.OrdinalIgnoreCase) || key.Contains("proxy", StringComparison.Ordinal) || key.Contains("socks", StringComparison.Ordinal))
                    proxy = true;
                else
                    tunnel = true;
            }

        var driverProperties = NotEmpty(Child(configuration, "properties"))
            || (Child(configuration, "provider-properties") is { ValueKind: JsonValueKind.Object } providerProperties && providerProperties.EnumerateObject().Any(property => !property.Name.StartsWith("@dbeaver-", StringComparison.Ordinal)));

        var bootstrapObject = Child(configuration, "bootstrap");
        var bootstrap = NotEmpty(Child(bootstrapObject, "query")) || Blank(Text(bootstrapObject, "defaultCatalog")) is not null || Blank(Text(bootstrapObject, "defaultSchema")) is not null;
        var autocommitOff = bootstrapObject.ValueKind == JsonValueKind.Object && bootstrapObject.TryGetProperty("autocommit", out var autocommit) && autocommit.ValueKind == JsonValueKind.False;
        var events = NotEmpty(Child(configuration, "events"));

        var filters = NotEmpty(Child(connection, "filters")) || (connection.ValueKind == JsonValueKind.Object && connection.EnumerateObject().Any(property => property.Name.StartsWith("navigator-", StringComparison.Ordinal) && property.Value.ValueKind == JsonValueKind.True));

        return resolved =>
        {
            var left = new List<string>();
            if (resolved.InformixServer is not null)
                left.Add(DbeaverLeftOut.InformixServer);

            if (tunnel)
                left.Add(DbeaverLeftOut.SshTunnel);

            if (proxy)
                left.Add(DbeaverLeftOut.Proxy);

            if (driverProperties)
                left.Add(DbeaverLeftOut.DriverProperties);

            if (bootstrap)
                left.Add(DbeaverLeftOut.Bootstrap);

            if (autocommitOff)
                left.Add(DbeaverLeftOut.AutocommitOff);

            if (events)
                left.Add(DbeaverLeftOut.Events);

            if (nonNative && authModel is not null)
                left.Add(DbeaverLeftOut.AuthModel);

            if (environment.ConfirmDataChangeOnly)
                left.Add(DbeaverLeftOut.ConfirmDataChange);

            if (permissionRestricted)
                left.Add(DbeaverLeftOut.Permissions);

            if (filters)
                left.Add(DbeaverLeftOut.NavigatorFilters);

            if (environment.Cut)
                left.Add(DbeaverLeftOut.EnvironmentCut);

            if (environment.Invalid)
                left.Add(DbeaverLeftOut.EnvironmentInvalid);

            return left;
        };
    }

    /// <summary>`security.permission-restrictions` com ao menos uma das quatro permissões que o DBeaver tira (`edit.data`, `edit.meta`, `edit.execute` e `import.data`).</summary>
    public static bool HasPermissionRestriction(JsonElement security)
    {
        var restrictions = Child(security, "permission-restrictions");

        return restrictions.ValueKind == JsonValueKind.Array
            && restrictions.EnumerateArray().Any(item => item.ValueKind == JsonValueKind.String && item.GetString() is "edit.data" or "edit.meta" or "edit.execute" or "import.data");
    }

    /// <summary>A porta como o DBeaver a grava, texto ou número JSON.</summary>
    private static string? PortText(JsonElement configuration)
    {
        if (configuration.ValueKind != JsonValueKind.Object || !configuration.TryGetProperty("port", out var port))
            return null;

        return port.ValueKind switch
        {
            JsonValueKind.String => port.GetString(),
            JsonValueKind.Number => port.GetRawText(),
            _ => null
        };
    }

    /// <summary>A senha como veio (não é aparada: o espaço faz parte dela); a vazia é "sem senha".</summary>
    private static string? NotEmpty(string? text)
        => string.IsNullOrEmpty(text) ? null : text;

    private static bool NotEmpty(JsonElement element)
        => element.ValueKind switch
        {
            JsonValueKind.Object => element.EnumerateObject().Any(),
            JsonValueKind.Array => element.GetArrayLength() > 0,
            JsonValueKind.String => !string.IsNullOrWhiteSpace(element.GetString()),
            _ => false
        };

    private static string? Text(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool Flag(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

    private static JsonElement Child(JsonElement element, string name)
        => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : default;

    private static string? Blank(string? text)
        => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static bool Is(string? text, string expected)
        => string.Equals(text?.Trim(), expected, StringComparison.OrdinalIgnoreCase);

    private static FileValue Of(string text)
        => new(JsonValueKind.String, text);
}
