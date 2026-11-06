using Prism.Core.Extensions;
using System.Resources;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.DatabaseSessions.Models;

/// <summary>
/// A tradução das recusas do registro de sessões (`DatabaseFailure`) para o erro da API, num lugar só: toda rota que fala com um banco
/// responde a mesma falha do mesmo jeito. Os códigos e os status são os da seção 6 da especificação.
///
/// Em `ConnectionFailed` e `ExecutionFailed` o `detail` é a mensagem do banco, sem alteração (decisão 4 da seção 8 da especificação,
/// RN-SESSAO-003 e RN-SQL-009): num cliente de banco ela é o produto. Nos demais, é o texto do próprio Prism.
///
/// O que a tela decide sem ler texto (Ruling 135) vai em extensões: `outcome` no `SQL_EXECUTION_FAILED` que terminou depois de um pedido
/// de cancelamento (RN-SQL-010) e `executed` no `TRANSACTION_CONTROL_NOT_SUPPORTED` do comando que rodou (RN-SESSAO-005).
/// </summary>
internal static class DatabaseSessionErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>DatabaseSessionErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(DatabaseSessionErrors));

    public static ApiErrorDto From(DatabaseFailure failure)
        => WithTheTransaction(Of(failure), failure);

    /// <summary>
    /// Seção 22 da especificação: a recusa de uma operação na sessão leva o estado da transação (`transaction`) e, quando a transação manual se
    /// perdeu sem a pessoa pedir, `transactionUndone`, para a tela dizer em que pé ficou sem ler o texto (Ruling 135).
    /// </summary>
    private static ApiErrorDto WithTheTransaction(ApiErrorDto error, DatabaseFailure failure)
    {
        if (failure.Transaction is null)
            return error;

        error.Extensions["transaction"] = failure.Transaction.ToDto();
        if (failure.TransactionUndone)
            error.Extensions["transactionUndone"] = true;

        return error;
    }

    private static ApiErrorDto Of(DatabaseFailure failure)
        => failure.Kind switch
        {
            EDatabaseFailure.ConnectionFailed => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ConnectionFailedTitle"), "DATABASE_CONNECTION_FAILED", failure.Message),

            // RN-REDE-007: a chave cifrada sem a frase secreta é o segredo que falta, no campo dele, como na RN-REDE-003: a tela pede a frase (RN-REDE-006).
            EDatabaseFailure.NetworkSecretMissing => ConnectionErrors.NetworkSecretMissing("SshSecret", failure.Message),
            EDatabaseFailure.ExecutionFailed => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ExecutionFailedTitle"), "SQL_EXECUTION_FAILED", failure.Message, SqlDetails(failure)),
            EDatabaseFailure.SessionNotFound => ApiErrorDto.CreateNotFound(Texts.Get("SessionNotFoundTitle"), "DATABASE_SESSION_NOT_FOUND", failure.Message),
            EDatabaseFailure.SessionBusy => ApiErrorDto.CreateConflict(Texts.Get("SessionBusyTitle"), "SESSION_BUSY", failure.Message),
            EDatabaseFailure.NoOpenCursor => ApiErrorDto.CreateConflict(Texts.Get("NoOpenCursorTitle"), "NO_OPEN_CURSOR", failure.Message),
            EDatabaseFailure.NoQueryToCount => ApiErrorDto.CreateConflict(Texts.Get("NoQueryToCountTitle"), "NO_QUERY_TO_COUNT", failure.Message),
            EDatabaseFailure.TransactionControlNotSupported => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("TransactionControlNotSupportedTitle"), "TRANSACTION_CONTROL_NOT_SUPPORTED", failure.Message, ExecutedDetails(failure)),
            EDatabaseFailure.MultipleStatementsNotSupported => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("MultipleStatementsNotSupportedTitle"), "MULTIPLE_STATEMENTS_NOT_SUPPORTED", failure.Message),

            // Seção 22 (RN-TX-004, 005, 009 e 013; RN-ISOL-003): nada foi ao banco.
            EDatabaseFailure.TransactionFailed => ApiErrorDto.CreateConflict(Texts.Get("TransactionFailedTitle"), "TRANSACTION_FAILED", failure.Message),
            EDatabaseFailure.CommandNotAllowedInTransaction => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("CommandNotAllowedInTransactionTitle"), "COMMAND_NOT_ALLOWED_IN_TRANSACTION", failure.Message),
            EDatabaseFailure.NoOpenTransaction => ApiErrorDto.CreateConflict(Texts.Get("NoOpenTransactionTitle"), "NO_OPEN_TRANSACTION", failure.Message),
            EDatabaseFailure.TransactionOpen => ApiErrorDto.CreateConflict(Texts.Get("TransactionOpenTitle"), "TRANSACTION_OPEN", failure.Message),
            EDatabaseFailure.TransactionsNotAvailable => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("TransactionsNotAvailableTitle"), "TRANSACTIONS_NOT_AVAILABLE", failure.Message),
            EDatabaseFailure.IsolationLevelInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("IsolationLevelInvalidTitle"), "ISOLATION_LEVEL_INVALID", failure.Message),

            // RN-DRIVER-006: o detalhe diz o nome do driver que falta, e a extensão `driverID` leva a tela até a linha dele ("Instalar driver").
            EDatabaseFailure.DriverNotInstalled => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("DriverNotInstalledTitle"), "DRIVER_NOT_INSTALLED", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["driverID"] = failure.DriverID }),

            // RN-EDIT-002, 005 e 006: a recusa da edição aponta o que a tela destaca: o motivo, a alteração, a coluna e as linhas.
            EDatabaseFailure.ResultChanged => ApiErrorDto.CreateConflict(Texts.Get("ResultChangedTitle"), "RESULT_CHANGED", failure.Message),
            EDatabaseFailure.ResultNotEditable => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ResultNotEditableTitle"), "RESULT_NOT_EDITABLE", failure.Message, EditDetails(failure)),
            EDatabaseFailure.EditInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("EditInvalidTitle"), "EDIT_INVALID", failure.Message, EditDetails(failure)),
            EDatabaseFailure.EditRowMismatch => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("EditRowMismatchTitle"), "EDIT_ROW_MISMATCH", failure.Message, EditDetails(failure)),

            // RN-EDIT-018 e 023: a tela decide pelo código, e mostra o `reason` como veio.
            EDatabaseFailure.EditAllRowsNotSupported => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("EditAllRowsNotSupportedTitle"), "EDIT_ALL_ROWS_NOT_SUPPORTED", failure.Message, EditDetails(failure)),

            // RN-SQL-017: o valor completo das células cortadas.
            EDatabaseFailure.ResultNotFound => ApiErrorDto.CreateNotFound(Texts.Get("ResultNotFoundTitle"), "RESULT_NOT_FOUND", failure.Message),
            EDatabaseFailure.CellsInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("CellsInvalidTitle"), "CELLS_INVALID", failure.Message),

            // RN-GRADE-011: pela rota, o validator recusa antes, com o mesmo código, no campo `Filter`; esta é a do registro de sessões.
            EDatabaseFailure.FilterInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("FilterInvalidTitle"), "FILTER_INVALID", failure.Message),

            // RN-VAR-032: o valor dos `params` que o banco não guarda, no campo dele; e os marcadores que não batem com os valores (`markers` e `values`).
            EDatabaseFailure.QueryInvalid => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("QueryInvalidTitle"), "QUERY_INVALID", failure.Field ?? "params", failure.Message),
            EDatabaseFailure.ParametersMismatch => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ParametersMismatchTitle"), "QUERY_PARAMETERS_MISMATCH", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["markers"] = failure.Markers, ["values"] = failure.Values }),

            // RN-VAR-034: a consulta de uma variável que não é uma leitura (o motivo no detalhe e em `reason`, como na exportação), e a que passou de um limite
            // (`reason` em `rows`, `columns` ou `bytes`, e `limit`).
            EDatabaseFailure.VariableQueryNotRead => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("VariableQueryNotReadTitle"), "VARIABLE_QUERY_NOT_READ", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["reason"] = failure.Reason }),
            EDatabaseFailure.VariableQueryTooLarge => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("VariableQueryTooLargeTitle"), "VARIABLE_QUERY_TOO_LARGE", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["reason"] = failure.Reason, ["limit"] = failure.Limit }),

            // RN-VAR-035: a coluna ou a descrição que o catálogo da sessão recusa vem na forma do erro de campo, como a do validator; a tabela que não existe é 404.
            EDatabaseFailure.ValuesInvalid => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("ValuesInvalidTitle"), "VALUES_INVALID", failure.Field ?? "column", failure.Message),
            EDatabaseFailure.ValuesTableNotFound => ApiErrorDto.CreateNotFound(Texts.Get("ValuesTableNotFoundTitle"), "VALUES_TABLE_NOT_FOUND", failure.Message),

            // RN-PROT-002: nada foi ao banco, e o resultado anterior continua (sem `executed`).
            EDatabaseFailure.ConnectionReadOnly => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ConnectionReadOnlyTitle"), "CONNECTION_READ_ONLY", failure.Message),

            // O cofre aberto mudou enquanto a sessão abria: para quem chamou, é o cofre que ele usava que fechou.
            EDatabaseFailure.VaultChanged => VaultErrors.From(EVaultError.Locked),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    /// <summary>
    /// RN-SQL-009: o SQLSTATE e a posição do erro só vão quando o driver os informa; `query.schema.ts` da tela os lê como `sqlState` e
    /// `position`. RN-SQL-010: `outcome` só vai quando houve pedido de cancelamento para o comando, e é com ele, e não com o texto, que a
    /// tela diz "Comando cancelado." (`canceled`) ou avisa que o desfecho é incerto (`unknown`) ou que o que foi gravado ficou (`partial`).
    /// </summary>
    private static Dictionary<string, object?> SqlDetails(DatabaseFailure failure)
    {
        var details = new Dictionary<string, object?>(StringComparer.Ordinal);

        if (failure.SqlState is not null)
            details["sqlState"] = failure.SqlState;

        if (failure.Position is { } position)
            details["position"] = position;

        if (failure.Outcome is { } outcome)
            details["outcome"] = OutcomeText(outcome);

        return EditDetails(failure, details);
    }

    /// <summary>
    /// RN-EDIT-002 a 012: `reason` (o resultado só leitura), `change` e `column` (a posição da alteração no pedido e a da coluna no
    /// resultado), `rowsAffected` (as linhas que o comando dela afetou) e `applied` (no banco sem log, as já gravadas), cada um só quando vem.
    /// </summary>
    private static Dictionary<string, object?> EditDetails(DatabaseFailure failure, Dictionary<string, object?>? details = null)
    {
        details ??= new Dictionary<string, object?>(StringComparer.Ordinal);

        if (failure.Reason is not null)
            details["reason"] = failure.Reason;

        if (failure.Change is { } change)
            details["change"] = change;

        if (failure.Column is { } column)
            details["column"] = column;

        if (failure.RowsAffected is { } rowsAffected)
            details["rowsAffected"] = rowsAffected;

        if (failure.Applied is { } applied)
            details["applied"] = applied;

        return details;
    }

    private static string OutcomeText(ECancelOutcome outcome)
        => outcome switch
        {
            ECancelOutcome.Canceled => "canceled",
            ECancelOutcome.Unknown => "unknown",
            ECancelOutcome.Partial => "partial",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    /// <summary>
    /// RN-SESSAO-005: `executed: true` diz que o comando rodou e o Prism desfez a transação que ele deixou aberta, e que o cursor anterior
    /// fechou; sem a extensão, o comando foi recusado antes de executar, e o resultado anterior continua.
    /// </summary>
    private static Dictionary<string, object?>? ExecutedDetails(DatabaseFailure failure)
        => failure.Executed ? new Dictionary<string, object?>(StringComparer.Ordinal) { ["executed"] = true } : null;
}
