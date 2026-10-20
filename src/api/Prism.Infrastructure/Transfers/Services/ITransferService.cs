using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Models;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-EXPORT-016: o registro das transferências em segundo plano, um só na API (`Singleton`, como o das sessões, decisão 3 da seção 8), para as
/// exportações de dados e, quando vierem, as importações e as cópias para outro banco (seção 36), que usam o mesmo registro e o mesmo limite. Cada
/// trabalho é do cofre aberto quando começou: fechar o cofre (por qualquer caminho) cancela os dele, apaga os arquivos e os tira do registro.
/// </summary>
public interface ITransferService
{
    /// <summary>
    /// Começa a exportação e volta antes de falar com o banco: conectar, contar e ler acontecem no trabalho, e a falha de cada um é o fim dele. A geração
    /// do cofre (lida por quem chama ANTES de ler a conexão) e o limite de transferências em andamento são conferidos sob a mesma trava com que o trabalho
    /// entra no registro: dois pedidos ao mesmo tempo não passam os dois, e um cofre que mudou não fica com o trabalho.
    /// </summary>
    Result<Guid, ETransferStartFailure> StartExport(ExportJob job);

    /// <summary>
    /// RN-IMPORT-014: começa a importação e volta antes de falar com o banco. Sob a mesma trava com que o trabalho entra no registro: a geração do cofre, o
    /// limite, a tabela ocupada (outra importação ou cópia para a mesma tabela em andamento) e a troca de nome do arquivo (`&lt;fileId&gt;.in` passa a
    /// `&lt;id&gt;.in`, e daí em diante é do trabalho; o que sumiu antes da troca é `FileMissing`). O cofre que muda depois da troca apaga o arquivo tomado.
    /// </summary>
    Result<Guid, ETransferStartFailure> StartImport(ImportJob job);

    /// <summary>RN-IMPORT-027: começa a cópia para outro banco, com as mesmas conferências da importação sob a trava, menos o arquivo.</summary>
    Result<Guid, ETransferStartFailure> StartCopy(CopyJob job);

    /// <summary>
    /// Como o trabalho está, ou nulo quando ele não existe (esquecido, abandonado, de outro cofre). A consulta é o que o mantém vivo: o que ninguém
    /// consulta por 5 minutos, em qualquer estado, é dado como abandonado.
    /// </summary>
    TransferInfo? Get(Guid id);

    /// <summary>Os trabalhos do cofre aberto, de todas as janelas, na ordem em que começaram. Não conta como consulta de nenhum deles.</summary>
    IReadOnlyList<TransferInfo> List();

    /// <summary>
    /// O `DELETE`: cancela o trabalho que roda (interrompe o comando no banco, fecha a conexão à parte, apaga o arquivo) e só volta quando ele parou, ou
    /// passado o prazo de 10 segundos (aí o trabalho fica `canceled` assim mesmo, deixa de contar para o limite, e a conexão é abandonada em segundo
    /// plano); o cancelado continua no registro até ser esquecido. O que termina `done` apesar do cancelamento (o último lote chegou antes dele) é
    /// esquecido na hora, com o arquivo pronto: quem pediu o cancelamento não o consulta mais; a importação e a cópia que terminam `done` assim ficam no
    /// registro, para a tela ler o fim delas (RN-IMPORT-019). Abandonada a importação ou a cópia no meio de uma confirmação (ou, no Informix sem log, de um
    /// comando), o fim leva `uncertain`. Esquece o que terminou, apagando o arquivo que sobrou. Falso quando o trabalho não existe.
    /// </summary>
    Task<bool> DeleteAsync(Guid id);

    /// <summary>
    /// RN-CONN-014: a conexão foi excluída: as transferências que leem dela ou gravam nela (a origem e o destino da cópia) em andamento são canceladas, com
    /// o motivo `connectionDeleted`.
    /// </summary>
    void CancelByConnection(Guid connectionID);
}
