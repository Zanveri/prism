using Prism.IntegrationTesting.Api.Support;
using Prism.TestingCore.Fakers.Dbeaver;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// RN-LOG-001 e RN-DBEAVER-006 a 008 e 016: o log da contagem, da prévia e da importação do DBeaver tem as contagens, os IDs e a classe da recusa, e nunca um nome, um
/// host, um usuário, uma senha, um ID do DBeaver, o nome de um projeto, a URL (nem o que vinha nela depois do corte), o `sourceId` de uma cópia que não existe nem um caminho,
/// em nenhum caminho (a contagem, a prévia, a importação, a reimportação que sobrescreve, o projeto que não existe, a cópia que sumiu). Roda a API como processo: só o
/// processo liga o Serilog e escreve `logs/`. O teste começa conferindo que o log registrou as três: procurar uma marca num log que nunca foi escrito passaria sem provar
/// nada. Não precisa de banco.
/// </summary>
[TestFixture]
[Category("Api")]
public sealed class DbeaverImportsLogTests
{
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(15);

    private static Guid PutWorkspace(ApiProcess api)
    {
        var folder = Path.Combine(api.DataDirectory, "transfers");
        Directory.CreateDirectory(folder);

        return DbeaverWorkspace.Add(new DbeaverCopyBuilder(folder)).Build();
    }

    private static List<string?> Importable(JsonElement preview)
        => [.. preview.GetProperty("folders").EnumerateArray().Concat(preview.GetProperty("connections").EnumerateArray()).Where(item => item.GetProperty("invalid").ValueKind == JsonValueKind.Null).Select(item => item.GetProperty("key").GetString())];

    [Test]
    public async Task Logs_DoNotContainAnythingFromTheDbeaver()
    {
        using var parent = ApiProcess.StartParentStandIn();
        using var api = await ApiProcess.StartAsync(parentProcessID: parent.Id);
        await api.Client.CreateUserAsync("marina.costa", $"senha-{Guid.NewGuid():N}-forte");

        var first = PutWorkspace(api);
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/scan", new { sourceId = first })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        var preview = await (await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import/preview", new { sourceId = first })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import/preview", new { sourceId = first, project = "Projeto-que-nao-existe" })).StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import", new { sourceId = first, items = Importable(preview) })).StatusCode, Is.EqualTo(HttpStatusCode.OK));

        // A reimportação que sobrescreve, e a cópia que sumiu.
        var second = PutWorkspace(api);
        var again = await (await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import/preview", new { sourceId = second })).Content.ReadFromJsonAsync<JsonElement>();
        var existing = again.GetProperty("connections").EnumerateArray().Where(connection => connection.GetProperty("existing").ValueKind == JsonValueKind.Object).Select(connection => connection.GetProperty("key").GetString()).ToList();
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import", new { sourceId = second, items = Importable(again), overwrite = existing })).StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await api.Client.PostAsJsonAsync("/api/user/connections/dbeaver/import", new { sourceId = first, items = new[] { "c1" } })).StatusCode, Is.EqualTo(HttpStatusCode.NotFound));

        Assert.That(await ApiProcess.StopThroughParentAsync(parent, api, ShutdownTimeout), Is.Zero);
        var logs = api.ReadLogs();

        Assert.That(logs, Is.Not.Empty, "A API não escreveu nenhum arquivo em logs/.");
        Assert.That(logs.Values.Any(log => log.Contains("Contagem do DBeaver", StringComparison.Ordinal)), Is.True, "O log não registra a contagem: o teste não prova nada se o log não está ligado.");
        Assert.That(logs.Values.Any(log => log.Contains("Prévia da importação do DBeaver", StringComparison.Ordinal)), Is.True, "O log não registra a prévia.");
        Assert.That(logs.Values.Any(log => log.Contains("Importação do DBeaver", StringComparison.Ordinal)), Is.True, "O log não registra a importação.");
        Assert.That(logs.Values.Any(log => log.Contains("atualizadas", StringComparison.Ordinal)), Is.True, "O log da reimportação deveria ter os IDs atualizados.");

        string[] forbidden =
        [
            DbeaverWorkspace.Mark, "senha-", ".exemplo.invalid", "usuario-", "Pedidos PG", "USER MIGRATION", "Vendas", "Legado", "Seguro", "Projeto-que-nao-existe", "postgres-jdbc-1a0d49eb651", "informix-1999a18bee0",
            "far_ewm_001", "tramon", "jdbc:", "bastion", "Pasta com um nome", "backup-duplicate-id", "transfers"
        ];
        foreach (var (file, log) in logs)
            foreach (var text in forbidden)
                Assert.That(log, Does.Not.Contain(text), $"{file} tem {text}, que veio do DBeaver.");
    }
}
