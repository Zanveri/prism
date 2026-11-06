using Prism.Application.Common.Texts;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Folders.Models;

/// <summary>
/// RN-PASTA-001: as regras do nome da pasta, num lugar só: o validator de criar, o de alterar e a importação de conexões (RN-TRANSF-014) as aplicam daqui,
/// com a mesma frase. As do ambiente e da cor da pasta são as da conexão (`EnvironmentRules`), e as das proteções, as de `ProtectionRules`.
/// </summary>
internal static class FolderRules
{
    /// <summary>Os textos, no idioma do pedido: <c>FolderRules.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(FolderRules));

    /// <summary>RN-PASTA-001: de 1 a 60 caracteres, medidos sobre o nome normalizado, que é o que se grava.</summary>
    public const int NameMaxLength = 60;

    /// <summary>
    /// Por que o nome da pasta não serve, ou nulo quando serve. Depois da normalização (que já troca a tabulação e a quebra de linha por um espaço), o
    /// tamanho, e o caractere de controle e o de direção do texto (`TextRules`): a pasta exportada com um nome desses não voltaria pela importação.
    /// </summary>
    public static string? NameRefusal(string? name)
    {
        var normalized = name.NormalizeName();
        if (normalized.Length is < 1 or > NameMaxLength)
            return Texts.Get("NameLength");

        return TextRules.HasControlOrDirection(normalized) ? Texts.Get("NameInvalidCharacters") : null;
    }
}
