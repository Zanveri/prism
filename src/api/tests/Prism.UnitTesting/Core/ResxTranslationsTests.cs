using Prism.Core.Api.Models.Dtos;
using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Resources;
using System.Text.RegularExpressions;

namespace Prism.UnitTesting.Core;

/// <summary>
/// Os idiomas da API: todo <c>.resx</c> em português (o sem sufixo, compilado no próprio assembly) tem o <c>.en.resx</c> e o <c>.es.resx</c> (os satélites
/// <c>en/</c> e <c>es/</c>) com as mesmas chaves e os mesmos marcadores (<c>{0}</c>, <c>{1}</c>) em cada chave. É o equivalente do <c>typecheck</c> da tela:
/// sem ele, a tradução que falta sairia em português, e o marcador que some, sem o valor, sem erro nenhum. Lê os recursos compilados dos quatro
/// assemblies do produto, e não os arquivos: confere também que o build gerou os satélites.
/// </summary>
public sealed partial class ResxTranslationsTests
{
    private static readonly Assembly[] ProductAssemblies = [typeof(Prism.Api.DependencyInjection).Assembly, typeof(Prism.Application.DependencyInjection).Assembly, typeof(Prism.Infrastructure.DependencyInjection).Assembly, typeof(ApiErrorDto).Assembly];

    private static readonly string[] Translations = ["en", "es"];

    [GeneratedRegex(@"\{(\d+)[^}]*\}")]
    private static partial Regex Placeholder();

    [Trait("Resx", "Translations")]
    [Fact(DisplayName = "OK todo .resx em português tem o inglês e o espanhol, com as mesmas chaves e os mesmos marcadores")]
    public void EveryPortugueseResx_ShouldHaveEnglishAndSpanish_WithTheSameKeysAndPlaceholders()
    {
        //Arrange
        var portuguese = ProductAssemblies.SelectMany(assembly => assembly.GetManifestResourceNames().Where(name => name.EndsWith(".resources", StringComparison.Ordinal)).Select(name => (Assembly: assembly, BaseName: name[..^".resources".Length]))).ToList();

        //Act
        var problems = portuguese.SelectMany(resource => Translations.SelectMany(culture => Compare(resource.Assembly, resource.BaseName, culture))).ToList();

        //Assert
        Assert.Contains(portuguese, resource => resource.BaseName == "Prism.Application.BuildModels.Models.BuildModelErrors");
        Assert.Empty(problems);
    }

    /// <summary>
    /// O SDK dá ao recurso o nome do PRIMEIRO tipo do <c>.cs</c> ao lado do <c>.resx</c>: um <c>record</c> antes da classe faria o
    /// <c>new ResourceManager(typeof(Classe))</c> procurar um recurso que não existe, e a tela receberia a chave no lugar do texto, sem erro nenhum.
    /// </summary>
    [Trait("Resx", "Translations")]
    [Fact(DisplayName = "OK todo ResourceManager estático da API acha o .resx da classe")]
    public void EveryStaticResourceManager_ShouldFindItsResource()
    {
        //Arrange
        var managers = ProductAssemblies.SelectMany(assembly => assembly.GetTypes())
            .Where(type => !type.ContainsGenericParameters)
            .SelectMany(type => type.GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
            .Where(IsResourceManager)
            .Select(field => (Owner: $"{field.DeclaringType!.FullName}.{field.Name}", Manager: (ResourceManager)field.GetValue(null)!))
            .ToList();

        //Act
        var missing = managers.Where(item => item.Manager.GetResourceSet(CultureInfo.InvariantCulture, createIfNotExists: true, tryParents: false) is null)
            .Select(item => $"{item.Owner}: não há o recurso {item.Manager.BaseName}")
            .ToList();

        //Assert
        Assert.Contains(managers, item => item.Manager.BaseName == "Prism.Application.BuildModels.Models.BuildModelErrors");
        Assert.Empty(missing);
    }

    /// <summary>O campo de um tipo do driver da IBM (que o processo dos testes de unidade não tem) não se deixa ler; nenhum deles é um ResourceManager.</summary>
    private static bool IsResourceManager(FieldInfo field)
    {
        try
        {
            return field.FieldType == typeof(ResourceManager);
        }
        catch (FileNotFoundException)
        {
            return false;
        }
    }

    private static IEnumerable<string> Compare(Assembly assembly, string baseName, string culture)
    {
        var portuguese = Read(assembly, $"{baseName}.resources")!;
        var translated = Read(assembly.GetSatelliteAssembly(CultureInfo.GetCultureInfo(culture)), $"{baseName}.{culture}.resources");

        if (translated is null)
        {
            yield return $"{baseName}: falta o .{culture}.resx";
            yield break;
        }

        foreach (var key in portuguese.Keys.Except(translated.Keys))
            yield return $"{baseName}.{culture}: falta a chave {key}";

        foreach (var key in translated.Keys.Except(portuguese.Keys))
            yield return $"{baseName}.{culture}: sobra a chave {key}";

        foreach (var key in portuguese.Keys.Intersect(translated.Keys).Where(key => string.IsNullOrWhiteSpace(translated[key]) || !Placeholders(portuguese[key]).SetEquals(Placeholders(translated[key]))))
            yield return $"{baseName}.{culture}: a chave {key} está vazia ou tem marcadores diferentes dos do português";
    }

    private static Dictionary<string, string>? Read(Assembly assembly, string name)
    {
        using var stream = assembly.GetManifestResourceStream(name);

        if (stream is null)
            return null;

        using var reader = new ResourceReader(stream);

        return reader.Cast<DictionaryEntry>().ToDictionary(entry => (string)entry.Key, entry => entry.Value as string ?? string.Empty);
    }

    private static HashSet<string> Placeholders(string text)
        => Placeholder().Matches(text).Select(match => match.Groups[1].Value).ToHashSet();
}
