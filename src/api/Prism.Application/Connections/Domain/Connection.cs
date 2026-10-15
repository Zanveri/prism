using Prism.Application.Common.Environments;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Domain;

/// <summary>
/// RN-CONN-010: uma conexão com um banco (PostgreSQL, Db2 ou Informix), numa pasta ou na raiz. Carrega a senha
/// do banco, que só sai do domínio para o cofre (RN-CONN-001: o DTO não tem como levá-la). O ID nasce aqui, e
/// não no cofre: a tela o recebe na resposta da criação.
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
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Connection(Guid id, Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, DateTime createdAt, DateTime updatedAt)
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
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public static Connection Create(Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, DateTime createdAt)
        => new(Guid.CreateVersion7(), folderID, name.NormalizeName(), engine, host.Trim(), port, database.Trim(), userName.Trim(), password, EnvironmentRules.NormalizeName(environmentName), EnvironmentRules.NormalizeColor(environmentColor), createdAt, createdAt);

    /// <summary>
    /// A conexão como o cofre a guarda, para o handler que altera: o cofre não tem SQL que materialize o construtor
    /// privado. Nada é normalizado nem carimbado, porque o que está gravado já passou pelo `Create` ou pelo `Update`.
    /// </summary>
    public static Connection Restore(Guid id, Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string password, string? environmentName, string? environmentColor, DateTime createdAt, DateTime updatedAt)
        => new(id, folderID, name, engine, host, port, database, userName, password, environmentName, environmentColor, createdAt, updatedAt);

    /// <summary>
    /// O `PATCH` grava todos os campos. A senha é a exceção (RN-CONN-004): `password` nulo mantém a gravada. Quem
    /// confere que a conexão e a pasta existem e que o nome é livre é o repository, dentro da gravação.
    /// </summary>
    public void Update(Guid? folderID, string name, EDatabaseEngine engine, string host, int port, string database, string userName, string? password, string? environmentName, string? environmentColor, DateTime updatedAt)
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
        UpdatedAt = updatedAt;
    }

    /// <summary>
    /// RN-CONN-016: a cópia desta conexão, com ID novo, o nome dado e as duas datas de agora, e todo o resto igual, a senha inclusive. Quem
    /// escolhe o nome (`ConnectionRules.CopyName`, livre na pasta) é o repository, dentro da gravação; o nome chega pronto e não é normalizado de novo.
    /// </summary>
    public Connection Duplicate(string name, DateTime createdAt)
        => new(Guid.CreateVersion7(), FolderID, name, Engine, Host, Port, Database, UserName, Password, EnvironmentName, EnvironmentColor, createdAt, createdAt);
}
