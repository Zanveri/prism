using FluentValidation;
using Prism.Application.Connections.Models;
using System.Globalization;
using System.Text.Json;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// A porta DRDA de um servidor Informix do DBeaver, como a tela a manda (adição à RN-DBEAVER-010): `host`, `port` (a porta SQLI) e `server` (o `INFORMIXSERVER`, nulo
/// sem ele) são os da conexão na prévia (`host`, `dbeaverPort` e `server`), e `drdaPort` é a porta que a pessoa preencheu.
/// </summary>
public sealed record DbeaverDrdaPortDto
{
    public string? Host { get; init; }
    public int? Port { get; init; }
    public string? Server { get; init; }
    public int? DrdaPort { get; init; }

    /// <summary>RN-LOG-001: o host e o servidor do DBeaver não vão a log.</summary>
    public override string ToString()
        => nameof(DbeaverDrdaPortDto);
}

/// <summary>As regras dos pedidos do "Importar do DBeaver" que valem antes do handler, sem ler a cópia nem o cofre (seção 6 e RN-DBEAVER-016).</summary>
internal static class DbeaverRequests
{
    /// <summary>As portas DRDA de um pedido: até 2.000, como as chaves de `overwrite`.</summary>
    public const int MaxDrdaPorts = 2000;
    public const int MaxOverwrite = 2000;

    /// <summary>O `sourceId` é o identificador de 36 caracteres, em minúsculas e com os hifens, que o processo principal dá; só o formato passa, e o caminho é montado pela API.</summary>
    public static bool IsSourceId(string? sourceId)
        => sourceId is { Length: 36 } && Guid.TryParseExact(sourceId, "D", out var parsed) && parsed.ToString("D") == sourceId;

    public static Guid SourceIdOf(string sourceId)
        => Guid.ParseExact(sourceId, "D");

    /// <summary>"Levar as senhas": ausente ou nulo é verdadeiro; verdadeiro e falso valem; o resto não é booleano.</summary>
    public static bool WithPasswordsIsValid(JsonElement? withPasswords)
        => withPasswords is null || withPasswords.Value.ValueKind is JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined;

    public static bool WithPasswordsOf(JsonElement? withPasswords)
        => withPasswords?.ValueKind != JsonValueKind.False;

    /// <summary>
    /// As portas DRDA: nenhuma, ou até 2.000, cada uma com o host (de 1 a 255 caracteres), a porta SQLI e a DRDA de 1 a 65.535, sem repetir o mesmo servidor (host, porta
    /// SQLI e `INFORMIXSERVER` como vêm).
    /// </summary>
    public static bool DrdaPortsAreValid(IReadOnlyList<DbeaverDrdaPortDto?>? drdaPorts)
    {
        if (drdaPorts is null)
            return true;

        if (drdaPorts.Count > MaxDrdaPorts || drdaPorts.Any(entry => entry is null))
            return false;

        var valid = drdaPorts.All(entry => !string.IsNullOrWhiteSpace(entry!.Host) && entry.Host.Trim().Length <= ConnectionRules.HostMaxLength
            && entry.Port is { } port && ConnectionRules.PortRefusal(port) is null
            && entry.DrdaPort is { } drda && ConnectionRules.PortRefusal(drda) is null);

        return valid && DrdaPortsOf(drdaPorts).Select(entry => (entry.Host, entry.Port, entry.Server)).Distinct().Count() == drdaPorts.Count;
    }

    /// <summary>As portas DRDA já na forma que a leitura compara: o host aparado, o servidor aparado e nulo quando vazio.</summary>
    public static IReadOnlyList<DbeaverDrdaPort> DrdaPortsOf(IReadOnlyList<DbeaverDrdaPortDto?>? drdaPorts)
        => [.. (drdaPorts ?? []).Select(entry => new DbeaverDrdaPort(entry!.Host!.Trim(), entry.Port!.Value, string.IsNullOrWhiteSpace(entry.Server) ? null : entry.Server.Trim(), entry.DrdaPort!.Value))];

    /// <summary>`overwrite`: até 2.000 chaves, nenhuma nula e nenhuma repetida. Que sejam de conexões marcadas só se sabe com a cópia aberta (o handler).</summary>
    public static bool OverwriteIsValid(IReadOnlyList<string?>? overwrite)
        => overwrite is null || (overwrite.Count <= MaxOverwrite && overwrite.All(key => key is not null) && overwrite.Distinct(StringComparer.Ordinal).Count() == overwrite.Count);

    public static IRuleBuilderOptions<T, string?> MustBeASourceId<T>(this IRuleBuilder<T, string?> rule)
        => rule.Must(IsSourceId).WithMessage("O identificador da cópia do DBeaver não é válido.").WithErrorCode("IMPORT_INVALID");

    public static string Digits(int value)
        => value.ToString(CultureInfo.InvariantCulture);
}
