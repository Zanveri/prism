using FluentValidation;
using System.Globalization;

namespace Prism.Application.Common.Texts;

/// <summary>
/// As regras de texto que valem para mais de um cadastro, num lugar só (RN-PASTA-001, RN-CONN-010 e RN-VERIF-001): o caractere de controle e o de direção do
/// texto, e o corte de um texto longo sem partir um caractere. Os validators, a importação de conexões (RN-TRANSF-014) e a prévia dela (RN-TRANSF-011) as aplicam daqui.
/// </summary>
internal static class TextRules
{
    /// <summary>
    /// RN-PASTA-001 e RN-CONN-010: o caractere de controle (U+0000 a U+001F e U+007F a U+009F) e o de direção do texto (U+200E, U+200F, U+202A a U+202E e
    /// U+2066 a U+2069). Um U+202E faria o host que a prévia da importação manda conferir parecer outro (RN-TRANSF-014). Quem chama confere o texto já
    /// normalizado: a normalização do nome troca a tabulação e a quebra de linha por um espaço.
    /// </summary>
    public static bool IsControlOrDirection(char character)
        => character is <= '\u001F' or (>= '\u007F' and <= '\u009F') or '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069');

    public static bool HasControlOrDirection(string text)
        => text.Any(IsControlOrDirection);

    /// <summary>
    /// RN-VERIF-001: a mesma recusa num texto de várias linhas, a consulta de verificação, que pode ter a tabulação, a quebra de linha e o retorno de carro
    /// (é SQL escrito pela pessoa); os outros caracteres de controle e os de direção do texto, não.
    /// </summary>
    public static bool HasControlOrDirectionBesidesLineBreaks(string text)
        => text.Any(character => character is not ('\t' or '\n' or '\r') && IsControlOrDirection(character));

    /// <summary>
    /// O texto até <paramref name="length"/> unidades UTF-16, cortado no fim de um caractere inteiro (um emoji, uma letra com acento combinado). É o corte do
    /// nome da cópia de uma conexão (RN-CONN-016) e o dos textos do item que a importação não pode trazer (RN-TRANSF-011, 200 caracteres).
    /// </summary>
    public static string Cut(string text, int length)
    {
        if (text.Length <= length)
            return text;

        var cut = StringInfo.ParseCombiningCharacters(text).Where(start => start <= length).Max();

        return text[..cut];
    }

    /// <summary>
    /// A regra do validator que diz POR QUE o valor não serve, com a frase de uma função que a importação também chama: o validator e a importação recusam
    /// pelo mesmo motivo, com a mesma mensagem (RN-CONN-010: "as mesmas regras, num lugar só"). Uma mensagem por campo, a primeira recusa.
    /// </summary>
    public static IRuleBuilderOptions<T, TProperty> MustPass<T, TProperty>(this IRuleBuilder<T, TProperty> rule, Func<TProperty, string?> refusal)
        => rule.Must((_, value, context) =>
        {
            if (refusal(value) is not { } message)
                return true;

            context.MessageFormatter.AppendArgument("Refusal", message);

            return false;
        }).WithMessage("{Refusal}");
}
