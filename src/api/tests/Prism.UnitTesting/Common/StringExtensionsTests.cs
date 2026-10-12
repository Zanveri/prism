using Prism.Core.Extensions;

namespace Prism.UnitTesting.Common;

public sealed class StringExtensionsTests
{
    /// <summary>Á composto (U+00E1) e a + acento combinante (U+0061 U+0301) são o mesmo texto para quem lê; só a forma composta fica gravada.</summary>
    [Trait("StringExtensions", "NormalizeName")]
    [Fact(DisplayName = "OK a forma decomposta vira a composta")]
    public void NormalizeName_ShouldComposeDecomposedText()
    {
        //Act
        var name = "Fábrica ação".NormalizeName();

        //Assert
        Assert.Equal("Fábrica ação", name);
        Assert.Equal("Fábrica".NormalizeName(), "Fábrica".NormalizeName());
    }

    /// <summary>O tamanho de 60 caracteres da RN-PASTA-001 é o do texto gravado: o acento combinante não conta como mais um caractere.</summary>
    [Trait("StringExtensions", "NormalizeName")]
    [Fact(DisplayName = "OK o acento combinante não conta como caractere a mais")]
    public void NormalizeName_ShouldCountTheComposedLength()
    {
        //Act
        var length = "Fábrica".NormalizeName().Length;

        //Assert
        Assert.Equal(7, length);
    }

    [Trait("StringExtensions", "NormalizeName")]
    [Fact(DisplayName = "OK tira os espaços das pontas, junta os repetidos e aceita nulo")]
    public void NormalizeName_ShouldTrimAndCollapseWhitespace()
    {
        //Act
        var collapsed = "  Produção \t  Sul \n".NormalizeName();
        var fromNull = ((string?)null).NormalizeName();

        //Assert
        Assert.Equal("Produção Sul", collapsed);
        Assert.Equal(string.Empty, fromNull);
    }
}
