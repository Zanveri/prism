using Microsoft.Extensions.Options;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.ConnectionFiles.Clients;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Serilog.Core;
using System.Text.Json;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-007 e RN-VERSAO-002: o formato 1 do arquivo da exportação de conexões é contrato. `Samples/connections-format-1.prismconexoes` foi gerado pelo
/// próprio código da exportação (o `ExportPlanner` e o `ConnectionFileService`, com a derivação de verdade e o Argon2id pequeno dos testes, 8 MiB e uma
/// passada, que o cabeçalho registra) e NÃO se regera: quem o regerar perde a prova de que o formato 1 continua abrindo. Os dados são inventados (os hosts no
/// domínio reservado `.invalid`, senhas de banco fictícias) e a SENHA DE EXPORTAÇÃO é a constante fictícia abaixo: sem ela o arquivo não serve de prova.
///
/// O que ele traz: "Estoque" (com cor) e, dentro, "Desenvolvimento DEV" (ambiente Desenvolvimento) e "Production PRD" (ambiente Production, somente leitura
/// e confirmação de todos os comandos); "Vazia", marcada sem nada dentro; "DATA FIX" de DEV com usuário e senha, "NOMINAL" de DEV sem usuário e senha,
/// "DATA FIX" de PRD com usuário e senha e consulta de verificação própria a cada 60 segundos, "[PERIGO] DATA FIX" de PRD só com o usuário e a confirmação
/// dos irreversíveis, "MIGRATION USER" de PRD (Db2) só com o usuário, e "Relatórios" na raiz (PostgreSQL), sem usuário e senha e com a verificação desligada.
/// </summary>
public sealed class ConnectionFileFormatOneSampleTests
{
    private const string SamplePassphrase = "exportação de exemplo fictícia";

    private const string SampleResource = "connections-format-1.prismconexoes";

    private static string ReadSample()
    {
        using var stream = typeof(ConnectionFileFormatOneSampleTests).Assembly.GetManifestResourceStream(SampleResource)!;
        using var reader = new StreamReader(stream);

        return reader.ReadToEnd();
    }

    /// <summary>A derivação de verdade (`VaultCrypto.DeriveKey`), com os parâmetros que o cabeçalho do arquivo registra.</summary>
    private static ConnectionFileService CreateService()
        => new(new ConnectionFileClient(Logger.None), Options.Create(new ConnectionFileOptions()), VaultCrypto.DeriveKey);

    [Trait("ConnectionFileFormatOneSample", "OpenAsync")]
    [Fact(DisplayName = "OK o arquivo do formato 1 abre com a senha de exportação e traz o que foi exportado")]
    public async Task Sample_ShouldOpen()
    {
        //Arrange
        var sample = ReadSample();

        //Act
        var opened = await ImportFiles.OpenAsync(CreateService(), sample, "  " + SamplePassphrase + "  ", CancellationToken.None);

        //Assert
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.Type : null);
        var analysis = opened.Value;
        Assert.Equal(0, analysis.InvalidCount);
        Assert.Equal(["Estoque", "Vazia", "Desenvolvimento DEV", "Production PRD"], analysis.Folders.Select(folder => folder.Candidate!.Name));
        Assert.Equal(6, analysis.Connections.Count);

        var production = analysis.Folders.Single(folder => folder.Candidate!.Name == "Production PRD").Candidate!;
        Assert.True(production.ReadOnly);
        Assert.Equal("all", production.ConfirmCommands);
        Assert.Equal(("Production", "#d64545"), (production.EnvironmentName, production.EnvironmentColor));
        Assert.Equal("#2f6fdf", analysis.Folders.Single(folder => folder.Candidate!.Name == "Estoque").Candidate!.Color);

        var connections = analysis.Connections.Select(connection => connection.Candidate!).ToList();
        var prdDataFix = connections.Single(connection => connection.Name == "DATA FIX" && connection.Host == "informix-prd.exemplo.invalid");
        Assert.Equal(("datafix", "senha-ficticia-prd"), (prdDataFix.UserName, prdDataFix.Password));
        Assert.Equal(60, prdDataFix.VerificationInterval);
        Assert.Equal("SELECT 1 FROM systables WHERE tabid = 1", prdDataFix.VerificationQuery);
        var danger = connections.Single(connection => connection.Name == "[PERIGO] DATA FIX");
        Assert.Equal(("datafix", string.Empty), (danger.UserName, danger.Password));
        Assert.Equal("irreversible", danger.ConfirmCommands);
        Assert.Equal(new ImportOrigin(true, "all", new Prism.Application.Common.Environments.ShownEnvironment("Production", "#d64545")), analysis.Connections.Single(connection => connection.Candidate!.Name == "[PERIGO] DATA FIX").Origin);
        var migration = connections.Single(connection => connection.Name == "MIGRATION USER");
        Assert.Equal((EDatabaseEngine.Db2, "db2-prd.exemplo.invalid", 50000), (migration.Engine, migration.Host, migration.Port));
        var nominal = connections.Single(connection => connection.Name == "NOMINAL");
        Assert.Equal((string.Empty, string.Empty), (nominal.UserName, nominal.Password));
        var reports = connections.Single(connection => connection.Name == "Relatórios");
        Assert.Equal((EDatabaseEngine.PostgreSql, false), (reports.Engine, reports.VerificationEnabled));
    }

    /// <summary>O cabeçalho do formato 1: o `kind`, o número e os parâmetros em claro, e nenhum dado do conteúdo fora do `payload` cifrado.</summary>
    [Trait("ConnectionFileFormatOneSample", "OpenAsync")]
    [Fact(DisplayName = "OK o cabeçalho do formato 1 está em claro, e o conteúdo, não")]
    public void Sample_HeaderIsInClear()
    {
        //Arrange
        var sample = ReadSample();
        var root = JsonDocument.Parse(sample).RootElement;

        //Assert
        Assert.Equal(["kind", "version", "kdf", "payload"], root.EnumerateObject().Select(property => property.Name));
        Assert.Equal("prism-connections", root.GetProperty("kind").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal("argon2id", root.GetProperty("kdf").GetProperty("algorithm").GetString());
        Assert.DoesNotContain("exemplo.invalid", sample);
        Assert.DoesNotContain("datafix", sample);
        Assert.DoesNotContain("Estoque", sample);
    }

    /// <summary>RN-TRANSF-010: com outra senha, a recusa é a da senha errada (a mesma do arquivo alterado).</summary>
    [Trait("ConnectionFileFormatOneSample", "OpenAsync")]
    [Fact(DisplayName = "Erro o arquivo do formato 1 não abre com outra senha")]
    public async Task Sample_ShouldNotOpenWithAnotherPassphrase()
    {
        //Act
        var opened = await CreateService().OpenAsync(ReadSample(), "outra senha de exportação", root => root.Clone(), CancellationToken.None);

        //Assert
        Assert.Equal(EConnectionFileError.WrongPassphrase, opened.Error);
    }
}
