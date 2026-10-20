namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// RN-DBEAVER-018: de onde uma conexão importada veio, para a reimportação reconhecê-la (RN-DBEAVER-017). `Source` é `dbeaver` (o programa de onde veio, por
/// enquanto o único), `Project` é o nome inteiro do projeto do DBeaver (até 255 caracteres) e `ID` é o ID da conexão lá (até 128). Campo novo e opcional da
/// conexão gravada, nulo na que o usuário criou: a leitura do cofre (`JsonSerializer` com as opções padrão, a mesma desde o formato 1) o entrega nulo ao JSON
/// de antes e uma versão anterior do Prism o ignora, então o formato do cofre não sobe (RN-VERSAO-005).
/// </summary>
public sealed record VaultConnectionOrigin(string Source, string Project, string ID)
{
    /// <summary>O único programa de onde o Prism importa por enquanto.</summary>
    public const string DbeaverSource = "dbeaver";

    public const int ProjectMaxLength = 255;
    public const int IDMaxLength = 128;

    /// <summary>RN-LOG-001: o nome do projeto e o ID do DBeaver não vão a log; o `ToString()` gerado os imprimiria.</summary>
    public override string ToString()
        => nameof(VaultConnectionOrigin);
}
