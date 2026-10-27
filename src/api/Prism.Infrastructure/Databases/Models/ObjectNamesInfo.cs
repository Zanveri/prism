namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-BUSCA-002: os nomes das tabelas e das visões de todos os esquemas do banco da sessão, numa consulta só ao catálogo, para a busca do
/// navegador procurar neles sem ir ao banco a cada tecla. Não é nível da árvore: não tem estimativa de linhas nem comentário (RN-CAT-009).
/// </summary>
/// <param name="Schemas">Os esquemas que têm ao menos uma tabela ou visão, os comuns primeiro e depois os de sistema (RN-ARVORE-004), cada grupo na ordem de nome do banco.</param>
/// <param name="Truncated">O banco tem mais nomes que o limite da API: a lista traz só os primeiros, e os esquemas de sistema, que vêm por último, são os primeiros a ficar de fora.</param>
public sealed record ObjectNamesInfo(IReadOnlyList<SchemaObjectNamesInfo> Schemas, bool Truncated);

/// <summary>Os nomes de um esquema, exatamente como o catálogo os guarda: com eles a tela monta a identidade da linha e o `SELECT * FROM "esquema"."nome"` (RN-TABELA-002).</summary>
/// <param name="IsSystem">O mesmo critério da lista dos esquemas (`GET …/schemas`, RN-ARVORE-004) em cada banco.</param>
/// <param name="Tables">As tabelas que `objects?kind=tables` lista neste esquema, na ordem em que o banco as lista.</param>
/// <param name="Views">As visões que `objects?kind=views` lista neste esquema, na ordem em que o banco as lista.</param>
public sealed record SchemaObjectNamesInfo(string Name, bool IsSystem, IReadOnlyList<string> Tables, IReadOnlyList<string> Views);
