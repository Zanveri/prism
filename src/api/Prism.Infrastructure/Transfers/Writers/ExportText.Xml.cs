using System.Text;
using System.Xml;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-012 e 024: o texto e o atributo do XML e a limpeza do XML 1.0, os mesmos da tela (`escapeXmlText`, `escapeXmlAttribute` e `isXmlChar`,
/// em `text-escape.ts`), que a fixture `xml-text.json` confere nos dois lados; e o nome de elemento e de atributo, que só a API escreve (`xml-name.json`).
/// </summary>
internal static partial class ExportText
{
    /// <summary>Um ponto de código que o XML 1.0 aceita (a produção `Char`): tabulação, quebra de linha, retorno de carro, e de U+0020 a U+D7FF, de U+E000 a U+FFFD e de U+10000 em diante.</summary>
    public static bool IsXmlChar(int codePoint)
        => codePoint is 0x9 or 0xA or 0xD or (>= 0x20 and <= 0xD7FF) or (>= 0xE000 and <= 0xFFFD) or (>= 0x10000 and <= 0x10FFFF);

    /// <summary>O conteúdo de um elemento: `&amp;`, `&lt;`, `&gt;` e o retorno de carro (`&#13;`), que o leitor trocaria por uma quebra de linha.</summary>
    public static string EscapeXmlText(string text)
        => EscapeXml(text, attribute: false);

    /// <summary>O valor de um atributo entre aspas duplas: o do conteúdo, a aspa dupla, a tabulação e a quebra de linha (`&quot;`, `&#9;`, `&#10;`), que o leitor trocaria por espaço.</summary>
    public static string EscapeXmlAttribute(string text)
        => EscapeXml(text, attribute: true);

    /// <summary>O texto do dado num elemento: sem o que o XML 1.0 não aceita (contado em `removed`) e escapado.</summary>
    public static string XmlText(string text, out int removed)
        => EscapeXmlText(StripUnaccepted(text, IsXmlChar, out removed));

    /// <summary>O texto do dado num atributo: sem o que o XML 1.0 não aceita (contado em `removed`) e escapado.</summary>
    public static string XmlAttribute(string text, out int removed)
        => EscapeXmlAttribute(StripUnaccepted(text, IsXmlChar, out removed));

    /// <summary>
    /// O nome de um elemento ou de um atributo a partir de um nome do banco, pela regra do .NET (`XmlConvert.EncodeLocalName`): cada caractere que não
    /// pode estar ali vira `_xHHHH_` (o espaço, `_x0020_`; o `1` do começo, `_x0031_`; fora do plano básico, oito dígitos), e o `_x` que já parece um
    /// escape ganha o dele (`_x005F_`). A volta (`DecodeName`) é exata, e o nome sai sempre válido, sem nada tirado.
    /// </summary>
    public static string XmlName(string name)
        => XmlConvert.EncodeLocalName(name)!;

    private static string EscapeXml(string text, bool attribute)
    {
        if (text.AsSpan().IndexOfAny(attribute ? "&<>\r\"\t\n" : "&<>\r") < 0)
            return text;

        var escaped = new StringBuilder(text.Length + 16);
        foreach (var character in text)
            escaped.Append(character switch
            {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '\r' => "&#13;",
                '"' when attribute => "&quot;",
                '\t' when attribute => "&#9;",
                '\n' when attribute => "&#10;",
                _ => character.ToString()
            });

        return escaped.ToString();
    }
}
