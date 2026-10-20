using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// A exportação de dados pela rota, como a tela a faz (RN-EXPORT-015 a 020): o `POST`, a consulta a cada 100 ms até o fim, o arquivo pronto lido da pasta
/// `transfers` (o que o processo principal do Electron entregaria) e o `DELETE` que esquece o trabalho. Para o teste que precisa do texto exportado e não
/// confere a rota em si (essa é do `TransfersTests`).
/// </summary>
internal static class TransferCalls
{
    public const string ExportsPath = "/api/user/transfers/exports";

    /// <summary>Exporta pela rota, confere o `done` sem linha pulada e devolve o texto do arquivo, em UTF-8.</summary>
    public static async Task<string> ExportTextAsync(ApiHost host, object request)
    {
        var started = await host.Client.PostAsJsonAsync(ExportsPath, request);
        var body = await started.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(started.StatusCode, Is.EqualTo(HttpStatusCode.Accepted), body.ToString());
        var id = body.GetProperty("id").GetGuid();

        var deadline = DateTime.UtcNow.AddSeconds(60);
        JsonElement transfer;
        while (true)
        {
            transfer = await host.Client.GetFromJsonAsync<JsonElement>($"/api/user/transfers/{id}");
            if (transfer.GetProperty("state").GetString() != "running")
                break;

            Assert.That(DateTime.UtcNow, Is.LessThan(deadline), "O trabalho não terminou em 60 segundos.");
            await Task.Delay(100);
        }

        Assert.That(transfer.GetProperty("state").GetString(), Is.EqualTo("done"), transfer.ToString());
        Assert.That(transfer.GetProperty("summary").GetProperty("skippedRows").GetInt64(), Is.Zero, transfer.ToString());
        var text = await File.ReadAllTextAsync(Path.Combine(host.DataDirectory, "transfers", $"{id:D}.ready"), Encoding.UTF8);
        Assert.That((await host.Client.DeleteAsync($"/api/user/transfers/{id}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        return text;
    }

    /// <summary>O pedido de exportação de um resultado, com as colunas na ordem do resultado e a saída num arquivo, sem BOM e sem .zip.</summary>
    public static object QueryExport(Guid connectionID, string sql, IReadOnlyList<string> columns, string format, object? options = null)
        => new
        {
            source = new { kind = "query", connectionID, sql, name = "exporta" },
            columns = columns.Select((name, position) => new { position, name }).ToArray(),
            count = false,
            format,
            options,
            output = new { bom = false, zip = false, clipboard = false },
            windowID = 1
        };
}
