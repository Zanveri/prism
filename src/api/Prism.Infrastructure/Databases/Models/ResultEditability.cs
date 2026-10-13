namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-EDIT-002: o que se sabe da edição de um resultado sem consultar o banco. `Known` falso é "só o catálogo sabe" (a tela pergunta
/// pelo `edit-target` na primeira tentativa de editar); verdadeiro vem sempre com o motivo de o resultado inteiro ser só leitura.
/// </summary>
public sealed record ResultEditability(bool Known, string? Reason)
{
    public static ResultEditability Unknown { get; } = new(false, null);

    public static ResultEditability ReadOnly(string reason)
        => new(true, reason);
}
