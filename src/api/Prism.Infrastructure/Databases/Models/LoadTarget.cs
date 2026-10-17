namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-IMPORT-015: a tabela em que o carregador grava e as colunas mapeadas, na ordem do mapeamento, com o esquema e os nomes como estão no catálogo. O
/// comando os escreve entre aspas duplas, com a aspa de dentro dobrada (RN-TABELA-002): `INSERT INTO "estoque"."pedido" ("id", "cliente") VALUES (…)`.
/// As colunas que ficam de fora recebem o padrão da tabela. São nomes do banco: o `ToString()` não os imprime (RN-LOG-001).
/// </summary>
public sealed record LoadTarget(string Schema, string Table, IReadOnlyList<string> Columns)
{
    public override string ToString()
        => nameof(LoadTarget);
}
