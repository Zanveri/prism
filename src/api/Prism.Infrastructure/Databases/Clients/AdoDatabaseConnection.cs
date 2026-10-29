using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using Serilog.Events;
using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// A conexão com um banco sobre o ADO.NET (`DbConnection`, `DbCommand`, `DbDataReader`), igual para os três bancos. Tem o único `try` da
/// integração, no <see cref="Send{T}"/>, e decide como cada comando do usuário é executado (RN-SESSAO-005, RN-SQL-004 e 013):
///
/// - o que tem cara de leitura é tentado dentro de uma transação que o banco não deixa gravar, com o leitor aberto entre as páginas;
/// - o que o banco recusa ali por tentar gravar, e tudo o que não tem cara de leitura, roda fora de transação e é lido até o fim: quando
///   a resposta sai, a gravação está confirmada, e não há cursor que, ao fechar, a desfaça.
///
/// Cada banco entra com o que só ele sabe: como abrir a conexão, as consultas de catálogo, a consulta de verificação, a forma do `COUNT`,
/// como abrir a transação só de leitura e reconhecer a recusa dela, como ler a mensagem, o SQLSTATE e a posição da exceção do driver e,
/// quando o driver dele não entrega os valores prontos para o <see cref="CellFormatter"/>, como ler a célula de um resultado.
///
/// Não é segura para duas chamadas ao mesmo tempo, com exceção do <see cref="Cancel"/>: quem a usa faz um comando por vez.
/// </summary>
internal abstract class AdoDatabaseConnection(ILogger logger) : IDatabaseConnection
{
    private const string CommitSql = "COMMIT";
    private const string RollbackSql = "ROLLBACK";

    /// <summary>RN-EXPORT-017: o ponto de salvamento da contagem da exportação, dentro da transação da leitura (no PostgreSQL).</summary>
    private const string CountSavepointSql = "SAVEPOINT prism_count";
    private const string ReleaseCountSavepointSql = "RELEASE SAVEPOINT prism_count";
    private const string RollbackToCountSavepointSql = "ROLLBACK TO SAVEPOINT prism_count";

    /// <summary>RN-IMPORT-011: o ponto de salvamento de cada linha da conferência da conversão, dentro da transação só de leitura dela (no PostgreSQL).</summary>
    private const string ImportSavepointSql = "SAVEPOINT prism_import";
    private const string ReleaseImportSavepointSql = "RELEASE SAVEPOINT prism_import";
    private const string RollbackToImportSavepointSql = "ROLLBACK TO SAVEPOINT prism_import";

    /// <summary>RN-IMPORT-011: as conversões de um `SELECT` da conferência, no máximo (o PostgreSQL aceita até 1.664 colunas num resultado).</summary>
    private const int ImportCastsPerSelect = 1000;

    /// <summary>RN-IMPORT-015: as linhas de um comando (ou de um lote) da carga, no máximo.</summary>
    protected const int MaxLoadRows = 500;

    /// <summary>RN-IMPORT-015: os parâmetros de um `INSERT … VALUES` de várias linhas, no máximo (no Db2: com 40 colunas mapeadas, 250 linhas).</summary>
    private const int MaxLoadParameters = 10000;

    /// <summary>O SQLSTATE com que o PostgreSQL e o Db2 dizem que interromperam o comando a pedido ("query canceled").</summary>
    private const string QueryCanceledSqlState = "57014";

    private const string CanceledMessage = "O comando foi cancelado.";
    private const string UnknownOutcomeAdvice = "O Prism não sabe se o comando foi concluído: confira no banco antes de executá-lo de novo.";
    private const string UnknownOutcomeMessage = $"O banco não respondeu ao cancelamento a tempo, e a sessão foi encerrada. {UnknownOutcomeAdvice}";
    private const string CanceledWhileReturningRowsMessage = "O cancelamento chegou enquanto o comando devolvia as linhas. O que ele gravou até ali está confirmado, e pode ser só uma parte do comando: o Prism não sabe se ele foi concluído. Confira no banco antes de executá-lo de novo.";
    private const string ConnectionClosedMessage = "A conexão com o banco foi encerrada, e o comando não foi enviado. Abra a sessão de novo.";
    private const string NoOpenCursorMessage = "Não há cursor aberto: execute o comando de novo.";
    /// <summary>RN-BUSCA-002: o tipo que a quarta coluna de <see cref="ObjectNamesSql"/> traz para a visão; o que não é ele é tabela.</summary>
    private const string ViewObjectKind = "view";

    private const string UnknownObjectKindMessage = "O tipo de objeto pedido não existe: use tables, views, routines ou sequences.";
    private const string TransactionControlMessage = "Comandos de controle de transação (BEGIN, COMMIT, ROLLBACK, SAVEPOINT) não são aceitos: toda sessão é auto-commit, e cada comando é confirmado quando termina.";
    private const string UndoneTransactionMessage = $"O comando deixou uma transação aberta, e o Prism a desfez: nada do que ele gravou dentro dela ficou. {TransactionControlMessage}";
    private const string WritesAfterTheFirstPageMessage = "O comando começou como leitura e tentou gravar depois da primeira página; nada foi gravado. Execute-o de novo: ele será executado até o fim.";
    private const string SeveralStatementsMessage = "Cada execução leva um comando só, e o texto enviado tem mais de um; nada foi executado. Envie um de cada vez. Um bloco com `;` no corpo (procedimento, função, gatilho, bloco composto) é um comando só.";
    private const string NotCountableMessage = "Só uma leitura pode ser contada, e o comando enviado não é uma leitura só; nada foi executado.";
    private const string NoRowMessage = "A linha não existe mais, ou a chave dela mudou: o comando não alterou nenhuma linha.";

    private readonly ILogger _logger = logger.ForContext<AdoDatabaseConnection>();

    private DbConnection? _connection;

    /// <summary>O comando do cursor aberto ou o que está rodando. É o que o `Cancel` interrompe, de outra thread.</summary>
    private volatile DbCommand? _command;

    private DbDataReader? _reader;
    private IReadOnlyList<QueryColumn> _columns = [];

    /// <summary>RN-SQL-016: as linhas de cada página do cursor aberto, as que o comando pediu. O "carregar mais" lê no mesmo tamanho.</summary>
    private int _pageSize = QueryPaging.DefaultPageSize;

    /// <summary>O leitor já está sobre uma linha que a página anterior não levou: é a leitura a mais que responde se há outra página.</summary>
    private bool _rowPending;

    /// <summary>
    /// Há uma transação aberta no banco, que o descarte do cursor encerra: a só de leitura da tentativa paginada (ou da contagem), ou a
    /// que um comando do usuário abriu sem a recusa da RN-SQL-003 reconhecer.
    /// </summary>
    private bool _inTransaction;

    /// <summary>O comando do cursor aberto, e o comando que o banco recusou por gravar depois da primeira página: executado de novo, vai direto até o fim.</summary>
    private string? _cursorSql;
    private string? _writesAfterTheFirstPage;

    /// <summary>O último comando do usuário voltou sem conjunto de resultados e sem contagem de linhas: um comando utilitário, o único que pode ter aberto uma transação.</summary>
    private bool _utilityCommand;

    /// <summary>Há um comando em andamento nesta conexão. Fora disso o `Cancel` não tem o que interromper (RN-SQL-010).</summary>
    private volatile bool _running;

    /// <summary>
    /// O cancelamento pedido pelo Prism durante o comando em andamento. Só decide o resultado no banco cujo driver volta vazio sem
    /// exceção (<see cref="CancelReturnsEmptyResult"/>); nos demais quem diz que o comando foi cancelado é a exceção do driver, e um
    /// comando que terminou antes de o cancelamento chegar é sucesso. Vale enquanto o cursor do comando estiver aberto: o "carregar
    /// mais" não o baixa.
    /// </summary>
    private volatile bool _canceled;

    /// <summary>
    /// No driver que volta vazio sem exceção, o comando executado até o fim já rodou no banco quando o leitor abriu: dali em diante o
    /// cancelamento não o transforma em comando cancelado (<see cref="CancelReturnsEmptyResult"/>).
    /// </summary>
    private bool _executed;

    /// <summary>
    /// No mesmo driver, o cancelamento foi pedido antes de o comando executado até o fim entregar a última linha. O driver só para
    /// de entregá-las: a página e o total podem não ser os do comando, e o que ele gravava enquanto as devolvia pode ter ficado pela
    /// metade, já confirmado. A resposta não é sucesso nem "cancelado": é a de que o Prism não sabe.
    /// </summary>
    private bool _canceledWhileReturningRows;

    /// <summary>
    /// A fonte de cancelamento do comando em andamento, ligada à da requisição. Todo envio ao banco dentro do comando a recebe: um
    /// cancelamento que chega antes de o comando do usuário ser enviado (enquanto o `BEGIN` da tentativa vai ao banco, por exemplo) faz
    /// com que ele nem seja enviado.
    /// </summary>
    private volatile CancellationTokenSource? _cancellation;

    /// <summary>
    /// A conexão foi descartada por esta classe. O estado que o driver informa não basta para dizer que ela não serve mais: o da
    /// IBM continua respondendo "aberta" depois do descarte de uma conexão que ele não conseguiu fechar (a que ficou sem banco, depois
    /// de um `CLOSE DATABASE` no Informix).
    ///
    /// Só sobe depois de o descarte do driver voltar. O descarte pedido com um comando em andamento só volta, no Npgsql, quando o
    /// comando termina e segue o caminho dele até o fim, e esse caminho pergunta por <see cref="IsOpen"/>: a marca posta antes fazia
    /// o comando parar no meio, e o descarte nunca voltava.
    /// </summary>
    private volatile bool _discarded;

    /// <summary>
    /// RN-EDIT-005: a transação do "Salvar", do próprio driver (no Db2 é ela que tira a conexão do auto-commit). Enquanto existe, todo
    /// comando entra nela, e o cursor abandonado (<see cref="DisposeCursorAsync"/>) a desfaz. Não usa `_inTransaction`, que é a da
    /// leitura paginada: o fim de uma consulta de catálogo dentro do "Salvar" não confirma nada.
    /// </summary>
    private DbTransaction? _editTransaction;

    /// <summary>
    /// RN-PROT-006: o modo da sessão que o Prism pôs no banco (<see cref="SessionModeSql"/>): verdadeiro depois do primeiro comando de uma conexão
    /// somente leitura, falso depois de ela deixar de ser. Nulo enquanto o Prism não mandou nada: a sessão de uma conexão que nunca foi somente
    /// leitura fica com o que o banco e o usuário dele já usam.
    /// </summary>
    private bool? _readOnlyMode;

    /// <summary>RN-PROT-002: o cursor aberto é de um comando de uma conexão somente leitura. A recusa por gravar no "carregar mais" é a resposta, como veio.</summary>
    private bool _cursorReadOnly;

    /// <summary>
    /// RN-IMPORT-015: o comando da carga preparado no banco, que serve às linhas seguintes enquanto o texto é o mesmo (no Informix, uma linha por comando,
    /// preparado uma vez e executado a cada linha; no Db2, os `INSERT` de várias linhas do mesmo tamanho). Sai com a conexão.
    /// </summary>
    private DbCommand? _loadCommand;

    /// <summary>RN-IMPORT-016: o lote da carga em andamento (PostgreSQL), para o <see cref="Send{T}"/> dizer qual comando dele o banco recusou.</summary>
    private DbBatch? _loadBatch;

    public string ServerVersion { get; private set; } = string.Empty;

    public bool IsOpen => !_discarded && _connection?.State == ConnectionState.Open;

    /// <summary>O leitor só fica aberto entre páginas: o fim da leitura (<see cref="FinishCursorAsync"/>) e o abandono (<see cref="DisposeCursorAsync"/>) o tiram.</summary>
    public bool HasOpenCursor => _reader is not null;

    /// <summary>A consulta de verificação do banco (RN-CONN-013).</summary>
    protected abstract string PingSql { get; }

    /// <summary>
    /// RN-PROT-006: o comando que põe a sessão no modo só de leitura do banco (ou o tira dele), para toda transação seguinte. Nulo, por padrão: o
    /// banco que não tem esse modo fica só com a recusa pelo texto (`ReadOnlySql`). O PostgreSQL tem (`SET SESSION CHARACTERISTICS`).
    /// </summary>
    protected virtual string? SessionModeSql(bool readOnly)
        => null;

    /// <summary>
    /// Colunas: nome, se é de sistema e quantas tabelas, visões e rotinas ele tem, contadas como a lista de objetos as lista (RN-CAT-010),
    /// numa consulta só, agrupada. Já na ordem da árvore, com os de sistema por último (RN-ARVORE-004).
    /// </summary>
    protected abstract string SchemasSql { get; }

    /// <summary>
    /// Parâmetros: esquema e tabela. Colunas: nome, tipo, se aceita nulo, se é da chave primária, a posição, a expressão padrão (ou nulo) e
    /// quem gera o valor (<see cref="ColumnGeneration"/>, ou nulo), na ordem da tabela (RN-CAT-001).
    /// </summary>
    protected abstract string ColumnsSql { get; }

    /// <summary>
    /// Parâmetros: esquema e tabela. Uma linha por coluna de cada índice, na ordem do índice: nome do índice, se é único, nome da coluna e o
    /// método ou tipo do índice, ou nulo (RN-CAT-003).
    /// </summary>
    protected abstract string IndexesSql { get; }

    /// <summary>
    /// Parâmetros: esquema e tabela que têm as chaves. Uma linha por par de colunas de cada chave, na ordem da chave, nas colunas de uma
    /// linha de chave estrangeira: nome da chave, esquema e tabela que a têm, coluna, esquema, tabela e coluna referenciados e as regras ao
    /// excluir e ao atualizar (<see cref="ForeignKeyRule"/>, ou nulo; RN-CAT-002). Pelo nome da chave.
    /// </summary>
    protected abstract string ForeignKeysSql { get; }

    /// <summary>
    /// RN-CAT-004. Parâmetros: esquema e tabela referenciados. As chaves de qualquer tabela (inclusive a própria) que apontam para ela, nas
    /// colunas de <see cref="ForeignKeysSql"/>, pelo nome da chave e depois pela tabela que a tem.
    /// </summary>
    protected abstract string ReferencedBySql { get; }

    /// <summary>
    /// RN-CAT-005. Parâmetros: esquema e tabela. Colunas: nome da restrição de conferência e um pedaço da condição, pelo nome e, dentro de
    /// cada restrição, na ordem dos pedaços (<see cref="JoinChunks"/>). Só as restrições `CHECK` de verdade: nem `NOT NULL`, nem as que o
    /// banco cria por conta própria para outra coisa.
    /// </summary>
    protected abstract string ChecksSql { get; }

    /// <summary>RN-CAT-006. Parâmetros: esquema e visão. Coluna: um pedaço do texto que o banco guarda para a visão, na ordem (<see cref="JoinChunks"/>). Nenhuma linha quando ele não devolve nada.</summary>
    protected abstract string ViewDefinitionSql { get; }

    /// <summary>
    /// RN-CAT-008. Parâmetro: esquema. As colunas de todas as tabelas dele (as visões não entram), pela tabela e depois pela posição:
    /// tabela, coluna, tipo, se aceita nulo e se é da chave primária. Na tabela sem coluna nenhuma, uma linha com a coluna nula.
    /// </summary>
    protected abstract string DiagramColumnsSql { get; }

    /// <summary>RN-CAT-008. Parâmetro: esquema. As chaves de todas as tabelas dele, nas colunas de <see cref="ForeignKeysSql"/> e na mesma ordem.</summary>
    protected abstract string DiagramForeignKeysSql { get; }

    /// <summary>
    /// RN-CAT-010: as consultas das propriedades do banco conectado, sem parâmetro, rodadas em ordem. Colunas: nome (`encoding`,
    /// `loggingMode`...) e valor em texto. O valor nulo não vem, e a consulta que o banco recusa a esta conta é deixada de lado.
    /// </summary>
    protected abstract IReadOnlyList<string> PropertiesSql { get; }

    /// <summary>
    /// RN-ARVORE-006: os bancos do servidor a que a conta pode se conectar, sem parâmetro. Colunas: nome, sem os espaços do fim, e se é o
    /// banco da sessão (booleano ou 0/1), em ordem de nome.
    /// </summary>
    protected abstract string DatabasesSql { get; }

    /// <summary>
    /// RN-SQL-013: o comando que abre, no banco, a transação em que a leitura paginada e a contagem rodam e em que ele mesmo recusa
    /// qualquer gravação. Ela termina com `COMMIT` quando o comando chega ao fim e com `ROLLBACK` quando o cursor fecha antes.
    ///
    /// Nulo no banco que não tem transação só de leitura (Db2 e Informix): a leitura paginada fica em auto-commit, sem transação
    /// nenhuma, e quem diz que o comando é leitura é o texto dele (<see cref="TriesAsRead"/>).
    /// </summary>
    protected abstract string? BeginReadOnlySql { get; }

    /// <summary>
    /// O driver deste banco não lança quando o cancelamento chega durante a leitura das linhas: devolve um resultado vazio, ou só
    /// para de entregá-las (os da IBM; ele lança quando interrompe a execução). Só então o cancelamento guardado pela conexão decide
    /// o resultado: sem ele a página cortada passaria por inteira. Uma leitura (a paginada, a de catálogo, a contagem) responde que
    /// foi cancelada. O comando executado até o fim já rodou no banco quando o leitor abre: sem linhas, é sucesso; com linhas e o
    /// cancelamento pedido antes da última, a resposta é a de que o Prism não sabe se ele foi concluído (RN-SQL-010).
    /// </summary>
    protected virtual bool CancelReturnsEmptyResult => false;

    /// <summary>
    /// O driver deste banco é síncrono: as chamadas `Async` dele só voltam quando o banco responde, e prenderiam a thread de quem
    /// chama (a da requisição, ou a de quem pede o cancelamento). As chamadas ao banco passam a rodar em outra thread, com a cultura
    /// invariável: o driver da IBM formata datas e números com a cultura da thread, e o que sai dele não pode depender do idioma
    /// de quem roda o Prism (RN-SQL-011).
    /// </summary>
    protected virtual bool BlocksTheCallingThread => false;

    /// <summary>
    /// O que o driver deste banco não aceita nos dados da conexão, dito a quem a cadastrou antes de o driver ser chamado: é dado de
    /// entrada, e não defeito, e não vai para o log. Nulo quando não há o que recusar.
    /// </summary>
    protected virtual string? SettingsRefusal => null;

    /// <summary>Cria a conexão do driver, ainda fechada. Roda dentro do <see cref="Send{T}"/>: montar a string de conexão também pode lançar.</summary>
    protected abstract DbConnection CreateConnection();

    /// <summary>
    /// RN-EDIT-003 e 010: a consulta que acha a tabela do `FROM` no catálogo, com os parâmetros dela, e devolve uma linha com o esquema e o
    /// nome como o banco os guarda, o tipo (`table`, `view`, `materializedView`, `foreign` ou `other`), o identificador da tabela quando a
    /// resposta de um comando o usa (PostgreSQL; nulo nos outros) e, como 0 ou 1, se o banco não tem log de transação (RN-EDIT-012).
    /// Nenhuma linha quando ela não existe como tabela nem como visão.
    /// </summary>
    protected abstract (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table);

    /// <summary>
    /// RN-EDIT-003: a mesma consulta de <see cref="EditRelationQuery"/>, pelo identificador que a resposta de um comando dá à tabela de
    /// cada coluna (PostgreSQL); nula no banco cuja resposta não o dá.
    /// </summary>
    protected virtual (string Sql, IReadOnlyList<object> Parameters)? EditRelationByIdQuery(long id)
        => null;

    /// <summary>
    /// RN-EDIT-002: as chaves da tabela que servem à edição (a primária, as restrições únicas e os índices únicos sem condição e só de
    /// colunas), uma coluna por linha: o nome da chave, se ela é a primária (0 ou 1) e a coluna, a primária primeiro e as colunas na ordem
    /// da chave. Os parâmetros são o esquema e a tabela, como em <see cref="ColumnsSql"/>.
    /// </summary>
    protected abstract string EditKeysSql { get; }

    /// <summary>
    /// RN-EDIT-021: o nível de isolamento da transação do "Salvar" com a coluna inteira, para a conferência do catálogo, a contagem e o `UPDATE` verem o
    /// mesmo retrato do banco. Nulo, por padrão: vale o do banco (Db2 e Informix). O PostgreSQL em Auto-commit responde Repeatable read.
    /// </summary>
    protected virtual IsolationLevel? WholeColumnIsolation => null;

    /// <summary>RN-EDIT-010: o comando que dá à conexão à parte do catálogo um prazo de espera de trava, em vez de esperar para sempre.</summary>
    protected abstract string LockTimeoutSql { get; }

    /// <summary>
    /// RN-EXPORT-017: os comandos que preparam a conexão à parte da exportação, logo depois de conectar e antes de qualquer transação: o prazo de espera
    /// de trava, por padrão. O banco que escreve o texto das células conforme a sessão fixa aqui a forma dele (o PostgreSQL).
    /// </summary>
    protected virtual IReadOnlyList<string> ExportSessionSql => [LockTimeoutSql];

    /// <summary>
    /// RN-EXPORT-017: o comando que abre a transação em que a contagem e a leitura da exportação veem o mesmo instante do banco, sem poder gravar; ela é
    /// confirmada quando a leitura chega ao fim. Nulo, por padrão: o banco sem transação só de leitura (Db2 e Informix) lê como uma sessão nova.
    /// </summary>
    protected virtual string? BeginExportSql => null;

    /// <summary>RN-EXPORT-017: como o leitor da exportação é aberto. O banco que lê o valor em pedaços (<see cref="ReadExportCellAsync"/>) pede o acesso sequencial.</summary>
    protected virtual CommandBehavior ExportBehavior => CommandBehavior.Default;

    /// <summary>
    /// RN-EXPORT-017: uma célula da exportação, inteira, no texto em que a grade a escreve (ou os bytes do binário), com o tamanho dela (o texto em bytes
    /// de UTF-8, o binário em bytes). O valor acima de `limit` não é guardado: volta nulo, com o tamanho que passou do teto. Por padrão o driver entrega o
    /// valor inteiro (<see cref="ReadCell"/>), e o teto vale logo depois dele; o banco cujo driver lê em pedaços para ao passar dele, sem montar o valor. Na
    /// cópia (`copy`, RN-IMPORT-026), a data e hora vai com as 7 casas de fração do driver.
    /// </summary>
    protected virtual ValueTask<ExportCellRead> ReadExportCellAsync(DbDataReader reader, int ordinal, string kind, long limit, bool copy, CancellationToken cancellationToken)
    {
        var value = ReadCell(reader, ordinal, kind);
        if (value is null or DBNull)
            return ValueTask.FromResult(new ExportCellRead(ExportCell.Null, 0));

        var cell = copy ? CellFormatter.ForCopy(value) : CellFormatter.ForExport(value);
        var bytes = cell.Bytes?.LongLength ?? Encoding.UTF8.GetByteCount(cell.Text!);

        return ValueTask.FromResult(bytes > limit ? new ExportCellRead(ExportCell.Null, bytes) : new ExportCellRead(cell, bytes));
    }

    /// <summary>
    /// RN-EDIT-003: de que tabela e coluna vem cada coluna do resultado, quando o banco diz isso na própria resposta, sem consulta a
    /// mais. Nulo, por padrão: no Db2 e no Informix quem diz é a leitura do comando.
    /// </summary>
    protected virtual IReadOnlyList<ColumnOrigin?>? ColumnOrigins(DbDataReader reader)
        => null;

    /// <summary>RN-VAR-032: o dialeto do banco, para converter os parâmetros do comando do usuário. O PostgreSQL por padrão; os da IBM informam o deles.</summary>
    protected virtual ESqlDialect QueryDialect => ESqlDialect.PostgreSql;

    /// <summary>
    /// RN-VAR-017 e 032: o parâmetro de um comando do usuário, convertido para o banco (<see cref="QueryParameterBinding"/>). Por padrão, o valor e o `DbType` quando
    /// vem; cada driver põe o tipo dele (o `NpgsqlDbType.Unknown`, o `DB2Type`).
    /// </summary>
    protected virtual void BindQueryParameter(DbParameter parameter, BoundQueryParameter bound)
    {
        if (bound.DbType is { } type)
            parameter.DbType = type;

        parameter.Value = bound.Value ?? DBNull.Value;
    }

    /// <summary>RN-VAR-032: os parâmetros do comando do usuário, ligados na ordem do texto (`$1`, `$2`... no PostgreSQL, `?` nos outros).</summary>
    private void BindQueryParameters(DbCommand command, IReadOnlyList<QueryParameter>? parameters)
    {
        if (parameters is null)
            return;

        foreach (var value in parameters)
        {
            var parameter = command.CreateParameter();
            BindQueryParameter(parameter, QueryParameterBinding.Convert(QueryDialect, value));
            command.Parameters.Add(parameter);
        }
    }

    /// <summary>O parâmetro de um comando da edição: o valor convertido da edição (RN-EDIT-006), ou o do comando do usuário que a coluna inteira leva no `&lt;Q&gt;` (RN-VAR-033).</summary>
    private void BindCommandParameter(DbParameter parameter, EditParameter value)
    {
        if (value.Query is { } query)
            BindQueryParameter(parameter, QueryParameterBinding.Convert(QueryDialect, query));
        else
            BindEditParameter(parameter, value);
    }

    /// <summary>RN-SQL-008: prepara os marcadores e nomes de parâmetros do comando antes do envio nas engines que exigem parâmetros nomeados.</summary>
    protected virtual void PrepareCommand(DbCommand command)
    {
    }

    /// <summary>RN-EDIT-006: o valor de um comando do "Salvar" no parâmetro. Por padrão, o valor convertido, com o tipo quando ele vem.</summary>
    protected virtual void BindEditParameter(DbParameter parameter, EditParameter value)
    {
        if (value.Type is { } type)
            parameter.DbType = type;

        parameter.Value = value.Value ?? DBNull.Value;
    }

    /// <summary>
    /// RN-IMPORT-010 e 015: um valor da importação no parâmetro: o convertido pelo Prism, com o tipo quando ele vem (Db2 e Informix), como no "Salvar". O
    /// banco que converte o texto (o PostgreSQL) manda o texto sem tipo e os bytes do binário no tipo binário dele.
    /// </summary>
    protected virtual void BindImportParameter(DbParameter parameter, EditParameter value)
        => BindEditParameter(parameter, value);

    /// <summary>
    /// RN-IMPORT-011: a conversão de um parâmetro (`$1`, a partir de 1) para o tipo de uma coluna, como o catálogo o escreve, na conferência da prévia. Nula,
    /// por padrão: no banco em que o Prism converte (Db2 e Informix), a conferência não vai ao banco.
    /// </summary>
    protected virtual string? ImportCastSql(string type, int parameter)
        => null;

    /// <summary>
    /// RN-IMPORT-010: no banco que tem domínios (o PostgreSQL), a consulta do tipo-base de cada coluna da tabela que é de um domínio. Parâmetros: esquema e
    /// tabela. Colunas: o nome da coluna e o tipo-base, sem modificadores. Nula, por padrão.
    /// </summary>
    protected virtual string? DomainBaseTypesSql => null;

    /// <summary>
    /// RN-IMPORT-015: quantas linhas vão num comando da carga com `columns` colunas. Por padrão (o Db2), um `INSERT … VALUES` de várias linhas, até 500 e
    /// até 10.000 parâmetros; o banco que não aceita várias linhas num `INSERT` (o Informix) responde 1.
    /// </summary>
    protected virtual int RowsPerLoadCommand(int columns)
        => Math.Clamp(MaxLoadParameters / Math.Max(1, columns), 1, MaxLoadRows);

    /// <summary>
    /// RN-IMPORT-015: o banco manda as linhas da carga num lote de comandos de uma linha numa ida só (o `NpgsqlBatch` do PostgreSQL), e não num `INSERT`
    /// de várias linhas. O lote diz qual comando o banco recusou, e assim qual linha, sem uma segunda passada.
    /// </summary>
    protected virtual bool LoadsInBatches => false;

    /// <summary>O marcador do parâmetro de posição dada (a partir de 1) num comando da carga: `?` por padrão, `$1` no PostgreSQL.</summary>
    protected virtual string LoadParameter(int position)
        => "?";

    /// <summary>
    /// Parâmetro: esquema. Colunas: nome, tipo (`table`, `view`, `procedure` ou `function`), a estimativa de linhas das estatísticas (nula
    /// quando não há estatística, e em tudo o que não é tabela) e o comentário (ou nulo), pelo nome (RN-CAT-009). Nulo para um tipo de
    /// objeto que não existe.
    /// </summary>
    /// <param name="kind">`tables`, `views`, `routines` ou `sequences`.</param>
    protected abstract string? ObjectsSql(string kind);

    /// <summary>
    /// RN-BUSCA-002. Sem parâmetro: as tabelas e as visões de todos os esquemas, com os mesmos tipos de objeto que <see cref="ObjectsSql"/>
    /// lista. Colunas: esquema (sem os espaços do fim), se é de sistema (booleano ou 0/1, o critério de <see cref="SchemasSql"/>), nome e
    /// tipo (`table` ou `view`, sem os espaços do fim), em ordem de esquema, os de sistema por último, e de nome. Só as primeiras
    /// `rows` linhas: o número entra no texto como constante (`LIMIT`, `FETCH FIRST … ROWS ONLY`, `SELECT FIRST`), e nunca como dado de fora.
    /// </summary>
    /// <param name="rows">Quantas linhas, no máximo, a consulta devolve. Quem chama (<see cref="GetObjectNamesAsync"/>) pede uma a mais que o limite.</param>
    protected abstract string ObjectNamesSql(int rows);

    /// <summary>RN-SQL-006: o `SELECT COUNT(*)` com o comando como subconsulta, na forma que o banco aceita.</summary>
    protected abstract string CountSql(string sql);

    /// <summary>
    /// A exceção do driver como recusa: a mensagem do banco como veio (decisão 4 do guia da raiz), com o detalhe e a dica, e o SQLSTATE e
    /// a posição quando o driver os informa (RN-SQL-009).
    /// </summary>
    protected abstract DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception);

    /// <summary>O banco recusou o comando porque ele grava, ou porque não roda dentro de transação: não é erro de quem escreveu, é o sinal para executá-lo até o fim.</summary>
    protected abstract bool IsWriteRefusal(DatabaseFailure failure);

    /// <summary>
    /// RN-SQL-010: a recusa é o banco dizendo que interrompeu o comando, e com isso o desfez? Por padrão, o SQLSTATE 57014, que o
    /// PostgreSQL e o Db2 usam, e a exceção sem nenhuma informação do banco, no driver que a lança na interrupção
    /// (<see cref="CameWithoutErrorInformation"/>). O banco que diz isso de outro jeito responde aqui (o Informix, pelo erro nativo da
    /// exceção). Só a exceção desta recusa decide, e não um estado guardado da conexão: o pedido de cancelamento roda em outra thread e
    /// também passa pelo <see cref="ToFailure"/>.
    /// </summary>
    protected virtual bool IsInterruption(Exception exception, DatabaseFailure failure)
        => failure.SqlState == QueryCanceledSqlState || CameWithoutErrorInformation(exception);

    /// <summary>
    /// RN-SQL-010 e RN-EDIT-021: a exceção é a do driver que não trouxe nenhum erro do banco ("no error information available")? No driver da
    /// IBM é como chega, às vezes, o comando interrompido dentro da transação do driver (a do "Salvar" e a da carga), nos dois bancos. Ela conta
    /// como interrupção, e quem decide o desfecho é o `RunAsync` (<see cref="WithTheCancelOutcome"/>): sem pedido de cancelamento ela fica um
    /// erro comum, sem desfecho. Por padrão, nenhuma exceção é assim.
    /// </summary>
    protected virtual bool CameWithoutErrorInformation(Exception exception)
        => false;

    /// <summary>
    /// Vale tentar o comando como leitura paginada? Só pela primeira palavra: quem diz se ele grava é o banco, dentro da transação só de
    /// leitura. O que não começa como leitura nem passa pela tentativa, e roda como um comando qualquer em auto-commit.
    /// </summary>
    protected virtual bool MayBeRead(string firstWord)
        => firstWord is "SELECT" or "WITH" or "VALUES" or "(";

    /// <summary>
    /// RN-SQL-013: o comando é tentado como leitura paginada, com o cursor aberto entre as páginas? Por padrão, o que começa como
    /// leitura e não é um `WITH` que grava: quem diz o resto é o banco, na transação só de leitura. O banco que não tem essa
    /// transação decide tudo aqui, pelo texto, e só deixa paginar o que é uma leitura só.
    /// </summary>
    protected virtual bool TriesAsRead(string sql)
        => MayBeRead(SqlText.LeadingWords(sql).First) && !SqlText.WithModifiesData(sql);

    /// <summary>RN-SQL-003: o comando é controle de transação, na forma em que este banco o escreve? É recusado sem ir ao banco.</summary>
    protected virtual bool IsTransactionControl(string sql)
        => SqlText.IsTransactionControl(sql);

    /// <summary>
    /// RN-SQL-001: o envio tem mais de um comando? Só responde o banco cujo driver os executaria um por um, cada um com a própria
    /// confirmação (os da IBM): ali o envio é recusado sem ir ao banco. No PostgreSQL quem recusa é o próprio banco.
    /// </summary>
    protected virtual bool HasSeveralStatements(string sql)
        => false;

    /// <summary>
    /// RN-SQL-006: o comando pode ir ao banco como subconsulta do "contar total"? No banco que tem transação só de leitura, qualquer
    /// um: ali ele não grava. No que não tem, só o que o texto diz ser uma leitura só.
    /// </summary>
    protected virtual bool MayBeCounted(string sql)
        => true;

    /// <summary>
    /// RN-SESSAO-005: o comando que acabou de ser executado até o fim pode ter deixado a conexão dentro de uma transação? É a
    /// pergunta que decide se a sonda (<see cref="ProbeTransactionAsync"/>) roda. Por padrão, só o comando utilitário, que volta sem
    /// conjunto de resultados e sem contagem de linhas (é assim que um `BEGIN` volta). No banco em que uma rotina pode abrir
    /// transação e devolver linhas, a resposta é outra.
    /// </summary>
    protected virtual bool MayHaveOpenedATransaction(bool returnedRows, int recordsAffected)
        => !returnedRows && recordsAffected < 0;

    /// <summary>
    /// RN-SESSAO-005: o comando executado até o fim que FALHA pode deixar a conexão dentro de uma transação? Por padrão não, e a
    /// sonda não roda depois de uma falha. No Informix pode: a função que abre a transação por dentro, grava, devolve linhas e
    /// lança deixa a transação aberta, e o comando seguinte cairia dentro dela.
    /// </summary>
    protected virtual bool MayLeaveATransactionOpenWhenItFails => false;

    /// <summary>
    /// RN-LOG-001: a recusa do banco que acabou de passar pelo <see cref="ToFailure"/> é a resposta de rotina de um gancho deste
    /// banco (<see cref="TryAsync"/>)? A que é não enche o log: sai como depuração, abaixo do nível com que o Prism roda. Nenhuma,
    /// por padrão. No Informix são as duas que a sonda de transação procura, e num banco sem log uma delas vem a cada comando.
    /// </summary>
    protected virtual bool IsRoutineRefusal => false;

    /// <summary>O ajuste que o banco precisa num comando do usuário (executar e contar) antes de ele ser enviado.</summary>
    protected virtual void ConfigureUserCommand(DbCommand command)
        => command.CommandText = SqlText.RewriteDoubleQuotedLiterals(command.CommandText, QueryDialect);

    /// <summary>`text`, `number`, `datetime`, `boolean` ou `binary` da coluna de um resultado. Por padrão, pelo tipo do C# que o driver entrega.</summary>
    protected virtual string ColumnKind(DbDataReader reader, int ordinal)
        => CellFormatter.KindOf(reader.GetFieldType(ordinal));

    /// <summary>
    /// RN-CAT-005 e 006: o texto inteiro a partir dos pedaços em que o catálogo o guarda, na ordem. Por padrão, um seguido do outro: o
    /// banco que guarda em pedaços de tamanho fixo diz o que é enchimento.
    /// </summary>
    protected virtual string JoinChunks(IReadOnlyList<string> chunks)
        => string.Concat(chunks);

    /// <summary>O valor de uma célula de um resultado, como o <see cref="CellFormatter"/> o recebe. Por padrão, o que o driver entrega.</summary>
    protected virtual object ReadCell(DbDataReader reader, int ordinal, string kind)
        => reader.GetValue(ordinal);

    /// <summary>
    /// Interrompe, no driver, o comando que já está no banco. Por padrão é o `Cancel` do comando: a implementação padrão do ADO.NET não
    /// olha a fonte de cancelamento enquanto espera uma linha. O banco cujo driver já interrompe pela fonte não repete o pedido.
    /// </summary>
    protected virtual void CancelCommand(DbCommand command)
        => command.Cancel();

    /// <summary>
    /// Envia o comando ao banco e devolve o leitor. Por padrão é o do ADO.NET, que interrompe o comando pela fonte de cancelamento. O
    /// banco cujo driver perde o pedido de cancelamento que chega antes de o comando estar executando cuida disso aqui.
    /// </summary>
    protected virtual Task<DbDataReader> ExecuteReaderAsync(DbCommand command, CancellationToken cancellationToken)
        => command.ExecuteReaderAsync(cancellationToken);

    /// <summary>
    /// RN-SESSAO-005, a rede de segurança: a conexão ficou dentro de uma transação? A base pergunta depois de um comando do usuário que
    /// voltou sem conjunto de resultados e sem contagem de linhas (é assim que um `BEGIN` volta), para o caso de uma forma de abrir
    /// transação que a recusa da RN-SQL-003 não conheça. Por padrão não confere nada; o banco que tem como saber responde, e não lança:
    /// a chamada ao driver passa pelo <see cref="TryAsync"/>.
    ///
    /// Quando a sonda roda, o banco já confirmou o comando. Por isso só responde <see cref="ETransactionProbe.InTransaction"/> o que diz
    /// isso com certeza; a sonda que falha por outro motivo (a conexão caiu, o banco recusou a ida e volta dela) responde
    /// <see cref="ETransactionProbe.Failed"/>, e não muda a resposta do comando.
    /// </summary>
    protected virtual Task<ETransactionProbe> ProbeTransactionAsync(DbConnection connection)
        => Task.FromResult(ETransactionProbe.Idle);

    /// <summary>O que o driver mantém além da conexão e precisa ser descartado com ela. Nada, por padrão.</summary>
    protected virtual ValueTask DisposeDriverAsync()
        => ValueTask.CompletedTask;

    /// <summary>Abre a conexão e a devolve pronta. Se não abre, descarta o que criou e devolve a recusa do banco (RN-SESSAO-003).</summary>
    public async Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(CancellationToken cancellationToken)
    {
        if (SettingsRefusal is { } refusal)
            return new DatabaseFailure(EDatabaseFailure.ConnectionFailed, refusal);

        var opened = await Send<IDatabaseConnection>(nameof(OpenAsync), EDatabaseFailure.ConnectionFailed, async () =>
        {
            _connection = CreateConnection();
            await _connection.OpenAsync(cancellationToken);
            ServerVersion = _connection.ServerVersion;

            return this;
        });

        if (opened.IsFailure)
            await DisposeAsync();

        return opened;
    }

    public Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken)
        => VerifyAsync(null, cancellationToken);

    /// <summary>
    /// RN-CONN-013 e RN-VERIF-001. A consulta própria (validada antes como uma leitura só, RN-PROT-005) vai como a pessoa a escreveu, com o ajuste que o
    /// banco pede num texto dela (<see cref="ConfigureUserCommand"/>), lida até o fim e com o prazo do driver, como o catálogo; no banco que tem
    /// transação só de leitura ela roda numa, e nem uma função chamada por ela grava. Sem ela, a do banco (<see cref="PingSql"/>).
    /// </summary>
    public async Task<UnitResult<DatabaseFailure>> VerifyAsync(string? sql, CancellationToken cancellationToken)
        => await RunAsync(nameof(VerifyAsync), EDatabaseFailure.ConnectionFailed, async token =>
        {
            if (sql is not null)
                await BeginReadOnlyAsync(token);

            var reader = await StartAsync(sql ?? PingSql, [], userCommand: false, token, userText: sql is not null);
            while (await reader.ReadAsync(token))
            {
            }

            await FinishCursorAsync(token);

            return true;
        }, cancellationToken);

    public async Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        // RN-SQL-003: recusado aqui, sem ir ao banco. Um `BEGIN` deixaria a conexão dentro de uma transação que ninguém fecha.
        if (IsTransactionControl(sql))
            return new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, TransactionControlMessage);

        // RN-SQL-001: também sem ir ao banco. O driver que executa os comandos de um envio um por um deixaria gravado o que veio antes
        // de um erro, e um `BEGIN` depois do primeiro comando abriria a transação que a recusa acima existe para evitar.
        if (HasSeveralStatements(sql))
            return new DatabaseFailure(EDatabaseFailure.MultipleStatementsNotSupported, SeveralStatementsMessage);

        return await ExecuteWithoutRefusalAsync(sql, pageSize, cancellationToken, parameters);
    }

    /// <summary>
    /// RN-PROT-002 e 006: o comando de uma conexão somente leitura, que o registro de sessões já conferiu pelo texto (`ReadOnlySql`). Sempre na tentativa
    /// paginada (no PostgreSQL, a transação só de leitura, com a sessão no modo só de leitura do banco), e a recusa do banco por gravar é a resposta:
    /// nunca roda de novo fora da transação, como o comando de uma conexão comum. As recusas pelo texto do <see cref="ExecuteAsync"/> valem aqui também.
    /// </summary>
    public async Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        if (IsTransactionControl(sql))
            return new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, TransactionControlMessage);

        if (HasSeveralStatements(sql))
            return new DatabaseFailure(EDatabaseFailure.MultipleStatementsNotSupported, SeveralStatementsMessage);

        return await RunAsync(nameof(ExecuteAsync), EDatabaseFailure.ExecutionFailed, token => ExecuteCommandAsync(sql, pageSize, paged: true, token, readOnly: true, parameters: parameters), cancellationToken);
    }

    /// <summary>
    /// O comando do usuário depois da recusa da RN-SQL-003. É `internal`, e não privado, por um motivo só: o teste da rede de segurança
    /// (<see cref="ProbeTransactionAsync"/>) precisa chegar ao banco com um `BEGIN`, como chegaria uma forma de abrir transação que o
    /// <see cref="SqlText"/> não conhecesse. Nenhum código do produto o chama direto.
    /// </summary>
    internal async Task<Result<QueryOutcome, DatabaseFailure>> ExecuteWithoutRefusalAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        // RN-SQL-013: um `WITH` que grava nem passa pela tentativa. A transação só de leitura deixa passar gravação em tabela temporária,
        // e ela seria desfeita quando o cursor fechasse antes do fim.
        if (TriesAsRead(sql) && sql != _writesAfterTheFirstPage)
        {
            var read = await RunAsync(nameof(ExecuteAsync), EDatabaseFailure.ExecutionFailed, token => ExecuteCommandAsync(sql, pageSize, paged: true, token, parameters: parameters), cancellationToken);

            // Qualquer outro erro da tentativa é o erro do comando, e volta como veio; a transação da tentativa já foi desfeita.
            if (read.IsSuccess || !IsWriteRefusal(read.Error))
                return read;
        }

        var executed = await RunAsync(nameof(ExecuteAsync), EDatabaseFailure.ExecutionFailed, token => ExecuteCommandAsync(sql, pageSize, paged: false, token, parameters: parameters), cancellationToken);

        // RN-SESSAO-005: depois de um comando executado até o fim a conexão não está dentro de uma transação. Do que deu certo, só o
        // comando utilitário pode ter aberto uma; o que veio com contagem de linhas ou com um conjunto de resultados não paga a
        // conferência.
        if (executed.IsSuccess && _utilityCommand && await EndStrayTransactionAsync(afterAFailure: false))
            return new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, TransactionControlMessage, Executed: true);

        // O comando que falhou, ou que foi cancelado enquanto devolvia as linhas, também rodou no banco. Onde ele pode ter deixado
        // uma transação aberta, ela é desfeita aqui, com a conexão viva, e o comando seguinte encontra a sessão limpa. A resposta
        // continua sendo a falha dele, como veio, menos numa: a do cancelamento diz que o que o comando gravou está confirmado, e
        // o que ele gravou dentro da transação acabou de ser desfeito. Ali a resposta é a do mesmo comando sem o cancelamento, a
        // recusa, dizendo o que houve. Nas duas recusas daqui o comando rodou, e o cursor anterior já fechou: `Executed` diz isso à tela
        // (RN-SESSAO-005), e a recusa antes de executar, no começo do `ExecuteAsync`, não o leva.
        if (executed.IsFailure && MayLeaveATransactionOpenWhenItFails && await EndStrayTransactionAsync(afterAFailure: true) && _canceledWhileReturningRows)
            return new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, UndoneTransactionMessage, Executed: true);

        return executed;
    }

    public async Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken)
    {
        // RN-SQL-007: o cursor acabou, foi fechado por outro comando ou pelo tempo sem leitura.
        if (_reader is null)
            return new DatabaseFailure(EDatabaseFailure.NoOpenCursor, NoOpenCursorMessage);

        var sql = _cursorSql;
        var readOnly = _cursorReadOnly;
        var page = await RunAsync(nameof(FetchNextAsync), EDatabaseFailure.ExecutionFailed, token => ReadPageAsync(Stopwatch.GetTimestamp(), toTheEnd: false, token), cancellationToken, continuesTheCursor: true);

        // RN-PROT-002: na conexão somente leitura a recusa do banco é a resposta, e o comando não roda de novo fora da transação.
        if (page.IsSuccess || readOnly || !IsWriteRefusal(page.Error))
            return page;

        // Uma função chamada pela leitura só gravou linhas adiante. A tentativa foi desfeita, e a mesma leitura, executada de novo, não
        // passa mais por ela: roda até o fim e confirma.
        _writesAfterTheFirstPage = sql;

        return page.Error with { Message = $"{page.Error.Message}\n{WritesAfterTheFirstPageMessage}" };
    }

    public async Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        // Sem transação só de leitura, o que impede a contagem de gravar é o texto: o que não é uma leitura só nem vai ao banco.
        if (!MayBeCounted(sql))
            return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, NotCountableMessage);

        var total = await RunAsync(nameof(CountAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            // RN-SQL-006: contar é executar o comando de novo, como subconsulta. Dentro da transação só de leitura ele não grava outra vez.
            await BeginReadOnlyAsync(token);
            var reader = await StartAsync(CountSql(sql), [], userCommand: true, token, query: parameters);
            await reader.ReadAsync(token);

            // O total chega como inteiro de 32 bits nos drivers da IBM, de 64 no PostgreSQL tipado e como texto no formato de texto.
            var value = Convert.ToInt64(reader.GetValue(0), CultureInfo.InvariantCulture);
            await FinishCursorAsync(token);

            return value;
        }, cancellationToken);

        // A posição seria a do comando embrulhado, e não a do que o usuário escreveu.
        if (total.IsFailure)
            return total.Error with { Position = null };

        return total;
    }

    public Task CloseCursorAsync()
        => DisposeCursorAsync();

    public void Cancel()
    {
        // RN-SQL-010: sem comando em andamento não há o que interromper, e um cursor aberto e parado fica como está.
        if (!_running)
            return;

        _canceled = true;

        // A fonte vale para o que ainda não foi enviado, e é como o driver que a observa interrompe o que já está no banco; o `Cancel` do
        // comando é para o driver que não a observa. O `Send` é assíncrono, mas as chamadas aqui são síncronas: quando ele devolve a
        // tarefa, ela já terminou.
        var cancellation = _cancellation;
        var command = _command;
        _ = Send(nameof(Cancel), EDatabaseFailure.ExecutionFailed, () =>
        {
            cancellation?.Cancel();

            if (command is not null)
                CancelCommand(command);

            return Task.FromResult(true);
        }, onThisThread: true);
    }

    public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken)
        => QueryAsync(nameof(GetSchemasAsync), EDatabaseFailure.ExecutionFailed, SchemasSql, [], reader => new SchemaInfo(Text(reader, 0), Flag(reader, 1), Number(reader, 2), Number(reader, 3), Number(reader, 4)), cancellationToken);

    public async Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken)
    {
        // Quem valida o tipo é a rota; aqui ele só não pode virar exceção nem SQL.
        if (ObjectsSql(kind) is not { } sql)
            return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, UnknownObjectKindMessage);

        return await QueryAsync(nameof(GetObjectsAsync), EDatabaseFailure.ExecutionFailed, sql, [schema], reader => new DatabaseObjectInfo(Text(reader, 0), Text(reader, 1), reader.IsDBNull(2) ? null : Convert.ToInt64(reader.GetValue(2), CultureInfo.InvariantCulture), NullableText(reader, 3)), cancellationToken);
    }

    /// <summary>
    /// RN-BUSCA-002: lê uma linha a mais que o limite, só para saber se o banco tem mais; essa linha liga `Truncated` e não entra na resposta.
    /// O `GroupBy` mantém a ordem em que as linhas chegaram: os esquemas na ordem da consulta (os de sistema por último), e as tabelas e as
    /// visões de cada um na ordem do banco, a mesma das listas `objects?kind=tables|views`.
    /// </summary>
    public async Task<Result<ObjectNamesInfo, DatabaseFailure>> GetObjectNamesAsync(int limit, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetObjectNamesAsync), EDatabaseFailure.ExecutionFailed, ObjectNamesSql(limit + 1), [], reader => (Schema: Text(reader, 0), IsSystem: Flag(reader, 1), Name: Text(reader, 2), IsView: Text(reader, 3) == ViewObjectKind), cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        var truncated = rows.Value.Count > limit;
        var kept = truncated ? rows.Value.Take(limit) : rows.Value;

        return new ObjectNamesInfo([.. kept.GroupBy(row => row.Schema).Select(schema => new SchemaObjectNamesInfo(schema.Key, schema.First().IsSystem, [.. schema.Where(row => !row.IsView).Select(row => row.Name)], [.. schema.Where(row => row.IsView).Select(row => row.Name)]))], truncated);
    }

    public Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken)
        => QueryAsync(nameof(GetColumnsAsync), EDatabaseFailure.ExecutionFailed, ColumnsSql, [schema, table], ReadColumn, cancellationToken);

    public async Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetIndexesAsync), EDatabaseFailure.ExecutionFailed, IndexesSql, [schema, table], reader => (Name: Text(reader, 0), IsUnique: Flag(reader, 1), Column: Text(reader, 2), Method: NullableText(reader, 3)), cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        // O `GroupBy` mantém a ordem em que as linhas chegaram: os índices pelo nome, e as colunas na ordem do índice.
        return Result.Success<IReadOnlyList<IndexInfo>, DatabaseFailure>([.. rows.Value.GroupBy(row => row.Name).Select(index => new IndexInfo(index.Key, [.. index.Select(row => row.Column)], index.First().IsUnique, index.First().Method))]);
    }

    public async Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetForeignKeysAsync), EDatabaseFailure.ExecutionFailed, ForeignKeysSql, [schema, table], ReadForeignKeyRow, cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        // As chaves de uma tabela têm nomes diferentes: o nome basta para juntar as colunas de cada uma.
        return Result.Success<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>([.. rows.Value.GroupBy(row => row.Name).Select(foreignKey => new ForeignKeyInfo(foreignKey.Key, [.. foreignKey.Select(row => row.Column)], foreignKey.First().ReferencedSchema, foreignKey.First().ReferencedTable, [.. foreignKey.Select(row => row.ReferencedColumn)], foreignKey.First().OnDelete, foreignKey.First().OnUpdate))]);
    }

    public async Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetReferencingForeignKeysAsync), EDatabaseFailure.ExecutionFailed, ReferencedBySql, [schema, table], ReadForeignKeyRow, cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        // Duas tabelas diferentes podem ter chaves de mesmo nome apontando para esta: cada chave é o nome dentro da tabela que a tem.
        return Result.Success<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>([.. rows.Value.GroupBy(row => (row.Name, row.ReferencingSchema, row.ReferencingTable)).Select(foreignKey => new ReferencingForeignKeyInfo(foreignKey.Key.Name, foreignKey.Key.ReferencingSchema, foreignKey.Key.ReferencingTable, [.. foreignKey.Select(row => row.Column)], [.. foreignKey.Select(row => row.ReferencedColumn)], foreignKey.First().OnDelete, foreignKey.First().OnUpdate))]);
    }

    public async Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetChecksAsync), EDatabaseFailure.ExecutionFailed, ChecksSql, [schema, table], reader => (Name: Text(reader, 0), Chunk: Text(reader, 1)), cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        return Result.Success<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>([.. rows.Value.GroupBy(row => row.Name).Select(check => new CheckConstraintInfo(check.Key, JoinChunks([.. check.Select(row => row.Chunk)])))]);
    }

    public async Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(string schema, string view, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(nameof(GetViewDefinitionAsync), EDatabaseFailure.ExecutionFailed, ViewDefinitionSql, [schema, view], reader => NullableText(reader, 0), cancellationToken);
        if (rows.IsFailure)
            return rows.Error;

        // RN-CAT-006: o que o banco não devolve é nulo, e não um texto vazio.
        string[] chunks = [.. rows.Value.OfType<string>()];

        return new ViewDefinitionInfo(chunks.Length == 0 ? null : JoinChunks(chunks));
    }

    /// <summary>RN-CAT-008: duas consultas de catálogo para o esquema inteiro, e não uma por tabela: a tela desenha o esquema com esta chamada só.</summary>
    public async Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(string schema, CancellationToken cancellationToken)
    {
        var columns = await QueryAsync(nameof(GetDiagramAsync), EDatabaseFailure.ExecutionFailed, DiagramColumnsSql, [schema], reader => (Table: Text(reader, 0), Column: reader.IsDBNull(1) ? null : new DiagramColumnInfo(Text(reader, 1), Text(reader, 2), Flag(reader, 3), Flag(reader, 4))), cancellationToken);
        if (columns.IsFailure)
            return columns.Error;

        var foreignKeys = await QueryAsync(nameof(GetDiagramAsync), EDatabaseFailure.ExecutionFailed, DiagramForeignKeysSql, [schema], ReadForeignKeyRow, cancellationToken);
        if (foreignKeys.IsFailure)
            return foreignKeys.Error;

        return new SchemaDiagramInfo([.. columns.Value.GroupBy(row => row.Table).Select(table => new DiagramTableInfo(table.Key, [.. table.Select(row => row.Column).OfType<DiagramColumnInfo>()]))], [.. foreignKeys.Value.GroupBy(row => (row.Name, row.ReferencingTable)).Select(foreignKey => new DiagramForeignKeyInfo(foreignKey.Key.Name, foreignKey.Key.ReferencingTable, [.. foreignKey.Select(row => row.Column)], foreignKey.First().ReferencedSchema, foreignKey.First().ReferencedTable, [.. foreignKey.Select(row => row.ReferencedColumn)], foreignKey.First().OnDelete, foreignKey.First().OnUpdate))]);
    }

    /// <summary>
    /// RN-CAT-010. O que o banco não informa a esta conta não vem na lista: o valor nulo e a consulta que ele recusa (sem permissão numa
    /// visão de administração, por exemplo) ficam de fora, e a resposta é a lista com o resto. A recusa só é a resposta quando a conexão
    /// caiu ou a requisição desistiu.
    /// </summary>
    public async Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(CancellationToken cancellationToken)
    {
        var properties = new List<DatabasePropertyInfo>();

        foreach (var sql in PropertiesSql)
        {
            var rows = await QueryAsync(nameof(GetPropertiesAsync), EDatabaseFailure.ExecutionFailed, sql, [], reader => (Name: Text(reader, 0), Value: NullableText(reader, 1)), cancellationToken);
            if (rows.IsFailure && (!IsOpen || cancellationToken.IsCancellationRequested))
                return rows.Error;

            if (rows.IsSuccess)
                properties.AddRange(rows.Value.Where(row => row.Value is not null).Select(row => new DatabasePropertyInfo(row.Name, row.Value!)));
        }

        return properties;
    }

    public async Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(CancellationToken cancellationToken)
        => (await QueryAsync(nameof(GetDatabasesAsync), EDatabaseFailure.ExecutionFailed, DatabasesSql, [], reader => new DatabaseInfo(Text(reader, 0), Flag(reader, 1)), cancellationToken)).Map(CurrentFirst);

    /// <summary>RN-ARVORE-006: o banco da sessão sobe para o começo; os outros ficam na ordem de nome em que o banco os devolveu.</summary>
    public Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeEditTablesAsync(EditTables tables, CancellationToken cancellationToken)
        => RunAsync(nameof(DescribeEditTablesAsync), EDatabaseFailure.ExecutionFailed, token => DescribeCoreAsync(tables, inTheSession: false, token), cancellationToken);

    public async Task<UnitResult<DatabaseFailure>> LimitLockWaitAsync(CancellationToken cancellationToken)
        => await RunAsync(nameof(LimitLockWaitAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            await NonQueryAsync(LockTimeoutSql, token);

            return true;
        }, cancellationToken);

    /// <summary>
    /// RN-IMPORT-009, 012 e 015: a tabela pela consulta da edição (`EditRelationQuery`, com o esquema e o nome como estão no catálogo; no PostgreSQL, entre
    /// aspas para o `to_regclass`), as chaves que apontam para ela e, no PostgreSQL, o tipo-base das colunas de um domínio. Na transação da carga (a
    /// leitura da primeira transação, RN-IMPORT-015), roda dentro dela, sem desfazê-la antes.
    /// </summary>
    public Task<Result<ImportCatalog?, DatabaseFailure>> DescribeImportTargetAsync(string schema, string table, CancellationToken cancellationToken)
        => RunAsync(nameof(DescribeImportTargetAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var written = $"{QuotedName(schema)}.{QuotedName(table)}";
            if (await DescribeCoreAsync(EditRelationQuery(new EditTableName(schema, table, written)), token) is not { } described)
                return (ImportCatalog?)null;

            var references = await ReadAllAsync(ReferencedBySql, [described.Schema, described.Name], ReadForeignKeyRow, token);
            var baseTypes = DomainBaseTypesSql is { } sql ? await ReadAllAsync(sql, [described.Schema, described.Name], reader => (Column: Text(reader, 0), Type: Text(reader, 1)), token) : [];
            var referencedBy = references.GroupBy(row => (row.Name, row.ReferencingSchema, row.ReferencingTable)).Select(foreignKey => new ReferencingForeignKeyInfo(foreignKey.Key.Name, foreignKey.Key.ReferencingSchema, foreignKey.Key.ReferencingTable, [.. foreignKey.Select(row => row.Column)], [.. foreignKey.Select(row => row.ReferencedColumn)], foreignKey.First().OnDelete, foreignKey.First().OnUpdate)).ToList();

            return new ImportCatalog(described, referencedBy, baseTypes.GroupBy(row => row.Column, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First().Type, StringComparer.Ordinal));
        }, cancellationToken, continuesTheCursor: _editTransaction is not null);

    /// <summary>
    /// RN-IMPORT-011. Tudo numa transação só de leitura, desfeita no fim: cada linha num ponto de salvamento, com um `SELECT` das conversões dela (em
    /// partes de até 1.000); na que o banco recusa, a volta ao ponto de salvamento e um `SELECT` por célula, até achar quais recusam, com a mensagem do
    /// banco em cada uma. A recusa é a resposta procurada, e passa pelo próprio `Send`, como a da contagem; a conexão que cai e o cancelamento são a falha
    /// da operação. No banco sem a conversão do banco (<see cref="ImportCastSql"/> nula), nada vai a ele.
    /// </summary>
    public async Task<Result<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>> CheckImportCastsAsync(IReadOnlyList<string> types, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken cancellationToken)
    {
        IReadOnlyList<IReadOnlyList<string?>> none = [.. values.Select(row => (IReadOnlyList<string?>)new string?[row.Count])];
        if (ImportCastSql("text", 1) is null || values.All(row => row.All(value => value is null)))
            return Result.Success<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>(none);

        var result = await RunAsync(nameof(CheckImportCastsAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            await BeginReadOnlyAsync(token);
            var problems = new List<IReadOnlyList<string?>>(values.Count);
            foreach (var row in values)
            {
                var cells = new string?[row.Count];
                foreach (var part in Enumerable.Range(0, row.Count).Where(index => row[index] is not null).Chunk(ImportCastsPerSelect))
                {
                    await NonQueryAsync(ImportSavepointSql, token);
                    var tried = await CastRefusalAsync([.. part.Select(index => (types[index], row[index]))], token);
                    if (tried.IsFailure)
                        return Result.Failure<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>(tried.Error);

                    if (tried.Value is not null)
                    {
                        await NonQueryAsync(RollbackToImportSavepointSql, token);
                        foreach (var index in part)
                        {
                            var cell = await CastRefusalAsync([(types[index], row[index])], token);
                            if (cell.IsFailure)
                                return Result.Failure<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>(cell.Error);

                            if (cell.Value is { } refusal)
                            {
                                cells[index] = refusal;
                                await NonQueryAsync(RollbackToImportSavepointSql, token);
                            }
                        }
                    }

                    await NonQueryAsync(ReleaseImportSavepointSql, token);
                }

                problems.Add(cells);
            }

            // Nada foi gravado, e nada fica: a transação só de leitura é desfeita.
            await NonQueryAsync(RollbackSql, CancellationToken.None);
            _inTransaction = false;

            return Result.Success<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>(problems);
        }, cancellationToken);

        if (result.IsFailure)
            return result.Error;

        if (result.Value.IsSuccess)
            return result.Value;

        await DisposeCursorAsync();

        return result.Value.Error;
    }

    /// <summary>
    /// RN-EDIT-005 e 012. Com transação, ela é do driver e abre antes da consulta ao catálogo, que roda dentro dela; cada comando tem de
    /// afetar exatamente uma linha, e a recusa (do banco, da contagem de linhas ou do plano) desfaz tudo pelo mesmo fim do cursor
    /// abandonado. A transação sai do campo antes do `COMMIT`: se ele falha, o banco já a encerrou (no PostgreSQL, a recusa de uma
    /// restrição adiada desfaz a transação), e o `ROLLBACK` do fim não tem o que desfazer. No banco sem log cada comando é confirmado
    /// sozinho, e a recusa diz quantos já estavam gravados (`Applied`).
    ///
    /// RN-EDIT-021: a coluna inteira vem primeiro, depois da conferência do catálogo: a contagem tem de dar as linhas confirmadas (senão nada é
    /// executado, `ResultChanged`), e o `UPDATE` (ou a soma dos lotes, cada um com as linhas das chaves dele) tem de alterar exatamente elas (senão tudo
    /// é desfeito, `ResultChanged`; no banco sem log ele já ficou gravado, `EditRowMismatch` com `Applied` 1). No banco que pede (o PostgreSQL), a
    /// transação de um "Salvar" com a coluna inteira é a do retrato (<see cref="WholeColumnIsolation"/>). No banco sem log, a falha do `UPDATE` da
    /// coluna inteira, de qualquer tipo (também o cancelamento), pode tê-lo deixado gravado em parte: `Outcome` é `Unknown`.
    /// </summary>
    public async Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, bool wholeColumn, Func<IReadOnlyList<EditCatalogTable?>, Result<EditPlan, DatabaseFailure>> plan, CancellationToken cancellationToken)
    {
        int? failing = null;
        var applied = 0;
        var writingTheWholeColumn = false;

        var result = await RunAsync(nameof(ApplyEditsAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            // RN-PROT-006: o "Salvar" só chega aqui numa conexão que não é somente leitura; a sessão que já foi sai do modo só de leitura do banco.
            await ApplySessionModeAsync(readOnly: false, token);

            if (!oneAtATime)
                _editTransaction = wholeColumn && WholeColumnIsolation is { } isolation ? await _connection!.BeginTransactionAsync(isolation, token) : await _connection!.BeginTransactionAsync(token);

            var planned = plan(await DescribeCoreAsync(tables, inTheSession: true, token));
            if (planned.IsFailure)
                return Result.Failure<int, DatabaseFailure>(planned.Error);

            if (planned.Value.WholeColumn is { } whole)
            {
                failing = whole.Change;
                var confirmed = whole.Rows ?? 0;
                var keys = whole.ReadsKeys ? await ReadKeysAsync(whole, token) : null;
                if (whole.ReadsKeys && keys is null)
                    return WholeColumnSql.NotSupported(WholeColumnSql.TooManyKeysReason, whole.Change);

                var counted = keys?.Count ?? await CountWholeColumnRowsAsync(whole.CountSql, whole.CountParameters, token);
                if (counted != confirmed)
                    return new DatabaseFailure(EDatabaseFailure.ResultChanged, WholeColumnSql.CountChanged(counted, confirmed), Change: whole.Change);

                IReadOnlyList<WholeColumnBatch>? batches = null;
                if (keys is not null)
                {
                    var built = whole.Batches!(keys);
                    if (built.IsFailure)
                        return built.Error;

                    batches = built.Value;
                }

                writingTheWholeColumn = true;
                long affected = 0;
                if (batches is not null)
                {
                    foreach (var batch in batches)
                    {
                        var done = await RunCountedAsync(batch.Command, token);
                        affected += done;
                        if (done != batch.Keys)
                            break;
                    }
                }
                else
                    affected = await RunCountedAsync(whole.Update!, token);

                writingTheWholeColumn = false;
                if (affected != confirmed && !oneAtATime)
                    return new DatabaseFailure(EDatabaseFailure.ResultChanged, WholeColumnSql.UpdateChanged(affected, confirmed), Change: whole.Change);

                applied++;
                if (affected != confirmed)
                    return new DatabaseFailure(EDatabaseFailure.EditRowMismatch, WholeColumnSql.WrittenAnyway(affected, confirmed), Change: whole.Change, RowsAffected: affected);
            }

            foreach (var edit in planned.Value.Commands)
            {
                failing = edit.Change;
                var affected = await RunEditAsync(edit, token);
                if (affected != 1)
                    return new DatabaseFailure(EDatabaseFailure.EditRowMismatch, affected == 0 ? NoRowMessage : $"O comando alteraria {affected} linhas, e não uma só.", Change: edit.Change, RowsAffected: affected);

                applied++;
            }

            failing = null;

            // RN-EDIT-021: o cancelamento que chega depois do último comando não desfaz nada (o driver da IBM, que não lança, o diria cancelado).
            if (planned.Value.WholeColumn is not null)
                _executed = true;

            if (_editTransaction is { } transaction)
            {
                _editTransaction = null;
                await transaction.CommitAsync(token);
                await transaction.DisposeAsync();
            }

            return Result.Success<int, DatabaseFailure>(applied);
        }, cancellationToken);

        int? written = oneAtATime ? applied : null;
        if (result.IsFailure)
        {
            var failure = result.Error with { Change = failing, Applied = written };

            return oneAtATime && writingTheWholeColumn ? failure with { Outcome = ECancelOutcome.Unknown } : failure;
        }

        if (result.Value.IsSuccess)
            return result.Value.Value;

        // A recusa do plano ou da contagem de linhas não é exceção: a transação é desfeita aqui, pelo mesmo fim do cursor abandonado.
        await DisposeCursorAsync();

        return result.Value.Error with { Applied = written };
    }

    /// <summary>
    /// RN-EDIT-019 e 023: a contagem da pergunta da coluna inteira, na sessão, como o "Salvar" que ela começa: fecha o cursor aberto, confere antes o
    /// catálogo na própria sessão (a tabela que mudou é a recusa do plano) e conta pela forma do plano. No banco que tem, numa transação só de leitura; no
    /// caminho por lotes, lendo as chaves do comando, até 1.000.001.
    /// </summary>
    public async Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(EditTables tables, Func<IReadOnlyList<EditCatalogTable?>, Result<WholeColumnPlan, DatabaseFailure>> plan, CancellationToken cancellationToken)
    {
        var result = await RunAsync(nameof(CountWholeColumnAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var planned = plan(await DescribeCoreAsync(tables, inTheSession: true, token));
            if (planned.IsFailure)
                return Result.Failure<long, DatabaseFailure>(planned.Error);

            var whole = planned.Value;
            if (whole.ReadsKeys)
            {
                var keys = await ReadKeysAsync(whole, token);

                return keys is null ? WholeColumnSql.NotSupported(WholeColumnSql.TooManyKeysReason, whole.Change) : Result.Success<long, DatabaseFailure>(keys.Count);
            }

            await BeginReadOnlyAsync(token);
            var counted = await CountWholeColumnRowsAsync(whole.CountSql, whole.CountParameters, token);

            return counted < 0 ? new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "A contagem não devolveu nenhuma linha.") : Result.Success<long, DatabaseFailure>(counted);
        }, cancellationToken);

        // A posição seria a do comando embrulhado, e não a do que o usuário escreveu.
        if (result.IsFailure)
            return result.Error with { Position = null };

        if (result.Value.IsSuccess)
            return result.Value.Value;

        // A recusa do plano (o catálogo mudou) e o teto das chaves: o que ficou aberto (o leitor das chaves) sai aqui.
        await DisposeCursorAsync();

        return result.Value.Error;
    }

    public async Task<UnitResult<DatabaseFailure>> BeginLoadAsync(CancellationToken cancellationToken)
        => await RunAsync(nameof(BeginLoadAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            await NonQueryAsync(LockTimeoutSql, token);

            return true;
        }, cancellationToken);

    public int LoadRowsPerCommand(int columns)
        => RowsPerLoadCommand(columns);

    /// <summary>
    /// RN-IMPORT-015. A transação é do driver, como a do "Salvar" (no Db2 é ela que tira a conexão do auto-commit), e todo comando entra nela até a
    /// confirmação; o comando que falha a desfaz pelo fim do cursor abandonado.
    /// </summary>
    public async Task<UnitResult<DatabaseFailure>> BeginLoadTransactionAsync(CancellationToken cancellationToken)
        => await RunAsync(nameof(BeginLoadTransactionAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            _editTransaction ??= await _connection!.BeginTransactionAsync(token);

            return true;
        }, cancellationToken, continuesTheCursor: true);

    public async Task<UnitResult<DatabaseFailure>> EmptyTableAsync(string schema, string table, CancellationToken cancellationToken)
        => await RunAsync(nameof(EmptyTableAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            // Se ele lança, quem o descarta é o fim do cursor abandonado, como no "Salvar".
            var command = _connection!.CreateCommand();
            command.CommandText = $"DELETE FROM {QuotedName(schema)}.{QuotedName(table)}";
            command.CommandTimeout = 0;
            command.Transaction = _editTransaction;
            await ExecuteLoadCommandAsync(command, token);
            await command.DisposeAsync();

            return true;
        }, cancellationToken, continuesTheCursor: true);

    /// <summary>
    /// RN-IMPORT-015 e 016. A recusa do banco é a resposta procurada (passa pelo próprio `Send`, como a da conferência da prévia), e só então a transação é
    /// desfeita: no Db2 o comando recusado foi desfeito sozinho (RN-TX-009), e a volta linha por linha precisa da transação para achar a linha recusada.
    /// Essa volta só acontece na recusa, nunca no caminho normal.
    /// </summary>
    public async Task<UnitResult<DatabaseFailure>> InsertRowsAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
    {
        var result = await RunAsync(nameof(InsertRowsAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var sent = await TryLoadAsync(target, rows, token);

            // O comando de uma linha só (no Informix, todos; no Db2, o último antes de uma confirmação ou o fechado pelos 16 MiB): a falha é dela.
            if (sent.IsFailure && rows.Count == 1)
                return UnitResult.Failure(sent.Error with { Change = 0 });

            if (sent.IsSuccess || LoadsInBatches || !IsOpen || token.IsCancellationRequested || !IsDataOrConstraintRefusal(sent.Error))
                return sent;

            for (var index = 0; index < rows.Count; index++)
            {
                var one = await TryLoadAsync(target, [rows[index]], token);
                if (one.IsFailure)
                    return UnitResult.Failure(one.Error with { Change = index });
            }

            return UnitResult.Success<DatabaseFailure>();
        }, cancellationToken, continuesTheCursor: true);

        if (result.IsFailure)
            return result.Error;

        if (result.Value.IsSuccess)
            return result.Value;

        // A recusa do banco: a transação da carga é desfeita aqui, pelo mesmo fim do cursor abandonado.
        await DisposeCursorAsync();

        return result.Value;
    }

    /// <summary>
    /// RN-IMPORT-014. A transação sai do campo antes do `COMMIT`: se ele falha, o banco já a encerrou (no PostgreSQL, a recusa de uma restrição adiada
    /// desfaz a transação), e o fim do cursor não tem o que desfazer. A confirmação conta como executada até o fim desde o começo: o cancelamento que
    /// chegar no meio não a transforma em cancelada (no driver da IBM, que não lança, é o que o `RunAsync` faria).
    /// </summary>
    public async Task<UnitResult<DatabaseFailure>> CommitLoadAsync()
    {
        if (_editTransaction is null)
            return UnitResult.Success<DatabaseFailure>();

        return await RunAsync(nameof(CommitLoadAsync), EDatabaseFailure.ExecutionFailed, async _ =>
        {
            var transaction = _editTransaction!;
            _editTransaction = null;
            _executed = true;
            await transaction.CommitAsync(CancellationToken.None);
            await transaction.DisposeAsync();

            return true;
        }, CancellationToken.None, continuesTheCursor: true);
    }

    /// <summary>
    /// RN-EXPORT-017. Os comandos da sessão vão antes da transação (dentro dela seriam desfeitos com ela). A marca da transação sobe antes do envio, como
    /// na leitura paginada: o `BEGIN` que o banco executou e cuja resposta se perdeu é desfeito pelo fim de sempre.
    /// </summary>
    public async Task<UnitResult<DatabaseFailure>> BeginExportAsync(CancellationToken cancellationToken)
        => await RunAsync(nameof(BeginExportAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            foreach (var sql in ExportSessionSql)
                await NonQueryAsync(sql, token);

            if (BeginExportSql is { } begin)
            {
                _inTransaction = true;
                await NonQueryAsync(begin, token);
            }

            return true;
        }, cancellationToken);

    /// <summary>
    /// RN-EXPORT-017. A contagem passa pelo próprio `Send`, dentro do comando: a recusa do banco é a resposta procurada (sem total), e não a falha do
    /// comando, que desfaria a transação da leitura. Dentro da transação ela tem um ponto de salvamento só dela, desfeito quando o banco a recusa. O que
    /// falha depois disso (o ponto de salvamento que não volta, a conexão que caiu) é a falha da operação, e a transação é desfeita pelo fim de sempre.
    /// Sem transação só de leitura, só a leitura só é contada (<see cref="MayBeCounted"/>), como no "Contar total". Com `required`, a recusa (e o comando
    /// que não pode ser contado) é a falha.
    /// </summary>
    public async Task<Result<long?, DatabaseFailure>> CountExportAsync(string sql, bool required, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        if (!MayBeCounted(sql))
            return required ? new DatabaseFailure(EDatabaseFailure.ExecutionFailed, NotCountableMessage) : Result.Success<long?, DatabaseFailure>(null);

        var result = await RunAsync(nameof(CountExportAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var savepoint = _inTransaction;
            if (savepoint)
                await NonQueryAsync(CountSavepointSql, token);

            var counted = await Send(nameof(CountExportAsync), EDatabaseFailure.ExecutionFailed, () => CountRowsAsync(CountSql(sql), token, parameters));

            // O comando da contagem recusada ficou no campo, para o `Cancel`: sai daqui, descartado.
            if (_command is { } refused)
            {
                _command = null;
                await refused.DisposeAsync();
            }

            if (savepoint)
                await NonQueryAsync(counted.IsSuccess ? ReleaseCountSavepointSql : RollbackToCountSavepointSql, token);

            if (counted.IsSuccess)
                return Result.Success<long?, DatabaseFailure>(counted.Value);

            // A posição seria a do comando embrulhado, e não a do que o usuário escreveu.
            return required ? Result.Failure<long?, DatabaseFailure>(counted.Error with { Position = null }) : Result.Success<long?, DatabaseFailure>(null);
        }, cancellationToken, continuesTheCursor: true);

        return result.IsFailure ? result.Error : result.Value;
    }

    public async Task<Result<IReadOnlyList<QueryColumn>, DatabaseFailure>> StartExportReadAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        => await RunAsync(nameof(StartExportReadAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var reader = await StartAsync(sql, [], userCommand: true, token, behavior: ExportBehavior, query: parameters);
            _columns = [.. Enumerable.Range(0, reader.FieldCount).Select(ordinal => new QueryColumn(reader.GetName(ordinal), reader.GetDataTypeName(ordinal), ColumnKind(reader, ordinal)))];

            return _columns;
        }, cancellationToken, continuesTheCursor: true);

    /// <summary>
    /// RN-EXPORT-017. Um lote por vez, com o mesmo leitor do começo ao fim: quem escreve o arquivo entre um lote e outro é o trabalho, fora do comando,
    /// e o `Cancel` só alcança a leitura em andamento. O fim do resultado é parte do comando (<see cref="FinishCursorAsync"/>: o `COMMIT` da transação
    /// e o erro que o banco deixa depois da última linha). O valor ou a linha acima do teto param o lote ali, sem guardar o valor.
    /// </summary>
    public async Task<Result<ExportBatch, DatabaseFailure>> ReadExportRowsAsync(ExportReadPlan plan, CancellationToken cancellationToken)
    {
        if (_reader is null)
            return new DatabaseFailure(EDatabaseFailure.NoOpenCursor, NoOpenCursorMessage);

        return await RunAsync(nameof(ReadExportRowsAsync), EDatabaseFailure.ExecutionFailed, async token =>
        {
            var reader = _reader!;
            var rows = new List<IReadOnlyList<ExportCell>>();
            long batchBytes = 0;

            while (rows.Count < plan.MaxRows && batchBytes < plan.MaxBatchBytes)
            {
                if (!await reader.ReadAsync(token))
                {
                    await FinishCursorAsync(token);

                    return new ExportBatch(rows, Finished: true);
                }

                var cells = new ExportCell[plan.Ordinals.Count];
                long rowBytes = 0;
                for (var index = 0; index < cells.Length; index++)
                {
                    var ordinal = plan.Ordinals[index];
                    if (plan.Skipped.Contains(ordinal))
                        continue;

                    var read = await ReadExportCellAsync(reader, ordinal, _columns[ordinal].Kind, Math.Min(plan.MaxValueBytes, plan.MaxRowBytes - rowBytes), plan.Copy, token);
                    if (read.Bytes > plan.MaxValueBytes)
                        return new ExportBatch(rows, Finished: false, new ExportOversize(index, WholeRow: false));

                    rowBytes += read.Bytes;
                    if (rowBytes > plan.MaxRowBytes)
                        return new ExportBatch(rows, Finished: false, new ExportOversize(index, WholeRow: true));

                    cells[index] = read.Cell;
                }

                batchBytes += rowBytes;
                rows.Add(cells);
            }

            return new ExportBatch(rows, Finished: false);
        }, cancellationToken, continuesTheCursor: true);
    }

    internal static IReadOnlyList<DatabaseInfo> CurrentFirst(IReadOnlyList<DatabaseInfo> databases)
        => [.. databases.Where(database => database.IsCurrent), .. databases.Where(database => !database.IsCurrent)];

    /// <summary>
    /// Não falha: o cursor, a conexão e o que mais o driver mantém são descartados cada um na sua chamada, para a falha de um não deixar
    /// o outro para trás. Chamado com um comando ainda em andamento (quem fecha a sessão desistiu de esperar por ele), não toca no
    /// leitor, que é do comando: descarta só a conexão, e o driver conclui o descarte quando o comando voltar.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (!_running)
            await DisposeCursorAsync();

        if (!_running && _loadCommand is { } loadCommand)
        {
            _loadCommand = null;
            await Send(nameof(DisposeAsync), EDatabaseFailure.ExecutionFailed, async () =>
            {
                await loadCommand.DisposeAsync();

                return true;
            });
        }

        await Send(nameof(DisposeAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            if (_connection is not null)
                await _connection.DisposeAsync();

            return true;
        });
        _discarded = true;

        await Send(nameof(DisposeAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            await DisposeDriverAsync();

            return true;
        });
    }

    private static ColumnInfo ReadColumn(DbDataReader reader)
        => new(Text(reader, 0), Text(reader, 1), Flag(reader, 2), Flag(reader, 3), Number(reader, 4), NullableText(reader, 5), NullableText(reader, 6));

    private static string Text(DbDataReader reader, int ordinal)
        => Convert.ToString(reader.GetValue(ordinal), CultureInfo.InvariantCulture) ?? string.Empty;

    /// <summary>O texto do catálogo que pode faltar: nulo continua nulo, e não vira texto vazio.</summary>
    private static string? NullableText(DbDataReader reader, int ordinal)
        => reader.IsDBNull(ordinal) ? null : Text(reader, ordinal);

    private static int Number(DbDataReader reader, int ordinal)
        => Convert.ToInt32(reader.GetValue(ordinal), CultureInfo.InvariantCulture);

    /// <summary>Uma linha de <see cref="ForeignKeysSql"/>, de <see cref="ReferencedBySql"/> e de <see cref="DiagramForeignKeysSql"/>: as três têm as mesmas colunas.</summary>
    private static ForeignKeyRow ReadForeignKeyRow(DbDataReader reader)
        => new(Text(reader, 0), Text(reader, 1), Text(reader, 2), Text(reader, 3), Text(reader, 4), Text(reader, 5), Text(reader, 6), NullableText(reader, 7), NullableText(reader, 8));

    /// <summary>Booleano do catálogo: `boolean` onde o banco tem, 0 ou 1 onde não tem.</summary>
    private static bool Flag(DbDataReader reader, int ordinal)
        => Convert.ToBoolean(reader.GetValue(ordinal), CultureInfo.InvariantCulture);

    private static long ElapsedMs(long started)
        => (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    /// <summary>
    /// RN-SESSAO-005 e RN-SQL-013. Paginado: dentro da transação só de leitura, com a primeira página lida e o cursor aberto se há mais.
    /// Completo: fora de transação e lido até o fim, de modo que o banco confirma o comando antes de a resposta sair. Nos dois a página
    /// tem até `pageSize` linhas (RN-SQL-016).
    /// </summary>
    /// <param name="readOnly">RN-PROT-006: o comando é de uma conexão somente leitura, e a sessão vai para o modo só de leitura do banco antes dele (ou sai dele, no de uma conexão que deixou de ser).</param>
    private async Task<QueryOutcome> ExecuteCommandAsync(string sql, int pageSize, bool paged, CancellationToken cancellationToken, bool readOnly = false, IReadOnlyList<QueryParameter>? parameters = null)
    {
        _utilityCommand = false;
        var started = Stopwatch.GetTimestamp();

        // Fora de transação: o modo da sessão vale para as transações seguintes, e dentro de uma seria desfeito com ela.
        await ApplySessionModeAsync(readOnly, cancellationToken);

        // ponytail: abrir e fechar a transação custa duas idas ao banco a mais por leitura. Se a rede pesar, mandar o `BEGIN` junto com o
        // comando (`DbBatch`) e fechar a transação depois de devolver a página.
        if (paged)
            await BeginReadOnlyAsync(cancellationToken);

        var reader = await StartUserCommandAsync(sql, parameters, cancellationToken);
        var requested = cancellationToken;

        // RN-SQL-010: no driver que não lança quando o cancelamento chega durante a leitura, o comando executado até o fim já rodou
        // no banco se o leitor abriu sem exceção (é na execução que esse driver lança). O cancelamento que chega daqui em diante
        // fecha o cursor pelo `Cancel` do comando e corta as linhas da resposta, mas não desfaz o que o comando gravou.
        if (!paged && CancelReturnsEmptyResult)
        {
            _executed = true;
            cancellationToken = CancellationToken.None;
        }

        // RN-SQL-008: comando sem linhas. Fora de INSERT, UPDATE e DELETE o driver informa -1, e a resposta é zero: todo desfecho tem a página ou as linhas afetadas.
        if (reader.FieldCount == 0)
        {
            var recordsAffected = reader.RecordsAffected;
            _utilityCommand = MayHaveOpenedATransaction(returnedRows: false, recordsAffected);
            await FinishCursorAsync(cancellationToken);

            return new QueryOutcome(null, Math.Max(recordsAffected, 0), ElapsedMs(started));
        }

        var origins = ColumnOrigins(reader);
        _columns = [.. Enumerable.Range(0, reader.FieldCount).Select(ordinal => new QueryColumn(reader.GetName(ordinal), reader.GetDataTypeName(ordinal), ColumnKind(reader, ordinal), origins?[ordinal]))];
        _cursorSql = sql;
        _cursorReadOnly = readOnly;
        _pageSize = pageSize;
        _utilityCommand = !paged && MayHaveOpenedATransaction(returnedRows: true, reader.RecordsAffected);

        var page = await ReadPageAsync(started, toTheEnd: !paged, cancellationToken);

        // O comando sem linhas não passa por aqui: nele não há leitura para o cancelamento cortar. O que terminou de devolver as
        // linhas antes de o cancelamento ser pedido também não: a marca é lida aqui, depois da última.
        _canceledWhileReturningRows = _executed && (_canceled || requested.IsCancellationRequested);

        return new QueryOutcome(page, null, page.ElapsedMs);
    }

    /// <summary>Uma consulta do próprio Prism lida até o fim, fora de transação: catálogo e verificação. Passa pelo mesmo caminho de leitura dos comandos do usuário.</summary>
    private Task<Result<IReadOnlyList<T>, DatabaseFailure>> QueryAsync<T>(string operation, EDatabaseFailure kind, string sql, IReadOnlyList<object> parameters, Func<DbDataReader, T> map, CancellationToken cancellationToken)
        => RunAsync(operation, kind, token => ReadAllAsync(sql, parameters, map, token), cancellationToken);

    /// <summary>Uma consulta do próprio Prism lida até o fim, dentro de um comando em andamento (o `RunAsync` de quem chama).</summary>
    private async Task<IReadOnlyList<T>> ReadAllAsync<T>(string sql, IReadOnlyList<object> parameters, Func<DbDataReader, T> map, CancellationToken cancellationToken)
    {
        var reader = await StartAsync(sql, parameters, userCommand: false, cancellationToken);
        var items = new List<T>();

        while (await reader.ReadAsync(cancellationToken))
            items.Add(map(reader));

        await FinishCursorAsync(cancellationToken);

        return items;
    }

    /// <summary>
    /// RN-EDIT-002, 003 e 010: cada tabela do `FROM`, com as colunas e as chaves, dentro do comando em andamento (e, no "Salvar", da
    /// transação dele). No PostgreSQL vêm antes as tabelas que a resposta do comando diz, pelo identificador, e a do `FROM` é a que tem o
    /// nome dela (e o esquema, quando o comando o escreveu): o caminho de busca que valeu foi o da sessão da aba, e não o desta conexão.
    /// A que não está entre elas (nenhuma coluna do resultado vem dela) é procurada pelo nome; a escrita duas vezes do mesmo jeito, uma vez.
    /// </summary>
    /// <param name="inTheSession">
    /// É a sessão do resultado (o "Salvar", dentro da transação). RN-SQL-024: no PostgreSQL, a tabela escrita sem esquema achada pelo
    /// identificador tem de ser a mesma a que o nome leva AGORA pelo caminho de busca desta sessão; se ele leva a outra (um `SET search_path`
    /// depois de um resultado guardado), ou a nenhuma, ela vem como <see cref="EditCatalogTable.Elsewhere"/>, e as colunas dela ficam só
    /// leitura. Fora da sessão (o catálogo do `edit-target`, na sessão da árvore ou numa conexão à parte) o caminho de busca é outro, e o
    /// nome não diz nada.
    /// </param>
    private async Task<IReadOnlyList<EditCatalogTable?>> DescribeCoreAsync(EditTables tables, bool inTheSession, CancellationToken cancellationToken)
    {
        var reported = new List<EditCatalogTable>();
        foreach (var id in tables.Relations.Distinct())
        {
            if (EditRelationByIdQuery(id) is { } query && await DescribeCoreAsync(query, cancellationToken) is { } relation)
                reported.Add(relation);
        }

        var described = new Dictionary<EditTableName, EditCatalogTable?>();
        var catalogs = new List<EditCatalogTable?>();
        foreach (var table in tables.Names)
        {
            var found = reported.FirstOrDefault(relation => relation.Name == table.Name && (table.Schema is null || relation.Schema == table.Schema));
            if (found is not null && inTheSession && table.Schema is null && await RelationIdAsync(table, cancellationToken) != found.Id)
                found = found with { Kind = EditCatalogTable.Elsewhere };

            if (found is null && !described.TryGetValue(table, out found))
                described[table] = found = await DescribeCoreAsync(EditRelationQuery(table), cancellationToken);

            catalogs.Add(found);
        }

        return catalogs;
    }

    /// <summary>O identificador da tabela a que o nome leva agora, nesta sessão (<see cref="EditRelationQuery"/>); nulo quando não leva a nenhuma.</summary>
    private async Task<long?> RelationIdAsync(EditTableName table, CancellationToken cancellationToken)
    {
        var (sql, parameters) = EditRelationQuery(table);
        var ids = await ReadAllAsync(sql, parameters, reader => reader.IsDBNull(3) ? (long?)null : Convert.ToInt64(reader.GetValue(3), CultureInfo.InvariantCulture), cancellationToken);

        return ids.Count == 0 ? null : ids[0];
    }

    private async Task<EditCatalogTable?> DescribeCoreAsync((string Sql, IReadOnlyList<object> Parameters) query, CancellationToken cancellationToken)
    {
        var (sql, parameters) = query;
        var relations = await ReadAllAsync(sql, parameters, reader => (Schema: Text(reader, 0).TrimEnd(), Name: Text(reader, 1).TrimEnd(), Kind: Text(reader, 2).Trim(), ID: reader.IsDBNull(3) ? (long?)null : Convert.ToInt64(reader.GetValue(3), CultureInfo.InvariantCulture), OneAtATime: Flag(reader, 4)), cancellationToken);
        if (relations.Count == 0)
            return null;

        var relation = relations[0];
        var columns = await ReadAllAsync(ColumnsSql, [relation.Schema, relation.Name], ReadColumn, cancellationToken);
        var keys = await ReadAllAsync(EditKeysSql, [relation.Schema, relation.Name], reader => (Name: Text(reader, 0), Primary: Flag(reader, 1), Column: Text(reader, 2)), cancellationToken);

        return new EditCatalogTable(relation.Schema, relation.Name, relation.Kind, relation.ID, relation.OneAtATime, columns, [.. keys.GroupBy(key => key.Name).Select(key => new EditKey(key.Key, key.First().Primary, [.. key.Select(row => row.Column)]))]);
    }

    /// <summary>Um comando do "Salvar", com os valores em parâmetros, dentro da transação dele quando há uma. Devolve as linhas afetadas.</summary>
    private async Task<int> RunEditAsync(EditCommand edit, CancellationToken cancellationToken)
    {
        var command = _connection!.CreateCommand();
        command.CommandText = edit.Sql;
        command.CommandTimeout = 0;
        command.Transaction = _editTransaction;

        foreach (var value in edit.Parameters)
        {
            var parameter = command.CreateParameter();
            BindCommandParameter(parameter, value);
            command.Parameters.Add(parameter);
        }

        // O `Cancel` o alcança por aqui; se ele lança, quem o descarta é o fim do cursor abandonado.
        _command = command;
        PrepareCommand(command);
        var affected = await command.ExecuteNonQueryAsync(cancellationToken);
        _command = null;
        await command.DisposeAsync();

        return affected;
    }

    /// <summary>
    /// RN-EDIT-021: um comando da coluna inteira, que altera muitas linhas: pelo envio do banco (<see cref="ExecuteReaderAsync"/>), em que o driver da IBM
    /// repete o pedido de cancelamento que chega antes de o comando estar executando. Devolve as linhas afetadas.
    /// </summary>
    private async Task<long> RunCountedAsync(EditCommand edit, CancellationToken cancellationToken)
    {
        var command = _connection!.CreateCommand();
        command.CommandText = edit.Sql;
        command.CommandTimeout = 0;
        command.Transaction = _editTransaction;

        foreach (var value in edit.Parameters)
        {
            var parameter = command.CreateParameter();
            BindCommandParameter(parameter, value);
            command.Parameters.Add(parameter);
        }

        // O `Cancel` o alcança por aqui; se ele lança, quem o descarta é o fim do cursor abandonado.
        _command = command;
        PrepareCommand(command);
        long affected;
        await using (var reader = await ExecuteReaderAsync(command, cancellationToken))
        {
            affected = reader.RecordsAffected;
            while (await reader.NextResultAsync(cancellationToken))
            {
            }
        }

        _command = null;
        await command.DisposeAsync();

        return affected;
    }

    /// <summary>RN-EDIT-020: a contagem da coluna inteira, lida até o fim, dentro do comando em andamento. -1 quando o banco não devolveu linha (o corte do cancelamento no driver da IBM).</summary>
    private async Task<long> CountWholeColumnRowsAsync(string sql, IReadOnlyList<QueryParameter>? parameters, CancellationToken cancellationToken)
    {
        var reader = await StartAsync(sql, [], userCommand: true, cancellationToken, query: parameters);

        // O total chega como inteiro de 32 bits nos drivers da IBM e como texto no PostgreSQL, que lê o resultado em texto.
        var counted = await reader.ReadAsync(cancellationToken) ? Convert.ToInt64(reader.GetValue(0), CultureInfo.InvariantCulture) : -1;
        await FinishCursorAsync(cancellationToken);

        return counted;
    }

    /// <summary>
    /// RN-EDIT-020: o caminho por lotes do Informix lê as chaves do próprio comando do resultado, como a grade as escreve (o valor cortado, inteiro), na
    /// memória. Nulo quando ele devolve mais de 1.000.000 de linhas: a leitura para na seguinte, e o leitor fica para o fim do cursor abandonado.
    /// </summary>
    private async Task<IReadOnlyList<IReadOnlyList<string>>?> ReadKeysAsync(WholeColumnPlan whole, CancellationToken cancellationToken)
    {
        var positions = whole.KeyColumns!;
        var reader = await StartAsync(whole.CountSql, [], userCommand: true, cancellationToken, query: whole.CountParameters);
        var kinds = positions.Select(position => ColumnKind(reader, position)).ToList();
        var keys = new List<IReadOnlyList<string>>();

        while (await reader.ReadAsync(cancellationToken))
        {
            if (keys.Count == WholeColumnSql.MaxKeys)
                return null;

            keys.Add([.. positions.Select((position, part) => KeyText(ReadCell(reader, position, kinds[part])))]);
        }

        await FinishCursorAsync(cancellationToken);

        return keys;
    }

    /// <summary>A chave lida como a grade a escreve (RN-SQL-011), e inteira quando a grade a cortaria.</summary>
    private static string KeyText(object value)
    {
        var text = CellFormatter.Format(value, out var truncated) ?? string.Empty;

        return truncated ? CellFormatter.Full(value).Write() : text;
    }

    /// <summary>
    /// RN-IMPORT-011: um `SELECT` das conversões pedidas, pelo próprio `Send`: a recusa do banco é a resposta (a mensagem dele), e nula quando todas
    /// convertem. A conexão que caiu e o cancelamento são a falha da conferência inteira, e não a recusa de um valor.
    /// </summary>
    private async Task<Result<string?, DatabaseFailure>> CastRefusalAsync(IReadOnlyList<(string Type, object? Value)> cells, CancellationToken cancellationToken)
    {
        var tried = await Send(nameof(CheckImportCastsAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            var command = _connection!.CreateCommand();
            command.CommandText = $"SELECT {string.Join(", ", cells.Select((cell, index) => ImportCastSql(cell.Type, index + 1)))}";
            ConfigureUserCommand(command);
            foreach (var (_, value) in cells)
            {
                var parameter = command.CreateParameter();
                BindImportParameter(parameter, new EditParameter(value));
                command.Parameters.Add(parameter);
            }

            _command = command;
            await using (var reader = await ExecuteReaderAsync(command, cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                }
            }

            _command = null;
            await command.DisposeAsync();

            return true;
        }, refusalIsTheAnswer: true);

        // O comando recusado ficou no campo, para o `Cancel`: sai daqui, descartado.
        if (_command is { } refused)
        {
            _command = null;
            await refused.DisposeAsync();
        }

        if (tried.IsSuccess)
            return Result.Success<string?, DatabaseFailure>(null);

        return !IsOpen || cancellationToken.IsCancellationRequested ? tried.Error : Result.Success<string?, DatabaseFailure>(tried.Error.Message);
    }

    /// <summary>RN-TABELA-002: o nome entre aspas duplas, com a aspa de dentro dobrada.</summary>
    protected virtual string QuotedName(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>RN-IMPORT-016: a recusa de um dado (classe 22) ou de uma restrição (classe 23), que o Db2 desfaz só no comando recusado.</summary>
    private static bool IsDataOrConstraintRefusal(DatabaseFailure failure)
        => failure.SqlState is { Length: 5 } state && (state.StartsWith("22", StringComparison.Ordinal) || state.StartsWith("23", StringComparison.Ordinal));

    /// <summary>
    /// Um comando da carga, pelo próprio `Send`: a recusa do banco é a resposta (com a linha recusada do lote, quando ele diz), e o comando recusado sai do
    /// campo descartado. A conexão que caiu e o cancelamento também voltam por aqui: quem chama decide pelo estado da conexão e pelo pedido.
    /// </summary>
    private async Task<UnitResult<DatabaseFailure>> TryLoadAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
    {
        var sent = await Send(nameof(InsertRowsAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            if (LoadsInBatches)
                await SendLoadBatchAsync(target, rows, cancellationToken);
            else
                await SendLoadCommandAsync(target, rows, cancellationToken);

            return true;
        }, refusalIsTheAnswer: true);

        if (_loadBatch is { } batch)
        {
            _loadBatch = null;
            await batch.DisposeAsync();
        }

        if (sent.IsSuccess)
            return UnitResult.Success<DatabaseFailure>();

        // O comando recusado ficou no campo, para o `Cancel`: sai daqui, descartado, e não serve mais às linhas seguintes.
        if (_command is { } refused)
        {
            _command = null;
            if (ReferenceEquals(refused, _loadCommand))
                _loadCommand = null;

            await refused.DisposeAsync();
        }

        return sent.Error;
    }

    /// <summary>
    /// RN-IMPORT-015, no PostgreSQL: um `INSERT` de uma linha por comando do lote, numa ida só ao banco, com os valores em parâmetros (o texto sem tipo, o
    /// binário em `bytea`, <see cref="BindImportParameter"/>).
    /// </summary>
    private async Task SendLoadBatchAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
    {
        var sql = InsertSql(target, 1);
        var batch = _loadBatch = _connection!.CreateBatch();
        batch.Transaction = _editTransaction;
        batch.Timeout = 0;
        foreach (var row in rows)
        {
            var command = batch.CreateBatchCommand();
            command.CommandText = sql;
            foreach (var value in row)
            {
                var parameter = command.CreateParameter();
                BindImportParameter(parameter, value);
                command.Parameters.Add(parameter);
            }

            batch.BatchCommands.Add(command);
        }

        await batch.ExecuteNonQueryAsync(cancellationToken);
        _executed = true;
    }

    /// <summary>
    /// RN-IMPORT-015, no Db2 e no Informix: um `INSERT … VALUES` com as linhas do comando, preparado uma vez e executado de novo enquanto o texto é o mesmo
    /// (no Informix, uma linha por comando). Os parâmetros do comando reaproveitado recebem os valores da linha nova, com o tipo dela.
    /// </summary>
    private async Task SendLoadCommandAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
    {
        var sql = InsertSql(target, rows.Count);
        var command = _loadCommand;
        var prepared = command is not null && command.CommandText == sql;
        if (!prepared)
        {
            if (command is not null)
            {
                _loadCommand = null;
                await command.DisposeAsync();
            }

            command = _connection!.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 0;
        }

        command!.Transaction = _editTransaction;
        var position = 0;
        foreach (var row in rows)
        {
            foreach (var value in row)
            {
                DbParameter parameter;
                if (prepared)
                {
                    parameter = command.Parameters[position];
                    parameter.ResetDbType();
                }
                else
                {
                    parameter = command.CreateParameter();
                    command.Parameters.Add(parameter);
                }

                BindImportParameter(parameter, value);
                position++;
            }
        }

        _command = command;
        if (!prepared)
        {
            PrepareCommand(command);
            await command.PrepareAsync(cancellationToken);
            _loadCommand = command;
        }

        await command.ExecuteNonQueryAsync(cancellationToken);
        _executed = true;
        _command = null;
    }

    /// <summary>RN-IMPORT-015: o `INSERT` da carga, com os nomes do catálogo entre aspas e `rows` linhas de marcadores de parâmetro.</summary>
    private string InsertSql(LoadTarget target, int rows)
    {
        var text = new StringBuilder($"INSERT INTO {QuotedName(target.Schema)}.{QuotedName(target.Table)} ({string.Join(", ", target.Columns.Select(QuotedName))}) VALUES ");
        var position = 0;
        for (var row = 0; row < rows; row++)
        {
            text.Append(row == 0 ? "(" : ", (");
            for (var column = 0; column < target.Columns.Count; column++)
                text.Append(column == 0 ? string.Empty : ", ").Append(LoadParameter(++position));

            text.Append(')');
        }

        return text.ToString();
    }

    /// <summary>RN-IMPORT-012 e 015: um comando da carga sem parâmetro (o esvaziamento), ao alcance do `Cancel` enquanto roda.</summary>
    private async Task ExecuteLoadCommandAsync(DbCommand command, CancellationToken cancellationToken)
    {
        _command = command;
        await command.ExecuteNonQueryAsync(cancellationToken);
        _executed = true;
        _command = null;
    }

    /// <summary>
    /// Um comando em andamento, do começo ao fim: é o intervalo em que o `Cancel` vale. Um comando que falha no meio deixa o leitor num
    /// estado que não serve mais: o cursor fecha, a transação da tentativa é desfeita, e a conexão fica pronta para o próximo.
    /// </summary>
    /// <param name="continuesTheCursor">É o "carregar mais": o único comando que não abandona o cursor anterior antes de começar.</param>
    private async Task<Result<T, DatabaseFailure>> RunAsync<T>(string operation, EDatabaseFailure kind, Func<CancellationToken, Task<T>> call, CancellationToken cancellationToken, bool continuesTheCursor = false)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        // O cancelamento que chegou com o cursor aberto e parado (depois de a página anterior sair) continua valendo no "carregar
        // mais": no driver que só para de entregar linhas, esse cursor foi cortado.
        if (!continuesTheCursor)
            _canceled = false;

        _executed = false;
        _canceledWhileReturningRows = false;
        _cancellation = cancellation;
        _running = true;

        // Abandonar o cursor anterior é do comando novo (o `Cancel` já vale), mas não entra no tempo que ele mede.
        if (!continuesTheCursor)
            await DisposeCursorAsync();

        // Se essa limpeza (ou a de um comando anterior) fechou a conexão, o comando não tem para onde ir: a resposta diz isso, no lugar
        // do erro do driver para uma conexão descartada.
        var result = IsOpen ? await Send(operation, kind, () => call(cancellation.Token)) : new DatabaseFailure(kind, ConnectionClosedMessage);

        // RN-SQL-010: um comando que terminou é sucesso, mesmo com um cancelamento a caminho. A exceção é a leitura no driver que
        // não lança ao ser cancelado e devolve um resultado vazio ou cortado: nela, quem sabe do cancelamento é o Prism. Só o
        // comando em andamento olha a marca: a sonda de transação e a limpeza, que rodam fora daqui, nunca a leem. Uma leitura não
        // grava nada: o desfecho é `canceled`.
        var cancelRequested = _canceled || cancellation.IsCancellationRequested;
        if (result.IsSuccess && CancelReturnsEmptyResult && !_executed && cancelRequested)
            result = new DatabaseFailure(kind, CanceledMessage, Outcome: ECancelOutcome.Canceled);

        // O comando executado até o fim que devolvia linhas quando o cancelamento chegou: sem página e sem total, que podem estar
        // cortados, e sem dizer que foi cancelado, porque o que ele gravou está confirmado.
        if (result.IsSuccess && _canceledWhileReturningRows)
            result = new DatabaseFailure(kind, CanceledWhileReturningRowsMessage, Outcome: ECancelOutcome.Partial);

        if (result.IsFailure)
        {
            result = WithTheCancelOutcome(result.Error, cancelRequested);
            await DisposeCursorAsync();
        }

        _running = false;
        _cancellation = null;

        return result;
    }

    /// <summary>
    /// RN-SQL-010 (Ruling 135): o desfecho do cancelamento que a falha leva à tela. Só existe com pedido de cancelamento para este
    /// comando: sem ele, a interrupção que o banco diz (o 57014 de um `statement_timeout`) é um erro comum. E a interrupção só prova
    /// que nada ficou enquanto o comando não tinha rodado no banco: no driver que só lança na execução, o comando executado até o fim
    /// já rodou quando o leitor abriu (<see cref="_executed"/>), e uma interrupção dali em diante deixa o desfecho em aberto.
    /// </summary>
    private DatabaseFailure WithTheCancelOutcome(DatabaseFailure failure, bool cancelRequested)
        => failure.Outcome switch
        {
            null => failure,
            _ when !cancelRequested => failure with { Outcome = null },
            ECancelOutcome.Canceled when _executed => failure with { Outcome = ECancelOutcome.Unknown },
            _ => failure
        };

    /// <summary>
    /// Para o gancho de um banco: faz uma chamada ao driver pelo único `try` da integração e diz se ela passou. Aqui a recusa do driver
    /// é a resposta que o gancho procura, e não um defeito: não vai para o log como conexão que falhou. A recusa do banco vai, como as
    /// outras; a que é resposta de rotina do gancho (<see cref="IsRoutineRefusal"/>) vai como depuração.
    /// </summary>
    /// <param name="onThisThread">A chamada não espera o banco: roda na thread de quem chama mesmo com o driver síncrono, e já terminou quando a tarefa é devolvida.</param>
    protected async Task<bool> TryAsync(string operation, Func<Task> call, bool onThisThread = false)
        => (await Send(operation, EDatabaseFailure.ExecutionFailed, async () =>
        {
            await call();

            return true;
        }, refusalIsTheAnswer: true, onThisThread)).IsSuccess;

    /// <summary>
    /// RN-SESSAO-005, a rede de segurança: se a conexão ficou dentro de uma transação (uma forma de `BEGIN` que a recusa da RN-SQL-003
    /// não conhece), ela é desfeita aqui, antes de qualquer outro comando; a transação só tem o comando que a abriu. Diz se havia uma.
    /// O fim é o mesmo da transação da tentativa: `ROLLBACK`, e, se ele não passa com a conexão viva, a conexão é fechada.
    ///
    /// O comando que chega aqui já foi confirmado pelo banco, e responder que ele foi recusado faria a pessoa executá-lo de novo e gravar
    /// duas vezes. Só a transação que a sonda achou com certeza muda a resposta; a sonda que falhou não muda.
    /// </summary>
    /// <param name="afterAFailure">O comando falhou ou foi cancelado enquanto devolvia as linhas: a transação que ele deixou é desfeita do mesmo jeito, e quem chama decide a resposta.</param>
    private async Task<bool> EndStrayTransactionAsync(bool afterAFailure)
    {
        if (!IsOpen)
            return false;

        var probe = await ProbeTransactionAsync(_connection!);

        // Conexão que não está aberta nunca é "há transação", responda a sonda o que responder: o driver recusa uma transação nova
        // também na conexão que caiu ou foi descartada. Nela não há o que desfazer, e quem a usa vê por `IsOpen` que ela não serve mais.
        if (probe == ETransactionProbe.Idle || !IsOpen)
            return false;

        // Há uma transação, ou a sonda falhou com a conexão viva e pode tê-la deixado dentro da transação dela mesma: o fim é um só.
        _inTransaction = true;
        await DisposeCursorAsync();

        if (probe == ETransactionProbe.Failed)
            return false;

        // RN-LOG-001: sem o comando. Depois de um sucesso, é o sinal de que falta uma forma de abrir transação na recusa da RN-SQL-003.
        if (afterAFailure)
            _logger.Warning("Um comando que falhou ou foi cancelado deixou uma transação aberta na conexão: ela foi desfeita.");
        else
            _logger.Warning("Um comando deixou uma transação aberta na conexão: ela foi desfeita, e o comando foi recusado.");

        return true;
    }

    /// <summary>
    /// A marca sobe antes do envio: um `BEGIN` cancelado depois de o banco executá-lo deixaria aberta uma transação que ninguém desfaz, e
    /// a gravação seguinte cairia dentro dela. Desfazer sem ela aberta não custa nada: no PostgreSQL é só um aviso.
    /// </summary>
    private async Task BeginReadOnlyAsync(CancellationToken cancellationToken)
    {
        // O banco sem transação só de leitura: a leitura roda em auto-commit, e não há o que confirmar nem desfazer depois.
        if (BeginReadOnlySql is not { } beginReadOnlySql)
            return;

        _inTransaction = true;
        await NonQueryAsync(beginReadOnlySql, cancellationToken);
    }

    /// <summary>
    /// RN-PROT-006: põe a sessão no modo da conexão daquele momento, dentro do comando em andamento e antes de qualquer transação. Só vai ao banco quando o
    /// modo muda: no primeiro comando de uma conexão somente leitura e quando a proteção muda com a sessão aberta. A sessão em que o Prism nunca pôs o
    /// modo não recebe nada para sair dele.
    /// </summary>
    private async Task ApplySessionModeAsync(bool readOnly, CancellationToken cancellationToken)
    {
        if (_readOnlyMode == readOnly || (_readOnlyMode is null && !readOnly) || SessionModeSql(readOnly) is not { } sql)
            return;

        await NonQueryAsync(sql, cancellationToken);
        _readOnlyMode = readOnly;
    }

    private async Task NonQueryAsync(string sql, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(sql))
            return;

        await using var command = _connection!.CreateCommand();
        command.CommandText = sql;
        command.Transaction = _editTransaction;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Abre o leitor do comando do usuário (<see cref="ExecuteCommandAsync"/>). O Informix alarga aqui a rotina que devolve `LVARCHAR` sem tamanho.</summary>
    protected virtual Task<DbDataReader> StartUserCommandAsync(string sql, IReadOnlyList<QueryParameter>? parameters, CancellationToken cancellationToken)
        => StartAsync(sql, [], userCommand: true, cancellationToken, query: parameters);

    /// <summary>
    /// Descreve a primeira coluna que um comando do usuário devolveria (`CommandBehavior.SchemaOnly`), sem executá-lo, pelo único `try`
    /// da integração. Nulo quando o banco recusa a preparação (rotina sem retorno, comando que não é consulta).
    /// </summary>
    protected async Task<(int FieldCount, string DataTypeName, int? ColumnSize)?> TryDescribeUserCommandAsync(string sql, IReadOnlyList<QueryParameter>? parameters, CancellationToken cancellationToken)
    {
        (int FieldCount, string DataTypeName, int? ColumnSize)? shape = null;
        await TryAsync(nameof(TryDescribeUserCommandAsync), async () =>
        {
            var command = _connection!.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 0;
            ConfigureUserCommand(command);
            BindQueryParameters(command, parameters);
            PrepareCommand(command);

            _command = command;
            await using (var reader = await command.ExecuteReaderAsync(CommandBehavior.SchemaOnly, cancellationToken))
                shape = reader.FieldCount > 0 ? (reader.FieldCount, reader.GetDataTypeName(0), reader.GetColumnSchema()[0].ColumnSize) : (0, string.Empty, null);

            _command = null;
            await command.DisposeAsync();
        });

        if (_command is { } refused)
        {
            _command = null;
            await refused.DisposeAsync();
        }

        return shape;
    }

    /// <summary>
    /// Tenta abrir o leitor do comando do usuário com outro texto (no Informix, a chamada de rotina envolvida num `SELECT CAST`), já na
    /// primeira linha (<see cref="_rowPending"/>): no `SELECT`, o banco só executa a rotina e acusa a recusa dela (-675, -686) ao ler a
    /// linha. Se o banco recusar ou não devolver linha, o leitor e o comando da tentativa saem descartados.
    /// </summary>
    protected async Task<DbDataReader?> TryStartUserSelectAsync(string sql, IReadOnlyList<QueryParameter>? parameters, CancellationToken cancellationToken)
    {
        var started = await TryAsync(nameof(StartUserCommandAsync), async () =>
        {
            var reader = await StartAsync(sql, [], userCommand: true, cancellationToken, query: parameters);
            _rowPending = await reader.ReadAsync(cancellationToken);
        });
        if (started && _rowPending)
            return _reader;

        await TryAsync(nameof(StartUserCommandAsync), async () =>
        {
            if (_reader is { } reader)
            {
                _reader = null;
                await reader.DisposeAsync();
            }

            if (_command is { } command)
            {
                _command = null;
                await command.DisposeAsync();
            }
        });
        _rowPending = false;

        return null;
    }

    /// <summary>
    /// Envia o comando e devolve o leitor, que fica aberto. Quem chama já fechou o cursor anterior: com um leitor aberto o driver do
    /// PostgreSQL não aceita outro comando na conexão. Os parâmetros são posicionais, e cada banco escreve o marcador dele (`$1`, `?`).
    /// </summary>
    /// <param name="userCommand">É comando do usuário: sem tempo limite, porque só para quando ele cancela (RN-SQL-010), e com o ajuste que o banco pede.</param>
    /// <param name="query">RN-VAR-032: os parâmetros do comando do usuário (`$n` ou `?` do texto), ligados na ordem, cada um com o tipo do banco (<see cref="QueryParameterBinding"/>).</param>
    /// <param name="userText">O texto é da pessoa, mas o comando tem o prazo do driver (a consulta de verificação própria, RN-VERIF-001): leva o ajuste que o banco pede num texto dela.</param>
    /// <param name="behavior">RN-EXPORT-017: o leitor da exportação, no banco que lê o valor em pedaços, é sequencial.</param>
    private async Task<DbDataReader> StartAsync(string sql, IReadOnlyList<object> parameters, bool userCommand, CancellationToken cancellationToken, bool userText = false, CommandBehavior behavior = CommandBehavior.Default, IReadOnlyList<QueryParameter>? query = null)
    {
        var command = _connection!.CreateCommand();
        command.CommandText = sql;
        command.Transaction = _editTransaction;

        // O padrão dos drivers é 30 segundos, e um comando do usuário pode levar horas.
        if (userCommand)
            command.CommandTimeout = 0;

        if (userCommand || userText)
            ConfigureUserCommand(command);

        foreach (var value in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.Value = value;
            command.Parameters.Add(parameter);
        }

        BindQueryParameters(command, query);
        PrepareCommand(command);

        _command = command;
        _reader = behavior == CommandBehavior.Default ? await ExecuteReaderAsync(command, cancellationToken) : await command.ExecuteReaderAsync(behavior, cancellationToken);

        return _reader;
    }

    /// <summary>
    /// RN-EXPORT-017: a contagem da exportação, lida pelo próprio leitor, sem tocar no da leitura (que nem foi aberto). O comando fica no campo enquanto
    /// roda, para o `Cancel`; quem chama o tira dele quando a contagem é recusada.
    /// </summary>
    private async Task<long> CountRowsAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
    {
        var command = _connection!.CreateCommand();
        command.CommandText = sql;
        command.CommandTimeout = 0;
        ConfigureUserCommand(command);
        BindQueryParameters(command, parameters);
        PrepareCommand(command);

        _command = command;
        long total;
        await using (var reader = await ExecuteReaderAsync(command, cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);

            // O total chega como inteiro de 32 bits nos drivers da IBM, de 64 no PostgreSQL tipado e como texto no formato de texto.
            total = Convert.ToInt64(reader.GetValue(0), CultureInfo.InvariantCulture);
            while (await reader.NextResultAsync(cancellationToken))
            {
            }
        }

        _command = null;
        await command.DisposeAsync();

        return total;
    }

    /// <summary>
    /// RN-SQL-004, 005 e 016: lê do leitor aberto até as linhas por página do cursor (<see cref="_pageSize"/>) e para. Nada conta o total
    /// nem lê o resto: o que o banco ainda tem para mandar fica no banco e na rede. RN-SQL-013: no comando que grava, o resto é lido só
    /// para ser contado, porque o banco só confirma o comando depois de entregar a última linha.
    /// </summary>
    private async Task<QueryPage> ReadPageAsync(long started, bool toTheEnd, CancellationToken cancellationToken)
    {
        var reader = _reader!;
        var rows = new List<string?[]>(_pageSize);
        var truncatedCells = new List<int[]>();
        var fullValues = new List<FullCellValue>();

        while (rows.Count < _pageSize && (_rowPending || await reader.ReadAsync(cancellationToken)))
        {
            _rowPending = false;

            var row = new string?[_columns.Count];
            for (var column = 0; column < row.Length; column++)
            {
                // A célula vem inteira para a memória antes do corte, e é ela inteira que copiar e exportar levam (RN-SQL-017): o registro
                // de sessões guarda o valor completo da cortada, com o teto dele.
                var value = ReadCell(reader, column, _columns[column].Kind);
                row[column] = CellFormatter.Format(value, out var truncated);
                if (!truncated)
                    continue;

                truncatedCells.Add([rows.Count, column]);
                fullValues.Add(CellFormatter.Full(value));
            }

            rows.Add(row);
        }

        if (toTheEnd)
        {
            long totalRows = rows.Count;
            while (await reader.ReadAsync(cancellationToken))
                totalRows++;

            await FinishCursorAsync(cancellationToken);

            return new QueryPage(_columns, rows, false, ElapsedMs(started), truncatedCells, totalRows, FullValues: fullValues);
        }

        // Uma leitura a mais diz se há outra página sem contar o total: a linha fica no leitor para a página seguinte.
        var hasMore = _rowPending = rows.Count == _pageSize && await reader.ReadAsync(cancellationToken);

        // RN-SQL-007: o cursor fecha quando acaba.
        if (!hasMore)
            await FinishCursorAsync(cancellationToken);

        return new QueryPage(_columns, rows, hasMore, ElapsedMs(started), truncatedCells, FullValues: fullValues);
    }

    /// <summary>
    /// O fim de um comando que foi lido até a última linha, e parte dele: quem chama está dentro do `Send` do comando, e o que falhar
    /// aqui é a falha do comando. O banco só confirma depois de entregar a última linha (é ali que ele confere uma restrição adiada, por
    /// exemplo), e a recusa dele só aparece quando o resultado é lido até o fim, o que o `NextResultAsync` faz, ou no `COMMIT` da
    /// transação da tentativa. Responder com as linhas sem passar por aqui seria mostrar o que o banco não gravou.
    ///
    /// O `COMMIT` existe pelo que a transação só de leitura deixa passar e precisa ficar: o que a leitura ajusta na sessão ou grava em
    /// tabela temporária. Quando algo aqui falha, o <see cref="RunAsync"/> desfaz o que sobrou pelo <see cref="DisposeCursorAsync"/>.
    /// </summary>
    private async Task FinishCursorAsync(CancellationToken cancellationToken)
    {
        // Até não haver mais resultado: o driver que executa os comandos de um envio um por um (os da IBM) só roda o seguinte
        // quando o leitor avança, e um `CALL` devolve mais de um conjunto. No PostgreSQL a primeira chamada já responde que acabou.
        while (await _reader!.NextResultAsync(cancellationToken))
        {
        }

        await _reader.DisposeAsync();
        await _command!.DisposeAsync();
        _reader = null;
        _command = null;
        _rowPending = false;
        _cursorSql = null;

        if (!_inTransaction)
            return;

        await NonQueryAsync(CommitSql, CancellationToken.None);
        _inTransaction = false;
    }

    /// <summary>
    /// Abandona o cursor: descarta o leitor e o comando e desfaz a transação que estiver aberta (`ROLLBACK`). É o fim de um cursor que
    /// não foi lido até a última linha (outro comando chegou, a pessoa fechou, o tempo sem leitura passou) e de um comando que falhou.
    /// Com linhas ainda por vir, cancela o comando antes: o descarte do leitor do PostgreSQL lê e joga fora tudo o que o banco ainda
    /// mandaria, e numa tabela grande isso é o resultado inteiro atravessando a rede. Não marca `_canceled`: este cancelamento é do Prism.
    ///
    /// Não falha, e por isso tem o próprio `Send`. O que o descarte encontra no fim de um resultado que ninguém leu até lá (um erro que
    /// o banco deixou depois das linhas já lidas) fica com o cursor abandonado: vai para o log, e nunca vira o erro do comando seguinte.
    /// E o fim da transação não depende de o descarte dar certo: é a saída do bloco, que roda de qualquer jeito.
    /// </summary>
    private async Task DisposeCursorAsync()
    {
        var reader = _reader;
        var command = _command;
        _reader = null;
        _command = null;
        _rowPending = false;
        _cursorSql = null;

        if (reader is null && command is null && !_inTransaction && _editTransaction is null)
            return;

        await Send(nameof(DisposeCursorAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            await using (new TransactionEnd(this))
            {
                if (reader is not null)
                {
                    command?.Cancel();
                    await reader.DisposeAsync();
                }

                if (command is not null)
                    await command.DisposeAsync();
            }

            return true;
        });

        if (!_inTransaction && _editTransaction is null)
            return;

        // O `ROLLBACK` não passou, e a conexão continua viva: ela ficaria presa numa transação abortada, e o comando
        // seguinte rodaria dentro dela. A conexão é fechada (o banco desfaz a transação ao perdê-la), e quem a usa vê por `IsOpen` que
        // ela não serve mais e tira a sessão do registro.
        _inTransaction = false;
        _editTransaction = null;
        await Send(nameof(DisposeCursorAsync), EDatabaseFailure.ExecutionFailed, async () =>
        {
            if (_connection is not null)
                await _connection.DisposeAsync();

            return true;
        });
        _discarded = true;
    }

    /// <summary>
    /// O único `try` da integração: nenhuma exceção do driver sai daqui, e a falha volta como `Result`. O log recebe a classe do erro e
    /// o SQLSTATE, nunca a exceção: a mensagem dela é a do banco, que cita o SQL e os dados (RN-LOG-001); ela vai para a tela, dentro da
    /// recusa. O que não é resposta de banco (um defeito, um valor que o driver não soube ler) leva também a pilha.
    /// </summary>
    /// <param name="refusalIsTheAnswer">Quem chama pergunta algo ao driver, e a exceção dele é uma das respostas: não é defeito, e não vai para o log como um.</param>
    /// <param name="onThisThread">A chamada não espera o banco (é o pedido de cancelamento): roda na thread de quem chama mesmo com o driver síncrono.</param>
    private async Task<Result<T, DatabaseFailure>> Send<T>(string operation, EDatabaseFailure kind, Func<Task<T>> call, bool refusalIsTheAnswer = false, bool onThisThread = false)
    {
        try
        {
            if (!BlocksTheCallingThread || onThisThread)
                return await call();

            // A cultura acompanha a chamada e as continuações dela, e não sai desta tarefa para quem chamou.
            return await Task.Run(() =>
            {
                CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

                return call();
            });
        }
        catch (Exception exception)
        {
            // O driver da IBM entrega embrulhados o cancelamento de uma leitura e o erro que o banco devolve durante ela: por dentro
            // são o mesmo cancelamento e a mesma recusa, e a resposta e o log são os deles, e não os de um defeito.
            if (exception is AggregateException { InnerExceptions: [OperationCanceledException or DbException] } wrapped)
                exception = wrapped.InnerExceptions[0];

            var failure = ToFailure(kind, exception);

            // RN-IMPORT-016: o lote da carga diz qual dos comandos dele o banco recusou, e assim qual linha.
            if (exception is DbException { BatchCommand: { } failedCommand } && _loadBatch is { } batch && batch.BatchCommands.IndexOf(failedCommand) is >= 0 and var failedRow)
                failure = failure with { Change = failedRow };

            // RN-SQL-010: o banco disse que interrompeu o comando, e o desfez. Quem decide se isso vira o desfecho da resposta é o
            // `RunAsync`, que sabe se houve pedido de cancelamento (`WithTheCancelOutcome`).
            if (IsInterruption(exception, failure))
                failure = failure with { Outcome = ECancelOutcome.Canceled };

            // O cancelamento sem mensagem do banco só tem o texto do .NET, que não vai para a tela. Com a conexão aberta, o comando nem
            // chegou a ser enviado, ou era uma leitura, que não grava (provado nos dois drivers desta árvore; ver "O desfecho do
            // cancelamento e o `executed`" no guia do back-end): o Npgsql 10 só lança o cancelamento sem a resposta 57014 do servidor antes de enviar o comando (o
            // `ThrowIfCancellationRequested` do começo do `ExecuteReader`) ou ao derrubar a conexão; e o da IBM, que é síncrono, só pelas
            // versões assíncronas do ADO.NET, que conferem o pedido antes de chamar o driver, enquanto o comando executado até o fim é
            // lido sem o pedido. Com a conexão fechada no meio de um comando, o driver desistiu de esperar a resposta do banco ao
            // cancelamento e a derrubou: o comando pode ter sido concluído lá, e a resposta não diz que ele foi cancelado.
            if (exception is OperationCanceledException && failure.SqlState is null)
                failure = _running && !IsOpen ? failure with { Message = UnknownOutcomeMessage, Outcome = ECancelOutcome.Unknown } : failure with { Message = CanceledMessage, Outcome = ECancelOutcome.Canceled };

            if (exception is DbException or OperationCanceledException)
                _logger.Write(refusalIsTheAnswer && IsRoutineRefusal ? LogEventLevel.Debug : LogEventLevel.Information, "O banco recusou {Operation} ({ExceptionType}, SQLSTATE {SqlState}).", operation, exception.GetType().Name, failure.SqlState);
            else if (!refusalIsTheAnswer)
                _logger.Error("A conexão com o banco falhou em {Operation} ({ExceptionType}).{NewLine}{StackTrace}", operation, exception.GetType().Name, Environment.NewLine, exception.StackTrace);

            return failure;
        }
    }

    /// <summary>Um par de colunas de uma chave estrangeira, com a chave, as duas pontas e as regras dela.</summary>
    private sealed record ForeignKeyRow(string Name, string ReferencingSchema, string ReferencingTable, string Column, string ReferencedSchema, string ReferencedTable, string ReferencedColumn, string? OnDelete, string? OnUpdate);

    /// <summary>RN-EXPORT-017: uma célula lida para a exportação e o tamanho dela; acima do teto, a célula vem nula, com o tamanho que passou dele.</summary>
    protected readonly record struct ExportCellRead(ExportCell Cell, long Bytes)
    {
        public override string ToString()
            => nameof(ExportCellRead);
    }

    /// <summary>RN-SESSAO-005: o que a sonda de transação de um banco respondeu, depois de um comando utilitário que o banco confirmou.</summary>
    protected enum ETransactionProbe
    {
        /// <summary>A conexão está fora de transação.</summary>
        Idle,

        /// <summary>O driver disse, sem enviar nada ao banco, que há uma transação aberta na conexão. A base só aceita a resposta com a conexão aberta.</summary>
        InTransaction,

        /// <summary>A sonda falhou por outro motivo. Não diz nada sobre o comando; a conexão, se continua viva, pode ter ficado dentro da transação da própria sonda.</summary>
        Failed
    }

    /// <summary>
    /// Desfaz a transação aberta na saída do bloco, também quando o descarte do leitor lança: sem `try`/`finally`, como o serviço do
    /// cofre libera o semáforo. `_inTransaction` só é baixado depois de o banco aceitar o `ROLLBACK`.
    /// </summary>
    private readonly struct TransactionEnd(AdoDatabaseConnection connection) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            // A do "Salvar" é do driver, e se desfaz por ele.
            if (connection._editTransaction is { } transaction)
            {
                await transaction.RollbackAsync();
                await transaction.DisposeAsync();
                connection._editTransaction = null;

                return;
            }

            if (!connection._inTransaction)
                return;

            await connection.NonQueryAsync(RollbackSql, CancellationToken.None);
            connection._inTransaction = false;
        }
    }
}
