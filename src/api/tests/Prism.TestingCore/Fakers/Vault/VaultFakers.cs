using Bogus;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;

namespace Prism.TestingCore.Fakers.Vault;

public static class VaultFakers
{
    /// <summary>
    /// Argon2id pequeno (8 MiB, uma passada), para o teste não pagar a cada derivação os 64 MiB que a
    /// RN-COFRE-002 pede em produção.
    /// </summary>
    public static VaultOptions CreateOptions(string dataDirectory)
        => new() { DataDirectory = dataDirectory, MemoryKiB = 8192, Iterations = 1, Parallelism = 1 };

    /// <summary>Os mesmos parâmetros pequenos de `CreateOptions`, com sal sorteado quando o teste não fixa um.</summary>
    public static VaultKdf CreateKdf(byte[]? salt = null)
        => new("argon2id", 8192, 1, 1, salt ?? new Faker().Random.Bytes(16));

    /// <summary>Um arquivo com a forma certa (tamanhos de sal, nonce, chave e tag), sem que nada nele abra.</summary>
    public static VaultFile CreateFile()
    {
        var faker = new Faker();

        return new VaultFile(VaultCrypto.Version, CreateKdf(), new VaultSealedBox(faker.Random.Bytes(12), faker.Random.Bytes(32), faker.Random.Bytes(16)), new VaultSealedBox(faker.Random.Bytes(12), faker.Random.Bytes(faker.Random.Int(min: 1, max: 512)), faker.Random.Bytes(16)));
    }

    public static VaultFolderRecord CreateFolder(Guid? iD = null, Guid? parentID = null, string? name = null)
    {
        var faker = new Faker("pt_BR");
        var createdAt = faker.Date.Recent().ToUniversalTime();

        return new VaultFolderRecord(iD ?? Guid.CreateVersion7(), parentID, name ?? faker.Random.String2(length: 12), createdAt, createdAt);
    }

    /// <summary>Um script salvo (RN-SCRIPT-001 a 004), com o SQL sorteado quando o teste não fixa um; sem conexão quando o teste não dá uma.</summary>
    public static VaultScriptRecord CreateScript(string? name = null, string? sql = null, Guid? connectionID = null, string? database = null, Guid? iD = null)
    {
        var faker = new Faker("pt_BR");
        var createdAt = faker.Date.Recent().ToUniversalTime();

        return new VaultScriptRecord(iD ?? Guid.CreateVersion7(), name ?? faker.Random.String2(length: 12), sql ?? $"SELECT {faker.Random.Int(min: 1, max: 9999)}", connectionID, database, createdAt, createdAt);
    }

    /// <summary>Uma aba de consulta da área de trabalho gravada (RN-ABAS-006), com o texto sorteado quando o teste não fixa um.</summary>
    public static VaultWorkspaceTabRecord CreateQueryTab(Guid? connectionID = null, string? database = null, string? sql = null, Guid? scriptID = null, bool dirty = false, bool sqlTooLarge = false)
        => new("query", connectionID, database, sql ?? $"SELECT {new Faker().Random.Int(min: 1, max: 9999)}", scriptID, dirty, sqlTooLarge, null, null, null);

    /// <summary>Uma aba de tabela da área de trabalho gravada (RN-ABAS-006): sempre com a conexão dela.</summary>
    public static VaultWorkspaceTabRecord CreateTableTab(Guid? connectionID = null, string? database = null, string schema = "loja", string table = "clientes", string view = "data")
        => new("table", connectionID ?? Guid.CreateVersion7(), database, null, null, false, false, schema, table, view);

    public static VaultWorkspaceRecord CreateWorkspace(int? activeIndex, params VaultWorkspaceTabRecord[] tabs)
        => new(tabs, activeIndex);

    public static VaultConnectionRecord CreateConnection(Guid? folderID = null, string? name = null, string? host = null, string? userName = null, string? password = null, Guid? iD = null, EDatabaseEngine? engine = null)
    {
        var faker = new Faker("pt_BR");
        var createdAt = faker.Date.Recent().ToUniversalTime();

        return new VaultConnectionRecord(iD ?? Guid.CreateVersion7(), folderID, name ?? faker.Random.String2(length: 12), engine ?? faker.Random.Enum<EDatabaseEngine>(), host ?? faker.Internet.DomainName(), faker.Internet.Port(), faker.Random.String2(length: 8), userName ?? faker.Internet.UserName(), password ?? faker.Internet.Password(), null, null, createdAt, createdAt);
    }
}
