using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Application.Folders.Queries;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Users;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Prism.IntegrationTesting.Api;

/// <summary>
/// As pastas do usuário (`api/user/folders`), pela API de verdade: RN-PASTA-001 a 004 e a barreira do
/// cofre (RN-API-005). É a primeira rota `api/user/...`, então também prova o que as próximas herdam:
/// o token vem antes do cofre, e um caminho que foge do prefixo nunca devolve dado. Cada teste sobe
/// uma API própria, com a pasta de dados própria.
/// </summary>
[TestFixture]
[Category("Api")]
[Parallelizable(ParallelScope.Self)]
public sealed class FoldersTests
{
    private const string FoldersPath = "/api/user/folders";

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string type)
    {
        var body = await ReadJsonAsync(response);

        Assert.That(response.StatusCode, Is.EqualTo(status));
        Assert.That(response.Content.Headers.ContentType?.MediaType, Is.EqualTo("application/problem+json"));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo(type));
    }

    /// <summary>Cria a pasta pela rota e confere o 201: um teste que arruma estado não segue adiante com uma criação recusada.</summary>
    private static async Task<JsonElement> CreateFolderAsync(ApiHost host, string name, Guid? parentID = null)
    {
        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name, parentID });
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));

        return await ReadJsonAsync(response);
    }

    private static Task<HttpResponseMessage> UpdateFolderAsync(ApiHost host, Guid id, string name, Guid? parentID)
        => host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, FoldersPath) { Content = JsonContent.Create(new { id, name, parentID }) });

    private static async Task<List<JsonElement>> ListFoldersAsync(ApiHost host)
    {
        var response = await host.Client.GetAsync(FoldersPath);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));

        return (await ReadJsonAsync(response)).EnumerateArray().ToList();
    }

    private static Guid IdOf(JsonElement folder)
        => folder.GetProperty("id").GetGuid();

    [Test]
    public async Task Create_Root_Returns201()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        // Espaços sobrando e acento de propósito: o nome é gravado normalizado (RN-PASTA-001).
        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "  Produção   Sul ", parentID = (Guid?)null });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(response.Headers.Location?.ToString(), Is.EqualTo(FoldersPath));
        Assert.That(body.GetProperty("id").GetGuid(), Is.Not.EqualTo(Guid.Empty));
        Assert.That(body.GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Produção Sul"));
        Assert.That(body.GetProperty("createdAt").GetDateTime(), Is.EqualTo(body.GetProperty("updatedAt").GetDateTime()));
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Create_Child_Returns201()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = IdOf(parent) });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(body.GetProperty("parentID").GetGuid(), Is.EqualTo(IdOf(parent)));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Linha 1"));
    }

    [Test]
    public async Task Create_WithoutParentIDField_IsRoot()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Produção" });

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(body.GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Create_UnknownParent_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = Guid.CreateVersion7() });

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        Assert.That(await ListFoldersAsync(host), Is.Empty);
    }

    /// <summary>RN-PASTA-002: a comparação ignora maiúsculas, e vale também para letra acentuada.</summary>
    [Test]
    public async Task Create_SameNameSameParent_DifferentCase_Returns409FolderAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateFolderAsync(host, "Produção");

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "  PRODUÇÃO ", parentID = (Guid?)null });

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_ALREADY_EXISTS");
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Create_SameNameOtherParent_Returns201()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var first = await CreateFolderAsync(host, "Produção");
        var second = await CreateFolderAsync(host, "Manutenção");
        await CreateFolderAsync(host, "Linha 1", IdOf(first));

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = IdOf(second) });

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        // E a raiz também é uma "pasta pai": o mesmo nome na raiz não colide com os das subpastas.
        Assert.That((await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = (Guid?)null })).StatusCode, Is.EqualTo(HttpStatusCode.Created));
    }

    [Test]
    public async Task Create_InvalidName_Returns422FolderNameInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        foreach (var name in new[] { "", "   ", new string('a', 61) })
        {
            var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name, parentID = (Guid?)null });

            var body = await ReadJsonAsync(response);
            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
            Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
            // A tela lê `errors.name`: ela põe a primeira letra do nome da propriedade em minúscula.
            Assert.That(body.GetProperty("errors").GetProperty("Name").GetArrayLength(), Is.GreaterThan(0));
        }

        // 60 caracteres é o limite de dentro (RN-PASTA-001).
        Assert.That((await host.Client.PostAsJsonAsync(FoldersPath, new { name = new string('a', 60), parentID = (Guid?)null })).StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Update_Rename_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        var folder = await CreateFolderAsync(host, "Antiga", IdOf(parent));

        var response = await UpdateFolderAsync(host, IdOf(folder), "  Nova   ", IdOf(parent));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(IdOf(body), Is.EqualTo(IdOf(folder)));
        Assert.That(body.GetProperty("name").GetString(), Is.EqualTo("Nova"));
        Assert.That(body.GetProperty("parentID").GetGuid(), Is.EqualTo(IdOf(parent)));
        Assert.That(body.GetProperty("createdAt").GetDateTime(), Is.EqualTo(folder.GetProperty("createdAt").GetDateTime()));
        Assert.That(body.GetProperty("updatedAt").GetDateTime(), Is.GreaterThanOrEqualTo(folder.GetProperty("updatedAt").GetDateTime()));
        Assert.That((await ListFoldersAsync(host)).Select(item => item.GetProperty("name").GetString()), Is.EquivalentTo(new[] { "Produção", "Nova" }));
    }

    [Test]
    public async Task Update_Move_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var source = await CreateFolderAsync(host, "Produção");
        var target = await CreateFolderAsync(host, "Manutenção");
        var folder = await CreateFolderAsync(host, "Linha 1", IdOf(source));
        await CreateFolderAsync(host, "Célula A", IdOf(folder));

        var response = await UpdateFolderAsync(host, IdOf(folder), "Linha 1", IdOf(target));

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("parentID").GetGuid(), Is.EqualTo(IdOf(target)));
        // A subárvore vai junto: quem aponta para a pasta continua apontando.
        var moved = (await ListFoldersAsync(host)).Single(item => item.GetProperty("name").GetString() == "Célula A");
        Assert.That(moved.GetProperty("parentID").GetGuid(), Is.EqualTo(IdOf(folder)));
    }

    /// <summary>O PATCH grava os dois campos: `parentID` nulo move para a raiz.</summary>
    [Test]
    public async Task Update_MoveToRoot_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        var folder = await CreateFolderAsync(host, "Linha 1", IdOf(parent));

        var response = await UpdateFolderAsync(host, IdOf(folder), "Linha 1", null);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(body.GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>Salvar sem mudar o nome não é duplicidade: a pasta não colide com ela mesma (RN-PASTA-002).</summary>
    [Test]
    public async Task Update_SameNameItAlreadyHas_Returns200()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");

        var unchanged = await UpdateFolderAsync(host, IdOf(folder), "Produção", null);
        // Só a caixa muda: continua sendo o mesmo nome entre as irmãs, e a pasta não colide com ela mesma.
        var otherCase = await UpdateFolderAsync(host, IdOf(folder), "PRODUÇÃO", null);

        Assert.That(unchanged.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        // Sem mudança nenhuma a pasta volta como estava, com o mesmo UpdatedAt.
        Assert.That((await ReadJsonAsync(unchanged)).GetProperty("updatedAt").GetDateTime(), Is.EqualTo(folder.GetProperty("updatedAt").GetDateTime()));
        Assert.That(otherCase.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That((await ReadJsonAsync(otherCase)).GetProperty("name").GetString(), Is.EqualTo("PRODUÇÃO"));
    }

    [Test]
    public async Task Update_RenameToSiblingName_Returns409FolderAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateFolderAsync(host, "Produção");
        var folder = await CreateFolderAsync(host, "Manutenção");

        var response = await UpdateFolderAsync(host, IdOf(folder), "produção", null);

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_ALREADY_EXISTS");
        Assert.That((await ListFoldersAsync(host)).Select(item => item.GetProperty("name").GetString()), Is.EquivalentTo(new[] { "Produção", "Manutenção" }));
    }

    [Test]
    public async Task Update_MoveToParentThatHasTheSameName_Returns409FolderAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        await CreateFolderAsync(host, "Linha 1", IdOf(parent));
        var folder = await CreateFolderAsync(host, "Linha 1");

        var response = await UpdateFolderAsync(host, IdOf(folder), "Linha 1", IdOf(parent));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_ALREADY_EXISTS");
    }

    /// <summary>RN-PASTA-003.</summary>
    [Test]
    public async Task Update_MoveIntoItself_Returns409FolderCycle()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");

        var response = await UpdateFolderAsync(host, IdOf(folder), "Produção", IdOf(folder));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_CYCLE");
        Assert.That((await ListFoldersAsync(host)).Single().GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-PASTA-003: uma descendente a qualquer profundidade, e não só uma filha.</summary>
    [Test]
    public async Task Update_MoveIntoDescendant_Returns409FolderCycle()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var top = await CreateFolderAsync(host, "Produção");
        var middle = await CreateFolderAsync(host, "Linha 1", IdOf(top));
        var bottom = await CreateFolderAsync(host, "Célula A", IdOf(middle));

        var response = await UpdateFolderAsync(host, IdOf(top), "Produção", IdOf(bottom));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_CYCLE");
        Assert.That((await ListFoldersAsync(host)).Single(item => IdOf(item) == IdOf(top)).GetProperty("parentID").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Update_Unknown_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await UpdateFolderAsync(host, Guid.CreateVersion7(), "Produção", null);

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
    }

    [Test]
    public async Task Update_UnknownParent_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");

        var response = await UpdateFolderAsync(host, IdOf(folder), "Produção", Guid.CreateVersion7());

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
    }

    [Test]
    public async Task Update_InvalidName_Returns422FolderNameInvalid()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");

        var response = await UpdateFolderAsync(host, IdOf(folder), new string('a', 61), null);

        var body = await ReadJsonAsync(response);
        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(body.GetProperty("type").GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
        Assert.That(body.GetProperty("errors").GetProperty("Name").GetArrayLength(), Is.GreaterThan(0));
    }

    /// <summary>
    /// RN-PASTA-005: o ambiente da pasta, com a normalização do ambiente da conexão, vai na resposta da criação e na lista, e o `PATCH` o troca e o tira
    /// (o corpo grava a pasta por inteiro: sem os dois campos, a pasta fica sem ambiente). A pasta sem ambiente responde os dois campos nulos.
    /// </summary>
    [Test]
    public async Task Environment_IsCreatedListedChangedAndRemoved()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var created = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Produção", parentID = (Guid?)null, environmentName = "  Produção   Sul ", environmentColor = " #FF8A7A " });
        var createdBody = await ReadJsonAsync(created);
        var plain = await CreateFolderAsync(host, "Geral");
        var listed = await ListFoldersAsync(host);

        Assert.That(created.StatusCode, Is.EqualTo(HttpStatusCode.Created));
        Assert.That(createdBody.GetProperty("environmentName").GetString(), Is.EqualTo("Produção Sul"));
        Assert.That(createdBody.GetProperty("environmentColor").GetString(), Is.EqualTo("#FF8A7A"));
        Assert.That(plain.GetProperty("environmentName").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(plain.GetProperty("environmentColor").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var listedProduction = listed.Single(folder => IdOf(folder) == IdOf(createdBody));
        Assert.That(listedProduction.GetProperty("environmentName").GetString(), Is.EqualTo("Produção Sul"));
        Assert.That(listedProduction.GetProperty("environmentColor").GetString(), Is.EqualTo("#FF8A7A"));

        var changed = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, FoldersPath) { Content = JsonContent.Create(new { id = IdOf(createdBody), name = "Produção", parentID = (Guid?)null, environmentName = "QAS", environmentColor = "#F2B644" }) });
        var changedBody = await ReadJsonAsync(changed);

        Assert.That(changed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(changedBody.GetProperty("environmentName").GetString(), Is.EqualTo("QAS"));
        Assert.That(changedBody.GetProperty("environmentColor").GetString(), Is.EqualTo("#F2B644"));

        var removed = await UpdateFolderAsync(host, IdOf(createdBody), "Produção", null);
        var removedBody = await ReadJsonAsync(removed);

        Assert.That(removed.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(removedBody.GetProperty("environmentName").ValueKind, Is.EqualTo(JsonValueKind.Null));
        Assert.That(removedBody.GetProperty("environmentColor").ValueKind, Is.EqualTo(JsonValueKind.Null));
        var relisted = (await ListFoldersAsync(host)).Single(folder => IdOf(folder) == IdOf(createdBody));
        Assert.That(relisted.GetProperty("environmentName").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    /// <summary>RN-PASTA-005: as recusas do ambiente da conexão, em `FOLDER_NAME_INVALID` e no campo de cada uma, na criação e na alteração; nada é gravado.</summary>
    [Test]
    public async Task Environment_Invalid_Returns422FolderNameInvalidInTheField()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");

        var longName = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "QAS", environmentName = new string('a', 31) });
        var badColor = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, FoldersPath) { Content = JsonContent.Create(new { id = IdOf(folder), name = "Produção", environmentName = "Produção", environmentColor = "vermelho" }) });

        var longNameBody = await ReadJsonAsync(longName);
        var badColorBody = await ReadJsonAsync(badColor);
        Assert.That(longName.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(longNameBody.GetProperty("type").GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
        Assert.That(longNameBody.GetProperty("errorCodes").GetProperty("EnvironmentName")[0].GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
        Assert.That(badColor.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(badColorBody.GetProperty("type").GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
        Assert.That(badColorBody.GetProperty("errorCodes").GetProperty("EnvironmentColor")[0].GetString(), Is.EqualTo("FOLDER_NAME_INVALID"));
        var listed = await ListFoldersAsync(host);
        Assert.That(listed, Has.Count.EqualTo(1));
        Assert.That(listed[0].GetProperty("environmentName").ValueKind, Is.EqualTo(JsonValueKind.Null));
    }

    [Test]
    public async Task Delete_Empty_Returns204()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        var folder = await CreateFolderAsync(host, "Linha 1", IdOf(parent));

        var response = await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(folder)}");

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.Empty);
        Assert.That((await ListFoldersAsync(host)).Select(IdOf), Is.EqualTo(new[] { IdOf(parent) }));
        // Esvaziada a pasta, a mãe também sai (RN-PASTA-004).
        Assert.That((await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(parent)}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));
    }

    /// <summary>RN-PASTA-004. A parte "sem conexões" da regra tem o teste de ponta a ponta em `ConnectionsTests` (`DeleteFolder_WithConnection_Returns409FolderNotEmpty`).</summary>
    [Test]
    public async Task Delete_WithSubfolder_Returns409FolderNotEmpty()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        await CreateFolderAsync(host, "Linha 1", IdOf(parent));

        var response = await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(parent)}");

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_NOT_EMPTY");
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(2));
    }

    [Test]
    public async Task Delete_Unknown_Returns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.DeleteAsync($"{FoldersPath}/{Guid.CreateVersion7()}");

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
    }

    /// <summary>A pasta já foi excluída: a segunda chamada é 404, e não 204 (a tela distingue as duas).</summary>
    [Test]
    public async Task Delete_Twice_SecondReturns404FolderNotFound()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");
        Assert.That((await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(folder)}")).StatusCode, Is.EqualTo(HttpStatusCode.NoContent));

        var response = await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(folder)}");

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
    }

    [Test]
    public async Task GetFolders_NoFolders_ReturnsEmptyList()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var response = await host.Client.GetAsync(FoldersPath);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(await response.Content.ReadAsStringAsync(), Is.EqualTo("[]"));
    }

    /// <summary>A lista vem inteira e ordenada pelo nome, sem diferenciar maiúsculas: a tela monta a árvore a partir dela.</summary>
    [Test]
    public async Task GetFolders_ReturnsTheWholeListOrderedByName()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var root = await CreateFolderAsync(host, "beta");
        await CreateFolderAsync(host, "Alfa");
        await CreateFolderAsync(host, "Gama");
        await CreateFolderAsync(host, "Delta", IdOf(root));

        var folders = await ListFoldersAsync(host);

        Assert.That(folders.Select(item => item.GetProperty("name").GetString()), Is.EqualTo(new[] { "Alfa", "beta", "Delta", "Gama" }));
        Assert.That(folders[0].EnumerateObject().Select(property => property.Name), Is.EqualTo(new[] { "id", "parentID", "name", "environmentName", "environmentColor", "createdAt", "updatedAt" }));
    }

    /// <summary>O que foi salvo está no arquivo cifrado, e não na memória da API: fechar o cofre e entrar de novo devolve as pastas.</summary>
    [Test]
    public async Task GetFolders_AfterLockAndSignIn_ReturnsWhatWasSaved()
    {
        await using var host = await ApiHost.StartAsync();
        var password = UserFakers.RandomPassword();
        await host.CreateUserAsync("marina.costa", password);
        var parent = await CreateFolderAsync(host, "Produção");
        var child = await CreateFolderAsync(host, "Linha 1", IdOf(parent));
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = "marina.costa", password })).EnsureSuccessStatusCode();

        var folders = await ListFoldersAsync(host);

        Assert.That(folders.Select(IdOf), Is.EquivalentTo(new[] { IdOf(parent), IdOf(child) }));
        Assert.That(folders.Single(item => IdOf(item) == IdOf(child)).GetProperty("parentID").GetGuid(), Is.EqualTo(IdOf(parent)));
        Assert.That(folders.Single(item => IdOf(item) == IdOf(child)).GetProperty("name").GetString(), Is.EqualTo("Linha 1"));
    }

    /// <summary>Cada usuário tem o cofre dele: o B não vê (nem apaga) as pastas do A.</summary>
    [Test]
    public async Task GetFolders_OfAnotherUser_IsEmpty()
    {
        await using var host = await ApiHost.StartAsync();
        var passwordA = UserFakers.RandomPassword();
        await host.CreateUserAsync("usuario.a", passwordA);
        var folderOfA = await CreateFolderAsync(host, "Produção");
        await host.CreateUserAsync("usuario.b", UserFakers.RandomPassword());

        Assert.That(await ListFoldersAsync(host), Is.Empty);
        await AssertProblemAsync(await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(folderOfA)}"), HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
        // O nome do A está livre para o B, e o A continua com a pasta dele.
        await CreateFolderAsync(host, "Produção");
        (await host.Client.PostAsJsonAsync("/api/public/sessions", new { userName = "usuario.a", password = passwordA })).EnsureSuccessStatusCode();
        Assert.That((await ListFoldersAsync(host)).Select(IdOf), Is.EqualTo(new[] { IdOf(folderOfA) }));
    }

    [Test]
    public async Task GetFolders_WhileLocked_Returns401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        var response = await host.Client.GetAsync(FoldersPath);

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    [Test]
    public async Task WriteRoutes_WhileLocked_Return401VaultLocked()
    {
        await using var host = await ApiHost.StartAsync();

        await AssertProblemAsync(await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Produção", parentID = (Guid?)null }), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await UpdateFolderAsync(host, Guid.CreateVersion7(), "Produção", null), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        await AssertProblemAsync(await host.Client.DeleteAsync($"{FoldersPath}/{Guid.CreateVersion7()}"), HttpStatusCode.Unauthorized, "VAULT_LOCKED");
    }

    /// <summary>O token vem antes da barreira do cofre: sem ele a resposta não diz se há cofre aberto.</summary>
    [Test]
    public async Task UserRoute_WithoutToken_Returns401AuthenticationRequired()
    {
        await using var host = await ApiHost.StartAsync();

        var locked = await host.ClientWithoutToken.GetAsync(FoldersPath);
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var unlocked = await host.ClientWithoutToken.GetAsync(FoldersPath);

        await AssertProblemAsync(locked, HttpStatusCode.Unauthorized, "AUTHENTICATION_REQUIRED");
        await AssertProblemAsync(unlocked, HttpStatusCode.Unauthorized, "AUTHENTICATION_REQUIRED");
    }

    /// <summary>
    /// A barreira olha o caminho cru, e `//api/user/...` e `/api//user/...` não começam por `/api/user`: o
    /// roteamento do ASP.NET não os casa com o controller, e a resposta é o 404 dele. `/api/user//folders`
    /// começa pelo prefixo e cai na barreira (401 `VAULT_LOCKED`), e `/API/USER/folders` também, porque a
    /// barreira não diferencia maiúsculas como o roteamento. Nenhum devolve dado.
    /// </summary>
    [Test]
    public async Task UserRoute_WithDoubleSlash_WhileLocked_NeverReturnsData()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateFolderAsync(host, "Segredo");
        (await host.Client.DeleteAsync("/api/public/sessions")).EnsureSuccessStatusCode();
        var authority = host.Client.BaseAddress!.GetLeftPart(UriPartial.Authority);

        foreach (var (path, status) in new[] { ("//api/user/folders", HttpStatusCode.NotFound), ("/api//user/folders", HttpStatusCode.NotFound), ("/api/user//folders", HttpStatusCode.Unauthorized), ("/API/USER/folders", HttpStatusCode.Unauthorized) })
        {
            // Um caminho relativo com `//` no começo viraria o host da URI: o teste só prova algo com a URI absoluta e a barra dupla intacta.
            var uri = new Uri(authority + path);
            Assert.That(uri.AbsolutePath, Is.EqualTo(path));

            var response = await host.Client.GetAsync(uri);

            Assert.That(response.StatusCode, Is.EqualTo(status), path);
            Assert.That(await response.Content.ReadAsStringAsync(), Does.Not.Contain("Segredo"), path);
            if (status == HttpStatusCode.Unauthorized)
                await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        }
    }

    /// <summary>
    /// O cofre fechou depois da barreira, antes de a requisição ler qualquer coisa: as consultas do handler
    /// (que devolvem `bool`) responderiam "não" por não terem lido nada. Nenhuma pasta é dada como inexistente
    /// por isso: quem decide é a gravação, e a resposta é 401 `VAULT_LOCKED`, e não 404 `FOLDER_NOT_FOUND`.
    /// O `VaultClosingChecks` fecha o cofre na primeira consulta de cada requisição.
    /// </summary>
    [Test]
    public async Task Create_WithParent_WhenTheVaultClosesAfterTheGate_Returns401VaultLocked()
    {
        var armed = new StrongBox<bool>();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(provider => new VaultClosingChecks(provider.GetRequiredService<IVaultService>(), armed))));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");
        armed.Value = true;

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = IdOf(parent) });

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"))).GetProperty("unlocked").GetBoolean(), Is.False);
    }

    [Test]
    public async Task Update_WhenTheVaultClosesAfterTheGate_Returns401VaultLocked()
    {
        var armed = new StrongBox<bool>();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(provider => new VaultClosingChecks(provider.GetRequiredService<IVaultService>(), armed))));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var target = await CreateFolderAsync(host, "Produção");
        var folder = await CreateFolderAsync(host, "Linha 1");
        armed.Value = true;

        var response = await UpdateFolderAsync(host, IdOf(folder), "Linha 1", IdOf(target));

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"))).GetProperty("unlocked").GetBoolean(), Is.False);
    }

    [Test]
    public async Task Delete_WhenTheVaultClosesAfterTheGate_Returns401VaultLocked()
    {
        var armed = new StrongBox<bool>();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(provider => new VaultClosingChecks(provider.GetRequiredService<IVaultService>(), armed))));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var folder = await CreateFolderAsync(host, "Produção");
        armed.Value = true;

        var response = await host.Client.DeleteAsync($"{FoldersPath}/{IdOf(folder)}");

        await AssertProblemAsync(response, HttpStatusCode.Unauthorized, "VAULT_LOCKED");
        Assert.That((await ReadJsonAsync(await host.Client.GetAsync("/api/public/sessions"))).GetProperty("unlocked").GetBoolean(), Is.False);
    }

    /// <summary>
    /// RN-PASTA-002: "Fábrica" digitado (á composto) e "Fábrica" colado de outro programa (a + acento
    /// combinante) são o mesmo nome para quem lê, então a segunda é duplicidade. O nome é gravado na forma composta.
    /// </summary>
    [Test]
    public async Task Create_SameNameInDecomposedForm_Returns409FolderAlreadyExists()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        await CreateFolderAsync(host, "Fábrica");

        var response = await host.Client.PostAsJsonAsync(FoldersPath, new { name = "Fábrica", parentID = (Guid?)null });

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "FOLDER_ALREADY_EXISTS");
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(1));
    }

    [Test]
    public async Task Create_NameInDecomposedForm_IsStoredComposed()
    {
        await using var host = await ApiHost.StartAsync();
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        var created = await CreateFolderAsync(host, "Fábrica");

        Assert.That(created.GetProperty("name").GetString(), Is.EqualTo("Fábrica"));
        Assert.That((await ListFoldersAsync(host)).Single().GetProperty("name").GetString(), Is.EqualTo("Fábrica"));
    }

    /// <summary>
    /// Duas requisições passam juntas pela conferência do handler (a barreira do `StalePreChecks` só solta as
    /// duas quando ambas chegaram, e as duas ouvem "livre") e só então gravam. O que impede as duas pastas é a
    /// regra de dentro da gravação, que o serviço do cofre roda uma requisição por vez (RN-PASTA-002).
    /// </summary>
    [Test]
    public async Task Create_SameNameTwiceInParallel_OnlyOneSucceeds()
    {
        var checks = new StalePreChecks();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(checks)));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());

        checks.Arm();
        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => host.Client.PostAsJsonAsync(FoldersPath, new { name = "Produção", parentID = (Guid?)null })));

        Assert.That(checks.Arrivals, Is.EqualTo(2));
        Assert.That(responses.Select(response => response.StatusCode), Is.EquivalentTo(new[] { HttpStatusCode.Created, HttpStatusCode.Conflict }));
        await AssertProblemAsync(responses.Single(response => response.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "FOLDER_ALREADY_EXISTS");
        Assert.That(await ListFoldersAsync(host), Has.Count.EqualTo(1));
    }

    /// <summary>RN-PASTA-003: A para dentro de B e B para dentro de A, juntos, fechariam um ciclo. A segunda gravação enxerga a primeira e é recusada.</summary>
    [Test]
    public async Task Update_TwoMovesThatWouldCloseACycleInParallel_OnlyOneSucceeds()
    {
        var checks = new StalePreChecks();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(checks)));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var a = await CreateFolderAsync(host, "A");
        var b = await CreateFolderAsync(host, "B");

        checks.Arm();
        var responses = await Task.WhenAll(UpdateFolderAsync(host, IdOf(a), "A", IdOf(b)), UpdateFolderAsync(host, IdOf(b), "B", IdOf(a)));

        Assert.That(responses.Select(response => response.StatusCode), Is.EquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        await AssertProblemAsync(responses.Single(response => response.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "FOLDER_CYCLE");
        // Uma das duas continua na raiz: nenhuma pasta aponta para a outra nos dois sentidos.
        Assert.That((await ListFoldersAsync(host)).Count(folder => folder.GetProperty("parentID").ValueKind == JsonValueKind.Null), Is.EqualTo(1));
    }

    /// <summary>
    /// RN-PASTA-004 contra a criação de uma filha: a exclusão viu a pasta vazia e a criação viu a pasta pai
    /// existindo. Quem grava primeiro vence e a outra é recusada; o que não pode sobrar é uma filha cuja pasta
    /// pai foi excluída.
    /// </summary>
    [Test]
    public async Task Delete_AndCreateChildInParallel_NeverLeavesAnOrphan()
    {
        var checks = new StalePreChecks();
        await using var host = await ApiHost.StartAsync(services => services.Replace(ServiceDescriptor.Singleton<IFolderQueries>(checks)));
        await host.CreateUserAsync("marina.costa", UserFakers.RandomPassword());
        var parent = await CreateFolderAsync(host, "Produção");

        checks.Arm();
        var deleted = host.Client.DeleteAsync($"{FoldersPath}/{IdOf(parent)}");
        var created = host.Client.PostAsJsonAsync(FoldersPath, new { name = "Linha 1", parentID = IdOf(parent) });
        await Task.WhenAll(deleted, created);

        var folders = await ListFoldersAsync(host);
        if (deleted.Result.StatusCode == HttpStatusCode.NoContent)
        {
            await AssertProblemAsync(created.Result, HttpStatusCode.NotFound, "FOLDER_NOT_FOUND");
            Assert.That(folders, Is.Empty);
        }
        else
        {
            await AssertProblemAsync(deleted.Result, HttpStatusCode.Conflict, "FOLDER_NOT_EMPTY");
            Assert.That(created.Result.StatusCode, Is.EqualTo(HttpStatusCode.Created));
            Assert.That(folders, Has.Count.EqualTo(2));
        }
    }

    /// <summary>
    /// As consultas como a `FolderQueries` de verdade as responde com o cofre fechado: "não" para tudo, porque
    /// não leram nada. Depois de armado, a primeira consulta de cada requisição ainda fecha o cofre, que é o
    /// que um `Lock` (sair, o quinto erro de senha, outro usuário entrando) faria entre a barreira e o handler.
    /// Antes de armado só responde "não", para o teste arrumar o estado pelas rotas.
    /// </summary>
    private sealed class VaultClosingChecks(IVaultService vault, StrongBox<bool> armed) : IFolderQueries
    {
        public Task<bool> Exists(string name, Guid? parentID, CancellationToken cancellationToken)
            => CloseAndAnswerNo();

        public Task<bool> ExistsByID(Guid id, CancellationToken cancellationToken)
            => CloseAndAnswerNo();

        public Task<bool> HasChildren(Guid id, CancellationToken cancellationToken)
            => CloseAndAnswerNo();

        public Task<bool> IsSelfOrDescendant(Guid candidateID, Guid ancestorID, CancellationToken cancellationToken)
            => CloseAndAnswerNo();

        private Task<bool> CloseAndAnswerNo()
        {
            if (armed.Value)
                vault.Lock();

            return Task.FromResult(false);
        }
    }

    /// <summary>
    /// Faz as conferências do handler responderem com o cofre de antes de a outra requisição gravar: depois
    /// de `Arm`, a primeira conferência de cada requisição só volta quando as duas chegaram, com "livre". É o
    /// intercalamento que, sem a regra de dentro da gravação, deixaria as duas passarem. Antes de `Arm` (a
    /// arrumação do teste) responde "livre" sem esperar. Não toca o cofre.
    /// </summary>
    private sealed class StalePreChecks : IFolderQueries
    {
        private readonly TaskCompletionSource _bothArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _armed;
        private int _arrivals;

        public int Arrivals => _arrivals;

        public void Arm()
            => _armed = true;

        public Task<bool> Exists(string name, Guid? parentID, CancellationToken cancellationToken)
            => WaitForTheOtherRequest();

        public Task<bool> ExistsByID(Guid id, CancellationToken cancellationToken)
            => Task.FromResult(true);

        public Task<bool> HasChildren(Guid id, CancellationToken cancellationToken)
            => WaitForTheOtherRequest();

        public Task<bool> IsSelfOrDescendant(Guid candidateID, Guid ancestorID, CancellationToken cancellationToken)
            => WaitForTheOtherRequest();

        /// <summary>O prazo existe para o teste falhar claro (500 por `TimeoutException`) se a outra requisição nunca chegar.</summary>
        private async Task<bool> WaitForTheOtherRequest()
        {
            if (!_armed)
                return false;

            if (Interlocked.Increment(ref _arrivals) >= 2)
                _bothArrived.TrySetResult();

            await _bothArrived.Task.WaitAsync(TimeSpan.FromSeconds(10));

            return false;
        }
    }
}
