using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// O idioma das mensagens da API vem do <c>Accept-Language</c> que a tela manda (pt-BR, en, es; en-US vale en): o título e o detalhe do erro de um
/// handler e a mensagem de um validator saem no idioma pedido, e sem cabeçalho, ou com um idioma fora da lista, em português, como antes.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class AcceptLanguageTests
{
    private const string BuildModelsPath = "/api/user/build-models";

    [Test]
    public async Task ErrorTexts_FollowTheAcceptLanguage_AndArePortugueseWithoutIt()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var id = Guid.NewGuid();

        async Task<JsonElement> SendAsync(HttpMethod method, string? language, HttpContent? content = null)
        {
            using var request = new HttpRequestMessage(method, method == HttpMethod.Get ? $"{BuildModelsPath}/{id}" : BuildModelsPath) { Content = content };

            if (language is not null)
                request.Headers.Add("Accept-Language", language);

            using var response = await host.Client.SendAsync(request);

            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }

        var english = await SendAsync(HttpMethod.Get, "en");
        Assert.That(english.GetProperty("type").GetString(), Is.EqualTo("BUILD_MODEL_NOT_FOUND"));
        Assert.That(english.GetProperty("title").GetString(), Is.EqualTo("Model not found."));
        Assert.That(english.GetProperty("detail").GetString(), Is.EqualTo($"There is no model with the ID {id}."));

        Assert.That((await SendAsync(HttpMethod.Get, "en-US,en;q=0.9")).GetProperty("title").GetString(), Is.EqualTo("Model not found."));
        Assert.That((await SendAsync(HttpMethod.Get, "es")).GetProperty("title").GetString(), Is.EqualTo("Modelo no encontrado."));
        Assert.That((await SendAsync(HttpMethod.Get, "fr")).GetProperty("title").GetString(), Is.EqualTo("Modelo não localizado."));

        var portuguese = await SendAsync(HttpMethod.Get, null);
        Assert.That(portuguese.GetProperty("title").GetString(), Is.EqualTo("Modelo não localizado."));
        Assert.That(portuguese.GetProperty("detail").GetString(), Is.EqualTo($"Não existe um modelo com o ID {id}."));

        // A mensagem do validator é lida na validação, no idioma do pedido.
        var refused = await SendAsync(HttpMethod.Post, "en", JsonContent.Create(new { name = "", body = """{"version":1}""" }));
        Assert.That(refused.GetProperty("type").GetString(), Is.EqualTo("BUILD_MODEL_NAME_INVALID"));
        Assert.That(refused.GetProperty("errors").GetProperty("Name")[0].GetString(), Is.EqualTo("The model name must have 1 to 200 characters, with no control characters."));
        Assert.That(refused.GetProperty("title").GetString(), Is.EqualTo("Error sending data to the API."));
        Assert.That(refused.GetProperty("detail").GetString(), Is.EqualTo("Check the incorrect data and try again."));

        // A recusa da porta de entrada (o 422 do GlobalValidationExceptionFilter) também segue o idioma, e sem cabeçalho sai em português.
        var recusada = await SendAsync(HttpMethod.Post, null, JsonContent.Create(new { name = "", body = """{"version":1}""" }));
        Assert.That(recusada.GetProperty("title").GetString(), Is.EqualTo("Erro ao enviar dados para a API."));
    }
}
