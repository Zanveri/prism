using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace Prism.Api.Hosting;

/// <summary>
/// Escreve `PRISM_API_READY &lt;porta&gt;` na saída padrão quando o Kestrel já escuta. A porta é
/// efêmera (`127.0.0.1:0`), então só o servidor em pé sabe qual é; o processo principal do
/// Electron lê esta linha para saber onde chamar. É a única coisa que a API escreve na saída padrão.
/// </summary>
internal static class ReadyAnnouncer
{
    public static void Announce(IServer server, TextWriter output)
    {
        var address = server.Features.Get<IServerAddressesFeature>()!.Addresses.Single();

        output.WriteLine($"PRISM_API_READY {new Uri(address).Port}");
    }
}
