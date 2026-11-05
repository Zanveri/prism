using System.Text.Json;

namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// RN-VAR-028: os valores lembrados do "Executar com valores…" de um script, como ficam dentro do registro dele no cofre (cifrados com o script, e excluídos com ele):
/// o mapa do nome da variável para o valor, como a tela o mandou (a API não interpreta os valores), a conexão e o banco escolhidos no script genérico, e a hora da
/// gravação, em UTC. São dados: o `ToString()` escreve só o nome do tipo (RN-LOG-001 e RN-VAR-036).
/// </summary>
public sealed record VaultScriptRunValuesRecord(JsonElement Values, Guid? ConnectionID, string? Database, DateTime SavedAt)
{
    public override string ToString()
        => nameof(VaultScriptRunValuesRecord);
}
