namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-VERIF-002: o que a verificação periódica de uma conexão achou.</summary>
public enum EVerificationStatus
{
    /// <summary>A consulta de verificação respondeu, numa sessão aberta da conexão.</summary>
    Ok,

    /// <summary>A consulta de verificação falhou: a mensagem e o SQLSTATE são os do banco.</summary>
    Failed,

    /// <summary>Todas as sessões abertas da conexão estavam com um comando em andamento ou com um cursor aberto: verificada na próxima.</summary>
    Busy,

    /// <summary>Nenhuma sessão da conexão está aberta no cofre aberto: não há o que verificar, e nenhuma sessão é aberta para isso.</summary>
    NotConnected
}

/// <summary>
/// RN-VERIF-002: o desfecho de uma verificação. `ElapsedMs` só em `Ok` e `Failed`, o tempo da consulta; `Message` e `SqlState` só em `Failed`, como o
/// banco os mandou (decisão 4 do guia da raiz), e por isso nunca vão para o log (RN-LOG-001).
/// </summary>
public sealed record ConnectionVerification(EVerificationStatus Status, long? ElapsedMs = null, string? Message = null, string? SqlState = null)
{
    /// <summary>RN-LOG-001: a mensagem do banco pode citar a consulta e os dados.</summary>
    public override string ToString()
        => $"{nameof(ConnectionVerification)} {{ Status = {Status} }}";
}
