namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-018: a falha do disco na pasta `transfers`: o disco cheio, ou outra, com o motivo do sistema sem o caminho (a mensagem da exceção traz o
/// caminho, e por isso nunca é usada).
/// </summary>
internal sealed record TransferFileFailure(bool DiskFull, string Reason);
