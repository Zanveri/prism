namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-001: quem preenche o valor de uma coluna, como a resposta o escreve. As consultas de catálogo devolvem estes textos.</summary>
public static class ColumnGeneration
{
    /// <summary>O banco calcula o valor e não aceita outro: identidade "sempre", coluna calculada.</summary>
    public const string Always = "always";

    /// <summary>
    /// O banco preenche o valor que não veio: identidade "por padrão", o `SERIAL`, o `SERIAL8` e o `BIGSERIAL` do Informix e, só no alvo da edição
    /// (<see cref="EditColumn.Generated"/>), a coluna do PostgreSQL cujo padrão é `nextval(...)` (o `serial` e o `bigserial`, RN-EDIT-016).
    /// </summary>
    public const string ByDefault = "byDefault";
}
