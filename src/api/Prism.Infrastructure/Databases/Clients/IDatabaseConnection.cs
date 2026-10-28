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
    /// RN-SQL-007: há um cursor aberto entre páginas, à espera do "carregar mais". Toda operação que vai ao banco o fecha antes de ser
    /// enviada, menos o "carregar mais", que lê dele e o fecha quando acaba ou falha. A recusa antes de ir ao banco (controle de
    /// transação, mais de um comando) não o toca. Lido por quem tem a vez da sessão: é por aqui que o registro de sessões sabe, depois
    /// de uma operação, se o cursor continua aberto, e se a verificação periódica (RN-VERIF-002) pode rodar na sessão sem fechá-lo.
    /// </summary>
    bool HasOpenCursor { get; }

    /// <summary>RN-CONN-013: a consulta de verificação do banco. Falha `ConnectionFailed`.</summary>
    Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-CONN-013 e RN-VERIF-001 e 002: a consulta de verificação própria da conexão, já validada como uma leitura só, ou a do banco quando ela é
    /// nula. Lida até o fim, com o prazo do driver; no PostgreSQL a própria roda numa transação só de leitura. Fecha o cursor aberto, como qualquer
    /// comando: quem chama confere antes (<see cref="HasOpenCursor"/>). Falha `ConnectionFailed`, com a mensagem e o SQLSTATE do banco.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> VerifyAsync(string? sql, CancellationToken cancellationToken);

    /// <summary>
    /// Envia o comando como está, um por vez (RN-SQL-003); controle de transação é recusado com `TransactionControlNotSupported`, sem
    /// ir ao banco. Uma leitura que devolve linhas traz as primeiras `pageSize` e mantém o cursor aberto enquanto houver mais
    /// (RN-SQL-004 e 016). Um comando que grava é executado até o fim e está confirmado quando a resposta sai (RN-SESSAO-005): devolve
    /// as linhas afetadas (RN-SQL-008) ou, se devolve linhas, as primeiras `pageSize` e o total, sem cursor (RN-SQL-013). O cursor de
    /// um comando anterior fecha antes (RN-SQL-007), como antes de qualquer outra operação que fale com o banco.
    /// </summary>
    /// <param name="pageSize">RN-SQL-016: as linhas da primeira página e de cada "carregar mais" deste cursor. Quem valida a faixa é a rota.</param>
    /// <param name="parameters">RN-VAR-032: os valores dos marcadores do comando (`$n` ou `?`), na ordem; a conexão os liga com o tipo do banco. O registro de sessões já conferiu que eles batem com o texto. Ausente ou vazio, o comando vai como está.</param>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null);

    /// <summary>
    /// RN-PROT-002 e 006: o comando de uma conexão somente leitura, que quem chama já conferiu pelo texto (`ReadOnlySql`). Roda sempre como leitura
    /// paginada, e no PostgreSQL na transação só de leitura, com a sessão posta antes no modo só de leitura do banco: a recusa do banco por gravar
    /// (uma função que grava, chamada pelo `SELECT`) é a resposta, também no "carregar mais", e o comando nunca roda de novo fora dela. O
    /// <see cref="ExecuteAsync"/> seguinte, de quando a conexão deixa de ser somente leitura, tira a sessão do modo antes de rodar.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null);

    /// <summary>RN-SQL-005: as linhas seguintes do mesmo cursor, sem executar de novo, no tamanho com que ele foi aberto. Sem cursor aberto, `NoOpenCursor`.</summary>
    Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-006: `SELECT COUNT(*)` sobre o comando, como subconsulta, sem deixar que ele grave de novo. A posição do erro não vem:
    /// seria a do comando embrulhado.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null);

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

    /// <param name="kind">`tables`, `views`, `routines` ou `sequences`.</param>
    Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken);

    /// <summary>
    /// RN-BUSCA-002: os nomes das tabelas e das visões de todos os esquemas, por uma consulta só, com os mesmos tipos de objeto que
    /// <see cref="GetObjectsAsync"/> lista em cada esquema. Lê até `limit` nomes, os esquemas de sistema por último; o banco que tem mais
    /// liga `Truncated`, e o nome a mais não vem.
    /// </summary>
    /// <param name="limit">Quantos nomes, no máximo, a resposta traz. A consulta lê um a mais, só para saber se há mais.</param>
    Task<Result<ObjectNamesInfo, DatabaseFailure>> GetObjectNamesAsync(int limit, CancellationToken cancellationToken);

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
    ///
    /// RN-EDIT-021: com a coluna inteira (`wholeColumn`, a do plano), ela vai primeiro: a contagem tem de dar as linhas confirmadas, e o `UPDATE` tem de
    /// alterar exatamente elas (a coluna inteira conta como uma alteração gravada).
    /// </summary>
    Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, bool wholeColumn, Func<IReadOnlyList<EditCatalogTable?>, Result<EditPlan, DatabaseFailure>> plan, CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-019 e 023: a contagem da coluna inteira, na sessão, antes da pergunta: fecha o cursor aberto, confere as tabelas no catálogo da própria
    /// sessão e entrega o que achou a `plan`, que devolve a forma da contagem ou a recusa. Devolve quantas linhas o comando do resultado devolve agora.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(EditTables tables, Func<IReadOnlyList<EditCatalogTable?>, Result<WholeColumnPlan, DatabaseFailure>> plan, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-009, 012 e 015: a tabela de destino de uma importação, pelo esquema e pelo nome como estão no catálogo, numa conexão à parte: o que a
    /// edição lê dela (a consulta de `edit-target`, RN-EDIT-010), as chaves estrangeiras que apontam para ela e, no PostgreSQL, o tipo-base das colunas de
    /// um domínio. Nulo quando o catálogo não a acha como tabela nem como visão.
    /// </summary>
    Task<Result<ImportCatalog?, DatabaseFailure>> DescribeImportTargetAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-011: no PostgreSQL, quem diz se um valor converte é o banco. Numa transação só de leitura, um `SELECT` por linha com um `CAST($n AS tipo)`
    /// para cada coluna (o tipo como o catálogo o escreve) e, na linha em que ele falha, um `SELECT` por célula, num ponto de salvamento, para achar qual.
    /// Nada é gravado. `values` tem, por linha, o valor de cada coluna (o texto canônico ou os bytes) ou nulo, que não é conferido. Devolve, por linha, a
    /// recusa do banco em cada célula, ou nula. No banco em que o Prism converte (Db2 e Informix), não vai ao banco e não recusa nada.
    /// </summary>
    Task<Result<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>> CheckImportCastsAsync(IReadOnlyList<string> types, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-015: prepara a conexão à parte do carregador (a da importação e a de gravação da cópia), logo depois de conectar: o prazo de espera de
    /// trava (RN-EDIT-010), e nada mais. A conexão é nova, e o modo só de leitura que a RN-PROT-006 põe nas sessões das abas não está nela: o Prism não
    /// manda nada sobre o modo, e a recusa de um servidor que começa as sessões só de leitura (SQLSTATE 25006) é a resposta.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> BeginLoadAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-015: quantas linhas vão, no máximo, num comando da carga com `columns` colunas mapeadas: no PostgreSQL, os comandos de uma linha de um
    /// lote; no Db2, as linhas de um `INSERT … VALUES` (até 500 e até 10.000 parâmetros); no Informix, uma.
    /// </summary>
    int LoadRowsPerCommand(int columns);

    /// <summary>
    /// RN-IMPORT-015: abre a transação da carga, do driver: o esvaziamento, as linhas e a leitura do catálogo da primeira transação entram nela, até o
    /// <see cref="CommitLoadAsync"/>. Não se chama no banco sem log de transação (RN-EDIT-012), em que cada comando fica gravado ao terminar.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> BeginLoadTransactionAsync(CancellationToken cancellationToken);

    /// <summary>RN-IMPORT-012: o esvaziamento, `DELETE FROM "esquema"."tabela"`, na transação da carga (no banco sem log, gravado sozinho, ao terminar).</summary>
    Task<UnitResult<DatabaseFailure>> EmptyTableAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-015 e 016: grava as linhas, cada uma com um valor já convertido por coluna de `target`, num comando ou num lote (no máximo
    /// <see cref="LoadRowsPerCommand"/>), na transação da carga. Na recusa do banco a transação é desfeita, e `Change` é a posição em `rows` da linha
    /// recusada, quando se sabe: no comando de uma linha só (no Informix, todos), ela, em toda falha; o lote do PostgreSQL diz o comando que falhou; no
    /// Db2, o comando de várias linhas recusado por um dado ou por uma restrição (SQLSTATE das classes 22 e 23) é executado de novo, linha por linha, na
    /// mesma transação, até a recusada; nas outras classes, nula.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> InsertRowsAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken);

    /// <summary>
    /// RN-IMPORT-014 e 015: confirma a transação da carga. O cancelamento não a interrompe: ela vai até o fim, e quem a pediu só vê o cancelamento depois
    /// dela. Sem transação aberta (o banco sem log), não faz nada.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> CommitLoadAsync();

    /// <summary>
    /// RN-EXPORT-017, o começo da leitura da exportação, numa conexão à parte que só ela usa: o prazo de espera de trava (RN-EDIT-010) e, no
    /// PostgreSQL, a forma do texto que o servidor escreve (`DateStyle`, `extra_float_digits`, `bytea_output`) e a transação `REPEATABLE READ READ ONLY`
    /// em que a contagem e a leitura veem o mesmo instante do banco. No Db2 e no Informix não há transação: a leitura é a de uma sessão nova.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> BeginExportAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-EXPORT-017: o `SELECT COUNT(*)` sobre o comando, como no "Contar total", depois do <see cref="BeginExportAsync"/> e antes da leitura; no
    /// PostgreSQL, num ponto de salvamento só dele, para a recusa dele não estragar a transação. A recusa do banco é um sucesso sem total (nulo): a
    /// exportação segue sem ele. A falha é a da conexão que não serve mais.
    /// </summary>
    /// <param name="required">RN-IMPORT-023: a contagem é obrigatória (a cópia de Db2 ou de Informix com a origem e o destino no mesmo banco): a recusa do banco é a falha, e não um total nulo.</param>
    Task<Result<long?, DatabaseFailure>> CountExportAsync(string sql, bool required, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null);

    /// <summary>RN-EXPORT-017: envia o comando da exportação e devolve as colunas do resultado, com o leitor aberto para o <see cref="ReadExportRowsAsync"/>.</summary>
    Task<Result<IReadOnlyList<QueryColumn>, DatabaseFailure>> StartExportReadAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null);

    /// <summary>
    /// RN-EXPORT-017: o lote seguinte de linhas da exportação, do leitor aberto pelo <see cref="StartExportReadAsync"/>, cada valor inteiro (sem o corte da
    /// grade), lido em pedaços onde o driver deixa, e com os tetos do plano. No fim do resultado o leitor fecha, e a transação do PostgreSQL é confirmada.
    /// </summary>
    Task<Result<ExportBatch, DatabaseFailure>> ReadExportRowsAsync(ExportReadPlan plan, CancellationToken cancellationToken);
}
