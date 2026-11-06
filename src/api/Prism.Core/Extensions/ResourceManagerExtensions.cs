using System.Globalization;
using System.Resources;

namespace Prism.Core.Extensions;

/// <summary>
/// O texto que chega à tela, no idioma do pedido: o modelo vem do <c>.resx</c> da classe na <see cref="CultureInfo.CurrentUICulture"/> (pt-BR, en ou es, que o
/// <c>UseRequestLocalization</c> da API escolhe pelo <c>Accept-Language</c>), e os argumentos são formatados na <see cref="CultureInfo.CurrentCulture"/>, que o pedido não troca.
/// </summary>
public static class ResourceManagerExtensions
{
    /// <summary>
    /// A chave que falta devolve a própria chave em vez de lançar: uma resposta de erro não cai por causa de um texto, e quem acusa a tradução que falta é o
    /// <c>ResxTranslationsTests</c>. Sem argumentos o modelo sai como está, e uma chave literal nele não precisa de escape.
    /// </summary>
    public static string Get(this ResourceManager resources, string key, params object?[] args)
    {
        var template = resources.GetString(key) ?? key;

        return args.Length == 0 ? template : string.Format(CultureInfo.CurrentCulture, template, args);
    }
}
