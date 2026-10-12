using CSharpFunctionalExtensions;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.Infrastructure.Drivers.Clients;

/// <summary>
/// O que nos drivers pode falhar por fora do código: a rede (o nuget.org) e o disco (a pasta de drivers). Nenhuma exceção sai daqui.
/// Quem chama só diz QUAL driver, pelo identificador do catálogo: o endereço do download, o hash esperado, o nome da pasta e os arquivos
/// que saem do pacote são sempre os do catálogo desta API, nunca um valor recebido (RN-DRIVER-003 e 008).
/// </summary>
public interface IDriverPackageClient
{
    /// <summary>
    /// A conferência da partida, uma vez por execução da API e antes de qualquer carga do driver: executa a remoção marcada na execução
    /// anterior (RN-DRIVER-007), apaga as sobras de uma instalação interrompida e confere a pasta, o registro e os hashes do assembly
    /// gerenciado e da biblioteca nativa principal. Verdadeiro só quando o driver está instalado e íntegro, e a partir daí é dessa
    /// pasta que esta execução o carrega (RN-DRIVER-005); o motivo de um "não" que merece atenção vai para o log, e a API segue sem o
    /// driver.
    /// </summary>
    bool CheckInstallation(string driverID);

    /// <summary>
    /// RN-DRIVER-003: baixa o pacote do catálogo, confere o tamanho e o SHA-512 antes de abri-lo, extrai só as entradas esperadas numa
    /// pasta temporária, grava o registro com o aceite e só então dá à pasta o nome da versão. Qualquer falha (ou o cancelamento) deixa
    /// a pasta de drivers como estava. `onProgress` recebe o total de bytes já baixados.
    /// </summary>
    Task<UnitResult<DriverInstallFailure>> InstallAsync(string driverID, DateTimeOffset acceptedAt, Action<long> onProgress, CancellationToken cancellationToken);

    /// <summary>RN-DRIVER-007: marca o driver instalado para ser apagado na próxima partida. Falha de disco é `StoreUnavailable`.</summary>
    UnitResult<EDriverFailure> MarkForRemoval(string driverID);
}
