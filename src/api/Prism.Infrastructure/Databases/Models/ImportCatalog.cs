namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-IMPORT-009, 010 e 012: o que o catálogo diz da tabela de destino de uma importação: a tabela como a edição a descreve (o tipo, as colunas, as chaves
/// e se o banco tem log de transação), as chaves estrangeiras que apontam para ela (RN-CAT-004) e, no PostgreSQL, o tipo-base de cada coluna que é de um
/// domínio, pelo nome da coluna.
/// </summary>
public sealed record ImportCatalog(EditCatalogTable Table, IReadOnlyList<ReferencingForeignKeyInfo> ReferencedBy, IReadOnlyDictionary<string, string> BaseTypes)
{
    public override string ToString()
        => nameof(ImportCatalog);
}
