using System.Text;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-004 e 009: a senha de exportação, que não é a senha do Prism e nunca é gravada nem vai a log. As mesmas regras e os mesmos casos de teste da
/// tela. Antes de contar e de usar, a senha passa à forma composta do Unicode (NFC): o "é" digitado de uma vez e o "é" colado como "e" mais o acento são a
/// mesma senha, e o arquivo exportado num Windows abre num macOS.
/// </summary>
internal static class PassphraseRules
{
    public const int MinLength = 12;
    public const int MaxLength = 128;

    /// <summary>
    /// RN-TRANSF-004: o que conta como espaço nas pontas, a lista da especificação (U+0009 a U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 a U+200A,
    /// U+2028, U+2029, U+202F, U+205F e U+3000), e não o `Trim()` do .NET nem o `trim()` do JavaScript: a tela e a API usam esta lista.
    /// </summary>
    public static bool IsSpace(char character)
        => character is (>= '\u0009' and <= '\u000D') or ' ' or '\u0085' or '\u00A0' or '\u1680' or (>= '\u2000' and <= '\u200A') or '\u2028' or '\u2029' or '\u202F' or '\u205F' or '\u3000';

    /// <summary>RN-TRANSF-004: a senha da exportação, na forma NFC. As pontas não são tiradas: a regra recusa a senha que começa ou termina com espaço.</summary>
    public static string ForExport(string? passphrase)
        => (passphrase ?? string.Empty).Normalize(NormalizationForm.FormC);

    /// <summary>
    /// RN-TRANSF-009: a senha da importação perde os espaços das pontas (os da lista), que a cópia de uma mensagem traz sem ninguém ver, e passa à forma
    /// NFC. A exportação recusa a senha com espaço nas pontas, então tirá-los não muda nenhuma senha que ela aceitou.
    /// </summary>
    public static string ForImport(string? passphrase)
    {
        var text = passphrase ?? string.Empty;
        var start = 0;
        var end = text.Length;

        while (start < end && IsSpace(text[start]))
            start++;

        while (end > start && IsSpace(text[end - 1]))
            end--;

        return text[start..end].Normalize(NormalizationForm.FormC);
    }

    /// <summary>
    /// RN-TRANSF-004: por que a senha de exportação não serve, ou nula quando serve. Nesta ordem, uma frase por vez: vazia, curta (menos de 12 unidades UTF-16),
    /// longa (mais de 128), com espaço numa ponta, com caractere de controle. Sem regra de composição; os espaços de dentro contam.
    /// </summary>
    public static string? ExportRefusal(string? passphrase)
    {
        var normalized = ForExport(passphrase);
        if (normalized.Length == 0)
            return "Crie uma senha de exportação.";

        if (normalized.Length < MinLength)
            return "A senha de exportação precisa ter pelo menos 12 caracteres.";

        if (normalized.Length > MaxLength)
            return "A senha de exportação pode ter até 128 caracteres.";

        if (IsSpace(normalized[0]) || IsSpace(normalized[^1]))
            return "A senha de exportação não pode começar nem terminar com espaço.";

        return normalized.Any(char.IsControl) ? "A senha de exportação não pode ter caractere de controle." : null;
    }

    /// <summary>RN-TRANSF-010, etapa 2: a senha da importação, sem os espaços das pontas, não é vazia nem passa de 128 caracteres. Nada é derivado antes.</summary>
    public static string? ImportRefusal(string? passphrase)
    {
        var normalized = ForImport(passphrase);
        if (normalized.Length == 0)
            return "Informe a senha de exportação.";

        return normalized.Length > MaxLength ? "A senha de exportação tem até 128 caracteres." : null;
    }

    /// <summary>
    /// RN-TRANSF-004: a senha de exportação igual à senha do Prism que veio no mesmo pedido e conferiu, as duas na forma NFC. A comparação é só com a que
    /// veio: sem ela, a API teria de derivar a chave do cofre para comparar, e isso seria um jeito de testar a senha do Prism sem contar erro.
    /// </summary>
    public static bool EqualsUserPassword(string passphrase, string userPassword)
        => string.Equals(ForExport(passphrase), userPassword.Normalize(NormalizationForm.FormC), StringComparison.Ordinal);
}
