using Prism.Core.Extensions;

namespace Prism.Application.ScriptFolders.Models;

/// <summary>RN-SCRIPT-007, num lugar só para a criação e a alteração.</summary>
internal static class ScriptFolderRules
{
    /// <summary>O mesmo limite das pastas de conexões (RN-PASTA-001).</summary>
    public const int MaxNameLength = 60;

    /// <summary>
    /// De 1 a 60 caracteres (unidades UTF-16, as do campo de texto) depois de normalizado como o nome da pasta de conexões, que é o que se grava, e nenhum
    /// caractere de controle no texto que veio, conferido antes de normalizar: a normalização trocaria a tabulação e a quebra de linha por espaço, e o nome do
    /// script (RN-SCRIPT-004) também as recusa.
    /// </summary>
    public static bool IsValidName(string? name)
        => name is not null && !name.Any(char.IsControl) && name.NormalizeName().Length is >= 1 and <= MaxNameLength;
}
