using Prism.Application.Common.Vault;
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
    public static ApiErrorDto From(DatabaseFailure failure)
        => failure.Kind switch
        {
            EDatabaseFailure.ConnectionFailed => ApiErrorDto.CreateUnprocessableEntity("Falha ao conectar no banco de dados.", "DATABASE_CONNECTION_FAILED", failure.Message),
            EDatabaseFailure.ExecutionFailed => ApiErrorDto.CreateUnprocessableEntity("Falha ao executar o comando.", "SQL_EXECUTION_FAILED", failure.Message, SqlDetails(failure)),
            EDatabaseFailure.SessionNotFound => ApiErrorDto.CreateNotFound("Sessão com o banco não localizada.", "DATABASE_SESSION_NOT_FOUND", failure.Message),
            EDatabaseFailure.SessionBusy => ApiErrorDto.CreateConflict("A sessão está ocupada.", "SESSION_BUSY", failure.Message),
            EDatabaseFailure.NoOpenCursor => ApiErrorDto.CreateConflict("Não há resultado aberto.", "NO_OPEN_CURSOR", failure.Message),
            EDatabaseFailure.NoQueryToCount => ApiErrorDto.CreateConflict("Não há consulta para contar.", "NO_QUERY_TO_COUNT", failure.Message),
            EDatabaseFailure.TransactionControlNotSupported => ApiErrorDto.CreateUnprocessableEntity("Controle de transação não é aceito.", "TRANSACTION_CONTROL_NOT_SUPPORTED", failure.Message, ExecutedDetails(failure)),
            EDatabaseFailure.MultipleStatementsNotSupported => ApiErrorDto.CreateUnprocessableEntity("Só um comando por execução.", "MULTIPLE_STATEMENTS_NOT_SUPPORTED", failure.Message),

            // RN-DRIVER-006: o detalhe diz o nome do driver que falta, e a extensão `driverID` leva a tela até a linha dele ("Instalar driver").
            EDatabaseFailure.DriverNotInstalled => ApiErrorDto.CreateUnprocessableEntity("Driver não instalado.", "DRIVER_NOT_INSTALLED", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["driverID"] = failure.DriverID }),

            // RN-EDIT-002, 005 e 006: a recusa da edição aponta o que a tela destaca: o motivo, a alteração, a coluna e as linhas.
            EDatabaseFailure.ResultChanged => ApiErrorDto.CreateConflict("O resultado mudou.", "RESULT_CHANGED", failure.Message),
            EDatabaseFailure.ResultNotEditable => ApiErrorDto.CreateUnprocessableEntity("O resultado é só leitura.", "RESULT_NOT_EDITABLE", failure.Message, EditDetails(failure)),
            EDatabaseFailure.EditInvalid => ApiErrorDto.CreateUnprocessableEntity("A alteração não se aplica.", "EDIT_INVALID", failure.Message, EditDetails(failure)),
            EDatabaseFailure.EditRowMismatch => ApiErrorDto.CreateUnprocessableEntity("O comando não afetou exatamente uma linha.", "EDIT_ROW_MISMATCH", failure.Message, EditDetails(failure)),

            // RN-SQL-017: o valor completo das células cortadas.
            EDatabaseFailure.ResultNotFound => ApiErrorDto.CreateNotFound("Resultado não localizado.", "RESULT_NOT_FOUND", failure.Message),
            EDatabaseFailure.CellsInvalid => ApiErrorDto.CreateUnprocessableEntity("Células inválidas.", "CELLS_INVALID", failure.Message),

            // RN-GRADE-011: pela rota, o validator recusa antes, com o mesmo código, no campo `Filter`; esta é a do registro de sessões.
            EDatabaseFailure.FilterInvalid => ApiErrorDto.CreateUnprocessableEntity("Filtro inválido.", "FILTER_INVALID", failure.Message),

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
