namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-018: a pasta `transfers` da pasta de dados (`&lt;PRISM_DATA_DIR&gt;/transfers`), onde ficam os arquivos temporários das transferências, com o
/// nome tirado só do identificador do trabalho. Nenhum caminho vem da tela.
/// </summary>
/// <param name="Directory">A pasta `transfers`.</param>
/// <param name="AbandonAfter">RN-EXPORT-016: o trabalho que ninguém consulta por este tempo é dado como abandonado (5 minutos, o do cursor parado).</param>
/// <param name="StallAfter">RN-EXPORT-016: o trabalho que fica este tempo sem avançar termina com `EXPORT_STALLED` (2 horas).</param>
/// <param name="CancelWait">RN-EXPORT-016: o tempo que o `DELETE` espera o trabalho parar antes de responder (10 segundos).</param>
/// <param name="Limit">RN-EXPORT-016: as transferências em andamento ao mesmo tempo, de todas as janelas e de todos os tipos (3).</param>
internal sealed record TransferSettings(string Directory, TimeSpan AbandonAfter, TimeSpan StallAfter, TimeSpan CancelWait, int Limit)
{
    /// <summary>De quanto em quanto tempo o registro confere o abandono e a falta de progresso.</summary>
    public TimeSpan CheckEvery { get; init; } = TimeSpan.FromSeconds(15);

    public static TransferSettings For(string dataDirectory)
        => new(Path.Combine(dataDirectory, "transfers"), TimeSpan.FromMinutes(5), TimeSpan.FromHours(2), TimeSpan.FromSeconds(10), 3);
}
