using Bogus;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Features.CreateScript;
using Prism.Application.Scripts.Features.UpdateScript;

namespace Prism.TestingCore.Fakers.Scripts;

/// <summary>
/// O script como ele volta do cofre e os comandos de criação e de alteração (RN-SCRIPT-001 a 004). Cada parâmetro fixa um campo; o que o teste não
/// nomeia é sorteado. O script gravado como registro do cofre (`VaultScriptRecord`) vem do `VaultFakers.CreateScript`.
/// </summary>
public static class ScriptFakers
{
    internal static Script Create(Guid? iD = null, string? name = null, string? sql = null, Guid? connectionID = null, string? database = null, DateTime? createdAt = null)
    {
        var created = createdAt ?? new Faker().Date.Recent().ToUniversalTime();

        return Script.Restore(iD ?? Guid.CreateVersion7(), name ?? RandomName(), sql ?? RandomSql(), connectionID, database, created, created);
    }

    public static CreateScriptCommand ReturnCreateScriptCommandValid(string? name = null, string? sql = null, Guid? connectionID = null, string? database = null)
        => new() { Name = name ?? RandomName(), Sql = sql ?? RandomSql(), ConnectionID = connectionID, Database = database };

    /// <summary>Só o ID é fixo: o PATCH manda o que muda, e o resto ausente (nulo) fica como está.</summary>
    public static UpdateScriptCommand ReturnUpdateScriptCommandValid(Guid? iD = null, string? name = null, string? sql = null, Guid? connectionID = null, string? database = null)
        => new() { ID = iD ?? Guid.CreateVersion7(), Name = name, Sql = sql, ConnectionID = connectionID, Database = database };

    public static string RandomName()
        => new Faker("pt_BR").Random.String2(length: 12, chars: "abcdefghijklmnopqrstuvwxyz");

    public static string RandomSql()
        => $"SELECT {new Faker().Random.Int(min: 1, max: 9999)}";
}
