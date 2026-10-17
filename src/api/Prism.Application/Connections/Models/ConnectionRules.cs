using Prism.Application.Common.Texts;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

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

    /// <summary>
    /// RN-CONN-010: os tetos do host (255), do banco de dados (128) e do usuário (128), contados em unidades UTF-16 depois de aparados, que é o que se grava,
    /// e o da senha (1.024), contada como veio (ela não é aparada). Valem no formulário, no "Testar conexão" e na importação (RN-TRANSF-014): sem eles o
    /// arquivo que o Prism exporta poderia não voltar pela importação dele.
    /// </summary>
    public const int HostMaxLength = 255;
    public const int DatabaseMaxLength = 128;
    public const int UserNameMaxLength = 128;
    public const int PasswordMaxLength = 1024;

    public static bool NameIsValid(string? name)
        => name.NormalizeName().Length is >= 1 and <= NameMaxLength;

    /// <summary>
    /// As regras de cada campo da conexão (RN-CONN-010), num lugar só: o validator de criar, o de alterar e o do teste as aplicam pelo `MustPass`, e a
    /// importação (RN-TRANSF-014) as chama direto, com a mesma frase. Cada uma devolve o primeiro motivo da recusa, ou nulo quando o valor serve. Os textos
    /// são medidos depois da normalização de cada campo (o nome pela `NormalizeName`, o host, o banco e o usuário aparados), que é o que se grava, e o
    /// caractere de controle e o de direção do texto (`TextRules`) são recusados no nome, no host, no banco de dados e no usuário (e, menos a tabulação e as
    /// quebras de linha, na consulta de verificação, <see cref="VerificationQueryRefusal"/>).
    /// </summary>
    public static string? NameRefusal(string? name)
    {
        var normalized = name.NormalizeName();
        if (normalized.Length is < 1 or > NameMaxLength)
            return "O nome da conexão deve ter de 1 a 80 caracteres.";

        return TextRules.HasControlOrDirection(normalized) ? "O nome da conexão não pode ter caractere de controle nem de direção do texto." : null;
    }

    public static string? HostRefusal(string? host)
        => Refusal(host, required: true, HostMaxLength, "Informe o host.", "O host pode ter até 255 caracteres.", "O host não pode ter caractere de controle nem de direção do texto.");

    public static string? PortRefusal(int port)
        => port is >= 1 and <= 65535 ? null : "Informe uma porta de 1 a 65535.";

    public static string? DatabaseRefusal(string? database)
        => Refusal(database, required: true, DatabaseMaxLength, "Informe o banco de dados.", "O banco de dados pode ter até 128 caracteres.", "O banco de dados não pode ter caractere de controle nem de direção do texto.");

    /// <summary>
    /// `required` é o formulário de criar e o teste. No `PATCH` o usuário vazio passa aqui, e quem decide é a gravação: ele só fica vazio na conexão gravada
    /// já sem usuário (a que a importação trouxe sem ele, RN-TRANSF-015). Na importação ele é opcional.
    /// </summary>
    public static string? UserNameRefusal(string? userName, bool required)
        => Refusal(userName, required, UserNameMaxLength, "Informe o usuário do banco.", "O usuário do banco pode ter até 128 caracteres.", "O usuário do banco não pode ter caractere de controle nem de direção do texto.");

    /// <summary>A senha não é aparada nem conferida quanto aos caracteres: espaço e qualquer caractere fazem parte dela. Só o teto, contado como veio.</summary>
    public static string? PasswordRefusal(string? password)
        => password is { Length: > PasswordMaxLength } ? "A senha do banco pode ter até 1.024 caracteres." : null;

    private static string? Refusal(string? value, bool required, int maxLength, string missing, string tooLong, string control)
    {
        if (string.IsNullOrWhiteSpace(value))
            return required ? missing : null;

        var trimmed = value.Trim();
        if (trimmed.Length > maxLength)
            return tooLong;

        return TextRules.HasControlOrDirection(trimmed) ? control : null;
    }

    /// <summary>RN-VERIF-001: "Verificar a cada N segundos", 30 por padrão, de 5 a 3.600 (o mínimo e o passo do canvas são 5).</summary>
    public const int VerificationIntervalDefault = 30;
    public const int VerificationIntervalMin = 5;
    public const int VerificationIntervalMax = 3600;

    /// <summary>RN-VERIF-001: a consulta de verificação própria tem até 1.000 caracteres, contados em unidades UTF-16 depois de aparada.</summary>
    public const int VerificationQueryMaxLength = 1000;

    /// <summary>RN-VERIF-001: a frase do intervalo fora da faixa, a mesma no formulário, no teste e na importação (RN-TRANSF-014).</summary>
    public const string VerificationIntervalMessage = "A verificação deve ser feita a cada 5 a 3.600 segundos.";

    /// <summary>Opcional: ausente ou nulo é o padrão (30).</summary>
    public static bool VerificationIntervalIsValid(int? interval)
        => interval is null or (>= VerificationIntervalMin and <= VerificationIntervalMax);

    /// <summary>Em branco é a consulta do banco (nula). O texto é aparado, e o resto vai ao banco como a pessoa escreveu.</summary>
    public static string? NormalizeVerificationQuery(string? query)
        => string.IsNullOrWhiteSpace(query) ? null : query.Trim();

    /// <summary>
    /// RN-VERIF-001: por que a consulta de verificação não serve, ou nula quando serve (a do banco, em branco, sempre serve). Nesta ordem: até 1.000
    /// caracteres; sem caractere de controle nem de direção do texto, menos a tabulação, a quebra de linha e o retorno de carro (`TextRules`: um U+202E faria a
    /// consulta que a prévia da importação manda conferir parecer outra, RN-TRANSF-011); e uma leitura só no banco da conexão (RN-PROT-005, `ReadOnlySql`).
    /// É a regra de quem a valida no formulário de criar e de alterar, no teste e na importação (RN-TRANSF-014), com as mesmas frases.
    /// </summary>
    public static string? VerificationQueryRefusal(string? query, EDatabaseEngine engine)
    {
        if (NormalizeVerificationQuery(query) is not { } normalized)
            return null;

        if (normalized.Length > VerificationQueryMaxLength)
            return "A consulta de verificação pode ter no máximo 1.000 caracteres.";

        if (TextRules.HasControlOrDirectionBesidesLineBreaks(normalized))
            return "A consulta de verificação não pode ter caractere de controle nem de direção do texto.";

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
        => name.Length <= length ? name : TextRules.Cut(name, length).TrimEnd();
}
