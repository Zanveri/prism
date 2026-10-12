namespace Prism.Application.Connections.Models.Dtos;

/// <summary>A senha do banco, devolvida só por `POST api/user/connections/{id}/password/reveal` (RN-CONN-002).</summary>
public sealed record ConnectionPasswordDto
{
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha.</summary>
    public override string ToString() => nameof(ConnectionPasswordDto);
}
