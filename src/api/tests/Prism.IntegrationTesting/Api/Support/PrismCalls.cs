using Prism.Infrastructure.Databases.Models;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// As chamadas que os testes de sessão com o banco repetem para chegar ao ponto que interessa a cada um: criar o usuário, gravar uma
/// conexão com o PostgreSQL de teste e abrir uma sessão. Cada uma confere o status que o arranjo precisa (um teste que arruma estado
/// não segue adiante com um passo recusado) e devolve o que a seguinte usa. Servem ao `ApiHost` e ao `ApiProcess`: ambos têm um
/// `HttpClient` com o token.
/// </summary>
internal static class PrismCalls
{
    public const string SessionsPath = "/api/user/database-sessions";

    public static async Task CreateUserAsync(this HttpClient client, string userName, string password)
        => (await client.PostAsJsonAsync("/api/public/users", new { userName, password })).EnsureSuccessStatusCode();

    /// <summary>Grava a conexão no cofre, com os dados do contêiner. `userName` e `password` trocam os do contêiner (um papel criado pelo teste, uma senha errada).</summary>
    public static async Task<Guid> CreateConnectionAsync(this HttpClient client, ConnectionSettings settings, string name = "Banco de teste", string? userName = null, string? password = null)
    {
        var response = await client.PostAsJsonAsync("/api/user/connections", new { folderID = (Guid?)null, name, engine = (int)settings.Engine, host = settings.Host, port = settings.Port, database = settings.Database, userName = userName ?? settings.UserName, password = password ?? settings.Password });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    public static Task<HttpResponseMessage> OpenSessionRawAsync(this HttpClient client, Guid connectionID)
        => client.PostAsJsonAsync(SessionsPath, new { connectionID });

    public static async Task<Guid> OpenSessionAsync(this HttpClient client, Guid connectionID)
    {
        var response = await client.OpenSessionRawAsync(connectionID);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created), await response.Content.ReadAsStringAsync());

        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    public static Task<HttpResponseMessage> ExecuteRawAsync(this HttpClient client, Guid sessionID, string sql)
        => client.PostAsJsonAsync($"{SessionsPath}/{sessionID}/queries", new { sql });

    /// <summary>Executa e confere o 200: para o comando de arranjo, que não pode falhar.</summary>
    public static async Task<JsonElement> ExecuteAsync(this HttpClient client, Guid sessionID, string sql)
    {
        var response = await client.ExecuteRawAsync(sessionID, sql);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK), body.ToString());

        return body;
    }

    /// <summary>O número do processo do PostgreSQL que atende a sessão: é como o teste a reconhece no `pg_stat_activity`.</summary>
    public static async Task<long> BackendPidAsync(this HttpClient client, Guid sessionID)
        => long.Parse((await client.ExecuteAsync(sessionID, "SELECT pg_backend_pid()")).GetProperty("rows")[0][0].GetString()!);
}
