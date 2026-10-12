using Prism.Api.Hosting;

namespace Prism.UnitTesting.Hosting;

public sealed class PrismHostOptionsTests
{
    private const string Token = "token-de-lancamento";
    private const string DataDirectory = @"C:\dados\prism";
    private const string Origin = "http://localhost:5173";

    private static Dictionary<string, string?> CompleteEnvironment() => new()
    {
        ["PRISM_API_TOKEN"] = Token,
        ["PRISM_DATA_DIR"] = DataDirectory,
        ["PRISM_ALLOWED_ORIGIN"] = Origin
    };

    private static PrismHostOptions Read(Dictionary<string, string?> environment) => PrismHostOptions.FromEnvironment(name => environment.GetValueOrDefault(name));

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "OK")]
    public void FromEnvironment_ShouldBeOK()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment["PRISM_PARENT_PID"] = "4321";

        //Act
        var options = Read(environment);

        //Assert
        Assert.Equal(new PrismHostOptions(Token, DataDirectory, Origin, 4321), options);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Erro sem PRISM_API_TOKEN")]
    public void FromEnvironment_WithoutApiToken_ThrowsNamingTheVariable()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment.Remove("PRISM_API_TOKEN");

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_API_TOKEN", exception.Message);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Erro sem PRISM_DATA_DIR")]
    public void FromEnvironment_WithoutDataDir_ThrowsNamingTheVariable()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment.Remove("PRISM_DATA_DIR");

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_DATA_DIR", exception.Message);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Erro sem PRISM_ALLOWED_ORIGIN")]
    public void FromEnvironment_WithoutAllowedOrigin_ThrowsNamingTheVariable()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment.Remove("PRISM_ALLOWED_ORIGIN");

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_ALLOWED_ORIGIN", exception.Message);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Variável obrigatória em branco conta como ausente")]
    public void FromEnvironment_WithBlankApiToken_ThrowsNamingTheVariable()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment["PRISM_API_TOKEN"] = "   ";

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_API_TOKEN", exception.Message);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "PRISM_PARENT_PID é opcional")]
    public void FromEnvironment_WithoutParentPid_ReturnsNullParent()
    {
        //Arrange
        var environment = CompleteEnvironment();

        //Act
        var options = Read(environment);

        //Assert
        Assert.Null(options.ParentProcessID);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Erro com PRISM_PARENT_PID que não é número")]
    public void FromEnvironment_WithInvalidParentPid_Throws()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment["PRISM_PARENT_PID"] = "abc";

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_PARENT_PID", exception.Message);
    }

    [Trait("PrismHostOptions", "FromEnvironment")]
    [Fact(DisplayName = "Erro com PRISM_PARENT_PID que não é positivo")]
    public void FromEnvironment_WithNonPositiveParentPid_Throws()
    {
        //Arrange
        var environment = CompleteEnvironment();
        environment["PRISM_PARENT_PID"] = "0";

        //Act
        var exception = Assert.Throws<InvalidOperationException>(() => Read(environment));

        //Assert
        Assert.Contains("PRISM_PARENT_PID", exception.Message);
    }

    [Trait("PrismHostOptions", "ToString")]
    [Fact(DisplayName = "ToString não revela o token")]
    public void ToString_ShouldNotExposeTheToken()
    {
        //Arrange
        var options = Read(CompleteEnvironment());

        //Act
        var text = options.ToString();

        //Assert
        Assert.DoesNotContain(Token, text);
    }
}
