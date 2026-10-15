namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EDIT-003: uma tabela do `FROM` como o comando a escreveu, já com os nomes como o banco os guarda (sem aspas, o PostgreSQL e o
/// Informix guardam em minúsculas, e o Db2 em maiúsculas). `Schema` nulo é o esquema atual da sessão (Db2), o dono que o banco
/// resolver (Informix) ou o caminho de busca (PostgreSQL). `Written` é o nome entre aspas, como o PostgreSQL o resolve (`to_regclass`).
/// </summary>
public sealed record EditTableName(string? Schema, string Name, string Written);

/// <summary>
/// RN-EDIT-003 e 010: as tabelas que o catálogo da edição consulta: as do `FROM`, como o comando as escreveu, na ordem dele, e os
/// identificadores das tabelas de onde a resposta do comando diz que vêm as colunas (PostgreSQL; vazio nos outros).
/// </summary>
public sealed record EditTables(IReadOnlyList<EditTableName> Names, IReadOnlyList<long> Relations);

/// <summary>
/// RN-EDIT-002 e 010: o que o catálogo diz de uma tabela do `FROM`, numa consulta só para a edição: o tipo dela (`table`, `view`,
/// `materializedView`, `foreign` ou `other`), as colunas e as chaves (a primária primeiro).
/// </summary>
/// <param name="Id">O identificador da tabela no banco, quando a resposta do comando diz de onde vem cada coluna por ele (PostgreSQL).</param>
/// <param name="OneAtATime">RN-EDIT-012: o banco não tem log de transação.</param>
public sealed record EditCatalogTable(string Schema, string Name, string Kind, long? Id, bool OneAtATime, IReadOnlyList<ColumnInfo> Columns, IReadOnlyList<EditKey> Keys);

/// <summary>Uma chave primária, restrição única ou índice único sem condição e só de colunas, com as colunas na ordem dela.</summary>
public sealed record EditKey(string Name, bool Primary, IReadOnlyList<string> Columns);
