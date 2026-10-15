using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// Uma conexão aberta com um banco. Os tipos do fornecedor param aqui: para fora só saem os modelos do Prism, e toda falha é um
/// <see cref="DatabaseFailure"/>. Faz um comando por vez: quem a usa (o registro de sessões) garante que duas chamadas não se
/// cruzam, com exceção do <see cref="Cancel"/>, que existe para ser chamado enquanto outra roda.
/// </summary>
public interface IDatabaseConnection : IAsyncDisposable
{
    string ServerVersion { get; }

    /// <summary>`false` quando a conexão caiu (rede, banco reiniciado, sessão derrubada por um administrador): depois de uma falha, é o que diz que ela não serve mais.</summary>
    bool IsOpen { get; }

    /// <summary>
    /// RN-SQL-007: há um cursor aberto entre páginas, à espera do "carregar mais", que qualquer outro comando nesta conexão fecharia antes de ser
    /// enviado. A recusa antes de ir ao banco (controle de transação, mais de um comando) não o toca. Lido por quem tem a vez da sessão: é por
    /// aqui que o registro de sessões sabe, depois de uma operação, se o cursor continua aberto.
    /// </summary>
    bool HasOpenCursor { get; }

    /// <summary>RN-CONN-013: a consulta de verificação do banco. Falha `ConnectionFailed`.</summary>
    Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Envia o comando como está, um por vez (RN-SQL-003); controle de transação é recusado com `TransactionControlNotSupported`, sem
    /// ir ao banco. Uma leitura que devolve linhas traz as primeiras `pageSize` e mantém o cursor aberto enquanto houver mais
    /// (RN-SQL-004 e 016). Um comando que grava é executado até o fim e está confirmado quando a resposta sai (RN-SESSAO-005): devolve
    /// as linhas afetadas (RN-SQL-008) ou, se devolve linhas, as primeiras `pageSize` e o total, sem cursor (RN-SQL-013). O cursor de
    /// um comando anterior fecha antes (RN-SQL-007), como antes de qualquer outra operação que fale com o banco.
    /// </summary>
    /// <param name="pageSize">RN-SQL-016: as linhas da primeira página e de cada "carregar mais" deste cursor. Quem valida a faixa é a rota.</param>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken);

    /// <summary>
    /// RN-PROT-002 e 006: o comando de uma conexão somente leitura, que quem chama já conferiu pelo texto (`ReadOnlySql`). Roda sempre como leitura
    /// paginada, e no PostgreSQL na transação só de leitura, com a sessão posta antes no modo só de leitura do banco: a recusa do banco por gravar
    /// (uma função que grava, chamada pelo `SELECT`) é a resposta, também no "carregar mais", e o comando nunca roda de novo fora dela. O
    /// <see cref="ExecuteAsync"/> seguinte, de quando a conexão deixa de ser somente leitura, tira a sessão do modo antes de rodar.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken);

    /// <summary>RN-SQL-005: as linhas seguintes do mesmo cursor, sem executar de novo, no tamanho com que ele foi aberto. Sem cursor aberto, `NoOpenCursor`.</summary>
    Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-006: `SELECT COUNT(*)` sobre o comando, como subconsulta, sem deixar que ele grave de novo. A posição do erro não vem:
    /// seria a do comando embrulhado.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken);

    /// <summary>Fecha o cursor aberto, se houver, sem esperar o resto das linhas. Não falha.</summary>
    Task CloseCursorAsync();

    /// <summary>
    /// RN-SQL-010: interrompe o comando em andamento, que termina com `ExecutionFailed`; se ele já tinha terminado quando o cancelamento
    /// chegou, termina como sucesso. Pode ser chamado de outra thread. Sem comando em andamento não faz nada: um cursor aberto e parado
    /// continua legível.
    /// </summary>
    void Cancel();

    /// <summary>Os esquemas, com os de sistema por último (RN-ARVORE-004).</summary>
    Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken);

    /// <param name="kind">`tables`, `views` ou `routines`.</param>
    Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-004: as chaves estrangeiras de outras tabelas, e da própria, que apontam para esta.</summary>
    Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-005: as restrições de conferência da tabela.</summary>
    Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-006: o texto que o banco guarda para a visão, ou nulo.</summary>
    Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(string schema, string view, CancellationToken cancellationToken);

    /// <summary>RN-CAT-008: as tabelas do esquema e as chaves que saem delas, por consultas do esquema inteiro.</summary>
    Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(string schema, CancellationToken cancellationToken);

    /// <summary>RN-CAT-010: o que o servidor informa do banco conectado a esta conta.</summary>
    Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(CancellationToken cancellationToken);

    /// <summary>RN-ARVORE-006: os bancos do servidor a que a conta pode se conectar, por nome, com o da sessão primeiro.</summary>
    Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-002 e 010: o que o catálogo diz de cada tabela do `FROM` para a edição, numa vez só para todas: o tipo dela, as colunas e
    /// as chaves, na ordem das tabelas. Nulo na que o catálogo não acha como tabela nem visão (um sinônimo, um apelido de tabela). A
    /// tabela sem esquema é a do esquema atual desta conexão (Db2), a do dono que o banco resolver (Informix) ou a do caminho de busca
    /// (PostgreSQL).
    /// </summary>
    Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeEditTablesAsync(EditTables tables, CancellationToken cancellationToken);

    /// <summary>RN-EDIT-010: o catálogo da edição numa conexão à parte espera uma trava por um prazo, e não para sempre.</summary>
    Task<UnitResult<DatabaseFailure>> LimitLockWaitAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-005 e 012: o "Salvar". Numa transação própria (ou, no banco sem log de transação, uma alteração por vez), confere as
    /// tabelas no catálogo antes do primeiro comando e entrega o que achou a `plan`, que devolve os comandos ou a recusa; cada comando
    /// tem de afetar exatamente uma linha. Qualquer falha desfaz tudo o que este "Salvar" fez, menos no banco sem log, em que as
    /// anteriores ficam gravadas (`Applied`). O cursor aberto fecha antes, como antes de qualquer comando. Devolve quantas foram gravadas.
    /// </summary>
    Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, Func<IReadOnlyList<EditCatalogTable?>, Result<IReadOnlyList<EditCommand>, DatabaseFailure>> plan, CancellationToken cancellationToken);
}
