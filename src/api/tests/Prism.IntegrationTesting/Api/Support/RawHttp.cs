using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// Um GET por socket, com o alvo da requisição exatamente como o teste o escreveu. O `HttpClient` normaliza a URL antes de enviar (tira
/// `.` e `..`, e desfaz `%2E`), e o que a API lê do alvo cru nunca chegaria a ela.
/// </summary>
internal static class RawHttp
{
    /// <param name="rawTarget">O caminho e a query string como vão na linha de pedido (`/api/user/...`).</param>
    public static async Task<(HttpStatusCode Status, string Body)> GetAsync(ApiHost host, string rawTarget)
    {
        var address = host.Client.BaseAddress!;
        using var tcp = new TcpClient();
        await tcp.ConnectAsync(address.Host, address.Port);
        await using var stream = tcp.GetStream();

        // `Connection: close` faz o servidor fechar no fim da resposta, e a leitura até o fim devolve tudo.
        var request = $"GET {rawTarget} HTTP/1.1\r\nHost: {address.Host}:{address.Port}\r\nAuthorization: Bearer {host.Token}\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(request));

        using var reader = new StreamReader(stream, Encoding.UTF8);
        var response = await reader.ReadToEndAsync();
        var head = response.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        var statusLine = response[..response.IndexOf("\r\n", StringComparison.Ordinal)];

        return ((HttpStatusCode)int.Parse(statusLine.Split(' ')[1]), response[(head + 4)..]);
    }
}
