using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>RN-DBEAVER-018: o que o cofre guarda do DBeaver, mudado num lugar só (o convite e a importação gravam por aqui).</summary>
internal static class DbeaverState
{
    /// <summary>O convite feito. O documento que já o tem volta como estava (a mesma instância: o cofre não regrava, e o `.bak` continua o de antes).</summary>
    public static VaultDocument Invite(VaultDocument document, DateTime now)
        => document.Dbeaver?.InvitedAt is not null
            ? document
            : document with { Dbeaver = (document.Dbeaver ?? new VaultDbeaverRecord(null, null)) with { InvitedAt = now } };

    /// <summary>A importação que gravou algo: a data dela e, na mesma gravação, o convite feito (quem importou foi convidado), sem trocar a data de um convite anterior.</summary>
    public static VaultDocument Imported(VaultDocument document, DateTime now)
    {
        var current = document.Dbeaver ?? new VaultDbeaverRecord(null, null);

        return document with { Dbeaver = current with { InvitedAt = current.InvitedAt ?? now, LastImportAt = now } };
    }
}
