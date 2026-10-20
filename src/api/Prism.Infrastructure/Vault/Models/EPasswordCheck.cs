namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// RN-PROT-003: o que a gravação que pode pedir a senha do usuário (`IVaultService.SaveWithPasswordAsync`) fez com ela. Só `NotNeeded` e `Matched`
/// gravaram; `Missing` e `Wrong` deixaram o cofre como estava.
/// </summary>
public enum EPasswordCheck
{
    /// <summary>A alteração não pedia a senha (ou não mudava nada): a senha que veio não foi conferida.</summary>
    NotNeeded,

    /// <summary>A alteração pedia a senha, e ela conferiu (a contagem de erros seguidos voltou a zero).</summary>
    Matched,

    /// <summary>A alteração pedia a senha, e ela não veio: nada foi conferido nem contado.</summary>
    Missing,

    /// <summary>A alteração pedia a senha, e ela não conferiu: o erro foi contado.</summary>
    Wrong
}
