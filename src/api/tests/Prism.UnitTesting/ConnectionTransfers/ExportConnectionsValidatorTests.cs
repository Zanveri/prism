using FluentValidation.TestHelper;
using Prism.Application.ConnectionTransfers.Features.ExportConnections;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-004, 006 e 008: as recusas do pedido de exportação que não leem o cofre nem derivam nada, nesta ordem: o pedido vazio, o malformado, as listas
/// acima de 2.000 IDs e a senha de exportação, com a regra da tela. O código do corpo é o da primeira recusa (`GlobalValidationExceptionFilter`).
/// </summary>
public sealed class ExportConnectionsValidatorTests
{
    private static readonly ExportConnectionsValidator Validator = new();

    private static ExportConnectionsCommand Valid()
        => new() { FolderIDs = [Guid.CreateVersion7()], Connections = [new ExportConnectionChoice { ID = Guid.CreateVersion7(), Credentials = "user" }], Passphrase = Passphrase };

    [Trait("ExportConnectionsValidator", "ExportConnectionsCommand")]
    [Fact(DisplayName = "OK pastas e conexões marcadas, cada escolha da lista e a ausente, e a senha de exportação")]
    public void Export_ShouldBeOK()
    {
        //Arrange
        var command = Valid() with
        {
            Connections =
            [
                new ExportConnectionChoice { ID = Guid.CreateVersion7(), Credentials = "none" },
                new ExportConnectionChoice { ID = Guid.CreateVersion7(), Credentials = "user" },
                new ExportConnectionChoice { ID = Guid.CreateVersion7(), Credentials = "userAndPassword" },
                new ExportConnectionChoice { ID = Guid.CreateVersion7() }
            ]
        };

        //Act
        var result = Validator.TestValidate(command);
        var onlyFolders = Validator.TestValidate(command with { Connections = null });
        var onlyConnections = Validator.TestValidate(command with { FolderIDs = null });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
        onlyFolders.ShouldNotHaveAnyValidationErrors();
        onlyConnections.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>Nenhuma pasta e nenhuma conexão: `EXPORT_EMPTY`, antes das outras recusas (a senha em branco também é recusada, depois).</summary>
    [Trait("ExportConnectionsValidator", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro nada marcado")]
    public void Export_ShouldBeError_Empty()
    {
        //Act
        var result = Validator.TestValidate(new ExportConnectionsCommand { FolderIDs = [], Connections = [] });

        //Assert
        Assert.Equal("EXPORT_EMPTY", result.Errors[0].ErrorCode);
        Assert.Equal("Marque ao menos uma conexão ou pasta para exportar.", result.Errors[0].ErrorMessage);
        result.ShouldHaveValidationErrorFor(command => command.Passphrase).WithErrorCode("EXPORT_PASSPHRASE_INVALID");
    }

    /// <summary>A escolha fora da lista (as letras contam), a conexão nula e o mesmo ID duas vezes são `EXPORT_INVALID`.</summary>
    [Trait("ExportConnectionsValidator", "ExportConnectionsCommand")]
    [Theory(DisplayName = "Erro pedido malformado")]
    [InlineData("all")]
    [InlineData("UserAndPassword")]
    [InlineData("")]
    [InlineData("nula")]
    [InlineData("repetida")]
    public void Export_ShouldBeError_Invalid(string change)
    {
        //Arrange
        var id = Guid.CreateVersion7();
        var command = change switch
        {
            "nula" => Valid() with { Connections = [null] },
            "repetida" => Valid() with { Connections = [new ExportConnectionChoice { ID = id }, new ExportConnectionChoice { ID = id, Credentials = "user" }] },
            _ => Valid() with { Connections = [new ExportConnectionChoice { ID = id, Credentials = change }] }
        };

        //Act
        var result = Validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(item => item.Connections).WithErrorCode("EXPORT_INVALID");
        Assert.Equal("EXPORT_INVALID", result.Errors[0].ErrorCode);
    }

    [Trait("ExportConnectionsValidator", "ExportConnectionsCommand")]
    [Fact(DisplayName = "Erro mais de 2.000 IDs numa lista")]
    public void Export_ShouldBeError_TooManyIDs()
    {
        //Act
        var folders = Validator.TestValidate(Valid() with { FolderIDs = [.. Enumerable.Range(0, 2001).Select(_ => Guid.CreateVersion7())] });
        var connections = Validator.TestValidate(Valid() with { Connections = [.. Enumerable.Range(0, 2001).Select(_ => new ExportConnectionChoice { ID = Guid.CreateVersion7() })] });
        var exactly = Validator.TestValidate(Valid() with { FolderIDs = [.. Enumerable.Range(0, 2000).Select(_ => Guid.CreateVersion7())], Connections = [.. Enumerable.Range(0, 2000).Select(_ => new ExportConnectionChoice { ID = Guid.CreateVersion7() })] });

        //Assert
        folders.ShouldHaveValidationErrorFor(item => item.FolderIDs).WithErrorCode("EXPORT_LIMITS_EXCEEDED");
        connections.ShouldHaveValidationErrorFor(item => item.Connections).WithErrorCode("EXPORT_LIMITS_EXCEEDED");
        exactly.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>RN-TRANSF-004: a recusa da senha de exportação no campo dela, com a frase da regra (os casos estão em `PassphraseRulesTests`).</summary>
    [Trait("ExportConnectionsValidator", "ExportConnectionsCommand")]
    [Theory(DisplayName = "Erro senha de exportação inválida, no campo")]
    [InlineData("", "Crie uma senha de exportação.")]
    [InlineData("curta", "A senha de exportação precisa ter pelo menos 12 caracteres.")]
    [InlineData(" com espaço na frente", "A senha de exportação não pode começar nem terminar com espaço.")]
    public void Export_ShouldBeError_Passphrase(string passphrase, string message)
    {
        //Act
        var result = Validator.TestValidate(Valid() with { Passphrase = passphrase });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Passphrase).WithErrorCode("EXPORT_PASSPHRASE_INVALID").WithErrorMessage(message);
    }

    /// <summary>RN-LOG-001: o comando leva duas senhas e escreve só o nome do tipo.</summary>
    [Trait("ExportConnectionsCommand", "ToString")]
    [Fact(DisplayName = "OK o comando não escreve as senhas")]
    public void Command_ToString_ShouldNotWriteThePasswords()
    {
        //Act
        var text = (Valid() with { UserPassword = "senha-do-prism" }).ToString();

        //Assert
        Assert.Equal(nameof(ExportConnectionsCommand), text);
    }
}
