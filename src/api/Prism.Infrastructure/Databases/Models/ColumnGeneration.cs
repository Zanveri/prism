namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-001: quem preenche o valor de uma coluna, como a resposta o escreve. As consultas de catálogo devolvem estes textos.</summary>
public static class ColumnGeneration
{
    /// <summary>O banco calcula o valor e não aceita outro: identidade "sempre", coluna calculada.</summary>
    public const string Always = "always";

    /// <summary>O banco preenche o valor que não veio: identidade "por padrão", `SERIAL` do Informix.</summary>
    public const string ByDefault = "byDefault";
}
