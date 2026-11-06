using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.BuildModels.Models.Dtos;

/// <summary>Um modelo do Construir, com o corpo JSON: resposta de <c>GET</c>, <c>POST</c> e <c>PATCH</c> em <c>api/user/build-models</c> (seção 7 da especificação).</summary>
public sealed record BuildModelDto
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Body { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o corpo do modelo.</summary>
    public override string ToString()
        => nameof(BuildModelDto);
}

internal static class BuildModelMappings
{
    public static BuildModelDto ToDto(this VaultBuildModelRecord record)
        => new()
        {
            ID = record.ID,
            Name = record.Name,
            Body = record.Body,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
        };
}
