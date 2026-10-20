using Prism.Application.ConnectionTransfers.Models;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-004 e 009: a senha de exportação. De 12 a 128 unidades UTF-16 depois da forma NFC, sem espaço nas pontas (a lista da especificação, e não o
/// `Trim()` do .NET nem o `trim()` do JavaScript: o U+0085 é espaço e o U+FEFF não é) e sem caractere de controle; na importação, as pontas saem e a senha
/// passa à NFC antes de contar. Os casos são os mesmos da tela.
/// </summary>
public sealed class PassphraseRulesTests
{
    [Trait("PassphraseRules", "ExportRefusal")]
    [Theory(DisplayName = "Senha de exportação: a frase de cada recusa, na ordem")]
    [InlineData(null, "Crie uma senha de exportação.")]
    [InlineData("", "Crie uma senha de exportação.")]
    [InlineData("abcdefghijk", "A senha de exportação precisa ter pelo menos 12 caracteres.")]
    [InlineData(" abcdefghijkl", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("abcdefghijkl ", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("\u00A0abcdefghijkl", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("abcdefghijkl\u3000", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("\u0085abcdefghijkl", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("abcdefghijkl\u2028", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("\u202Fabcdefghijkl", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("\tabcdefghijkl", "A senha de exportação não pode começar nem terminar com espaço.")]
    [InlineData("abcdef\u0001ghijkl", "A senha de exportação não pode ter caractere de controle.")]
    [InlineData("abcdef\tghijkl", "A senha de exportação não pode ter caractere de controle.")]
    [InlineData("abcdef\u007Fghijkl", "A senha de exportação não pode ter caractere de controle.")]
    public void ExportRefusal_ShouldRefuse(string? passphrase, string expected)
    {
        //Act
        var refusal = PassphraseRules.ExportRefusal(passphrase);

        //Assert
        Assert.Equal(expected, refusal);
    }

    /// <summary>Os espaços de dentro contam; o U+FEFF (que o `trim()` do JavaScript tiraria) não é espaço da lista, e fica; sem regra de composição.</summary>
    [Trait("PassphraseRules", "ExportRefusal")]
    [Theory(DisplayName = "Senha de exportação válida")]
    [InlineData("abcdefghijkl")]
    [InlineData("senha de exportação")]
    [InlineData("\uFEFFabcdefghijkl")]
    [InlineData("😀😀😀😀😀😀")]
    public void ExportRefusal_ShouldAccept(string passphrase)
    {
        //Act
        var refusal = PassphraseRules.ExportRefusal(passphrase);

        //Assert
        Assert.Null(refusal);
    }

    /// <summary>
    /// A contagem é na forma NFC: seis "é" colados como "e" mais o acento são 12 unidades, mas seis caracteres depois da NFC, e a senha é curta; 130 unidades
    /// que viram 128 passam, e 129 de verdade não.
    /// </summary>
    [Trait("PassphraseRules", "ExportRefusal")]
    [Fact(DisplayName = "Senha de exportação contada na forma NFC, de 12 a 128")]
    public void ExportRefusal_ShouldCountInNfc()
    {
        //Arrange
        var decomposed = string.Concat(Enumerable.Repeat("e\u0301", 6));
        var composesTo128 = new string('a', 126) + "e\u0301e\u0301";

        //Act
        var shortAfterNfc = PassphraseRules.ExportRefusal(decomposed);
        var fits = PassphraseRules.ExportRefusal(composesTo128);
        var exactly128 = PassphraseRules.ExportRefusal(new string('a', 128));
        var tooLong = PassphraseRules.ExportRefusal(new string('a', 129));

        //Assert
        Assert.Equal(12, decomposed.Length);
        Assert.Equal("A senha de exportação precisa ter pelo menos 12 caracteres.", shortAfterNfc);
        Assert.Null(fits);
        Assert.Null(exactly128);
        Assert.Equal("A senha de exportação pode ter até 128 caracteres.", tooLong);
        Assert.Equal("ééé", PassphraseRules.ForExport("e\u0301e\u0301e\u0301"));
    }

    /// <summary>RN-TRANSF-009: na importação, a senha perde os espaços das pontas (os da lista) e passa à NFC; os de dentro e o U+FEFF ficam.</summary>
    [Trait("PassphraseRules", "ForImport")]
    [Theory(DisplayName = "Senha da importação sem os espaços das pontas e na forma NFC")]
    [InlineData("  senha de exportação  ", "senha de exportação")]
    [InlineData("\u00A0\u3000\u0085senha\u2029\r\n", "senha")]
    [InlineData("\uFEFFsenha", "\uFEFFsenha")]
    [InlineData("se\u0301nha", "sénha")]
    [InlineData("   ", "")]
    [InlineData(null, "")]
    public void ForImport_ShouldTrimTheListAndNormalize(string? passphrase, string expected)
    {
        //Act
        var result = PassphraseRules.ForImport(passphrase);

        //Assert
        Assert.Equal(expected, result);
    }

    /// <summary>RN-TRANSF-010, etapa 2: sem os espaços das pontas, não vazia e até 128 caracteres; nada mais (a senha é a de um colega, e a cifra a confere).</summary>
    [Trait("PassphraseRules", "ImportRefusal")]
    [Theory(DisplayName = "Senha da importação: vazia ou longa")]
    [InlineData("", "Informe a senha de exportação.")]
    [InlineData(" \u00A0 ", "Informe a senha de exportação.")]
    [InlineData("curta", null)]
    public void ImportRefusal_ShouldRefuseEmptyOnly(string passphrase, string? expected)
    {
        //Act
        var refusal = PassphraseRules.ImportRefusal(passphrase);

        //Assert
        Assert.Equal(expected, refusal);
        Assert.Null(PassphraseRules.ImportRefusal("  " + new string('a', 128) + "  "));
        Assert.Equal("A senha de exportação tem até 128 caracteres.", PassphraseRules.ImportRefusal(new string('a', 129)));
    }

    /// <summary>RN-TRANSF-004: igual à senha do Prism com as duas na forma NFC; a comparação é exata (maiúsculas contam).</summary>
    [Trait("PassphraseRules", "EqualsUserPassword")]
    [Fact(DisplayName = "Senha de exportação igual à do Prism, comparadas na NFC")]
    public void EqualsUserPassword_ShouldCompareInNfc()
    {
        //Act
        var equal = PassphraseRules.EqualsUserPassword("senha da máquina", "senha da ma\u0301quina");
        var differentCase = PassphraseRules.EqualsUserPassword("Senha da máquina", "senha da máquina");

        //Assert
        Assert.True(equal);
        Assert.False(differentCase);
    }
}
