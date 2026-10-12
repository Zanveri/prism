using System.Diagnostics;

namespace Prism.Api.Hosting;

/// <summary>
/// RN-API-004: a API encerra quando o processo de `PRISM_PARENT_PID` deixa de existir. Sem isso,
/// um Electron que cai à força deixaria a API órfã, com as conexões abertas nos bancos do
/// usuário. Sem PID, não faz nada.
/// </summary>
internal sealed class ParentProcessWatcher(PrismHostOptions options, IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.ParentProcessID is not { } parentProcessID)
            return;

        var parent = Find(parentProcessID);
        if (parent is not null)
        {
            using (parent)
                await parent.WaitForExitAsync(stoppingToken);
        }

        lifetime.StopApplication();
    }

    /// <summary>O pai pode já ter saído antes de este serviço começar: `GetProcessById` lança, e é isso que "não existe mais" quer dizer.</summary>
    private static Process? Find(int processID)
    {
        try
        {
            return Process.GetProcessById(processID);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
