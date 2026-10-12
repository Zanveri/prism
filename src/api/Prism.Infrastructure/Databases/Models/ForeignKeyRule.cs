namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-002: as regras de uma chave estrangeira ao excluir e ao atualizar, como a resposta as escreve. As consultas de catálogo devolvem estes textos.</summary>
public static class ForeignKeyRule
{
    public const string NoAction = "noAction";

    public const string Restrict = "restrict";

    public const string Cascade = "cascade";

    public const string SetNull = "setNull";

    public const string SetDefault = "setDefault";
}
