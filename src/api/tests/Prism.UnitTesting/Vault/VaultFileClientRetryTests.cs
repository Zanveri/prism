using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Events;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-COFRE-013: a troca de arquivos de TODA gravação do cofre é tentada de novo, até cinco vezes e com espera curta e crescente (menos de um
/// segundo no total), quando outro programa segura o arquivo (antivírus, cópia de segurança). O client de verdade grava em arquivos de verdade; a
/// troca de arquivos e a espera entre as tentativas são as duas costuras do teste (`FileSwap` e `RetryWait`), para o "arquivo em uso" não depender do
/// sistema operacional (só o Windows o recusa) nem de tempo. É o mesmo client de `VaultFileClientTests`, em outro arquivo.
/// </summary>
public sealed partial class VaultFileClientTests
{
    /// <summary>`ERROR_SHARING_VIOLATION`, o que o .NET devolve no Windows quando outro programa segura o arquivo (o `.bak` dá o 1175, "não foi possível remover o arquivo a ser substituído").</summary>
    private static IOException InUse()
        => new("O arquivo está em uso por outro processo.", unchecked((int)0x80070020));

    private VaultFileClient CreateRetryingClient(Action<string, string> swap, List<TimeSpan>? waits = null, bool cancelledDuringTheWait = false, ILogger? logger = null)
        => new(Options.Create(VaultFakers.CreateOptions(_directory)), logger ?? Serilog.Core.Logger.None)
        {
            FileSwap = swap,
            RetryWait = (delay, _) =>
            {
                waits?.Add(delay);

                return cancelledDuringTheWait;
            }
        };

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK a troca de arquivos falha duas vezes porque o arquivo está em uso e passa na terceira")]
    public void Write_WhenTheSwapFailsTwiceBecauseTheFileIsInUse_SucceedsOnTheThirdAttempt()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        var second = VaultFakers.CreateFile();
        CreateClient().Write(_userName, first);
        var attempts = 0;
        var waits = new List<TimeSpan>();
        var client = CreateRetryingClient((temporary, path) =>
        {
            if (++attempts <= 2)
                throw InUse();

            VaultFileClient.ReplaceFiles(temporary, path);
        }, waits);

        //Act
        var written = client.Write(_userName, second);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(3, attempts);
        Assert.Equal([TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(100)], waits);
        Assert.True(client.Read(_userName).Value.Value.JsonEquals(second));
        Assert.False(File.Exists(VaultPath + ".tmp"));
    }

    /// <summary>
    /// Falhando sempre, o resultado é o de hoje (`Unavailable`), depois da quinta tentativa e de quatro esperas crescentes que somam menos de um segundo, e o
    /// cofre que estava gravado segue intacto (o `File.Replace` que não passa não toca nos arquivos).
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro arquivo em uso em todas as tentativas responde indisponível depois da quinta, com esperas que somam menos de um segundo")]
    public void Write_WhenTheSwapAlwaysFails_ReturnsUnavailableAfterTheFifthAttempt()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        CreateClient().Write(_userName, first);
        var storedBytes = File.ReadAllBytes(VaultPath);
        var attempts = 0;
        var waits = new List<TimeSpan>();
        var sink = new CollectingSink();
        var client = CreateRetryingClient((_, _) =>
        {
            attempts++;

            throw InUse();
        }, waits, logger: new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        var written = client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        Assert.True(written.IsFailure);
        Assert.Equal(EVaultFileError.Unavailable, written.Error);
        Assert.Equal(5, attempts);
        Assert.Equal([TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(200), TimeSpan.FromMilliseconds(400)], waits);
        Assert.True(waits.Aggregate(TimeSpan.Zero, (total, delay) => total + delay) < TimeSpan.FromSeconds(1));
        Assert.Equal(storedBytes, File.ReadAllBytes(VaultPath));
        // O registro de hoje, uma vez: a falha que ficou. As tentativas que vieram antes são informação, e não erro.
        var error = Assert.Single(sink.Events, logEvent => logEvent.Level == LogEventLevel.Error);
        Assert.Contains("Write", error.RenderMessage());
        Assert.Equal(4, sink.Events.Count(logEvent => logEvent.Level == LogEventLevel.Information));
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK acesso negado passageiro também é tentado de novo")]
    public void Write_WhenAccessIsDeniedForAMoment_RetriesAndSucceeds()
    {
        //Arrange
        var second = VaultFakers.CreateFile();
        CreateClient().Write(_userName, VaultFakers.CreateFile());
        var attempts = 0;
        var client = CreateRetryingClient((temporary, path) =>
        {
            if (++attempts == 1)
                throw new UnauthorizedAccessException("Acesso negado.");

            VaultFileClient.ReplaceFiles(temporary, path);
        });

        //Act
        var written = client.Write(_userName, second);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(2, attempts);
        Assert.True(client.Read(_userName).Value.Value.JsonEquals(second));
    }

    /// <summary>
    /// Os códigos do Windows que valem uma nova tentativa, um a um: 32 e 33 (violação de compartilhamento e de trava), 1175 (o arquivo a ser substituído não pôde ser
    /// removido: é o `.bak` aberto por outro programa, o que a reprodução do revisor deu) e 1176 e 1177 (o substituto não pôde ser renomeado). Sem este teste, um número
    /// trocado na lista passaria despercebido e só a reprodução de verdade o acusaria.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Theory(DisplayName = "OK cada código do Windows de arquivo em uso é tentado de novo")]
    [InlineData(32)]
    [InlineData(33)]
    [InlineData(1175)]
    [InlineData(1176)]
    [InlineData(1177)]
    public void Write_WhenTheWindowsCodeIsFileInUse_Retries(int code)
    {
        //Arrange
        var attempts = 0;
        var client = CreateRetryingClient((temporary, path) =>
        {
            if (++attempts == 1)
                throw new IOException("O arquivo está em uso.", unchecked((int)0x80070000) | code);

            VaultFileClient.ReplaceFiles(temporary, path);
        });

        //Act
        var written = client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(2, attempts);
    }

    /// <summary>
    /// A família do HRESULT conta: o 32 de um HRESULT que não é de Win32 (`0x8007xxxx`) não é arquivo em uso, e o número 32 sozinho também não; e outros códigos do
    /// Win32 (arquivo ou caminho que não existe, disco cheio, nome inválido) não valem nova tentativa.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Theory(DisplayName = "Erro HRESULT que não é de arquivo em uso, ou de outra família, não tem nova tentativa")]
    [InlineData(0x80070002u)]
    [InlineData(0x80070003u)]
    [InlineData(0x80070070u)]
    [InlineData(0x8007007Bu)]
    [InlineData(0x80040020u)]
    [InlineData(0x00000020u)]
    public void Write_WhenTheHResultIsNotAFileInUseCode_DoesNotRetry(uint hResult)
    {
        //Arrange
        var attempts = 0;
        var client = CreateRetryingClient((_, _) =>
        {
            attempts++;

            throw new IOException("Uma falha de disco.", unchecked((int)hResult));
        });

        //Act
        var written = client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        Assert.Equal(EVaultFileError.Unavailable, written.Error);
        Assert.Equal(1, attempts);
    }

    /// <summary>
    /// O que não é arquivo em uso não é tentado de novo: o disco cheio (que repetir só atrasaria e não resolveria), o caminho que sumiu e uma exceção
    /// qualquer respondem `Unavailable` na primeira tentativa, sem espera, como hoje.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro que não é arquivo em uso não tem nova tentativa")]
    public void Write_WhenTheFailureIsNotFileInUse_DoesNotRetry()
    {
        foreach (var failure in new Exception[] { new IOException("Não há espaço suficiente no disco.", unchecked((int)0x80070070)), new DirectoryNotFoundException("A pasta sumiu."), new InvalidOperationException("Um defeito.") })
        {
            //Arrange
            var attempts = 0;
            var waits = new List<TimeSpan>();
            var client = CreateRetryingClient((_, _) =>
            {
                attempts++;

                throw failure;
            }, waits);

            //Act
            var written = client.Write(_userName, VaultFakers.CreateFile());

            //Assert
            Assert.True(written.IsFailure, failure.GetType().Name);
            Assert.Equal(EVaultFileError.Unavailable, written.Error);
            Assert.Equal(1, attempts);
            Assert.Empty(waits);
        }
    }

    /// <summary>A troca que valeu não se repete: o laço só roda por causa de uma exceção, e depois do sucesso não há mais nada a tentar.</summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK depois de a troca valer não há nova tentativa nem espera")]
    public void Write_AfterTheSwapSucceeded_NeverRetries()
    {
        //Arrange
        var attempts = 0;
        var waits = new List<TimeSpan>();
        var client = CreateRetryingClient((temporary, path) =>
        {
            attempts++;
            VaultFileClient.ReplaceFiles(temporary, path);
        }, waits);

        //Act
        var written = client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(1, attempts);
        Assert.Empty(waits);
    }

    /// <summary>
    /// O cancelamento é respeitado: a primeira tentativa sempre acontece (uma gravação que começou termina como hoje), mas com o cancelamento pedido não
    /// há nova tentativa, e a espera que o cancelamento interrompe também encerra as tentativas.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK com o cancelamento pedido não há nova tentativa, e cancelar durante a espera encerra as tentativas")]
    public void Write_WhenCancelled_StopsRetrying()
    {
        //Arrange
        var attemptsAlreadyCancelled = 0;
        var attemptsCancelledDuringTheWait = 0;
        var waitsAlreadyCancelled = new List<TimeSpan>();
        var waitsCancelledDuringTheWait = new List<TimeSpan>();
        using var cancelled = new CancellationTokenSource();
        using var live = new CancellationTokenSource();
        cancelled.Cancel();
        var alreadyCancelled = CreateRetryingClient((_, _) =>
        {
            attemptsAlreadyCancelled++;

            throw InUse();
        }, waitsAlreadyCancelled);
        var duringTheWait = CreateRetryingClient((_, _) =>
        {
            attemptsCancelledDuringTheWait++;

            throw InUse();
        }, waitsCancelledDuringTheWait, cancelledDuringTheWait: true);

        //Act
        var withTheTokenCancelled = alreadyCancelled.Write(_userName, VaultFakers.CreateFile(), cancelled.Token);
        var cancelledWhileWaiting = duringTheWait.Write(_userName, VaultFakers.CreateFile(), live.Token);

        //Assert
        Assert.Equal(EVaultFileError.Unavailable, withTheTokenCancelled.Error);
        Assert.Equal(1, attemptsAlreadyCancelled);
        Assert.Empty(waitsAlreadyCancelled);
        Assert.Equal(EVaultFileError.Unavailable, cancelledWhileWaiting.Error);
        Assert.Equal(1, attemptsCancelledDuringTheWait);
        Assert.Equal([TimeSpan.FromMilliseconds(50)], waitsCancelledDuringTheWait);
    }

    /// <summary>
    /// O estado mais perigoso do `File.Replace` (o erro 1177): o principal já foi renomeado para o `.bak` e o temporário ainda não tomou o lugar. A nova
    /// tentativa o completa: sem principal, o temporário é movido para o lugar dele, e o `.bak` segue sendo o principal de antes.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK a nova tentativa completa a troca que parou entre as duas trocas de nome")]
    public void Write_WhenTheFirstAttemptStopsBetweenTheRenames_TheNextOneCompletesTheSwap()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        var second = VaultFakers.CreateFile();
        CreateClient().Write(_userName, first);
        var firstBytes = File.ReadAllBytes(VaultPath);
        var attempts = 0;
        var client = CreateRetryingClient((temporary, path) =>
        {
            if (++attempts == 1)
            {
                File.Move(path, path + ".bak", overwrite: true);

                throw new IOException("O arquivo substituto não pôde ser renomeado.", unchecked((int)0x80070499));
            }

            VaultFileClient.ReplaceFiles(temporary, path);
        });

        //Act
        var written = client.Write(_userName, second);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(2, attempts);
        Assert.True(client.Read(_userName).Value.Value.JsonEquals(second));
        Assert.Equal(firstBytes, File.ReadAllBytes(VaultPath + ".bak"));
        Assert.False(File.Exists(VaultPath + ".tmp"));
    }

    /// <summary>RN-LOG-001: cada nova tentativa é registrada como informação, com a classe da exceção e sem a mensagem (traz o caminho, que tem o nome do usuário) nem o nome do usuário.</summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK a nova tentativa vai ao log como informação, sem o nome do usuário nem a mensagem da exceção")]
    public void Write_RetriesAreLoggedAsInformation_WithoutTheUserNameOrTheExceptionMessage()
    {
        //Arrange
        var sink = new CollectingSink();
        var attempts = 0;
        var client = CreateRetryingClient((temporary, path) =>
        {
            if (++attempts == 1)
                throw new IOException($"O arquivo {path} está em uso.", unchecked((int)0x80070020));

            VaultFileClient.ReplaceFiles(temporary, path);
        }, logger: new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());

        //Act
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        var retry = Assert.Single(sink.Events);
        var text = retry.RenderMessage();
        Assert.Equal(LogEventLevel.Information, retry.Level);
        Assert.Null(retry.Exception);
        Assert.Contains("IOException", text);
        Assert.DoesNotContain(_userName, text);
        Assert.DoesNotContain("está em uso", text);
    }
}
