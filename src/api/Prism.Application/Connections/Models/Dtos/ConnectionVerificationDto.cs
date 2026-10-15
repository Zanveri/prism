namespace Prism.Application.Connections.Models.Dtos;

/// <summary>
/// RN-VERIF-002: `status` é `ok`, `failed`, `busy` ou `notConnected`; `checkedAt` é o instante da resposta (UTC); `elapsedMs`, o tempo da consulta (só em
/// `ok` e `failed`); `message` e `sqlState`, só em `failed`, com a mensagem do banco como veio e o SQLSTATE quando o driver o informa.
/// </summary>
public sealed record ConnectionVerificationDto
{
    public string Status { get; init; } = string.Empty;
    public DateTime CheckedAt { get; init; }
    public long? ElapsedMs { get; init; }
    public string? Message { get; init; }
    public string? SqlState { get; init; }
}
