using Prism.Core.Extensions;
using System.Resources;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.Application.Journal.Models;

internal static class JournalErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>JournalErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(JournalErrors));

    public static ApiErrorDto From(EJournalError error, long? id = null)
        => error switch
        {
            EJournalError.Locked => VaultErrors.From(EVaultError.Locked),
            EJournalError.Unavailable => ApiErrorDto.Create("JOURNAL_UNAVAILABLE", Texts.Get("UnavailableTitle"), HttpStatusCode.ServiceUnavailable, Texts.Get("UnavailableDetail"), null, null),
            EJournalError.NotFound => NotFound(id),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    public static ApiErrorDto NotFound(long? id = null)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "JOURNAL_ENTRY_NOT_FOUND", id is null ? Texts.Get("NotFoundDetail") : Texts.Get("NotFoundDetailWithID", id));

    public static ApiErrorDto FilterInvalid(string details)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("FilterInvalidTitle"), "JOURNAL_FILTER_INVALID", details);

    public static ApiErrorDto SettingsInvalid(string details)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("SettingsInvalidTitle"), "JOURNAL_SETTINGS_INVALID", details);
}
