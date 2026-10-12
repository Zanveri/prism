using System.Globalization;
using System.Text;

namespace Prism.Core.Extensions;

public static class StringExtensions
{
    private static readonly HashSet<string> NameParticles = ["da", "das", "de", "do", "dos", "e"];

    /// <summary>
    /// Texto sem espaços nas pontas e sem sequências internas de espaço, na forma
    /// Unicode composta (FormC): é a forma persistida nos cadastros e a que a
    /// verificação de duplicidade compara. "Fábrica" digitado (á de um caractere)
    /// e "Fábrica" colado de outro programa (a e o acento combinante) são o mesmo
    /// nome para quem lê, e só a comparação das duas na mesma forma os trata assim.
    /// Nulo vira string vazia, e quem valida decide se isso é erro.
    /// </summary>
    public static string NormalizeName(this string? name)
        => string.Join(' ', (name ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Normalize(NormalizationForm.FormC);

    /// <summary>
    /// O mesmo do nome, em caixa alta: códigos e siglas são comparados sem
    /// diferenciar maiúsculas, e gravá-los já normalizados é o que faz o UNIQUE
    /// do banco valer como essa comparação.
    /// </summary>
    public static string NormalizeCode(this string? code)
        => code.NormalizeName().ToUpperInvariant();

    /// <summary>
    /// Nome de pessoa como ele se escreve: inicial maiúscula em cada palavra e
    /// as partículas "da", "das", "de", "do", "dos" e "e" em minúsculas. Quem
    /// digita com o caps lock ligado, ou tudo em minúsculas, não percebe, e
    /// passaria a se ver assim em toda a aplicação.
    /// </summary>
    // ponytail: a caixa digitada é descartada — "McDonald" vira "Mcdonald" e "De Carli" vira "de Carli"; preservar a caixa mista da palavra se nomes assim aparecerem.
    public static string NormalizePersonName(this string? name)
        => string.Join(' ', name.NormalizeName().ToLowerInvariant().Split(' ').Select(word => NameParticles.Contains(word) ? word : Capitalize(word)));

    private static string Capitalize(string word)
    {
        var builder = new StringBuilder(word.Length);
        var opensInitial = true;

        foreach (var character in word)
        {
            builder.Append(opensInitial ? char.ToUpperInvariant(character) : character);
            // Hífen e apóstrofo abrem outra inicial ("Ana-Luísa", "D'Ávila"). O acento combinante de um texto em NFD não: sem essa exceção, "Mariângela" viraria "MariâNgela".
            opensInitial = !char.IsLetter(character) && CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark;
        }

        return builder.ToString();
    }

    /// <summary>
    /// Texto digitado pronto para o meio de um padrão `ILIKE`. `%` e `_` são
    /// curingas, e quem digita procura por eles como texto: sem escapar, um `%`
    /// sozinho devolveria a tabela inteira como se fosse resultado da busca.
    /// </summary>
    public static string EscapeLike(this string value)
        => value.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");

    /// <summary>
    /// Chave de comparação para casar um nome recebido de fora com o cadastro:
    /// além do <see cref="NormalizeName"/>, sobe a caixa e tira os acentos.
    ///
    /// Serve à importação em massa, onde o nome da área vem
    /// digitado por quem gerou o arquivo. "Clinica medica" e "Clínica Médica"
    /// são a mesma área para quem escreveu, e recusar por causa do acento
    /// mandaria a pessoa caçar um til numa lista de cem questões.
    ///
    /// Não é o que se persiste: o banco continua guardando o nome como o
    /// cadastro o escreveu. Isto é só a chave do dicionário de busca.
    /// </summary>
    public static string NormalizeLookup(this string? value)
    {
        var decomposed = value.NormalizeName().ToUpperInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);

        foreach (var character in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(character);

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}
