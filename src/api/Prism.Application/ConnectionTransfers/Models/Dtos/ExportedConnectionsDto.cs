namespace Prism.Application.ConnectionTransfers.Models.Dtos;

/// <summary>
/// RN-TRANSF-008: a resposta da exportação. `Content` é o texto do arquivo já cifrado, que a tela entrega ao diálogo de salvar do sistema sem conseguir ler:
/// é o único jeito de uma senha de banco sair da API fora da revelação (RN-CONN-001). As contagens são do que foi no arquivo (as pastas do caminho contam):
/// quantas conexões levam o usuário e quantas levam a senha.
/// </summary>
public sealed record ExportedConnectionsDto
{
    public string Content { get; init; } = string.Empty;
    public int Folders { get; init; }
    public int Connections { get; init; }
    public int WithUser { get; init; }
    public int WithPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o arquivo.</summary>
    public override string ToString()
        => nameof(ExportedConnectionsDto);
}
