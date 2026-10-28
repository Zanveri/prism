using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Models;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Domain;

/// <summary>
/// RN-CONN-010: uma conexão com um banco (PostgreSQL, Db2 ou Informix), numa pasta ou na raiz. Carrega a senha
/// do banco, que só sai do domínio para o cofre (RN-CONN-001: o DTO não tem como levá-la). O ID nasce aqui, e
/// não no cofre: a tela o recebe na resposta da criação.
///
/// As proteções próprias (RN-PROT-001 e 002: `ConfirmCommands`, nulo é "Não", e `ReadOnly`) e a verificação periódica (RN-VERIF-001: `VerificationEnabled`,
/// `VerificationInterval` em segundos e `VerificationQuery`, nula é a do banco) ficam aqui já normalizadas; as que valem, com as das pastas acima, não são
/// do domínio (RN-PROT-004, `ProtectionRules.Of`), e quem confere a senha que o somente leitura pede é a gravação (RN-PROT-003).
/// </summary>
internal sealed class Connection
{
    public Guid ID { get; }
    public Guid? FolderID { get; private set; }
    public string Name { get; private set; }
    public EDatabaseEngine Engine { get; private set; }
    public string Host { get; private set; }
    public int Port { get; private set; }
    public string Database { get; private set; }
    public string UserName { get; private set; }
    public string Password { get; private set; }
    public string? EnvironmentName { get; private set; }
    public string? EnvironmentColor { get; private set; }
    public string? ConfirmCommands { get; private set; }
    public bool ReadOnly { get; private set; }
    public bool VerificationEnabled { get; private set; }
    public int VerificationInterval { get; private set; }
    public string? VerificationQuery { get; private set; }
    public bool? UseInternalDescriptions { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Connection(Guid id, Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, ConnectionSafeguards safeguards, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        FolderID = folderID;
        Name = name;
        Engine = engine;
        Host = host;
        Port = port;
        Database = database;
        UserName = userName;
        Password = password;
        EnvironmentName = environmentName;
        EnvironmentColor = environmentColor;
        ConfirmCommands = safeguards.ConfirmCommands;
        ReadOnly = safeguards.ReadOnly;
        VerificationEnabled = safeguards.VerificationEnabled;
        VerificationInterval = safeguards.VerificationInterval;
        VerificationQuery = safeguards.VerificationQuery;
        UseInternalDescriptions = safeguards.UseInternalDescriptions;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    /// <summary>As proteções e a verificação, como a conexão as guarda: o que vem do pedido passa antes pelo <see cref="ConnectionSafeguards.Normalize"/>.</summary>
    public ConnectionSafeguards Safeguards
        => new(ConfirmCommands, ReadOnly, VerificationEnabled, VerificationInterval, VerificationQuery, UseInternalDescriptions);

    public static Connection Create(Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, ConnectionSafeguards safeguards, DateTime createdAt)
        => new(Guid.CreateVersion7(), folderID, name.NormalizeName(), engine, host.Trim(), port, database.Trim(), userName.Trim(), password, EnvironmentRules.NormalizeName(environmentName), EnvironmentRules.NormalizeColor(environmentColor), safeguards.Normalize(), createdAt, createdAt);

    /// <summary>
    /// A conexão como o cofre a guarda, para o handler que altera: o cofre não tem SQL que materialize o construtor
    /// privado. Nada é normalizado nem carimbado, porque o que está gravado já passou pelo `Create` ou pelo `Update`.
    /// </summary>
    public static Connection Restore(Guid id, Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, ConnectionSafeguards safeguards, DateTime createdAt, DateTime updatedAt)
        => new(id, folderID, name, engine, host, port, database, userName, password, environmentName, environmentColor, safeguards, createdAt, updatedAt);

    /// <summary>
    /// O `PATCH` grava todos os campos, as proteções e a verificação inclusive (o ausente volta ao padrão, como o ambiente). A senha é a exceção
    /// (RN-CONN-004): `password` nulo mantém a gravada. Quem confere que a conexão e a pasta existem, que o nome é livre e a senha do usuário que o
    /// somente leitura pede (RN-PROT-003) é o repository, dentro da gravação.
    /// </summary>
    public void Update(Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string? password, string? environmentName, string? environmentColor, ConnectionSafeguards safeguards, DateTime updatedAt)
    {
        FolderID = folderID;
        Name = name.NormalizeName();
        Engine = engine;
        Host = host.Trim();
        Port = port;
        Database = database.Trim();
        UserName = userName.Trim();
        Password = password ?? Password;
        EnvironmentName = EnvironmentRules.NormalizeName(environmentName);
        EnvironmentColor = EnvironmentRules.NormalizeColor(environmentColor);

        var normalized = safeguards.Normalize();
        ConfirmCommands = normalized.ConfirmCommands;
        ReadOnly = normalized.ReadOnly;
        VerificationEnabled = normalized.VerificationEnabled;
        VerificationInterval = normalized.VerificationInterval;
        VerificationQuery = normalized.VerificationQuery;
        UseInternalDescriptions = normalized.UseInternalDescriptions;
        UpdatedAt = updatedAt;
    }

    /// <summary>
    /// RN-CONN-016: a cópia desta conexão, com ID novo, o nome dado e as duas datas de agora, e todo o resto igual, a senha, as proteções e a verificação
    /// inclusive (RN-PROT-003: duplicar não pede a senha do usuário). Quem escolhe o nome (`ConnectionRules.CopyName`, livre na pasta) é o repository,
    /// dentro da gravação; o nome chega pronto e não é normalizado de novo.
    /// </summary>
    public Connection Duplicate(string name, DateTime createdAt)
        => new(Guid.CreateVersion7(), FolderID, name, Engine, Host, Port, Database, UserName, Password, EnvironmentName, EnvironmentColor, Safeguards, createdAt, createdAt);
}

/// <summary>
/// As proteções próprias e a verificação periódica de uma conexão (RN-PROT-001 e 002, RN-VERIF-001), juntas para o domínio não ter mais cinco parâmetros
/// em cada construção. O padrão é o de uma conexão sem nada escolhido: sem confirmação, sem somente leitura, a verificação ligada a cada 30 segundos com a
/// consulta do banco.
/// </summary>
internal sealed record ConnectionSafeguards(string? ConfirmCommands = null, bool ReadOnly = false, bool VerificationEnabled = true, int VerificationInterval = ConnectionRules.VerificationIntervalDefault, string? VerificationQuery = null, bool? UseInternalDescriptions = null)
{
    /// <summary>O que veio do pedido (nulo é o padrão), já normalizado.</summary>
    public static ConnectionSafeguards From(string? confirmCommands, bool readOnly, bool? verificationEnabled, int? verificationInterval, string? verificationQuery, bool? useInternalDescriptions = null)
        => new ConnectionSafeguards(confirmCommands, readOnly, verificationEnabled ?? true, verificationInterval ?? ConnectionRules.VerificationIntervalDefault, verificationQuery, useInternalDescriptions).Normalize();

    /// <summary>"Não" e a consulta em branco se guardam nulos (uma forma só); a consulta é aparada, e vai ao banco como ficou.</summary>
    public ConnectionSafeguards Normalize()
        => this with { ConfirmCommands = ProtectionRules.NormalizeConfirmation(ConfirmCommands), VerificationQuery = ConnectionRules.NormalizeVerificationQuery(VerificationQuery) };

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria a consulta de verificação.</summary>
    public override string ToString()
        => nameof(ConnectionSafeguards);
}
