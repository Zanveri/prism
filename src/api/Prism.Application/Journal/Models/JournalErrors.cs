using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.Application.Journal.Models;

internal static class JournalErrors
{
    public static ApiErrorDto From(EJournalError error, long? id = null)
        => error switch
        {
            EJournalError.Locked => VaultErrors.From(EVaultError.Locked),
            EJournalError.Unavailable => ApiErrorDto.Create("JOURNAL_UNAVAILABLE", "Diário indisponível.", HttpStatusCode.ServiceUnavailable, "O diário de auditoria está indisponível nesta sessão.", null, null),
            EJournalError.NotFound => NotFound(id),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    public static ApiErrorDto NotFound(long? id = null)
        => ApiErrorDto.CreateNotFound("Registro não localizado.", "JOURNAL_ENTRY_NOT_FOUND", id is null ? "O registro não existe no diário." : $"O registro #{id} não existe no diário.");

    public static ApiErrorDto FilterInvalid(string details)
        => ApiErrorDto.CreateUnprocessableEntity("Filtro do diário inválido.", "JOURNAL_FILTER_INVALID", details);

    public static ApiErrorDto SettingsInvalid(string details)
        => ApiErrorDto.CreateUnprocessableEntity("Configuração do diário inválida.", "JOURNAL_SETTINGS_INVALID", details);
}
