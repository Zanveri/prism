using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Globalization;

namespace Prism.Application.Connections.Models;

/// <summary>
/// As regras de formato dos campos de uma conexão (RN-CONN-010) que o validator de criar e o de alterar repetem. Medem
/// o valor depois de normalizado, que é o que o domínio grava. As do ambiente são as mesmas da pasta e moram no `EnvironmentRules`.
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

    /// <summary>RN-CONN-010: o nome tem de 1 a 80 caracteres, contados em unidades UTF-16 como o campo de texto da tela conta.</summary>
    public const int NameMaxLength = 80;

    public static bool NameIsValid(string? name)
        => name.NormalizeName().Length is >= 1 and <= NameMaxLength;

    /// <summary>RN-VERIF-001: "Verificar a cada N segundos", 30 por padrão, de 5 a 3.600 (o mínimo e o passo do canvas são 5).</summary>
    public const int VerificationIntervalDefault = 30;
    public const int VerificationIntervalMin = 5;
    public const int VerificationIntervalMax = 3600;

    /// <summary>RN-VERIF-001: a consulta de verificação própria tem até 1.000 caracteres, contados em unidades UTF-16 depois de aparada.</summary>
    public const int VerificationQueryMaxLength = 1000;

    /// <summary>Opcional: ausente ou nulo é o padrão (30).</summary>
    public static bool VerificationIntervalIsValid(int? interval)
        => interval is null or (>= VerificationIntervalMin and <= VerificationIntervalMax);

    /// <summary>Em branco é a consulta do banco (nula). O texto é aparado, e o resto vai ao banco como a pessoa escreveu.</summary>
    public static string? NormalizeVerificationQuery(string? query)
        => string.IsNullOrWhiteSpace(query) ? null : query.Trim();

    /// <summary>
    /// RN-VERIF-001: por que a consulta de verificação não serve, ou nula quando serve (a do banco, em branco, sempre serve). Até 1.000 caracteres e uma
    /// leitura só no banco da conexão (RN-PROT-005, `ReadOnlySql`), a regra de quem a valida no formulário e no teste.
    /// </summary>
    public static string? VerificationQueryRefusal(string? query, EDatabaseEngine engine)
    {
        if (NormalizeVerificationQuery(query) is not { } normalized)
            return null;

        if (normalized.Length > VerificationQueryMaxLength)
            return "A consulta de verificação pode ter no máximo 1.000 caracteres.";

        return ReadOnlySql.VerificationRefusal(normalized, engine) is { } reason ? $"A consulta de verificação tem de ser uma leitura só: {reason}." : null;
    }

    /// <summary>
    /// RN-CONN-016: o nome da cópia de uma conexão, "&lt;nome&gt; (cópia)", ou "(cópia 2)", "(cópia 3)" e assim por diante, o primeiro que
    /// `isTaken` diz estar livre (quem chama sabe a pasta e o documento). O nome original é cortado para o sufixo caber no limite
    /// (`NameMaxLength`), sem partir um caractere em dois e sem deixar espaço antes do sufixo. O laço acaba: cada candidato é diferente
    /// dos anteriores, e a pasta tem um número finito de nomes.
    /// </summary>
    public static string CopyName(string name, Func<string, bool> isTaken)
    {
        for (var number = 1; ; number++)
        {
            var suffix = number == 1 ? " (cópia)" : $" (cópia {number})";
            var candidate = Fit(name, NameMaxLength - suffix.Length) + suffix;

            if (!isTaken(candidate))
                return candidate;
        }
    }

    /// <summary>O nome até `length` unidades UTF-16, cortado no fim de um caractere inteiro (um emoji, uma letra com acento combinado), sem espaço no fim.</summary>
    private static string Fit(string name, int length)
    {
        if (name.Length <= length)
            return name;

        var cut = StringInfo.ParseCombiningCharacters(name).Where(start => start <= length).Max();

        return name[..cut].TrimEnd();
    }
}
