using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Services;
using System.Collections;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Services;

internal sealed class DatabaseSessionService : IDatabaseSessionService, IAsyncDisposable
{
    /// <summary>De quanto em quanto tempo o fechamento de uma sessão confere se o comando parou e, se o pedido anterior já voltou, pede de novo para interrompê-lo.</summary>
    private static readonly TimeSpan CancelRetryInterval = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// O teto da espera por um comando que não para: com a rede morta o banco não responde nem ao cancelamento, e "Sair" e o
    /// encerramento do app não podem ficar presos a ele.
    /// </summary>
    private static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(10);

    private readonly ConcurrentDictionary<Guid, Session> _sessions = new();

    /// <summary>
    /// Conferir a geração do cofre e registrar a sessão são uma coisa só diante do fechamento do cofre, que tira as sessões do registro
    /// com a mesma trava: ou a sessão entra antes e o fechamento a leva, ou entra depois e a conferência, já com a geração nova, a recusa.
    /// </summary>
    private readonly Lock _registration = new();

    private readonly Dictionary<EDatabaseEngine, IDatabaseClient> _clients;
    private readonly IVaultService _vault;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger _logger;

    public DatabaseSessionService(IEnumerable<IDatabaseClient> clients, IVaultService vault, TimeProvider timeProvider, ILogger logger)
    {
        _clients = clients.ToDictionary(client => client.Engine);
        _vault = vault;
        _timeProvider = timeProvider;
        _logger = logger.ForContext<DatabaseSessionService>();

        // RN-COFRE-008: fechar o cofre encerra as sessões abertas com as credenciais dele.
        _vault.Locked += OnVaultLocked;
    }

    public async Task<Result<DatabaseSessionInfo, DatabaseFailure>> OpenAsync(Guid connectionID, ConnectionSettings settings, long vaultGeneration, CancellationToken cancellationToken)
    {
        var opened = await ConnectAsync(settings, cancellationToken);
        if (opened.IsFailure)
        {
            _logger.Information("A sessão com o banco não abriu ({Failure}, SQLSTATE {SqlState}); conexão {ConnectionID}.", opened.Error.Kind, opened.Error.SqlState, connectionID);

            return opened.Error;
        }

        var session = new Session(new DatabaseSessionInfo(Guid.CreateVersion7(), connectionID, settings.Engine, settings.Database, opened.Value.ServerVersion), settings, opened.Value, vaultGeneration);
        session.IdleTimer = _timeProvider.CreateTimer(_ => OnCursorIdle(session), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);

        if (!Register(session))
        {
            await ReleaseAsync(session);
            _logger.Information("O cofre mudou enquanto a sessão abria, e ela foi descartada; conexão {ConnectionID}.", connectionID);

            return new DatabaseFailure(EDatabaseFailure.VaultChanged, "O cofre mudou enquanto a sessão era aberta.");
        }

        _logger.Information("Sessão {SessionID} aberta; conexão {ConnectionID}, banco {Engine}.", session.Info.ID, connectionID, settings.Engine);

        return session.Info;
    }

    public async Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, CancellationToken cancellationToken)
    {
        var opened = await ConnectAsync(settings, cancellationToken);
        if (opened.IsFailure)
            return opened.Error;

        // RN-CONN-013: abre, roda a consulta de verificação e fecha, sem registrar sessão.
        await using var connection = opened.Value;

        return await connection.PingAsync(cancellationToken);
    }

    public async Task<UnitResult<DatabaseFailure>> CloseAsync(Guid sessionID)
    {
        if (!_sessions.TryRemove(sessionID, out var session))
            return SessionNotFound();

        await CloseSessionAsync(session);

        return UnitResult.Success<DatabaseFailure>();
    }

    public Task CloseByConnectionAsync(Guid connectionID)
        => Task.WhenAll(Take(session => session.Info.ConnectionID == connectionID).Select(CloseSessionAsync));

    public Task CloseAllAsync()
        => Task.WhenAll(Take(_ => true).Select(CloseSessionAsync));

    public bool HasOpenSession(IReadOnlyCollection<EDatabaseEngine> engines)
        => _sessions.Values.Any(session => engines.Contains(session.Info.Engine));

    public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(Guid sessionID, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetSchemasAsync), waitsForTurn: true, session => session.Connection.GetSchemasAsync(cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(Guid sessionID, string schema, string kind, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetObjectsAsync), waitsForTurn: true, session => session.Connection.GetObjectsAsync(schema, kind, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetColumnsAsync), waitsForTurn: true, session => session.Connection.GetColumnsAsync(schema, table, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetIndexesAsync), waitsForTurn: true, session => session.Connection.GetIndexesAsync(schema, table, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetForeignKeysAsync), waitsForTurn: true, session => session.Connection.GetForeignKeysAsync(schema, table, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetReferencingForeignKeysAsync), waitsForTurn: true, session => session.Connection.GetReferencingForeignKeysAsync(schema, table, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetChecksAsync), waitsForTurn: true, session => session.Connection.GetChecksAsync(schema, table, cancellationToken), cancellationToken);

    public Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(Guid sessionID, string schema, string view, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetViewDefinitionAsync), waitsForTurn: true, session => session.Connection.GetViewDefinitionAsync(schema, view, cancellationToken), cancellationToken);

    public Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(Guid sessionID, string schema, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetDiagramAsync), waitsForTurn: true, session => session.Connection.GetDiagramAsync(schema, cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(Guid sessionID, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetPropertiesAsync), waitsForTurn: true, session => session.Connection.GetPropertiesAsync(cancellationToken), cancellationToken);

    public Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(Guid sessionID, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(GetDatabasesAsync), waitsForTurn: true, session => session.Connection.GetDatabasesAsync(cancellationToken), cancellationToken);

    public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, int pageSize, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(ExecuteAsync), waitsForTurn: false, async session =>
        {
            var outcome = await session.Connection.ExecuteAsync(sql, pageSize, cancellationToken);

            // RN-SQL-006: "contar total" vale para o último comando que devolveu linhas, mesmo que outros sem linhas venham depois.
            if (outcome.IsSuccess && outcome.Value.Page is { } page)
            {
                session.LastRowQuery = new RowQuery(sql, page.TotalRows);

                // RN-EDIT-002 e 010: cada execução é um resultado novo, e o que o texto diz da edição dele sai sem consultar o banco. O
                // comando executado até o fim que devolveu linhas gravou (RN-SQL-013): é só leitura.
                var result = new ResultState(page.TotalRows is null ? EditableSql.Read(sql, DialectOf(session)) : ResultSource.ReadOnly(EditableSql.WroteRows), page.Columns);
                var withoutFullValue = result.Cells.Add(page);
                ReplaceResult(session, result);

                return outcome.Value with { Page = page with { ResultID = result.ID, Editable = result.Editability, FullValues = null, CellsWithoutFullValue = withoutFullValue } };
            }

            // O comando que rodou deixa a sessão sem resultado (RN-SQL-017: e larga os valores completos dele); a recusa pelo texto, antes
            // de executar, deixa o anterior como estava.
            if (outcome.IsSuccess || outcome.Error.Kind == EDatabaseFailure.ExecutionFailed || outcome.Error.Executed)
                ReplaceResult(session, null);

            return outcome;
        }, cancellationToken);

    public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(Guid sessionID, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(FetchNextAsync), waitsForTurn: false, async session =>
        {
            var page = await session.Connection.FetchNextAsync(cancellationToken);
            if (page.IsFailure)
                return page;

            // RN-SQL-017: a página continua a contagem das linhas do resultado, e o valor completo das cortadas fica com ele.
            return session.CurrentResult is { } result
                ? page.Value with { ResultID = result.ID, Editable = result.Editability, FullValues = null, CellsWithoutFullValue = result.Cells.Add(page.Value) }
                : page.Value with { FullValues = null, CellsWithoutFullValue = page.Value.TruncatedCells };
        }, cancellationToken);

    /// <summary>
    /// RN-SQL-017: o valor completo das células pedidas, do que está na memória. Não fala com o banco, então não toma a vez da sessão:
    /// responde enquanto um "carregar mais" ou outro comando roda (o resultado de antes continua o atual até o outro comando terminar).
    /// </summary>
    public Result<IReadOnlyList<string?>, DatabaseFailure> GetCells(Guid sessionID, Guid resultID, IReadOnlyList<CellPosition> cells)
    {
        if (!_sessions.TryGetValue(sessionID, out var session) || session.Closed)
            return SessionNotFound();

        if (session.CurrentResult is not { } result || result.ID != resultID)
            return new DatabaseFailure(EDatabaseFailure.ResultNotFound, "O resultado não existe mais: a sessão executou outro comando depois dele. Execute o comando de novo para copiar.");

        var started = _timeProvider.GetTimestamp();
        var values = result.Cells.Read(cells, result.Columns.Count);
        var elapsedMs = (long)_timeProvider.GetElapsedTime(started).TotalMilliseconds;

        // RN-LOG-001: só as contagens, nunca um valor.
        if (values.IsSuccess)
            _logger.Information("Sessão {SessionID}: {Operation} em {ElapsedMs} ms, {Cells} células pedidas, {Missing} sem valor completo.", session.Info.ID, nameof(GetCells), elapsedMs, cells.Count, values.Value.Count(value => value is null));
        else
            _logger.Information("Sessão {SessionID}: {Operation} recusado ({Failure}), {Cells} células pedidas.", session.Info.ID, nameof(GetCells), values.Error.Kind, cells.Count);

        return values;
    }

    public async Task<Result<long, DatabaseFailure>> CountAsync(Guid sessionID, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        var query = session.LastRowQuery;
        if (query is null)
            return new DatabaseFailure(EDatabaseFailure.NoQueryToCount, "Nenhum comando desta sessão devolveu linhas para contar.");

        // RN-SQL-013: o comando gravou, foi executado até o fim e já disse quantas linhas devolveu. Contar seria executá-lo de novo.
        if (query.TotalRows is { } known)
            return known;

        // RN-SQL-010: a contagem para com a requisição, com "cancelar", com o fechamento da sessão e com o do cofre.
        using var counting = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, session.CountCancellation.Token);

        // RN-SQL-006: em conexão separada, para o cursor da sessão continuar como está e a sessão continuar livre para "carregar mais".
        var opened = await ConnectAsync(session.Settings, counting.Token);
        if (opened.IsFailure)
            return opened.Error;

        await using var connection = opened.Value;
        var started = _timeProvider.GetTimestamp();
        var total = await connection.CountAsync(query.Sql, counting.Token);
        Log(session, nameof(CountAsync), started, total);

        return total;
    }

    public UnitResult<DatabaseFailure> Cancel(Guid sessionID)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        // RN-SQL-010: a contagem em andamento é interrompida; a seguinte usa uma fonte nova, e não nasce cancelada.
        _ = Interlocked.Exchange(ref session.CountCancellation, new CancellationTokenSource()).CancelAsync();

        // Só com comando em andamento: sem ele não há o que interromper, e um cursor aberto e parado fica como está.
        if (session.Turn.CurrentCount == 0)
            session.Connection.Cancel();

        return UnitResult.Success<DatabaseFailure>();
    }

    public async Task<Result<EditTarget, DatabaseFailure>> GetEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        if (session.CurrentResult is not { } result || result.ID != resultID)
            return ResultChanged();

        return await TargetOfAsync(session, result, catalogSessionID, cancellationToken);
    }

    public async Task<Result<EditPreview, DatabaseFailure>> PreviewEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        if (session.CurrentResult is not { } result || result.ID != resultID)
            return ResultChanged();

        var target = await TargetOfAsync(session, result, catalogSessionID: null, cancellationToken);

        return target.IsFailure ? target.Error : EditPlanner.Preview(DialectOf(session), target.Value, result.Columns, changes);
    }

    /// <summary>
    /// RN-EDIT-005: o alvo de antes é o que o `edit-target` respondeu (sem ele, o catálogo é consultado aqui, na própria sessão, cujo
    /// cursor o "Salvar" fecha de qualquer jeito). As pendências são conferidas contra ele antes de ir ao banco; dentro da transação, o
    /// catálogo é consultado de novo, e um alvo diferente (a tabela mudou, ou o esquema atual da sessão leva a outra) não executa nada.
    /// </summary>
    public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(ApplyEditsAsync), waitsForTurn: false, async session =>
        {
            if (session.CurrentResult is not { } result || result.ID != resultID)
                return ResultChanged();

            var dialect = DialectOf(session);
            if (result.Source.Table is not { } table)
                return EditTargetResolver.Resolve(dialect, result.Source, result.Columns, null).Error;

            var expected = result.Target;
            if (expected is null)
            {
                var described = await session.Connection.DescribeEditTableAsync(table, cancellationToken);
                if (described.IsFailure)
                    return described.Error;

                var resolved = EditTargetResolver.Resolve(dialect, result.Source, result.Columns, described.Value);
                if (resolved.IsFailure)
                    return resolved.Error;

                expected = result.Target = resolved.Value;
            }

            var planned = EditPlanner.Plan(dialect, expected, result.Columns, changes);
            if (planned.IsFailure)
                return planned.Error;

            return await session.Connection.ApplyEditsAsync(table, expected.OneAtATime, catalog =>
            {
                var now = EditTargetResolver.Resolve(dialect, result.Source, result.Columns, catalog);
                if (now.IsFailure || !EditTargetResolver.Same(expected, now.Value))
                    return Result.Failure<IReadOnlyList<EditCommand>, DatabaseFailure>(TableChanged(expected, now));

                return EditPlanner.Plan(dialect, now.Value, result.Columns, changes);
            }, cancellationToken);
        }, cancellationToken);

    /// <summary>RN-SESSAO-004: a API encerrando fecha as sessões. O contêiner descarta o serviço no desligamento, antes do cofre, de quem ele depende.</summary>
    public async ValueTask DisposeAsync()
    {
        _vault.Locked -= OnVaultLocked;
        await CloseAllAsync();
    }

    private static DatabaseFailure SessionNotFound()
        => new(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.");

    private static DatabaseFailure ResultChanged()
        => new(EDatabaseFailure.ResultChanged, "O resultado mudou: a sessão executou outro comando depois dele. Execute o comando de novo para editar.");

    /// <summary>RN-EDIT-005: o catálogo de dentro da transação não é o da consulta. Nada foi executado.</summary>
    private static DatabaseFailure TableChanged(EditTarget expected, Result<EditTarget, DatabaseFailure> now)
    {
        var before = expected.Tables[0];
        if (now.IsSuccess && now.Value.Tables[0] is var table && (table.Schema != before.Schema || table.Name != before.Name))
            return new DatabaseFailure(EDatabaseFailure.ResultChanged, $"O comando agora lê outra tabela ({table.Schema}.{table.Name}, e não {before.Schema}.{before.Name}): o esquema atual da sessão mudou desde a consulta. Nada foi gravado; execute o comando de novo.");

        return new DatabaseFailure(EDatabaseFailure.ResultChanged, $"A tabela {before.Name} mudou desde a consulta (a chave, as colunas ou o tipo delas). Nada foi gravado; execute o comando de novo.");
    }

    private static ESqlDialect DialectOf(Session session)
        => session.Info.Engine switch
        {
            EDatabaseEngine.Db2 => ESqlDialect.Db2,
            EDatabaseEngine.Informix => ESqlDialect.Informix,
            _ => ESqlDialect.PostgreSql
        };

    /// <summary>
    /// RN-EDIT-010: o alvo da edição de um resultado, consultado uma vez e guardado com ele. O resultado inteiro só leitura responde
    /// sem ir ao banco.
    /// </summary>
    private async Task<Result<EditTarget, DatabaseFailure>> TargetOfAsync(Session session, ResultState result, Guid? catalogSessionID, CancellationToken cancellationToken)
    {
        if (result.Target is { } known)
            return known;

        var dialect = DialectOf(session);
        if (result.Source.Table is not { } table)
            return EditTargetResolver.Resolve(dialect, result.Source, result.Columns, null);

        var started = _timeProvider.GetTimestamp();
        var catalog = await DescribeElsewhereAsync(session, table, catalogSessionID, cancellationToken);
        var target = catalog.IsFailure ? catalog.Error : EditTargetResolver.Resolve(dialect, result.Source, result.Columns, catalog.Value);
        Log(session, nameof(GetEditTargetAsync), started, target);

        if (target.IsSuccess)
            result.Target = target.Value;

        return target;
    }

    /// <summary>
    /// RN-EDIT-010: o catálogo da edição nunca vai na sessão do resultado, que pode ter o cursor aberto. Vai na sessão da árvore (a da
    /// mesma conexão, do mesmo banco e do mesmo cofre), esperando a vez como qualquer consulta de catálogo; sem ela, numa conexão à
    /// parte, com as credenciais da sessão e prazo de espera de trava, que o "cancelar" e o fechamento da sessão interrompem como a
    /// contagem.
    /// </summary>
    private async Task<Result<EditCatalogTable?, DatabaseFailure>> DescribeElsewhereAsync(Session session, EditTableName table, Guid? catalogSessionID, CancellationToken cancellationToken)
    {
        if (catalogSessionID is { } catalogID && catalogID != session.Info.ID && _sessions.TryGetValue(catalogID, out var tree) && tree.Info.ConnectionID == session.Info.ConnectionID && tree.Info.Database == session.Info.Database && tree.VaultGeneration == session.VaultGeneration)
        {
            var described = await RunAsync(catalogID, nameof(DescribeElsewhereAsync), waitsForTurn: true, other => other.Connection.DescribeEditTableAsync(table, cancellationToken), cancellationToken);
            if (described.IsSuccess || described.Error.Kind != EDatabaseFailure.SessionNotFound)
                return described;
        }

        using var describing = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, session.CountCancellation.Token);
        var opened = await ConnectAsync(session.Settings, describing.Token);
        if (opened.IsFailure)
            return opened.Error;

        await using var connection = opened.Value;
        var limited = await connection.LimitLockWaitAsync(describing.Token);

        return limited.IsFailure ? limited.Error : await connection.DescribeEditTableAsync(table, describing.Token);
    }

    /// <summary>RN-SQL-007: só há cursor aberto quando a página diz que há mais linhas; qualquer outro desfecho de um comando o fechou.</summary>
    private static bool HasOpenCursor(object? value)
        => value switch
        {
            QueryPage page => page.HasMore,
            QueryOutcome outcome => outcome.Page?.HasMore ?? false,
            _ => false
        };

    /// <summary>As linhas lidas ou afetadas, para o log (RN-LOG-001).</summary>
    private static long CountRows(object? value)
        => value switch
        {
            QueryPage page => page.Rows.Count,
            QueryOutcome outcome => outcome.Page?.Rows.Count ?? outcome.RowsAffected ?? 0,
            ICollection items => items.Count,
            SchemaDiagramInfo diagram => diagram.Tables.Count,
            long total => total,
            _ => 0
        };

    /// <summary>RN-SQL-017: o resultado novo (ou nenhum) toma o lugar do de antes, cujos valores completos saem da memória.</summary>
    private static void ReplaceResult(Session session, ResultState? next)
    {
        var previous = session.CurrentResult;
        session.CurrentResult = next;
        previous?.Cells.Clear();
    }

    /// <summary>Com a vez da sessão tomada, ou antes de ela entrar no registro. A conexão não falha ao ser descartada.</summary>
    private static async Task ReleaseAsync(Session session)
    {
        session.Close();
        session.IdleTimer.Dispose();
        await session.Connection.DisposeAsync();
    }

    /// <summary>
    /// RN-ABERTO-006: o PostgreSQL tem client em toda plataforma. Banco sem client é o Db2 ou o Informix numa plataforma para a qual a
    /// IBM não publica o driver, e a resposta diz isso no lugar de um erro genérico.
    /// </summary>
    private Task<Result<IDatabaseConnection, DatabaseFailure>> ConnectAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => _clients.TryGetValue(settings.Engine, out var client)
            ? client.OpenAsync(settings, cancellationToken)
            : Task.FromResult(Result.Failure<IDatabaseConnection, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, $"O Prism para {RuntimeInformation.RuntimeIdentifier} ainda não conecta em Db2 e Informix: a IBM não publica o driver para ela.")));

    private bool Register(Session session)
    {
        lock (_registration)
            return _vault.Generation == session.VaultGeneration && _sessions.TryAdd(session.Info.ID, session);
    }

    /// <summary>
    /// Tira do registro as sessões que atendem à condição, avaliada com a trava tomada, e as marca como fechadas: daqui em diante o
    /// identificador delas não existe, quem esperava a vez numa delas desiste e a contagem em andamento para. O fechamento da conexão,
    /// que fala com o banco, fica para quem chamou.
    /// </summary>
    private Session[] Take(Func<Session, bool> predicate)
    {
        Session[] taken;

        lock (_registration)
            taken = [.. _sessions.Values.Where(predicate).Where(session => _sessions.TryRemove(session.Info.ID, out _))];

        foreach (var session in taken)
            session.Close();

        return taken;
    }

    /// <summary>
    /// RN-COFRE-008. O aviso chega na thread que fechou o cofre, depois de o semáforo dele ser liberado; numa troca de usuário, com o
    /// cofre novo já aberto. Por isso só saem as sessões de outra geração, lida com a trava do registro tomada: uma sessão do cofre que
    /// acabou de abrir não dependia do que fechou. Aqui as sessões só saem do registro, o que não espera ninguém; fechar as conexões
    /// fala com o banco e vai para outra thread. Nada aqui lança: o fechamento trata as próprias falhas, uma sessão de cada vez.
    /// </summary>
    private void OnVaultLocked()
    {
        var sessions = Take(session => session.VaultGeneration != _vault.Generation);

        if (sessions.Length > 0)
            _ = Task.Run(() => Task.WhenAll(sessions.Select(CloseSessionAsync)));
    }

    /// <summary>
    /// Fecha uma sessão que já saiu do registro. A conexão só é descartada com a vez tomada, porque o driver não aceita ser descartado
    /// no meio de um comando. Se a vez está com um comando, ele é interrompido: o pedido vai em outra thread (com a rede morta o driver
    /// leva dezenas de segundos para desistir dele) e se repete enquanto a vez não chega, porque um cancelamento que cai entre dois
    /// comandos não interrompe nenhum. Passado o teto, a conexão é abandonada: o descarte fica por conta do driver, sem ninguém à espera.
    /// </summary>
    private async Task CloseSessionAsync(Session session)
    {
        session.Close();

        if (!session.Turn.Wait(0))
        {
            var started = _timeProvider.GetTimestamp();
            var canceling = Task.Run(session.Connection.Cancel);

            while (!await session.Turn.WaitAsync(CancelRetryInterval))
            {
                if (_timeProvider.GetElapsedTime(started) >= CloseTimeout)
                {
                    session.IdleTimer.Dispose();
                    _ = Task.Run(() => session.Connection.DisposeAsync().AsTask());
                    _logger.Warning("Sessão {SessionID}: o comando não parou em {Seconds} s, e a conexão foi abandonada.", session.Info.ID, CloseTimeout.TotalSeconds);

                    return;
                }

                if (canceling.IsCompleted)
                    canceling = Task.Run(session.Connection.Cancel);
            }
        }

        using (new TurnEnd(session.Turn))
            await ReleaseAsync(session);

        _logger.Information("Sessão {SessionID} fechada.", session.Info.ID);
    }

    /// <summary>RN-SQL-007: cinco minutos sem leitura. Se há um comando rodando na sessão, é ele quem rearma ou fecha o cursor ao terminar.</summary>
    private void OnCursorIdle(Session session)
    {
        if (session.Turn.Wait(0))
            _ = CloseIdleCursorAsync(session);
    }

    private async Task CloseIdleCursorAsync(Session session)
    {
        using var turnEnd = new TurnEnd(session.Turn);

        // O aviso pode chegar atrasado, depois de uma leitura que acabou de rearmar o temporizador: quem decide é a hora da última leitura.
        if (session.Closed || _timeProvider.GetElapsedTime(session.LastReadAt) < QueryPaging.CursorIdleTimeout)
            return;

        await session.Connection.CloseCursorAsync();
        _logger.Information("Sessão {SessionID}: cursor fechado por tempo sem leitura.", session.Info.ID);
        await RemoveIfClosedAsync(session);
    }

    /// <summary>
    /// Com a vez da sessão tomada. A conexão caiu (rede, banco reiniciado, sessão derrubada) ou se fechou porque a transação de uma
    /// leitura não pôde ser encerrada: a sessão sai do registro, e a próxima chamada com este identificador responde que ela não
    /// existe, para a tela abrir outra (seção 7 da especificação).
    /// </summary>
    private async Task RemoveIfClosedAsync(Session session)
    {
        if (session.Connection.IsOpen || !_sessions.TryRemove(session.Info.ID, out _))
            return;

        await ReleaseAsync(session);
        _logger.Information("Sessão {SessionID} fechada: a conexão com o banco não está mais aberta.", session.Info.ID);
    }

    /// <summary>
    /// Uma operação na conexão da sessão, uma de cada vez (RN-SESSAO-002). Executar e carregar mais não esperam: com a sessão ocupada,
    /// `SessionBusy`. As consultas de catálogo esperam a vez, porque a árvore pede vários níveis ao mesmo tempo; quem desiste de esperar
    /// (a requisição foi abortada) recebe uma recusa, e não uma exceção.
    /// </summary>
    private async Task<Result<T, DatabaseFailure>> RunAsync<T>(Guid sessionID, string operation, bool waitsForTurn, Func<Session, Task<Result<T, DatabaseFailure>>> work, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        if (waitsForTurn)
        {
            var turn = session.Turn.WaitAsync(cancellationToken);
            await turn.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);

            if (!turn.IsCompletedSuccessfully)
                return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "A operação foi cancelada antes de chegar a vez dela na sessão.");
        }
        else if (!session.Turn.Wait(0))
            return new DatabaseFailure(EDatabaseFailure.SessionBusy, "A sessão está ocupada com outro comando.");

        using var turnEnd = new TurnEnd(session.Turn);

        // A sessão fechou enquanto esta chamada esperava a vez.
        if (session.Closed)
            return SessionNotFound();

        var started = _timeProvider.GetTimestamp();
        var result = await work(session);
        Log(session, operation, started, result);

        // RN-SQL-007: o temporizador recomeça a cada página que deixa o cursor aberto.
        var cursorOpen = result.IsSuccess && HasOpenCursor(result.Value);
        session.LastReadAt = _timeProvider.GetTimestamp();
        session.IdleTimer.Change(cursorOpen ? QueryPaging.CursorIdleTimeout : Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);

        // A tela recebe a resposta desta chamada (o erro do banco, quando a conexão caiu no meio dela); a seguinte já não encontra a sessão.
        await RemoveIfClosedAsync(session);

        return result;
    }

    /// <summary>RN-LOG-001: a sessão, a operação, a duração, as linhas e o tipo da falha. Nunca o SQL, a mensagem do banco ou um dado de resultado.</summary>
    private void Log<T>(Session session, string operation, long started, Result<T, DatabaseFailure> result)
    {
        var elapsedMs = (long)_timeProvider.GetElapsedTime(started).TotalMilliseconds;

        if (result.IsSuccess)
            _logger.Information("Sessão {SessionID}: {Operation} em {ElapsedMs} ms, {Rows} linhas.", session.Info.ID, operation, elapsedMs, CountRows(result.Value));
        else
            _logger.Information("Sessão {SessionID}: {Operation} falhou em {ElapsedMs} ms ({Failure}, SQLSTATE {SqlState}).", session.Info.ID, operation, elapsedMs, result.Error.Kind, result.Error.SqlState);
    }

    /// <summary>
    /// Uma sessão aberta. Guarda as credenciais (para a contagem abrir outra conexão) e o SQL do último comando, por isso não é um
    /// record: nada aqui se imprime.
    /// </summary>
    private sealed class Session(DatabaseSessionInfo info, ConnectionSettings settings, IDatabaseConnection connection, long vaultGeneration)
    {
        /// <summary>RN-EDIT-002: o resultado do último comando que devolveu linhas, enquanto nenhum outro rodou. Lido pelo `edit-target` sem a vez da sessão.</summary>
        public volatile ResultState? CurrentResult;

        /// <summary>O último comando que devolveu linhas (RN-SQL-006). Lido pela contagem sem a vez da sessão.</summary>
        public volatile RowQuery? LastRowQuery;

        /// <summary>
        /// O que interrompe as contagens em andamento da sessão, que rodam em outras conexões (RN-SQL-010). "Cancelar" troca a fonte por
        /// uma nova depois de cancelar a atual; o fechamento da sessão a cancela de vez.
        /// </summary>
        public CancellationTokenSource CountCancellation = new();

        public volatile bool Closed;

        public DatabaseSessionInfo Info => info;

        public ConnectionSettings Settings => settings;

        public IDatabaseConnection Connection => connection;

        /// <summary>A geração do cofre de onde as credenciais saíram.</summary>
        public long VaultGeneration => vaultGeneration;

        /// <summary>A vez na conexão: um comando por vez.</summary>
        public SemaphoreSlim Turn { get; } = new(1, 1);

        public ITimer IdleTimer { get; set; } = null!;

        /// <summary>O instante da última página lida com a vez tomada, pelo relógio do registro (RN-SQL-007).</summary>
        public long LastReadAt { get; set; }

        /// <summary>
        /// A sessão não atende mais ninguém, e a contagem em andamento para. O cancelamento roda em outra thread: ele fala com o banco, e
        /// quem chama pode ser a thread que fechou o cofre.
        /// </summary>
        public void Close()
        {
            Closed = true;
            _ = Volatile.Read(ref CountCancellation).CancelAsync();

            // RN-SQL-017: a sessão que fecha larga os valores completos do resultado dela.
            CurrentResult?.Cells.Clear();
        }
    }

    /// <summary>
    /// RN-EDIT-002: um resultado da sessão, com o identificador que a página leva (muda a cada execução), o que o texto do comando diz da
    /// edição e as colunas que o banco devolveu. O alvo da edição é consultado na primeira tentativa de editar e fica com ele. RN-SQL-017:
    /// guarda também o valor completo das células cortadas das páginas entregues.
    /// </summary>
    private sealed class ResultState(ResultSource source, IReadOnlyList<QueryColumn> columns)
    {
        private volatile EditTarget? _target;

        public Guid ID { get; } = Guid.CreateVersion7();

        public ResultCells Cells { get; } = new();

        public ResultSource Source => source;

        public IReadOnlyList<QueryColumn> Columns => columns;

        public ResultEditability Editability { get; } = source.Reason is { } reason ? ResultEditability.ReadOnly(reason) : ResultEditability.Unknown;

        public EditTarget? Target
        {
            get => _target;
            set => _target = value;
        }
    }

    /// <summary>O comando e, quando ele gravou e foi executado até o fim (RN-SQL-013), o total de linhas que devolveu. Não é um record: o SQL não se imprime.</summary>
    private sealed class RowQuery(string sql, long? totalRows)
    {
        public string Sql => sql;

        public long? TotalRows => totalRows;
    }

    /// <summary>Devolve a vez da sessão na saída do bloco, também quando o trabalho termina em exceção: sem `try`/`finally`, como no serviço do cofre.</summary>
    private readonly struct TurnEnd(SemaphoreSlim turn) : IDisposable
    {
        public void Dispose()
            => turn.Release();
    }
}
