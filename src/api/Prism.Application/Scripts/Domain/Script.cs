using Prism.Application.Common.Environments;
using Prism.Application.Scripts.Models;
using Prism.Core.Extensions;

namespace Prism.Application.Scripts.Domain;

/// <summary>
/// RN-SCRIPT-001 a 004: um script salvo é um nome (1 a 200 caracteres, sem caractere de controle e único por usuário: regras do validator e do repository),
/// o texto do SQL (até 1 MB) e o lugar em que foi salvo, a conexão e o banco da aba. O lugar é um par: o banco só existe com a conexão, e o banco nulo é o
/// banco da própria conexão. Sem conexão o script é genérico (RN-SCRIPT-005): a tela o abre na conexão conectada, ou pergunta qual. RN-SCRIPT-006: e um ícone
/// da lista fechada (`ScriptRules.Icons`; nulo é o padrão) e uma cor opcional, que nascem nulos. O ID nasce aqui, e não no cofre: a tela o recebe na resposta
/// da criação.
/// </summary>
internal sealed class Script
{
    public Guid ID { get; }
    public string Name { get; private set; }
    public string Sql { get; private set; }
    public Guid? ConnectionID { get; private set; }
    public string? Database { get; private set; }
    public string? Icon { get; private set; }
    public string? Color { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Script(Guid id, string name, string sql, Guid? connectionID, string? database, string? icon, string? color, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        Name = name;
        Sql = sql;
        ConnectionID = connectionID;
        Database = database;
        Icon = icon;
        Color = color;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    /// <summary>
    /// O SQL fica como veio, com os espaços e as quebras de linha: é o texto do editor. Só o nome é normalizado. O script novo tem o ícone padrão e não tem
    /// cor (RN-SCRIPT-006): os dois só mudam pelo "Editar script…".
    /// </summary>
    public static Script Create(string name, string sql, Guid? connectionID, string? database, DateTime createdAt)
        => new(Guid.CreateVersion7(), name.NormalizeName(), sql, connectionID, DatabaseOf(connectionID, database), null, null, createdAt, createdAt);

    /// <summary>O script como o cofre o guarda, para o repository. Nada é normalizado nem carimbado: o que está gravado já passou pelo `Create`.</summary>
    public static Script Restore(Guid id, string name, string sql, Guid? connectionID, string? database, string? icon, string? color, DateTime createdAt, DateTime updatedAt)
        => new(id, name, sql, connectionID, database, icon, color, createdAt, updatedAt);

    /// <summary>
    /// A alteração do `PATCH`: o que vem nulo fica como está. Renomear manda só o nome; gravar a aba por cima manda o SQL e o lugar dela. Com
    /// <paramref name="connectionID"/>, o lugar inteiro é gravado (o <paramref name="database"/> nulo é o banco da conexão); sem ele, conexão e banco ficam,
    /// e um banco enviado sozinho não muda nada (não há banco sem conexão). <paramref name="generic"/> apaga o lugar (RN-SCRIPT-005): o ausente não pode
    /// dizer isso, porque ausente é "fica como está". O validator recusa o genérico junto com um lugar; aqui o genérico ganha.
    ///
    /// O ícone e a cor (RN-SCRIPT-006) seguem o mesmo "nulo fica": <paramref name="icon"/> em branco ou o padrão volta ao ícone padrão (nulo), e
    /// <paramref name="color"/> em branco tira a cor. Devolve se algo mudou: nada mudou (a tela salvou sem editar) não carimba a data, e o repository não
    /// regrava o cofre.
    /// </summary>
    public bool Change(string? name, string? sql, Guid? connectionID, string? database, bool generic, string? icon, string? color, DateTime updatedAt)
    {
        var newName = name is null ? Name : name.NormalizeName();
        var newSql = sql ?? Sql;
        var (newConnectionID, newDatabase) = generic ? (null, null) : connectionID is null ? (ConnectionID, Database) : (connectionID, DatabaseOf(connectionID, database));
        var newIcon = icon is null ? Icon : ScriptRules.NormalizeIcon(icon);
        var newColor = color is null ? Color : EnvironmentRules.NormalizeColor(color);

        if (string.Equals(newName, Name, StringComparison.Ordinal) && string.Equals(newSql, Sql, StringComparison.Ordinal) && newConnectionID == ConnectionID && string.Equals(newDatabase, Database, StringComparison.Ordinal)
            && string.Equals(newIcon, Icon, StringComparison.Ordinal) && string.Equals(newColor, Color, StringComparison.Ordinal))
            return false;

        Name = newName;
        Sql = newSql;
        ConnectionID = newConnectionID;
        Database = newDatabase;
        Icon = newIcon;
        Color = newColor;
        UpdatedAt = updatedAt;

        return true;
    }

    /// <summary>Sem conexão não há banco, e o banco vazio é o banco da própria conexão (nulo).</summary>
    private static string? DatabaseOf(Guid? connectionID, string? database)
        => connectionID is null || string.IsNullOrEmpty(database) ? null : database;
}
