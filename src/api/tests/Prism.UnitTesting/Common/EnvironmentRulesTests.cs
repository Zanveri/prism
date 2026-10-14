using Prism.Application.Common.Environments;

namespace Prism.UnitTesting.Common;

/// <summary>
/// O ambiente (nome e cor) da conexão (RN-CONN-010) e da pasta (RN-PASTA-005) é uma regra só: os validators das duas e os dois domínios a
/// aplicam daqui, e nenhum repete o limite, o formato nem a normalização.
/// </summary>
public sealed class EnvironmentRulesTests
{
    [Trait("EnvironmentRules", "NameIsValid")]
    [Fact(DisplayName = "OK nome do ambiente ausente, em branco, com 30 caracteres e com espaços que a normalização tira")]
    public void NameIsValid_ShouldBeTrue()
    {
        //Assert
        Assert.True(EnvironmentRules.NameIsValid(null));
        Assert.True(EnvironmentRules.NameIsValid("   "));
        Assert.True(EnvironmentRules.NameIsValid(new string('a', 30)));
        Assert.True(EnvironmentRules.NameIsValid($"  {new string('a', 30)}  "));
    }

    [Trait("EnvironmentRules", "NameIsValid")]
    [Fact(DisplayName = "Erro nome do ambiente com 31 caracteres depois de normalizado")]
    public void NameIsValid_ShouldBeFalse_WhenLongerThan30()
    {
        //Assert
        Assert.False(EnvironmentRules.NameIsValid(new string('a', 31)));
        Assert.False(EnvironmentRules.NameIsValid($"{new string('a', 15)}   {new string('b', 15)}"));
    }

    [Trait("EnvironmentRules", "ColorIsValid")]
    [Fact(DisplayName = "OK cor ausente, em branco e #RRGGBB em maiúsculas ou minúsculas, com espaços nas pontas")]
    public void ColorIsValid_ShouldBeTrue()
    {
        //Assert
        Assert.True(EnvironmentRules.ColorIsValid(null));
        Assert.True(EnvironmentRules.ColorIsValid(" "));
        Assert.True(EnvironmentRules.ColorIsValid("#FF8A7A"));
        Assert.True(EnvironmentRules.ColorIsValid("#ff8a7a"));
        Assert.True(EnvironmentRules.ColorIsValid(" #B79CFF "));
    }

    [Trait("EnvironmentRules", "ColorIsValid")]
    [Fact(DisplayName = "Erro cor que não é #RRGGBB")]
    public void ColorIsValid_ShouldBeFalse()
    {
        //Assert
        Assert.False(EnvironmentRules.ColorIsValid("red"));
        Assert.False(EnvironmentRules.ColorIsValid("#12345"));
        Assert.False(EnvironmentRules.ColorIsValid("#1234567"));
        Assert.False(EnvironmentRules.ColorIsValid("#GGGGGG"));
        Assert.False(EnvironmentRules.ColorIsValid("FF8A7A0"));
    }

    [Trait("EnvironmentRules", "NormalizeName")]
    [Fact(DisplayName = "OK o nome é normalizado, e em branco é sem ambiente")]
    public void NormalizeName_ShouldBeOK()
    {
        //Assert
        Assert.Equal("Produção Sul", EnvironmentRules.NormalizeName("  Produção   Sul "));
        Assert.Null(EnvironmentRules.NormalizeName("   "));
        Assert.Null(EnvironmentRules.NormalizeName(null));
    }

    [Trait("EnvironmentRules", "NormalizeColor")]
    [Fact(DisplayName = "OK a cor é aparada e mantém as letras como vieram, e em branco é sem cor")]
    public void NormalizeColor_ShouldBeOK()
    {
        //Assert
        Assert.Equal("#ff8a7a", EnvironmentRules.NormalizeColor(" #ff8a7a "));
        Assert.Null(EnvironmentRules.NormalizeColor(" "));
        Assert.Null(EnvironmentRules.NormalizeColor(null));
    }
}
