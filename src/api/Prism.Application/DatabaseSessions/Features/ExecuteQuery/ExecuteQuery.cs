using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Application.Journal;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.ExecuteQuery;

/// <summary>
/// RN-SQL-001 e 003: um comando, enviado ao banco como está. A sessão vem da rota, e o `[JsonIgnore]` impede que o corpo a escolha: o
/// controller completa o comando com `with { SessionID = id }`.
/// </summary>
public sealed record ExecuteQueryCommand : IRequest<Result<QueryResultDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public string Sql { get; init; } = string.Empty;

    /// <summary>
    /// RN-SQL-016: as linhas por busca, de 50 a 1000; ausente (ou nulo), 200. Chega como o JSON que veio, e não como inteiro, para o
    /// texto e o número com casas serem recusados pelo validator com `QUERY_INVALID` no campo, como o SQL vazio: lidos como inteiro, o
    /// MVC os recusaria antes, com 400 e em outro formato.
    /// </summary>
    public JsonElement? PageSize { get; init; }

    /// <summary>
    /// RN-GRADE-011: o filtro do resultado, o texto do campo (condição, ordem ou as duas, como na RN-TABELA-010), que a API junta ao
    /// comando ou põe por fora dele. Ausente, nulo ou só de espaços, o comando vai sem filtro.
    /// </summary>
    public string? Filter { get; init; }

    /// <summary>
    /// RN-SQL-024: os `resultID` que a aba continua mostrando, e editando, depois deste comando (as abas do script), até 20. Chega como o JSON
    /// que veio, como o `PageSize`, para a entrada que não é um identificador ser recusada pelo validator com `QUERY_INVALID` no campo.
    /// Ausente, nula ou vazia, a sessão esquece os resultados guardados quando o comando vai ao banco.
    /// </summary>
    public JsonElement? Keep { get; init; }

    /// <summary>
    /// RN-VAR-032: os valores dos marcadores do comando (`$1`, `$2`... ou `?`), na ordem do texto, cada um `{ type, value }` (`type` em `text`, `number`, `boolean`,
    /// `date` ou `timestamp`; `value` um texto, ou nulo). Chega como o JSON que veio, como o `Keep`, para a forma errada ser `QUERY_INVALID` no campo
    /// (`params[3].value`). Ausente, nulo ou vazio, o comando vai como antes, sem parâmetros. Os valores são do usuário: nunca vão ao log (RN-VAR-036).
    /// </summary>
    public JsonElement? Params { get; init; }

    /// <summary>
    /// RN-AUDIT-001 e 002: de onde o comando partiu (`editor`, `script`, `values`, `statement`, `rerun`, `filter`, `auto-refresh`, `other`, `records`, `ddl` ou `build`).
    /// Ausente ou nulo, vale `other`. Só `editor`, `script`, `values` e `statement` entram na lista do Histórico (`RN-HIST-002`).
    /// </summary>
    public string? Origin { get; init; }

    /// <summary>
    /// RN-AUDIT-001 e RN-HIST-002: quando o comando tinha `@nome` que a tela trocou por `$1`/`?`, o texto antes da troca, para o Histórico
    /// devolver ao editor o que a pessoa escreveu. Sem variáveis, ausente ou nulo.
    /// </summary>
    public string? HistoryText { get; init; }

    /// <summary>RN-AUDIT-001: a pessoa confirmou o aviso de comando irreversível antes desta execução.</summary>
    public bool Confirmed { get; init; }

    /// <summary>RN-AUDIT-002 e 013: o identificador da execução de um script (Alt+X), comum aos comandos do mesmo script.</summary>
    public Guid? ScriptRunID { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e o SQL do usuário pode ter dado sensível.</summary>
    public override string ToString() => nameof(ExecuteQueryCommand);

    /// <summary>RN-SQL-024: os identificadores de `Keep`, já conferidos pelo validator; o repetido conta uma vez.</summary>
    internal IReadOnlyCollection<Guid> KeptResults()
        => Keep is { ValueKind: JsonValueKind.Array } keep ? [.. keep.EnumerateArray().Select(entry => entry.GetGuid()).Distinct()] : [];
}

internal sealed class ExecuteQueryHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService? vaultService = null, IJournalRecorder? journalRecorder = null) : IRequestHandler<ExecuteQueryCommand, Result<QueryResultDto, ApiErrorDto>>
{
    private static readonly ConcurrentDictionary<Guid, string> LastAutoRefresh = new();

    /// <summary>
    /// O validator já recusou o que não é um inteiro da faixa (aqui só há o número ou a falta dele) e o filtro que não se junta ao
    /// comando. Sem filtro (nulo ou só de espaços), o comando vai como veio. RN-PROT-002 e 006: a conexão somente leitura é a do cofre agora,
    /// e o registro de sessões recusa o que não é leitura antes de ir ao banco. RN-SQL-024: os resultados de `keep` continuam guardados para a
    /// edição quando o comando vai ao banco, e os outros saem.
    /// </summary>
    public async Task<Result<QueryResultDto, ApiErrorDto>> Handle(ExecuteQueryCommand request, CancellationToken cancellationToken)
    {
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<QueryResultDto, ApiErrorDto>(readOnly.Error);

        var pageSize = request.PageSize is { ValueKind: JsonValueKind.Number } size ? size.GetInt32() : QueryPaging.DefaultPageSize;
        var filter = string.IsNullOrWhiteSpace(request.Filter) ? null : request.Filter;
        var parameters = QueryParameterRules.Read(request.Params);
        var origin = string.IsNullOrWhiteSpace(request.Origin) ? "other" : request.Origin;

        // RN-AUDIT-002: na atualização automática, a primeira execução com aquele texto e filtro entra no diário; as seguintes com o mesmo texto e filtro não.
        var shouldRecord = journalRecorder is not null;
        if (shouldRecord && origin == "auto-refresh")
        {
            var autoRefreshKey = $"{request.Sql}\0{filter}";
            if (LastAutoRefresh.TryGetValue(request.SessionID, out var last) && last == autoRefreshKey)
                shouldRecord = false;
            else
                LastAutoRefresh[request.SessionID] = autoRefreshKey;
        }
        else if (shouldRecord)
        {
            LastAutoRefresh.TryRemove(request.SessionID, out _);
        }

        var entryId = -1L;
        if (shouldRecord)
        {
            var sessionInfo = databaseSessionService.InfoOf(request.SessionID);
            var engine = sessionInfo?.Engine ?? EDatabaseEngine.PostgreSql;
            var (level, reason, action) = CommandDanger.Classify(request.Sql, engine);
            var (snapshot, protections) = JournalSnapshots.FromVault(vaultService, sessionInfo?.ConnectionID, sessionInfo, readOnly.Value);

            entryId = journalRecorder!.Begin(new JournalEntryStart(
                Kind: EJournalKind.Sql,
                Action: action,
                Level: level,
                Reason: reason,
                Origin: origin,
                Sql: request.Sql,
                HistoryText: request.HistoryText,
                Confirmed: request.Confirmed,
                SessionId: request.SessionID,
                ScriptRunId: request.ScriptRunID,
                Connection: snapshot,
                Protections: protections));
        }

        var outcome = await databaseSessionService.ExecuteAsync(request.SessionID, request.Sql, filter, pageSize, readOnly.Value, request.KeptResults(), parameters, cancellationToken);

        if (entryId > 0)
        {
            if (outcome.IsSuccess)
            {
                var executed = outcome.Value;
                var rows = executed.RowsAffected ?? executed.Page?.TotalRows ?? executed.Page?.Rows.Count;
                journalRecorder!.Complete(entryId, new JournalEntryEnd(EJournalOutcome.Ok, rows));
            }
            else
            {
                var errorDto = DatabaseSessionErrors.From(outcome.Error);
                var journalOutcome = outcome.Error.Outcome == ECancelOutcome.Canceled
                    ? EJournalOutcome.Cancelled
                    : outcome.Error.Kind is EDatabaseFailure.ConnectionReadOnly or EDatabaseFailure.FilterInvalid or EDatabaseFailure.ParametersMismatch or EDatabaseFailure.QueryInvalid or EDatabaseFailure.TransactionsNotAvailable or EDatabaseFailure.TransactionFailed
                        ? EJournalOutcome.Refused
                        : EJournalOutcome.Error;
                var sqlState = journalOutcome == EJournalOutcome.Error ? outcome.Error.SqlState : null;
                journalRecorder!.Complete(entryId, new JournalEntryEnd(journalOutcome, null, errorDto.Type, sqlState, errorDto.Detail));
            }
        }

        return outcome.Map(executed => executed.ToDto()).MapError(DatabaseSessionErrors.From);
    }
}
