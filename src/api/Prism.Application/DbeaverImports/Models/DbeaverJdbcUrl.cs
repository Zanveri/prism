using Prism.Application.Common.Texts;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.Databases.Models;
using System.Globalization;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-010: a URL JDBC de uma conexão do DBeaver, lida pela API (o DBeaver só a casa com o modelo do driver, e o Prism faz a leitura dele), e o começo
/// dela, o único pedaço que pode aparecer quando não casa. O Prism não adivinha: a URL que não casa deixa a conexão não importável.
/// </summary>
internal static class DbeaverJdbcUrl
{
    private const string PostgreSql = "jdbc:postgresql://";
    private const string Db2 = "jdbc:db2://";
    private const string Informix = "jdbc:informix-sqli://";

    /// <summary>
    /// Os campos de uma URL que casou: o host, a porta (nula quando a URL não a traz, e o padrão de cada banco é de quem chama), o banco de dados (nulo quando vazio)
    /// e, no Informix, o servidor (`INFORMIXSERVER`). As propriedades da URL (`user=`, `password=`, `currentSchema=`…) nunca saem daqui: RN-CONN-001.
    /// </summary>
    internal sealed record Parsed(string Host, string? Port, string? Database, string? Server)
    {
        public override string ToString()
            => nameof(Parsed);
    }

    /// <summary>
    /// A leitura pelas formas da RN-DBEAVER-010, sem diferenciar maiúsculas no começo: PostgreSQL `jdbc:postgresql://host[:porta][/banco][?…]` (o host pode ser um
    /// IPv6 entre colchetes, e com vários hosts separados por vírgula vale o primeiro); Db2 `jdbc:db2://host[:porta]/banco[:propriedades;]`; Informix
    /// `jdbc:informix-sqli://host:porta/[banco][:propriedades]`, as propriedades separadas por `;` e o servidor em `INFORMIXSERVER=`. Nulo quando não casa: o
    /// endereço com `@` (um usuário escrito nele), o host vazio, a porta que não é número, e a URL de outra forma.
    /// </summary>
    public static Parsed? TryParse(EDatabaseEngine engine, string url)
        => engine switch
        {
            EDatabaseEngine.PostgreSql => ParsePostgreSql(url),
            EDatabaseEngine.Db2 => ParseDb2(url),
            EDatabaseEngine.Informix => ParseInformix(url),
            _ => null
        };

    /// <summary>
    /// O começo da URL que pode ir à tela, à resposta e ao log da conexão que não casou: cortada antes do primeiro `/`, `?`, `;` ou `,` depois do `//` e, sem `//`,
    /// depois do esquema (`jdbc:informix-sqli:`); com um `@` em qualquer lugar depois do `//` (um usuário escrito no endereço, cuja senha pode ter `/`, `?`, `;` ou `,`),
    /// ou com um trecho antes do corte que não é `host` nem `host:porta` (um `usuario:senha` ainda sem o `@`), só o esquema fica. O que vem depois pode trazer
    /// `user=` e `password=`. Termina em `/…` (o corte numa barra) ou em `…` quando algo foi cortado, e tem no máximo 200 caracteres. Vazio quando nem o esquema se reconhece.
    /// </summary>
    public static string Beginning(string url)
    {
        var trimmed = url.Trim();
        var slashes = trimmed.IndexOf("//", StringComparison.Ordinal);

        // O que vem antes do `//` (ou o esquema, sem ele) é o único texto que sai sempre, e só na forma `jdbc:<subprotocolo>:` (letras, dígitos e `-`, `_` e `.`):
        // qualquer outra coisa nessa posição pode ser um segredo.
        var scheme = slashes >= 0 ? trimmed[..slashes] : Scheme(trimmed);
        if (!IsJdbcScheme(scheme))
            return string.Empty;

        if (slashes < 0)
            return scheme + "…";

        var start = slashes + 2;
        var end = trimmed.IndexOfAny(['/', '?', ';', ','], start);
        var cut = end < 0 ? trimmed.Length : end;

        // O `@` em qualquer lugar depois do `//` é um usuário (e talvez uma senha) escrito no endereço, e a senha pode conter o próprio caractere do corte: não se decide pelo
        // texto antes do corte. O trecho antes do corte com `:` seguido de algo que não é a porta também pode ser `usuario:senha`. Nos dois casos só o esquema fica.
        // O que fica termina em `/…` quando o corte foi numa barra (o exemplo da especificação) e em `…` nos outros cortes; sem corte, a URL inteira é o endereço.
        var shown = trimmed[start..].Contains('@') || !IsHostAndPort(trimmed[start..cut]) ? scheme + "…" : trimmed[..cut] + (cut >= trimmed.Length ? string.Empty : trimmed[cut] == '/' ? "/…" : "…");

        return TextRules.Cut(shown, TransferLimits.InvalidTextLength);
    }

    /// <summary>O trecho do endereço antes do corte tem a forma de `host`, `host:porta` ou `[ipv6]:porta`: um `:` só pode ser seguido de dígitos (a porta, que pode faltar).</summary>
    private static bool IsHostAndPort(string segment)
    {
        var rest = segment;
        if (rest.StartsWith('['))
        {
            var close = rest.IndexOf(']');
            if (close < 0)
                return false;

            rest = rest[(close + 1)..];
            if (rest.Length > 0 && rest[0] != ':')
                return false;
        }
        else if (rest.Contains(':'))
        {
            // Um `:` só: com dois, o texto não é `host:porta`.
            if (rest.IndexOf(':') != rest.LastIndexOf(':'))
                return false;

            rest = rest[rest.IndexOf(':')..];
        }
        else
            return true;

        return rest.Length == 0 || rest[0] == ':' && rest[1..].All(char.IsAsciiDigit);
    }

    /// <summary>`jdbc:informix-sqli:` de uma URL sem `//`: o `jdbc:` e o subprotocolo, até o segundo dois-pontos.</summary>
    private static string Scheme(string url)
    {
        var colon = url.StartsWith("jdbc:", StringComparison.OrdinalIgnoreCase) ? url.IndexOf(':', 5) : -1;

        return colon < 0 ? string.Empty : url[..(colon + 1)];
    }

    /// <summary>`jdbc:` e um subprotocolo de letras, dígitos, `-`, `_` e `.`, terminado em dois-pontos.</summary>
    private static bool IsJdbcScheme(string scheme)
        => scheme.Length > 6 && scheme.StartsWith("jdbc:", StringComparison.OrdinalIgnoreCase) && scheme[^1] == ':' && scheme[5..^1].All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');

    private static Parsed? ParsePostgreSql(string url)
    {
        if (!url.StartsWith(PostgreSql, StringComparison.OrdinalIgnoreCase))
            return null;

        var rest = url[PostgreSql.Length..];
        var end = rest.IndexOfAny(['/', '?']);
        var authority = end < 0 ? rest : rest[..end];

        // Vários hosts separados por vírgula: vale o primeiro.
        var first = authority.Split(',')[0];
        if (!TryHostAndPort(first, out var host, out var port))
            return null;

        string? database = null;
        if (end >= 0 && rest[end] == '/')
        {
            var afterSlash = rest[(end + 1)..];
            var query = afterSlash.IndexOf('?');
            database = query < 0 ? afterSlash : afterSlash[..query];
        }

        return new Parsed(host, port, Empty(database), null);
    }

    private static Parsed? ParseDb2(string url)
    {
        if (!url.StartsWith(Db2, StringComparison.OrdinalIgnoreCase))
            return null;

        var rest = url[Db2.Length..];
        var slash = rest.IndexOf('/');
        if (slash < 0 || !TryHostAndPort(rest[..slash], out var host, out var port))
            return null;

        // O banco vai até as propriedades (`:currentSchema=X;`).
        var afterSlash = rest[(slash + 1)..];
        var properties = afterSlash.IndexOfAny([':', ';']);
        var database = properties < 0 ? afterSlash : afterSlash[..properties];

        return new Parsed(host, port, Empty(database), null);
    }

    private static Parsed? ParseInformix(string url)
    {
        if (!url.StartsWith(Informix, StringComparison.OrdinalIgnoreCase))
            return null;

        var rest = url[Informix.Length..];
        var slash = rest.IndexOf('/');
        if (slash < 0 || !TryHostAndPort(rest[..slash], out var host, out var port))
            return null;

        // `banco:PROP=valor;PROP=valor`, ou `banco;PROP=valor`, ou só `:INFORMIXSERVER=servidor` (o banco vazio).
        var afterSlash = rest[(slash + 1)..];
        var properties = afterSlash.IndexOfAny([':', ';']);
        var database = properties < 0 ? afterSlash : afterSlash[..properties];

        string? server = null;
        if (properties >= 0)
            foreach (var property in afterSlash[(properties + 1)..].Split(';'))
            {
                var equals = property.IndexOf('=');
                if (equals > 0 && string.Equals(property[..equals].Trim(), "INFORMIXSERVER", StringComparison.OrdinalIgnoreCase))
                    server = Empty(property[(equals + 1)..]);
            }

        return new Parsed(host, port, Empty(database), server);
    }

    /// <summary>`host`, `host:porta` ou `[ipv6]:porta`. O `@` (um usuário no endereço), o host vazio e a porta que não são dígitos não casam. A porta ausente ou vazia é nula.</summary>
    private static bool TryHostAndPort(string text, out string host, out string? port)
    {
        host = string.Empty;
        port = null;

        var value = text.Trim();
        if (value.Length == 0 || value.Contains('@'))
            return false;

        string? portText;
        if (value[0] == '[')
        {
            var close = value.IndexOf(']');
            if (close < 0)
                return false;

            host = value[1..close];
            var after = value[(close + 1)..];
            if (after.Length > 0 && after[0] != ':')
                return false;

            portText = after.Length > 1 ? after[1..] : null;
        }
        else
        {
            var colon = value.LastIndexOf(':');
            host = colon < 0 ? value : value[..colon];
            portText = colon < 0 || colon == value.Length - 1 ? null : value[(colon + 1)..];
        }

        if (host.Length == 0 || host.Contains(':') && value[0] != '[')
            return false;

        if (portText is not null && !(portText.Length > 0 && portText.All(char.IsAsciiDigit)))
            return false;

        port = portText;

        return true;
    }

    private static string? Empty(string? text)
        => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>A porta como o inteiro do JDBC, ou nulo quando não é um inteiro de 1 a 65535.</summary>
    public static int? PortNumber(string? text)
        => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value is >= 1 and <= 65535 ? value : null;
}
