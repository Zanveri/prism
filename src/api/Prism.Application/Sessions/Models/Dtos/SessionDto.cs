namespace Prism.Application.Sessions.Models.Dtos;

/// <summary>O estado do cofre para a tela. Fechado é `{ unlocked: false, userName: null }`.</summary>
public sealed record SessionDto
{
    public bool Unlocked { get; init; }
    public string? UserName { get; init; }
}
