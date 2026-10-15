namespace Prism.Application.Scripts.Models.Dtos;

/// <summary>O script inteiro, com o SQL: a resposta de `GET api/user/scripts/{id}`, que a tela abre numa aba.</summary>
public sealed record ScriptDto
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? ConnectionID { get; init; }
    public string? Database { get; init; }
    public string Sql { get; init; } = string.Empty;
    public DateTime UpdatedAt { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o texto do SQL.</summary>
    public override string ToString() => nameof(ScriptDto);
}
