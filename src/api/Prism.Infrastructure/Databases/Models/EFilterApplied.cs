namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-GRADE-011: como o filtro do resultado entrou no comando da aba.</summary>
public enum EFilterApplied
{
    /// <summary>Junto ao próprio comando: a condição no `WHERE` dele, por `AND`, e a ordem no lugar do `ORDER BY` dele. A edição vale como sem o filtro.</summary>
    Merged,

    /// <summary>Por fora do comando, que vira uma tabela derivada (`SELECT * FROM (...) prism_filtro WHERE ... ORDER BY ...`). O resultado é só leitura.</summary>
    Wrapped
}
