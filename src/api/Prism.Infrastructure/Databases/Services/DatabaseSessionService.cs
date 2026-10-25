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

    /// <summary>RN-SQL-010: o comando que esperava o fim de uma verificação (RN-VERIF-002) e foi cancelado antes de ir ao banco.</summary>
    private const string CanceledBeforeItRanMessage = "O comando foi cancelado antes de ir ao banco: nada foi executado.";

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

    public Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => TestAsync(settings, null, cancellationToken);

    public async Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, string? verificationQuery, CancellationToken cancellationToken)
    {
        var opened = await ConnectAsync(settings, cancellationToken);
        if (opened.IsFailure)
            return opened.Error;

        // RN-CONN-013: abre, roda a consulta de verificação (a do formulário, RN-VERIF-001, ou a do banco) e fecha, sem registrar sessão.
        await using var connection = opened.Value;

        return await connection.VerifyAsync(verificationQuery, cancellationToken);
    }

    /// <summary>
    /// RN-VERIF-002. A vez é tomada sem esperar (`Wait(0)`), sessão por sessão, e o cursor é conferido na conexão depois de tomá-la: a marca do registro
    /// (`CursorOpen`) é a do temporizador do cursor, e a conexão é quem sabe se ele está aberto. Nada do que a sessão guarda muda (resultado, última
    /// leitura, temporizador): a verificação não é atividade. O log leva a conexão, a sessão, o tempo e a classe da falha, nunca a mensagem nem a
    /// consulta (RN-LOG-001); a que deu certo só em depuração, porque seria uma linha a cada intervalo de cada conexão.
    /// </summary>
    public async Task<ConnectionVerification> VerifyAsync(Guid connectionID, string? verificationQuery, long vaultGeneration, CancellationToken cancellationToken)
    {
        // A sessão sem resultado primeiro: é a da árvore, que só faz catálogo, e a de uma aba sem cursor vem depois. Entre as iguais, a mais antiga.
        var sessions = _sessions.Values
            .Where(session => session.Info.ConnectionID == connectionID && session.VaultGeneration == vaultGeneration)
            .OrderBy(session => session.CurrentResult is null ? 0 : 1)
            .ThenBy(session => session.Info.ID)
            .ToList();

        if (sessions.Count == 0)
        {
            _logger.Debug("Conexão {ConnectionID}: verificação sem sessão aberta.", connectionID);

            return new ConnectionVerification(EVerificationStatus.NotConnected);
        }

        foreach (var session in sessions)
        {
            if (!session.Turn.Wait(0))
                continue;

            using var turnEnd = new TurnEnd(session.Turn);

            // A sessão fechou depois da lista, ou tem um cursor que a consulta fecharia (RN-SQL-007).
            if (session.Closed || session.Connection.HasOpenCursor)
                continue;

            // O comando da pessoa que chega agora espera o fim da verificação, em vez de responder que a sessão está ocupada (`RunAsync`).
            session.Verifying = true;
            var started = _timeProvider.GetTimestamp();
            var verified = await session.Connection.VerifyAsync(verificationQuery, cancellationToken);
            var elapsedMs = (long)_timeProvider.GetElapsedTime(started).TotalMilliseconds;
            session.Verifying = false;

            if (verified.IsSuccess)
                _logger.Debug("Conexão {ConnectionID}: verificação na sessão {SessionID} em {ElapsedMs} ms.", connectionID, session.Info.ID, elapsedMs);
            else
                _logger.Information("Conexão {ConnectionID}: a verificação falhou na sessão {SessionID} em {ElapsedMs} ms ({Failure}, SQLSTATE {SqlState}).", connectionID, session.Info.ID, elapsedMs, verified.Error.Kind, verified.Error.SqlState);

            // A sessão cuja conexão caiu sai do registro, como depois de qualquer falha; a verificação seguinte procura outra.
            await RemoveIfClosedAsync(session);

            return verified.IsSuccess
                ? new ConnectionVerification(EVerificationStatus.Ok, elapsedMs)
                : new ConnectionVerification(EVerificationStatus.Failed, elapsedMs, verified.Error.Message, verified.Error.SqlState);
        }

        _logger.Debug("Conexão {ConnectionID}: verificação adiada, com as {Sessions} sessões ocupadas.", connectionID, sessions.Count);

        return new ConnectionVerification(EVerificationStatus.Busy);
    }

    public Guid? ConnectionOf(Guid sessionID)
        => _sessions.TryGetValue(sessionID, out var session) ? session.Info.ConnectionID : null;

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

    public bool HasSession(Guid connectionID, long vaultGeneration)
        => _sessions.Values.Any(session => session.Info.ConnectionID == connectionID && session.VaultGeneration == vaultGeneration && !session.Closed);

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
        => ExecuteAsync(sessionID, sql, null, pageSize, cancellationToken);

    public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, CancellationToken cancellationToken)
        => ExecuteAsync(sessionID, sql, filter, pageSize, readOnly: false, cancellationToken);

    public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, CancellationToken cancellationToken)
        => ExecuteAsync(sessionID, sql, filter, pageSize, readOnly, [], cancellationToken);

    public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, IReadOnlyCollection<Guid> keep, CancellationToken cancellationToken)
        => ExecuteAsync(sessionID, sql, filter, pageSize, readOnly, keep, [], cancellationToken);

    public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, IReadOnlyCollection<Guid> keep, IReadOnlyList<QueryParameter> parameters, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(ExecuteAsync), waitsForTurn: false, async session =>
        {
            var dialect = DialectOf(session);

            // RN-GRADE-011: o comando montado é o que roda. A recusa do filtro, como a do texto do comando, deixa o resultado anterior como estava.
            // RN-VAR-032: com `params`, o filtro não tem marcador (os marcadores do comando ficam na ordem, e o filtro entra sem marcador).
            FilteredSql? filtered = null;
            if (!string.IsNullOrWhiteSpace(filter))
            {
                if (parameters.Count > 0 && QueryParameterRules.FilterHasMarker(filter, session.Info.Engine))
                    return new DatabaseFailure(EDatabaseFailure.FilterInvalid, QueryParameterRules.FilterMarker);

                var applied = SqlFilter.Apply(sql, filter, dialect);
                if (applied.IsFailure)
                    return applied.Error;

                filtered = applied.Value;
            }

            var sent = filtered?.Sql ?? sql;

            // RN-VAR-032: os marcadores do texto montado contra os valores, e o que o banco não guarda; antes de qualquer coisa ir a ele.
            if (QueryParameterRules.Refusal(sent, session.Info.Engine, parameters, "params") is { } invalid)
                return invalid;

            // RN-PROT-002: na conexão somente leitura, o comando montado que não é uma leitura nem vai ao banco, e o resultado anterior fica.
            if (readOnly && ReadOnlySql.Refusal(sent, session.Info.Engine) is { } reason)
                return new DatabaseFailure(EDatabaseFailure.ConnectionReadOnly, ReadOnlySql.Message(reason));

            var outcome = readOnly ? await session.Connection.ExecuteReadOnlyAsync(sent, pageSize, cancellationToken, parameters) : await session.Connection.ExecuteAsync(sent, pageSize, cancellationToken, parameters);

            // RN-LOG-001 e RN-VAR-036: quantos parâmetros o comando levou, nunca o valor.
            if (parameters.Count > 0)
                _logger.Information("Sessão {SessionID}: {Operation} levou {Parameters} parâmetros.", session.Info.ID, nameof(ExecuteAsync), parameters.Count);

            // RN-SQL-009: a posição do erro seria a do comando montado, que a tela não mostra (como na contagem, RN-SQL-006).
            if (outcome.IsFailure && filtered is not null)
                outcome = outcome.Error with { Position = null };

            // RN-SQL-024: o comando que foi ao banco (deu certo, o banco recusou, ou rodou e foi desfeito) guarda os resultados da lista, entre o
            // atual e os já guardados, antes de o atual ser trocado, e conta, no Db2 e no Informix, o que pode ter trocado o esquema atual da
            // sessão. A recusa pelo texto, antes de executar, não muda nada.
            var ran = outcome.IsSuccess || outcome.Error.Kind == EDatabaseFailure.ExecutionFailed || outcome.Error.Executed;
            if (ran)
            {
                Keep(session, keep);
                if (dialect != ESqlDialect.PostgreSql && EditableSql.MayChangeTheCurrentSchema(sent, dialect))
                    session.SchemaChanges++;
            }

            // RN-SQL-006: "contar total" vale para o último comando que devolveu linhas, mesmo que outros sem linhas venham depois.
            if (outcome.IsSuccess && outcome.Value.Page is { } page)
            {
                session.LastRowQuery = new RowQuery(sent, page.TotalRows, parameters);

                // RN-EDIT-002 e 010: cada execução é um resultado novo, e o que o texto diz da edição dele sai sem consultar o banco. O
                // comando executado até o fim que devolveu linhas gravou (RN-SQL-013): é só leitura. O filtro junto é lido com o comando
                // (a edição vale como sem ele); o embrulhado é só leitura, com o motivo do próprio comando.
                // RN-PROT-002: na conexão somente leitura a página diz o resultado inteiro só leitura, com o motivo que a grade mostra; RN-GRADE-020: o
                // que o texto diz das tabelas fica com o resultado, para o alvo do "Gerar SQL" nela e para a edição quando ela deixar de ser somente leitura.
                var source = page.TotalRows is not null ? ResultSource.ReadOnly(EditableSql.WroteRows)
                    : filtered is { Applied: EFilterApplied.Wrapped } ? ResultSource.ReadOnly(EditableSql.Read(sql, dialect).Reason ?? EditableSql.FilteredOutside)
                    : EditableSql.Read(sent, dialect);
                // RN-EXPORT-001 e 002: exportar executa o comando de novo, numa conexão à parte; só vale para a leitura só, pelo comando montado, que não gravou.
                var read = page.TotalRows is null && ReadOnlySql.ExportRefusal(sent, session.Info.Engine) is null;
                var result = new ResultState(source, page.Columns, session.SchemaChanges, filtered?.Applied, read, readOnly ? ReadOnlySql.ResultReason : null, sent, parameters);
                var withoutFullValue = result.Cells.Add(page);
                ReplaceResult(session, result);

                return outcome.Value with { Page = page with { ResultID = result.ID, Editable = result.Editability, FullValues = null, CellsWithoutFullValue = withoutFullValue, FilterApplied = result.FilterApplied, Read = result.Read } };
            }

            // O comando que rodou deixa a sessão sem resultado (RN-SQL-017: e larga os valores completos dele); a recusa pelo texto, antes
            // de executar, deixa o anterior como estava.
            if (ran)
                ReplaceResult(session, null);

            return outcome;
        }, cancellationToken);

    public string? FilterRefusal(Guid sessionID, string? filter)
        => FilterRefusal(sessionID, filter, withParameters: false);

    public string? FilterRefusal(Guid sessionID, string? filter, bool withParameters)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return null;

        if (withParameters && !string.IsNullOrWhiteSpace(filter) && QueryParameterRules.FilterHasMarker(filter, session.Info.Engine))
            return QueryParameterRules.FilterMarker;

        return SqlFilter.Refusal(filter, DialectOf(session));
    }

    public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(Guid sessionID, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(FetchNextAsync), waitsForTurn: false, async session =>
        {
            var page = await session.Connection.FetchNextAsync(cancellationToken);
            if (page.IsFailure)
                return page;

            // RN-SQL-017: a página continua a contagem das linhas do resultado, e o valor completo das cortadas fica com ele.
            return session.CurrentResult is { } result
                ? page.Value with { ResultID = result.ID, Editable = result.Editability, FullValues = null, CellsWithoutFullValue = result.Cells.Add(page.Value), FilterApplied = result.FilterApplied, Read = result.Read }
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
        var total = await connection.CountAsync(query.Sql, counting.Token, query.Parameters);
        Log(session, nameof(CountAsync), started, total);

        return total;
    }

    public UnitResult<DatabaseFailure> Cancel(Guid sessionID)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        // RN-SQL-010: a contagem em andamento é interrompida; a seguinte usa uma fonte nova, e não nasce cancelada.
        _ = Interlocked.Exchange(ref session.CountCancellation, new CancellationTokenSource()).CancelAsync();

        // RN-VERIF-002: o comando que espera o fim de uma verificação desiste na hora, pela fonte acima, e o contador pega o "cancelar" que chega
        // junto com a vez dele. A verificação em si não é interrompida: não é dela que a pessoa desistiu.
        Interlocked.Increment(ref session.CancelRequests);

        // Só com comando em andamento: sem ele não há o que interromper, e um cursor aberto e parado fica como está.
        if (session.Turn.CurrentCount == 0 && !session.Verifying)
            session.Connection.Cancel();

        return UnitResult.Success<DatabaseFailure>();
    }

    public async Task<Result<EditTarget, DatabaseFailure>> GetEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        var result = EditableResult(session, resultID);
        if (result.IsFailure)
            return result.Error;

        return await TargetOfAsync(session, result.Value, catalogSessionID, keep: true, cancellationToken);
    }

    public async Task<Result<EditTarget, DatabaseFailure>> GetReadOnlyEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, string reason, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        var result = EditableResult(session, resultID);
        if (result.IsFailure)
            return result.Error;

        return (await TargetOfAsync(session, result.Value, catalogSessionID, keep: false, cancellationToken)).Map(target => EditTargetResolver.ReadOnly(target, reason));
    }

    public async Task<Result<EditPreview, DatabaseFailure>> PreviewEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionID, out var session))
            return SessionNotFound();

        var found = EditableResult(session, resultID);
        if (found.IsFailure)
            return found.Error;

        var whole = WholeColumnSql.Find(changes);
        if (whole.IsFailure)
            return whole.Error;

        var result = found.Value;
        var target = await TargetOfAsync(session, result, catalogSessionID: null, keep: true, cancellationToken);
        if (target.IsFailure)
            return target.Error;

        // RN-EDIT-023: a contagem e o `UPDATE` da coluna inteira vêm antes dos comandos por linha, como o "Salvar" os executa.
        var dialect = DialectOf(session);
        IReadOnlyList<EditStatement> first = [];
        if (whole.Value is { } index)
        {
            var statements = WholeColumnSql.Preview(dialect, result.Sql, result.Read, target.Value, result.Columns, changes[index], index, result.Parameters);
            if (statements.IsFailure)
                return statements.Error;

            first = statements.Value;
        }

        var preview = EditPlanner.Preview(dialect, target.Value, result.Columns, changes);

        return preview.IsFailure ? preview.Error : preview.Value with { Statements = [.. first, .. preview.Value.Statements] };
    }

    /// <summary>
    /// RN-EDIT-005: o alvo de antes é o que o `edit-target` respondeu (sem ele, o catálogo é consultado aqui, na própria sessão, cujo
    /// cursor o "Salvar" fecha de qualquer jeito). As pendências são conferidas contra ele antes de ir ao banco; dentro da transação, o
    /// catálogo é consultado de novo, e um alvo diferente (a tabela mudou, ou o esquema atual da sessão leva a outra) não executa nada.
    /// RN-SQL-024: o resultado pode ser um guardado; o "Salvar" dele fecha o cursor do atual como qualquer comando, e não troca nenhum dos dois.
    /// </summary>
    public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(ApplyEditsAsync), waitsForTurn: false, async session =>
        {
            var whole = WholeColumnSql.Find(changes);
            if (whole.IsFailure)
                return whole.Error;

            var found = EditableResult(session, resultID);
            if (found.IsFailure)
                return found.Error;

            var result = found.Value;
            var dialect = DialectOf(session);
            var tables = TablesOf(result);
            var expected = await ExpectedTargetAsync(session, result, cancellationToken);
            if (expected.IsFailure)
                return expected.Error;

            var planned = Plan(dialect, result, expected.Value, changes, whole.Value);
            if (planned.IsFailure)
                return planned.Error;

            var saved = await session.Connection.ApplyEditsAsync(tables, expected.Value.OneAtATime, whole.Value is not null, catalogs =>
            {
                var now = EditTargetResolver.Resolve(dialect, result.Source, result.Columns, catalogs);
                if (now.IsFailure || !EditTargetResolver.Same(expected.Value, now.Value))
                    return Result.Failure<EditPlan, DatabaseFailure>(TableChanged(expected.Value, now));

                return Plan(dialect, result, now.Value, changes, whole.Value);
            }, cancellationToken);

            // RN-EDIT-021 e RN-LOG-001: os IDs e o número de linhas da coluna inteira, nunca o comando, os nomes nem os valores.
            if (saved.IsSuccess && whole.Value is { } index)
                _logger.Information("Sessão {SessionID}: a coluna inteira do resultado {ResultID} alterou {Rows} linhas.", session.Info.ID, resultID, changes[index].Rows);

            return saved;
        }, cancellationToken);

    /// <summary>
    /// RN-EDIT-019, 020 e 023: a contagem da pergunta da coluna inteira, na sessão do resultado, como o "Salvar": a conferência das alterações antes do
    /// banco, e a do catálogo na própria sessão, dentro da contagem (a tabela que mudou, ou o nome sem esquema que leva agora a outra, RN-SQL-024).
    /// </summary>
    public Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken)
        => RunAsync(sessionID, nameof(CountWholeColumnAsync), waitsForTurn: false, async session =>
        {
            var only = WholeColumnSql.OnlyOne(changes);
            if (only.IsFailure)
                return only.Error;

            var found = EditableResult(session, resultID);
            if (found.IsFailure)
                return found.Error;

            var result = found.Value;
            var dialect = DialectOf(session);
            var index = only.Value;
            var expected = await ExpectedTargetAsync(session, result, cancellationToken);
            if (expected.IsFailure)
                return expected.Error;

            var planned = WholeColumnSql.Plan(dialect, result.Sql, result.Read, expected.Value, result.Columns, changes[index], index, requiresRows: false, result.Parameters);
            if (planned.IsFailure)
                return planned.Error;

            return await session.Connection.CountWholeColumnAsync(TablesOf(result), catalogs =>
            {
                var now = EditTargetResolver.Resolve(dialect, result.Source, result.Columns, catalogs);
                if (now.IsFailure || !EditTargetResolver.Same(expected.Value, now.Value))
                    return Result.Failure<WholeColumnPlan, DatabaseFailure>(TableChanged(expected.Value, now));

                return WholeColumnSql.Plan(dialect, result.Sql, result.Read, now.Value, result.Columns, changes[index], index, requiresRows: false, result.Parameters);
            }, cancellationToken);
        }, cancellationToken);

    /// <summary>
    /// RN-EDIT-005: o alvo de antes é o que o `edit-target` respondeu (sem ele, o catálogo é consultado aqui, na própria sessão, cujo cursor o "Salvar" e a
    /// contagem fecham de qualquer jeito). O resultado inteiro só leitura é a recusa do texto, sem ir ao banco.
    /// </summary>
    private static async Task<Result<EditTarget, DatabaseFailure>> ExpectedTargetAsync(Session session, ResultState result, CancellationToken cancellationToken)
    {
        var dialect = DialectOf(session);
        if (result.Source.Tables.Count == 0)
            return EditTargetResolver.Resolve(dialect, result.Source, result.Columns, null).Error;

        if (result.Target is { } known)
            return known;

        var described = await session.Connection.DescribeEditTablesAsync(TablesOf(result), cancellationToken);
        if (described.IsFailure)
            return described.Error;

        var resolved = EditTargetResolver.Resolve(dialect, result.Source, result.Columns, described.Value);
        if (resolved.IsSuccess)
            result.Target = resolved.Value;

        return resolved;
    }

    /// <summary>RN-EDIT-005 e 021: a coluna inteira (no "Salvar", com o número de linhas confirmado) e os comandos por linha, contra o alvo dado.</summary>
    private static Result<EditPlan, DatabaseFailure> Plan(ESqlDialect dialect, ResultState result, EditTarget target, IReadOnlyList<EditChange> changes, int? whole)
    {
        WholeColumnPlan? wholeColumn = null;
        if (whole is { } index)
        {
            var planned = WholeColumnSql.Plan(dialect, result.Sql, result.Read, target, result.Columns, changes[index], index, requiresRows: true, result.Parameters);
            if (planned.IsFailure)
                return planned.Error;

            wholeColumn = planned.Value;
        }

        var commands = EditPlanner.Plan(dialect, target, result.Columns, changes);

        return commands.IsFailure ? commands.Error : new EditPlan(wholeColumn, commands.Value);
    }

    /// <summary>RN-SESSAO-004: a API encerrando fecha as sessões. O contêiner descarta o serviço no desligamento, antes do cofre, de quem ele depende.</summary>
    public async ValueTask DisposeAsync()
    {
        _vault.Locked -= OnVaultLocked;
        await CloseAllAsync();
    }

    private static DatabaseFailure SessionNotFound()
        => new(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada.");

    private static DatabaseFailure ResultChanged()
        => new(EDatabaseFailure.ResultChanged, "O resultado não está mais guardado na sessão: outro comando foi executado nela depois dele. Execute o comando de novo para editar.");

    /// <summary>
    /// RN-SQL-024: o resultado que a edição pede, o atual ou um dos guardados. Um que não é nenhum dos dois é `ResultChanged`. No Db2 e no
    /// Informix, o guardado que lê uma tabela escrita sem esquema também é, quando a sessão executou depois dele um comando que pode ter
    /// trocado o esquema atual (ou o banco, no Informix): a tabela que o nome leva agora pode ser outra, e o driver não diz o esquema sem uma
    /// consulta. Na dúvida, recusa. O atual nunca tem comando depois dele: o seguinte o substitui.
    /// </summary>
    private static Result<ResultState, DatabaseFailure> EditableResult(Session session, Guid resultID)
    {
        var result = session.CurrentResult is { } current && current.ID == resultID ? current : session.Kept.GetValueOrDefault(resultID);
        if (result is null)
            return ResultChanged();

        if (DialectOf(session) == ESqlDialect.PostgreSql || result.SchemaChanges == session.SchemaChanges)
            return result;

        return result.Source.Tables.FirstOrDefault(table => table.Name.Schema is null) is { } unqualified
            ? new DatabaseFailure(EDatabaseFailure.ResultChanged, $"Um comando executado depois deste resultado (como um SET ou um CALL) pode ter trocado o esquema atual da sessão, e {unqualified.Name.Name}, escrita sem esquema, pode ser outra tabela agora. Nada foi gravado; escreva o esquema no comando (esquema.tabela), ou execute-o de novo.")
            : result;
    }

    /// <summary>
    /// RN-SQL-024: com a vez da sessão tomada, quando o comando foi ao banco. Ficam guardados, entre o resultado atual e os já guardados, os da
    /// lista (o identificador que a sessão não conhece é ignorado, e o repetido conta uma vez); os outros são esquecidos. Os valores completos
    /// do atual saem da memória quando ele é trocado (<see cref="ReplaceResult"/>): o guardado leva só o que a edição precisa.
    /// </summary>
    private static void Keep(Session session, IReadOnlyCollection<Guid> keep)
    {
        var kept = new Dictionary<Guid, ResultState>();
        foreach (var resultID in keep)
        {
            var result = session.CurrentResult is { } current && current.ID == resultID ? current : session.Kept.GetValueOrDefault(resultID);
            if (result is not null)
                kept.TryAdd(resultID, result);
        }

        session.Kept = kept;
    }

    /// <summary>
    /// RN-EDIT-005: o catálogo de dentro da transação não é o da consulta. Nada foi executado. Diz a primeira tabela do `FROM` que mudou
    /// (a que agora é outra, pelo esquema atual da sessão, ou a de chave, colunas ou tipos diferentes).
    /// </summary>
    private static DatabaseFailure TableChanged(EditTarget expected, Result<EditTarget, DatabaseFailure> now)
    {
        var changed = expected.Tables[0];
        for (var index = 0; now.IsSuccess && index < expected.Tables.Count; index++)
        {
            var before = expected.Tables[index];
            if (index >= now.Value.Tables.Count)
                break;

            var table = now.Value.Tables[index];
            if (table.Schema != before.Schema || table.Name != before.Name)
                return new DatabaseFailure(EDatabaseFailure.ResultChanged, $"O comando agora lê outra tabela ({table.Schema}.{table.Name}, e não {before.Schema}.{before.Name}): o esquema atual da sessão mudou desde a consulta. Nada foi gravado; execute o comando de novo.");

            var position = index;
            if (table.Editable != before.Editable || !table.Key.SequenceEqual(before.Key) || !expected.Columns.Where(column => column.Table == position).SequenceEqual(now.Value.Columns.Where(column => column.Table == position)))
            {
                changed = before;
                break;
            }
        }

        return new DatabaseFailure(EDatabaseFailure.ResultChanged, $"A tabela {changed.Name} mudou desde a consulta (a chave, as colunas ou o tipo delas). Nada foi gravado; execute o comando de novo.");
    }

    /// <summary>RN-EDIT-003: as tabelas do `FROM` e, no PostgreSQL, as que a resposta do comando diz de onde vêm as colunas.</summary>
    private static EditTables TablesOf(ResultState result)
        => new([.. result.Source.Tables.Select(table => table.Name)], [.. result.Columns.Select(column => column.Origin?.Table ?? 0).Where(table => table != 0).Distinct()]);

    private static ESqlDialect DialectOf(Session session)
        => session.Info.Engine switch
        {
            EDatabaseEngine.Db2 => ESqlDialect.Db2,
            EDatabaseEngine.Informix => ESqlDialect.Informix,
            _ => ESqlDialect.PostgreSql
        };

    /// <summary>
    /// RN-EDIT-010: o alvo da edição de um resultado, consultado uma vez e guardado com ele. O resultado inteiro só leitura responde
    /// sem ir ao banco. Sem `keep` (o "Gerar SQL" numa conexão somente leitura, RN-GRADE-020), o alvo consultado não fica guardado; o que já estava, serve.
    /// </summary>
    private async Task<Result<EditTarget, DatabaseFailure>> TargetOfAsync(Session session, ResultState result, Guid? catalogSessionID, bool keep, CancellationToken cancellationToken)
    {
        if (result.Target is { } known)
            return known;

        var dialect = DialectOf(session);
        if (result.Source.Tables.Count == 0)
            return EditTargetResolver.Resolve(dialect, result.Source, result.Columns, null);

        var started = _timeProvider.GetTimestamp();
        var catalog = await DescribeElsewhereAsync(session, TablesOf(result), catalogSessionID, cancellationToken);
        var target = catalog.IsFailure ? catalog.Error : EditTargetResolver.Resolve(dialect, result.Source, result.Columns, catalog.Value);
        Log(session, nameof(GetEditTargetAsync), started, target);

        if (keep && target.IsSuccess)
            result.Target = target.Value;

        return target;
    }

    /// <summary>
    /// RN-EDIT-010: o catálogo da edição nunca vai na sessão do resultado, que pode ter o cursor aberto. Vai na sessão da árvore (a da
    /// mesma conexão, do mesmo banco e do mesmo cofre), esperando a vez como qualquer consulta de catálogo; sem ela, numa conexão à
    /// parte, com as credenciais da sessão e prazo de espera de trava, que o "cancelar" e o fechamento da sessão interrompem como a
    /// contagem.
    /// </summary>
    private async Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeElsewhereAsync(Session session, EditTables tables, Guid? catalogSessionID, CancellationToken cancellationToken)
    {
        if (catalogSessionID is { } catalogID && catalogID != session.Info.ID && _sessions.TryGetValue(catalogID, out var tree) && tree.Info.ConnectionID == session.Info.ConnectionID && tree.Info.Database == session.Info.Database && tree.VaultGeneration == session.VaultGeneration)
        {
            var described = await RunAsync(catalogID, nameof(DescribeElsewhereAsync), waitsForTurn: true, other => other.Connection.DescribeEditTablesAsync(tables, cancellationToken), cancellationToken);
            if (described.IsSuccess || described.Error.Kind != EDatabaseFailure.SessionNotFound)
                return described;
        }

        using var describing = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, session.CountCancellation.Token);
        var opened = await ConnectAsync(session.Settings, describing.Token);
        if (opened.IsFailure)
            return opened.Error;

        await using var connection = opened.Value;
        var limited = await connection.LimitLockWaitAsync(describing.Token);

        return limited.IsFailure ? limited.Error : await connection.DescribeEditTablesAsync(tables, describing.Token);
    }

    /// <summary>RN-SQL-007: a operação leu uma página e deixou o cursor aberto, porque há mais linhas. É a única leitura que o temporizador conta.</summary>
    private static bool LeftTheCursorOpen(object? value)
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

        // O aviso pode chegar atrasado: depois de uma operação que fechou o cursor (sem cursor vigiado, não há o que fechar) ou de uma
        // página que acabou de rearmar o temporizador (quem decide é a hora dessa leitura).
        if (session.Closed || !session.CursorOpen)
            return;

        await CloseCursorIfIdleAsync(session);
        await RemoveIfClosedAsync(session);
    }

    /// <summary>
    /// RN-SQL-007, com a vez da sessão tomada e o cursor vigiado aberto: quem decide é a hora da última leitura, e não a do aviso nem a
    /// da operação que acabou. O aviso pode chegar adiantado uns milissegundos em relação a esse relógio: antes da hora, o temporizador
    /// volta a contar o que falta (sem isso, o aviso adiantado deixava o cursor aberto até a sessão fechar). Passada a hora, o cursor fecha.
    /// </summary>
    private async Task CloseCursorIfIdleAsync(Session session)
    {
        var idle = _timeProvider.GetElapsedTime(session.LastReadAt);
        if (idle < QueryPaging.CursorIdleTimeout)
        {
            session.IdleTimer.Change(QueryPaging.CursorIdleTimeout - idle, Timeout.InfiniteTimeSpan);

            return;
        }

        session.CursorOpen = false;
        await session.Connection.CloseCursorAsync();
        _logger.Information("Sessão {SessionID}: cursor fechado por tempo sem leitura.", session.Info.ID);
    }

    /// <summary>
    /// RN-SQL-007, com a vez da sessão tomada, no fim de cada operação. Só a página que deixa o cursor aberto é leitura: o temporizador
    /// recomeça a contar dela. Se a operação não leu e o cursor vigiado continua aberto na conexão, ela não chegou a ele (a recusa
    /// antes de ir ao banco: a da conexão somente leitura, RN-PROT-002, o filtro, o controle de transação, mais de um comando; e
    /// qualquer outra que venha a existir), e o prazo continua o da última leitura. Ele é conferido aqui, e não só deixado como estava:
    /// o aviso que chegou enquanto esta operação tinha a vez desistiu, contando com ela (<see cref="OnCursorIdle"/>), e, se o prazo já
    /// passou, o cursor fecha agora. O resto fechou o cursor (todo comando que vai ao banco fecha o anterior antes de ser enviado, e a
    /// falha, o cancelamento e a queda da conexão também), e o temporizador para.
    /// </summary>
    private async Task WatchCursorAsync<T>(Session session, Result<T, DatabaseFailure> result)
    {
        if (result.IsSuccess && LeftTheCursorOpen(result.Value))
        {
            session.LastReadAt = _timeProvider.GetTimestamp();
            session.CursorOpen = true;
            session.IdleTimer.Change(QueryPaging.CursorIdleTimeout, Timeout.InfiniteTimeSpan);

            return;
        }

        if (session.CursorOpen && session.Connection.HasOpenCursor)
        {
            await CloseCursorIfIdleAsync(session);

            return;
        }

        session.CursorOpen = false;
        session.IdleTimer.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
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
        {
            if (!session.Verifying)
                return new DatabaseFailure(EDatabaseFailure.SessionBusy, "A sessão está ocupada com outro comando.");

            // RN-VERIF-002: a verificação periódica não é comando da pessoa, e não a deixa com a sessão ocupada: o comando espera o fim dela, que tem o
            // prazo do driver. O "cancelar" pedido durante a espera vale para ele, que desiste na hora, sem ir ao banco: a fonte que o "cancelar" e o
            // fechamento da sessão cancelam interrompe a espera. O contador pega o "cancelar" que chega junto com a vez, depois da espera.
            var canceled = Volatile.Read(ref session.CancelRequests);
            using var waiting = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, session.CountCancellation.Token);
            var afterTheVerification = session.Turn.WaitAsync(waiting.Token);
            await afterTheVerification.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);

            if (!afterTheVerification.IsCompletedSuccessfully)
            {
                if (session.Closed)
                    return SessionNotFound();

                return cancellationToken.IsCancellationRequested
                    ? new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "A operação foi cancelada antes de chegar a vez dela na sessão.")
                    : new DatabaseFailure(EDatabaseFailure.ExecutionFailed, CanceledBeforeItRanMessage, Outcome: ECancelOutcome.Canceled);
            }

            if (Volatile.Read(ref session.CancelRequests) != canceled)
            {
                session.Turn.Release();

                return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, CanceledBeforeItRanMessage, Outcome: ECancelOutcome.Canceled);
            }
        }

        using var turnEnd = new TurnEnd(session.Turn);

        // A sessão fechou enquanto esta chamada esperava a vez.
        if (session.Closed)
            return SessionNotFound();

        var started = _timeProvider.GetTimestamp();
        var result = await work(session);
        Log(session, operation, started, result);
        await WatchCursorAsync(session, result);

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

        /// <summary>
        /// RN-SQL-024: os resultados de antes que a tela pediu para continuar editando (as abas do script), pelo `resultID`, sem as linhas, sem
        /// cursor e sem os valores completos. Trocado inteiro, com a vez tomada, por quem executa; lido pelo `edit-target` sem a vez.
        /// </summary>
        public volatile IReadOnlyDictionary<Guid, ResultState> Kept = new Dictionary<Guid, ResultState>();

        /// <summary>
        /// RN-SQL-024: quantos comandos que podem trocar o esquema atual da sessão (`SET`, `CALL`, `EXECUTE` e, no Informix, `DATABASE`) ela
        /// executou, no Db2 e no Informix. Cada resultado guarda o número de quando foi lido; um guardado com número menor teve um deles depois.
        /// </summary>
        public volatile int SchemaChanges;

        /// <summary>O último comando que devolveu linhas (RN-SQL-006). Lido pela contagem sem a vez da sessão.</summary>
        public volatile RowQuery? LastRowQuery;

        /// <summary>
        /// O que interrompe as contagens em andamento da sessão, que rodam em outras conexões (RN-SQL-010), e a espera do comando pelo fim
        /// de uma verificação (RN-VERIF-002). "Cancelar" troca a fonte por uma nova depois de cancelar a atual; o fechamento da sessão a
        /// cancela de vez.
        /// </summary>
        public CancellationTokenSource CountCancellation = new();

        public volatile bool Closed;

        /// <summary>RN-VERIF-002: a vez está com a verificação periódica, e não com um comando da pessoa: quem chega espera, em vez de ouvir "ocupada".</summary>
        public volatile bool Verifying;

        /// <summary>
        /// RN-SQL-010: quantos "cancelar" a sessão recebeu. O comando que esperava a verificação compara antes e depois da espera: pega o
        /// "cancelar" que chegou junto com a vez, que a fonte (<see cref="CountCancellation"/>) já não interrompe.
        /// </summary>
        public int CancelRequests;

        public DatabaseSessionInfo Info => info;

        public ConnectionSettings Settings => settings;

        public IDatabaseConnection Connection => connection;

        /// <summary>A geração do cofre de onde as credenciais saíram.</summary>
        public long VaultGeneration => vaultGeneration;

        /// <summary>A vez na conexão: um comando por vez.</summary>
        public SemaphoreSlim Turn { get; } = new(1, 1);

        public ITimer IdleTimer { get; set; } = null!;

        /// <summary>
        /// O instante da última página que deixou o cursor aberto, pelo relógio do registro (RN-SQL-007). Os cinco minutos contam dele: a
        /// operação que não leu (uma recusa antes de ir ao banco) não o muda.
        /// </summary>
        public long LastReadAt { get; set; }

        /// <summary>Há um cursor aberto, que o temporizador da RN-SQL-007 vigia: uma página o abriu, e nenhuma operação depois dela o fechou.</summary>
        public bool CursorOpen { get; set; }

        /// <summary>
        /// A sessão não atende mais ninguém, e a contagem em andamento para. O cancelamento roda em outra thread: ele fala com o banco, e
        /// quem chama pode ser a thread que fechou o cofre.
        /// </summary>
        public void Close()
        {
            Closed = true;
            _ = Volatile.Read(ref CountCancellation).CancelAsync();

            // RN-SQL-017: a sessão que fecha larga os valores completos do resultado dela; RN-SQL-024: e os guardados morrem com ela.
            CurrentResult?.Cells.Clear();
            Kept = new Dictionary<Guid, ResultState>();
        }
    }

    /// <summary>
    /// RN-EDIT-002: um resultado da sessão, com o identificador que a página leva (muda a cada execução), o que o texto do comando diz da
    /// edição e as colunas que o banco devolveu. O alvo da edição é consultado na primeira tentativa de editar e fica com ele. RN-SQL-017:
    /// guarda também o valor completo das células cortadas das páginas entregues, enquanto é o atual.
    /// </summary>
    /// <param name="schemaChanges">RN-SQL-024: o <see cref="Session.SchemaChanges"/> da sessão quando o resultado foi lido.</param>
    /// <param name="filterApplied">RN-GRADE-011: como o filtro entrou no comando do resultado; nulo sem filtro.</param>
    /// <param name="read">RN-EXPORT-002: o comando do resultado, com o filtro, é uma leitura só e não gravou: o resultado inteiro se exporta.</param>
    /// <param name="sql">RN-EDIT-023: o comando executado, com o filtro junto.</param>
    /// <param name="parameters">RN-VAR-033: os valores dos marcadores do comando.</param>
    /// <param name="readOnlyReason">
    /// RN-PROT-002: o motivo da conexão somente leitura em que o resultado foi lido, que a página leva no lugar do que o texto diz. Não muda o
    /// <paramref name="source"/>: o alvo do "Gerar SQL" nela (RN-GRADE-020) e o da edição, quando ela deixa de ser somente leitura, saem dele. Quem recusa
    /// a edição na conexão somente leitura é a rota, pela opção de agora.
    /// </param>
    private sealed class ResultState(ResultSource source, IReadOnlyList<QueryColumn> columns, int schemaChanges, EFilterApplied? filterApplied = null, bool read = false, string? readOnlyReason = null, string? sql = null, IReadOnlyList<QueryParameter>? parameters = null)
    {
        public bool Read => read;

        /// <summary>
        /// RN-VAR-033 e 036: os valores dos marcadores do <see cref="Sql"/>, na ordem do texto, só na memória da sessão (até 4 MiB, nunca no disco nem no log): vão de novo
        /// em tudo o que executa o comando outra vez (a coluna inteira), e morrem com o resultado.
        /// </summary>
        public IReadOnlyList<QueryParameter> Parameters => parameters ?? [];

        /// <summary>
        /// RN-EDIT-023: o comando como a API o executou, com o filtro do resultado já junto, só na memória (nunca no disco nem no log): é o `<Q>` da coluna
        /// inteira (RN-EDIT-020).
        /// </summary>
        public string? Sql => sql;

        public int SchemaChanges => schemaChanges;

        private volatile EditTarget? _target;

        public Guid ID { get; } = Guid.CreateVersion7();

        public ResultCells Cells { get; } = new();

        public ResultSource Source => source;

        public IReadOnlyList<QueryColumn> Columns => columns;

        public ResultEditability Editability { get; } = (readOnlyReason ?? source.Reason) is { } reason ? ResultEditability.ReadOnly(reason) : ResultEditability.Unknown;

        public EFilterApplied? FilterApplied => filterApplied;

        public EditTarget? Target
        {
            get => _target;
            set => _target = value;
        }
    }

    /// <summary>O comando e, quando ele gravou e foi executado até o fim (RN-SQL-013), o total de linhas que devolveu. Não é um record: o SQL não se imprime.</summary>
    private sealed class RowQuery(string sql, long? totalRows, IReadOnlyList<QueryParameter> parameters)
    {
        public string Sql => sql;

        /// <summary>RN-VAR-033: os valores dos marcadores do comando, que a contagem leva de novo.</summary>
        public IReadOnlyList<QueryParameter> Parameters => parameters;

        public long? TotalRows => totalRows;
    }

    /// <summary>Devolve a vez da sessão na saída do bloco, também quando o trabalho termina em exceção: sem `try`/`finally`, como no serviço do cofre.</summary>
    private readonly struct TurnEnd(SemaphoreSlim turn) : IDisposable
    {
        public void Dispose()
            => turn.Release();
    }
}
