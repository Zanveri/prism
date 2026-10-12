using Bogus;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Features.RevealConnectionPassword;
using Prism.Application.Connections.Features.UpdateConnection;
using Prism.Infrastructure.Databases.Models;

namespace Prism.TestingCore.Fakers.Connections;

/// <summary>
/// A conexão como ela volta do cofre e os comandos de criação, de alteração e de revelar a senha. Cada
/// parâmetro fixa um campo; o que o teste não nomeia é sorteado (o ambiente, que é opcional, fica nulo), e é
/// assim que um caso inválido quebra um campo por vez. A conexão gravada como registro do cofre
/// (`VaultConnectionRecord`) vem do `VaultFakers.CreateConnection`.
/// </summary>
public static class ConnectionFakers
{
    /// <summary>O domínio só nasce por `Create` (ID novo, criada agora); o teste que precisa dele como o cofre o devolve usa o `Restore`.</summary>
    internal static Connection Create(Guid? iD = null, Guid? folderID = null, string? name = null, EDatabaseEngine? engine = null, string? host = null, int? port = null, string? database = null, string? userName = null, string? password = null, string? environmentName = null, string? environmentColor = null, DateTime? createdAt = null, DateTime? updatedAt = null)
    {
        var faker = new Faker("pt_BR");
        var created = createdAt ?? faker.Date.Recent().ToUniversalTime();

        return Connection.Restore(iD ?? Guid.CreateVersion7(), folderID, name ?? RandomName(), engine ?? faker.Random.Enum<EDatabaseEngine>(), host ?? RandomHost(), port ?? RandomPort(), database ?? RandomDatabase(), userName ?? RandomUserName(), password ?? RandomPassword(), environmentName, environmentColor, created, updatedAt ?? created);
    }

    public static CreateConnectionCommand ReturnCreateConnectionCommandValid(Guid? folderID = null, string? name = null, EDatabaseEngine? engine = null, string? host = null, int? port = null, string? database = null, string? userName = null, string? password = null, string? environmentName = null, string? environmentColor = null)
        => new() { FolderID = folderID, Name = name ?? RandomName(), Engine = engine ?? new Faker().Random.Enum<EDatabaseEngine>(), Host = host ?? RandomHost(), Port = port ?? RandomPort(), Database = database ?? RandomDatabase(), UserName = userName ?? RandomUserName(), Password = password ?? RandomPassword(), EnvironmentName = environmentName, EnvironmentColor = environmentColor };

    /// <summary>`password` nulo é o que o `PATCH` manda para manter a senha gravada (RN-CONN-004).</summary>
    public static UpdateConnectionCommand ReturnUpdateConnectionCommandValid(Guid? iD = null, Guid? folderID = null, string? name = null, EDatabaseEngine? engine = null, string? host = null, int? port = null, string? database = null, string? userName = null, string? password = null, string? environmentName = null, string? environmentColor = null)
        => new() { ID = iD ?? Guid.CreateVersion7(), FolderID = folderID, Name = name ?? RandomName(), Engine = engine ?? new Faker().Random.Enum<EDatabaseEngine>(), Host = host ?? RandomHost(), Port = port ?? RandomPort(), Database = database ?? RandomDatabase(), UserName = userName ?? RandomUserName(), Password = password, EnvironmentName = environmentName, EnvironmentColor = environmentColor };

    public static RevealConnectionPasswordCommand ReturnRevealConnectionPasswordCommandValid(Guid? iD = null, string? password = null)
        => new() { ID = iD ?? Guid.CreateVersion7(), Password = password ?? RandomPassword() };

    public static string RandomName()
        => new Faker("pt_BR").Random.String2(length: 12, chars: "abcdefghijklmnopqrstuvwxyz");

    public static string RandomHost()
        => new Faker().Internet.DomainName();

    public static int RandomPort()
        => new Faker().Random.Int(min: 1, max: 65535);

    public static string RandomDatabase()
        => new Faker().Random.String2(length: 8, chars: "abcdefghijklmnopqrstuvwxyz");

    public static string RandomUserName()
        => new Faker().Random.String2(length: 8, chars: "abcdefghijklmnopqrstuvwxyz");

    public static string RandomPassword()
        => new Faker().Internet.Password(length: 16);
}
