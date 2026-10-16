using Prism.Application.Connections.Models;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.ConnectionFiles.Models;
using System.Net;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// Seção 6 e RN-TRANSF-010 e 016: os códigos das recusas da exportação, da importação e da conexão sem usuário e senha, com o status, o campo (na forma do
/// erro de campo, `errors` e `errorCodes`, com o nome em PascalCase) e a frase da especificação.
/// </summary>
public sealed class TransferErrorsTests
{
    private static string? FieldOf(Prism.Core.Api.Models.Dtos.ApiErrorDto error)
        => error.Extensions is { } extensions && extensions.TryGetValue("errorCodes", out var codes) ? ((Dictionary<string, string[]>)codes!).Keys.Single() : null;

    /// <summary>Todo valor do `EConnectionFileError` tem tradução: um valor novo sem ela seria 500.</summary>
    [Trait("TransferErrors", "From")]
    [Theory(DisplayName = "Cada recusa da leitura do arquivo tem o código, o status e o campo da seção 6")]
    [InlineData(EConnectionFileError.Invalid, "IMPORT_FILE_INVALID", HttpStatusCode.UnprocessableEntity, "Content", "Este arquivo não é uma exportação de conexões do Prism, ou está danificado.")]
    [InlineData(EConnectionFileError.Newer, "IMPORT_FILE_NEWER", HttpStatusCode.Conflict, null, "Este arquivo foi exportado por uma versão mais nova do Prism. Atualize o Prism para importá-lo.")]
    [InlineData(EConnectionFileError.WrongPassphrase, "IMPORT_PASSPHRASE_WRONG", HttpStatusCode.UnprocessableEntity, "Passphrase", "A senha de exportação não confere, ou o arquivo foi alterado.")]
    public void From_ShouldMapEachError(EConnectionFileError value, string type, HttpStatusCode status, string? field, string detail)
    {
        //Act
        var error = TransferErrors.From(value);

        //Assert
        Assert.Equal(type, error.Type);
        Assert.Equal(status, error.StatusCode);
        Assert.Equal(field, FieldOf(error));
        Assert.Equal(detail, error.Detail);
        Assert.Equal(3, Enum.GetValues<EConnectionFileError>().Length);
    }

    /// <summary>RN-TRANSF-006 e 010: uma frase só para cada código de limite, a mesma da tela.</summary>
    [Trait("TransferErrors", "Limits")]
    [Fact(DisplayName = "As recusas de limite têm a frase da especificação")]
    public void Limits_ShouldHaveTheSpecificationSentence()
    {
        //Act
        var export = TransferErrors.ExportLimitsExceeded();
        var import = TransferErrors.ImportLimitsExceeded();

        //Assert
        Assert.Equal("EXPORT_LIMITS_EXCEEDED", export.Type);
        Assert.Equal("O arquivo passaria dos limites da importação: até 2.000 conexões, 2.000 pastas, 5 MiB e 32 níveis de pastas a partir da raiz. Exporte em partes; o que está a mais de 32 níveis da raiz só sai se for movido para mais perto dela.", export.Detail);
        Assert.Equal("IMPORT_LIMITS_EXCEEDED", import.Type);
        Assert.Equal("Este arquivo passa dos limites da importação: até 5 MiB, 2.000 conexões, 2.000 pastas e 32 níveis de pastas.", import.Detail);
        Assert.Equal("Content", FieldOf(import));
    }

    /// <summary>
    /// RN-TRANSF-016: `CONNECTION_CREDENTIALS_MISSING` na forma do erro de campo, no campo que falta (`UserName` sem usuário, `Password` com o usuário e sem
    /// a senha); e o `PATCH` que tira o usuário de uma conexão que tem um é o `CONNECTION_INVALID` do formulário, no campo dele (RN-TRANSF-015).
    /// </summary>
    [Trait("ConnectionErrors", "CredentialsMissing")]
    [Fact(DisplayName = "Conexão sem usuário ou sem senha: o código no campo que falta")]
    public void CredentialsMissing_ShouldBeOnTheMissingField()
    {
        //Act
        var noUser = ConnectionErrors.CredentialsMissingToConnect(userNameMissing: true);
        var noPassword = ConnectionErrors.CredentialsMissingToConnect(userNameMissing: false);
        var test = ConnectionErrors.CredentialsMissingToTest();
        var patch = ConnectionErrors.UserNameRequired();

        //Assert
        Assert.All([noUser, noPassword, test], error =>
        {
            Assert.Equal("CONNECTION_CREDENTIALS_MISSING", error.Type);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        });
        Assert.Equal("UserName", FieldOf(noUser));
        Assert.Equal("Password", FieldOf(noPassword));
        Assert.Equal("Password", FieldOf(test));
        Assert.Equal("Esta conexão não tem senha gravada. Informe a senha do banco para testar.", test.Detail);
        Assert.Equal("CONNECTION_INVALID", patch.Type);
        Assert.Equal("UserName", FieldOf(patch));
        Assert.Equal("Informe o usuário do banco.", patch.Detail);
    }
}
