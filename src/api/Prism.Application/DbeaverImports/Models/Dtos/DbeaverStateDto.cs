namespace Prism.Application.DbeaverImports.Models.Dtos;

/// <summary>
/// RN-DBEAVER-018: o que o cofre do usuário guarda do DBeaver. `InvitedAt` é quando o convite foi feito e `LastImportAt`, quando a última importação que
/// gravou algo aconteceu, as duas em UTC e nulas até acontecerem (RN-CONFIG-011 mostra a segunda).
/// </summary>
public sealed record DbeaverStateDto
{
    public DateTime? InvitedAt { get; init; }
    public DateTime? LastImportAt { get; init; }
}
