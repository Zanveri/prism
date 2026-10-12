using System.Diagnostics.CodeAnalysis;

namespace Prism.Infrastructure.Vault.Clients;

/// <summary>
/// RN-COFRE-001: o nome do usuário vira nome de arquivo (`&lt;usuario&gt;.vault.json`). Esta é a checagem de
/// nome de arquivo do cofre, num lugar só: o <see cref="VaultFileClient"/> a aplica antes de qualquer
/// acesso ao disco, e a Application a reaproveita na regra do nome de usuário (RN-COFRE-010), para as
/// duas não divergirem. É pública porque a Application não enxerga o client, que é `internal`.
/// </summary>
public static class VaultFileName
{
    private static readonly char[] InvalidCharacters = Path.GetInvalidFileNameChars();

    /// <summary>
    /// `con.vault.json` não é um arquivo no Windows, é o dispositivo `CON`: o que vem depois do ponto não
    /// muda isso, e a caixa também não. Ler ou gravar um nome desses não chega a um arquivo do cofre.
    /// </summary>
    private static readonly HashSet<string> DeviceNames = new(["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"], StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Falso para o nome vazio, para o que tem separador, dois-pontos, curinga ou qualquer caractere que
    /// o sistema de arquivos recusa, e para nome de dispositivo do Windows. A regra completa do nome é a
    /// RN-COFRE-010, de quem recebe a requisição; esta é só a última barreira antes do disco.
    /// </summary>
    public static bool IsAllowed([NotNullWhen(true)] string? userName)
    {
        if (string.IsNullOrWhiteSpace(userName) || userName.IndexOfAny(InvalidCharacters) >= 0)
            return false;

        var dot = userName.IndexOf('.');

        return !DeviceNames.Contains(dot < 0 ? userName : userName[..dot]);
    }
}
