using Prism.Core.Extensions;

namespace Prism.Application.Connections.Models;

/// <summary>
/// As regras de formato dos campos de uma conexão (RN-CONN-010) que o validator de criar e o de alterar repetem. Medem
/// o valor depois de normalizado, que é o que o domínio grava.
/// </summary>
internal static class ConnectionRules
{
    /// <summary>
    /// RN-CONN-004 e RN-CONN-013: a senha gravada só é enviada ao servidor para o qual foi gravada, e "o mesmo servidor" é o mesmo host e a
    /// mesma porta. O host é comparado de forma EXATA (`Ordinal`), depois da única normalização que a gravação aplica, aparar as pontas
    /// (`Connection.Create` e `Update`); a porta, como número. Nada de ignorar maiúsculas: um host que começa por `/` é diretório de socket
    /// Unix no driver, e `/tmp/pgsock-x` e `/tmp/PGSOCK-X` são diretórios diferentes; e o `OrdinalIgnoreCase` iguala letras que são
    /// endereços diferentes (`ς` e `σ`, `µ` e `μ`), então a senha iria a um nome que quem controla a resolução registrou de propósito.
    /// Errar para o lado de pedir a senha de novo custa uma digitação; errar para o outro entrega a senha a outro servidor.
    /// </summary>
    public static bool SameServer(string storedHost, int storedPort, string host, int port)
        => storedPort == port && string.Equals(storedHost.Trim(), host.Trim(), StringComparison.Ordinal);

    public static bool NameIsValid(string? name)
        => name.NormalizeName().Length is >= 1 and <= 80;

    /// <summary>Opcional: em branco é "sem ambiente".</summary>
    public static bool EnvironmentNameIsValid(string? environmentName)
        => environmentName.NormalizeName().Length <= 30;

    /// <summary>Opcional: em branco é "sem cor". Quando vem, é `#RRGGBB`.</summary>
    public static bool EnvironmentColorIsValid(string? environmentColor)
    {
        if (string.IsNullOrWhiteSpace(environmentColor))
            return true;

        var color = environmentColor.Trim();

        return color.Length == 7 && color[0] == '#' && color.Skip(1).All(char.IsAsciiHexDigit);
    }
}
