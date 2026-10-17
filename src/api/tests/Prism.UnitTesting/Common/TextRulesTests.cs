using Prism.Application.Common.Texts;

namespace Prism.UnitTesting.Common;

/// <summary>
/// RN-PASTA-001 e RN-CONN-010: o caractere de controle (U+0000 a U+001F e U+007F a U+009F) e o de direção do texto (U+200E, U+200F, U+202A a U+202E e
/// U+2066 a U+2069), nas pontas de cada faixa e logo fora delas; e o corte de um texto longo sem partir um caractere (RN-CONN-016 e RN-TRANSF-011).
/// </summary>
public sealed class TextRulesTests
{
    [Trait("TextRules", "IsControlOrDirection")]
    [Theory(DisplayName = "Caractere de controle ou de direção do texto, nas pontas de cada faixa")]
    [InlineData(0x0000, true)]
    [InlineData(0x0009, true)]
    [InlineData(0x001F, true)]
    [InlineData(0x0020, false)]
    [InlineData(0x007E, false)]
    [InlineData(0x007F, true)]
    [InlineData(0x0085, true)]
    [InlineData(0x009F, true)]
    [InlineData(0x00A0, false)]
    [InlineData(0x200D, false)]
    [InlineData(0x200E, true)]
    [InlineData(0x200F, true)]
    [InlineData(0x2029, false)]
    [InlineData(0x202A, true)]
    [InlineData(0x202E, true)]
    [InlineData(0x202F, false)]
    [InlineData(0x2065, false)]
    [InlineData(0x2066, true)]
    [InlineData(0x2069, true)]
    [InlineData(0x206A, false)]
    [InlineData(0xFEFF, false)]
    [InlineData('é', false)]
    public void IsControlOrDirection_ShouldBeTheListOfTheSpecification(int codePoint, bool expected)
    {
        //Act
        var result = TextRules.IsControlOrDirection((char)codePoint);

        //Assert
        Assert.Equal(expected, result);
        Assert.Equal(expected, TextRules.HasControlOrDirection($"a{(char)codePoint}b"));
    }

    /// <summary>O corte nunca parte um caractere: um emoji (dois `char`) e uma letra com acento combinado ficam inteiros, do lado de dentro ou de fora.</summary>
    [Trait("TextRules", "Cut")]
    [Theory(DisplayName = "Corte em unidades UTF-16 sem partir um caractere")]
    [InlineData("abcdef", 3, "abc")]
    [InlineData("abc", 3, "abc")]
    [InlineData("ab😀cd", 3, "ab")]
    [InlineData("ab😀cd", 4, "ab😀")]
    [InlineData("abe\u0301cd", 3, "ab")]
    [InlineData("abe\u0301cd", 4, "abe\u0301")]
    public void Cut_ShouldKeepWholeCharacters(string text, int length, string expected)
    {
        //Act
        var result = TextRules.Cut(text, length);

        //Assert
        Assert.Equal(expected, result);
    }
}
