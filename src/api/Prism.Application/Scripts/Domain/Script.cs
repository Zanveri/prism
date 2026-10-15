using Prism.Core.Extensions;

namespace Prism.Application.Scripts.Domain;

/// <summary>
/// RN-SCRIPT-001 a 004: um script salvo é um nome (1 a 200 caracteres, sem caractere de controle e único por usuário: regras do validator e do repository),
/// o texto do SQL (até 1 MB) e o lugar em que foi salvo, a conexão e o banco da aba. O lugar é um par: o banco só existe com a conexão, e o banco nulo é o
/// banco da própria conexão. O ID nasce aqui, e não no cofre: a tela o recebe na resposta da criação.
/// </summary>
internal sealed class Script
{
    public Guid ID { get; }
    public string Name { get; private set; }
    public string Sql { get; private set; }
    public Guid? ConnectionID { get; private set; }
    public string? Database { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Script(Guid id, string name, string sql, Guid? connectionID, string? database, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        Name = name;
        Sql = sql;
        ConnectionID = connectionID;
        Database = database;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    /// <summary>O SQL fica como veio, com os espaços e as quebras de linha: é o texto do editor. Só o nome é normalizado.</summary>
    public static Script Create(string name, string sql, Guid? connectionID, string? database, DateTime createdAt)
        => new(Guid.CreateVersion7(), name.NormalizeName(), sql, connectionID, DatabaseOf(connectionID, database), createdAt, createdAt);

    /// <summary>O script como o cofre o guarda, para o repository. Nada é normalizado nem carimbado: o que está gravado já passou pelo `Create`.</summary>
    public static Script Restore(Guid id, string name, string sql, Guid? connectionID, string? database, DateTime createdAt, DateTime updatedAt)
        => new(id, name, sql, connectionID, database, createdAt, updatedAt);

    /// <summary>
    /// A alteração do `PATCH`: o que vem nulo fica como está. Renomear manda só o nome; gravar a aba por cima manda o SQL e o lugar dela. Com
    /// <paramref name="connectionID"/>, o lugar inteiro é gravado (o <paramref name="database"/> nulo é o banco da conexão); sem ele, conexão e banco ficam,
    /// e um banco enviado sozinho não muda nada (não há banco sem conexão). Devolve se algo mudou: nada mudou (a tela salvou sem editar) não carimba a data,
    /// e o repository não regrava o cofre.
    /// </summary>
    public bool Change(string? name, string? sql, Guid? connectionID, string? database, DateTime updatedAt)
    {
        var newName = name is null ? Name : name.NormalizeName();
        var newSql = sql ?? Sql;
        var (newConnectionID, newDatabase) = connectionID is null ? (ConnectionID, Database) : (connectionID, DatabaseOf(connectionID, database));

        if (string.Equals(newName, Name, StringComparison.Ordinal) && string.Equals(newSql, Sql, StringComparison.Ordinal) && newConnectionID == ConnectionID && string.Equals(newDatabase, Database, StringComparison.Ordinal))
            return false;

        Name = newName;
        Sql = newSql;
        ConnectionID = newConnectionID;
        Database = newDatabase;
        UpdatedAt = updatedAt;

        return true;
    }

    /// <summary>Sem conexão não há banco, e o banco vazio é o banco da própria conexão (nulo).</summary>
    private static string? DatabaseOf(Guid? connectionID, string? database)
        => connectionID is null || string.IsNullOrEmpty(database) ? null : database;
}
