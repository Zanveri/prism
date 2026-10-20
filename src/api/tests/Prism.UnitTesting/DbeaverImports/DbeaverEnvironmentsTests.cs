using Prism.Application.DbeaverImports.Models;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>RN-DBEAVER-012: o tipo de conexão do DBeaver vira o ambiente (o nome e a cor) e as proteções.</summary>
public sealed class DbeaverEnvironmentsTests
{
    private static readonly IReadOnlyDictionary<string, DbeaverType> NoTypes = new Dictionary<string, DbeaverType>();

    [Trait("DbeaverEnvironments", "Resolve")]
    [Theory(DisplayName = "OK os três tipos do DBeaver, reconhecidos pelo ID, viram Desenvolvimento, Teste e Produção, com a cor do tipo")]
    [InlineData(null, "Desenvolvimento", null, false, false)]
    [InlineData("dev", "Desenvolvimento", null, false, false)]
    [InlineData("test", "Teste", "#D6FACF", false, true)]
    [InlineData("prod", "Produção", "#FACFCF", true, false)]
    public void Resolve_BuiltInTypes(string? type, string name, string? color, bool confirmAll, bool confirmDataChangeOnly)
    {
        //Act
        var resolved = DbeaverEnvironments.Resolve(type, null, NoTypes);

        //Assert
        Assert.Equal((name, color, confirmAll, confirmDataChangeOnly), (resolved.Name, resolved.Color, resolved.ConfirmAll, resolved.ConfirmDataChangeOnly));
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK o nome padrão em inglês no arquivo vira o português; o renomeado pela pessoa fica com o nome dela")]
    public void Resolve_BuiltInType_InTheFile()
    {
        //Arrange
        var types = new Dictionary<string, DbeaverType>
        {
            ["prod"] = new("prod", "Production", "250,207,207", true, true, false),
            ["test"] = new("test", "Homologação", "214,250,207", false, true, false)
        };

        //Act
        var prod = DbeaverEnvironments.Resolve("prod", null, types);
        var test = DbeaverEnvironments.Resolve("test", null, types);

        //Assert
        Assert.Equal("Produção", prod.Name);
        Assert.Equal("Homologação", test.Name);
        Assert.Equal("Homologação", test.DbeaverType);
        Assert.Equal("Production", prod.DbeaverType);
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK o tipo criado pela pessoa fica com o nome e a cor dele, e o confirm-execute dele vale")]
    public void Resolve_CustomType()
    {
        //Arrange
        var types = new Dictionary<string, DbeaverType> { ["qa"] = new("qa", "QA Homologação", "10,20,30", true, false, false) };

        //Act
        var resolved = DbeaverEnvironments.Resolve("qa", null, types);

        //Assert
        Assert.Equal(("QA Homologação", "#0A141E", true), (resolved.Name, resolved.Color, resolved.ConfirmAll));
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK o tipo que nem o arquivo nem o DBeaver trazem vira o dev, como no DBeaver")]
    public void Resolve_UnknownType_IsDev()
    {
        //Act
        var resolved = DbeaverEnvironments.Resolve("desconhecido", null, NoTypes);

        //Assert
        Assert.Equal("Desenvolvimento", resolved.Name);
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK o nome com mais de 30 caracteres é cortado em 30 sem partir um par de substitutos, e a marca diz")]
    public void Resolve_CutsTheName()
    {
        //Arrange
        var name = new string('a', 29) + "😀😀";
        var types = new Dictionary<string, DbeaverType> { ["x"] = new("x", name, null, null, null, false) };

        //Act
        var resolved = DbeaverEnvironments.Resolve("x", null, types);

        //Assert
        Assert.True(resolved.Cut);
        Assert.Equal(new string('a', 29), resolved.Name);
        Assert.False(resolved.Invalid);
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK o nome com caractere de controle ou de direção do texto deixa a conexão sem ambiente e sem cor")]
    public void Resolve_InvalidName()
    {
        //Arrange
        var types = new Dictionary<string, DbeaverType> { ["x"] = new("x", "Ambiente‮ruim", "10,20,30", null, null, false) };

        //Act
        var resolved = DbeaverEnvironments.Resolve("x", "1,2,3", types);

        //Assert
        Assert.True(resolved.Invalid);
        Assert.Null(resolved.Name);
        Assert.Null(resolved.Color);
        Assert.Null(resolved.DbeaverType);
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Theory(DisplayName = "OK a cor da própria conexão vence a do tipo; o branco e o inválido não contam")]
    [InlineData("1,2,3", "#010203")]
    [InlineData("255,255,255", "#FACFCF")]
    [InlineData("256,0,0", "#FACFCF")]
    [InlineData("a,b,c", "#FACFCF")]
    [InlineData("1,2", "#FACFCF")]
    [InlineData(" 16 , 32 , 48 ", "#102030")]
    [InlineData(null, "#FACFCF")]
    public void Resolve_ConnectionColor(string? connectionColor, string expected)
        => Assert.Equal(expected, DbeaverEnvironments.Resolve("prod", connectionColor, NoTypes).Color);

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK com a cor da conexão e a do tipo brancas, o ambiente vem só com o nome")]
    public void Resolve_WhiteEverywhere_OnlyTheName()
    {
        //Act
        var resolved = DbeaverEnvironments.Resolve("dev", "255,255,255", NoTypes);

        //Assert
        Assert.Equal("Desenvolvimento", resolved.Name);
        Assert.Null(resolved.Color);
    }

    [Trait("DbeaverEnvironments", "Resolve")]
    [Fact(DisplayName = "OK as restrições de permissão do tipo contam; o confirm-execute do tipo vence o confirm-data-change sozinho")]
    public void Resolve_PermissionRestrictionsAndConfirmations()
    {
        //Arrange
        var types = new Dictionary<string, DbeaverType>
        {
            ["restrito"] = new("restrito", "Restrito", null, false, false, true),
            ["ambos"] = new("ambos", "Ambos", null, true, true, false)
        };

        //Act
        var restricted = DbeaverEnvironments.Resolve("restrito", null, types);
        var both = DbeaverEnvironments.Resolve("ambos", null, types);

        //Assert
        Assert.True(restricted.PermissionRestricted);
        Assert.True(both.ConfirmAll);
        Assert.False(both.ConfirmDataChangeOnly);
    }
}
