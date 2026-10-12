using Prism.Infrastructure.Vault.Clients;
using System.Text.RegularExpressions;

namespace Prism.Application.Users.Models;

/// <summary>
/// RN-COFRE-010: o nome do usuário é gravado em minúsculas, tem de 3 a 32 caracteres e usa só `a-z`,
/// `0-9`, `.`, `_` e `-`, começando por letra ou número. A tela normaliza do mesmo jeito, para as duas
/// concordarem sobre o que é o mesmo usuário.
/// </summary>
internal static partial class UserNameRules
{
    // `\z`, e não `$`: o `$` aceitaria um `\n` no fim do nome.
    [GeneratedRegex(@"^[a-z0-9][a-z0-9._-]{2,31}\z")]
    private static partial Regex Pattern();

    public static string Normalize(string? userName)
        => (userName ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>
    /// O nome já normalizado. A checagem de nome de arquivo (nomes de dispositivo do Windows, que o
    /// formato sozinho aceita) é a mesma do client do cofre, e não uma lista repetida aqui: RN-COFRE-001.
    /// </summary>
    public static bool IsValid(string normalizedUserName)
        => Pattern().IsMatch(normalizedUserName) && VaultFileName.IsAllowed(normalizedUserName);
}
