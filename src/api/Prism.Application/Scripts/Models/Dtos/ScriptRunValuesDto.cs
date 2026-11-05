using System.Text.Json;

namespace Prism.Application.Scripts.Models.Dtos;

/// <summary>
/// RN-VAR-028: os valores lembrados de um script, no `runValues` de `GET api/user/scripts/{id}`: o mapa como a tela o gravou, a conexão e o banco do script
/// genérico (nulos no que tem lugar) e a hora da gravação, em UTC. São dados: o `ToString()` escreve só o nome do tipo (RN-VAR-036).
/// </summary>
public sealed record ScriptRunValuesDto(JsonElement Values, Guid? ConnectionID, string? Database, DateTime SavedAt)
{
    public override string ToString() => nameof(ScriptRunValuesDto);
}
