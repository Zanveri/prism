namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-VAR-032: o tipo de um parâmetro do comando, como a tela o manda (`text`, `number`, `boolean`, `date`, `timestamp`).</summary>
public enum EQueryParameterType
{
    Text,
    Number,
    Boolean,

    /// <summary>`aaaa-mm-dd`.</summary>
    Date,

    /// <summary>`aaaa-mm-dd hh:mm:ss`, com até 6 casas depois de um ponto e, só no PostgreSQL, o fuso no fim.</summary>
    Timestamp
}

/// <summary>
/// RN-VAR-032: o valor de um marcador do comando (`$n` ou `?`), na ordem do texto: o tipo e o valor como texto, ou nulo para o parâmetro nulo (o tipo vale
/// mesmo assim: o Db2 e o Informix precisam dele). O valor é do usuário e pode ser sensível: o `ToString()` só diz o tipo (RN-LOG-001, RN-VAR-036).
/// </summary>
public sealed record QueryParameter(EQueryParameterType Type, string? Value)
{
    public override string ToString()
        => nameof(QueryParameter);
}
