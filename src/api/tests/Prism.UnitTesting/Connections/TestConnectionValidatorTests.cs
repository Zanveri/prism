using FluentValidation.TestHelper;
using Prism.Application.Connections.Features.TestConnection;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Connections;

/// <summary>RN-CONN-010 e 013: os campos de conexão do formulário, um inválido por vez, sempre `CONNECTION_INVALID`; a senha é obrigatória sem `id` e opcional com ele.</summary>
public sealed class TestConnectionValidatorTests
{
    private static readonly TestConnectionValidator Validator = new();

    private static TestConnectionCommand Valid(Guid? id = null, EDatabaseEngine engine = EDatabaseEngine.PostgreSql, string host = "pg.local", int port = 5432, string database = "producao", string userName = "operador", string? password = "senha")
        => new() { ID = id, Engine = engine, Host = host, Port = port, Database = database, UserName = userName, Password = password };

    private static void AssertInvalid(TestConnectionCommand command, string property)
    {
        //Act
        var result = Validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID");
        Assert.All(result.Errors, error => Assert.Equal(property, error.PropertyName));
    }

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "OK com senha, com id e sem senha, e com id e senha")]
    public void TestConnection_ShouldBeOK()
    {
        //Act
        var typed = Validator.TestValidate(Valid());
        var stored = Validator.TestValidate(Valid(id: Guid.CreateVersion7(), password: null));
        var overridden = Validator.TestValidate(Valid(id: Guid.CreateVersion7()));

        //Assert
        typed.ShouldNotHaveAnyValidationErrors();
        stored.ShouldNotHaveAnyValidationErrors();
        overridden.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "OK nos limites da porta e para cada banco")]
    public void TestConnection_ShouldBeOK_AtTheLimits()
    {
        //Act
        var results = new[] { Valid(port: 1), Valid(port: 65535), Valid(engine: EDatabaseEngine.Db2), Valid(engine: EDatabaseEngine.Informix) }.Select(command => Validator.TestValidate(command));

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro banco fora da lista")]
    public void TestConnection_ShouldBeError_EngineInvalid()
        => AssertInvalid(Valid(engine: (EDatabaseEngine)9), nameof(TestConnectionCommand.Engine));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro host em branco")]
    public void TestConnection_ShouldBeError_HostBlank()
        => AssertInvalid(Valid(host: "   "), nameof(TestConnectionCommand.Host));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro porta zero")]
    public void TestConnection_ShouldBeError_PortZero()
        => AssertInvalid(Valid(port: 0), nameof(TestConnectionCommand.Port));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro porta acima de 65535")]
    public void TestConnection_ShouldBeError_PortTooHigh()
        => AssertInvalid(Valid(port: 65536), nameof(TestConnectionCommand.Port));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro banco de dados em branco")]
    public void TestConnection_ShouldBeError_DatabaseBlank()
        => AssertInvalid(Valid(database: ""), nameof(TestConnectionCommand.Database));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro usuário em branco")]
    public void TestConnection_ShouldBeError_UserNameBlank()
        => AssertInvalid(Valid(userName: " "), nameof(TestConnectionCommand.UserName));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro sem id e sem senha: não há senha guardada para usar")]
    public void TestConnection_ShouldBeError_PasswordMissingWithoutID()
        => AssertInvalid(Valid(password: null), nameof(TestConnectionCommand.Password));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro sem id e senha vazia")]
    public void TestConnection_ShouldBeError_PasswordEmptyWithoutID()
        => AssertInvalid(Valid(password: ""), nameof(TestConnectionCommand.Password));

    [Trait("TestConnectionValidator", "TestConnectionCommand")]
    [Fact(DisplayName = "Erro com id e senha vazia: enviada, tem de ter conteúdo")]
    public void TestConnection_ShouldBeError_PasswordEmptyWithID()
        => AssertInvalid(Valid(id: Guid.CreateVersion7(), password: ""), nameof(TestConnectionCommand.Password));
}
