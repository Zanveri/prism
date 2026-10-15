using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Models;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Vault.Clients;

internal sealed class VaultFileClient(IOptions<VaultOptions> options, ILogger logger) : IVaultFileClient
{
    /// <summary>
    /// Tetos para os parâmetros de derivação do cabeçalho: 256 MiB, 8 passadas e paralelismo 8, com o
    /// padrão da RN-COFRE-002 (64 MiB, 3, 4) folgado dentro deles. O arquivo é editável por quem tem
    /// acesso ao disco, e sem teto um `memoryKiB` absurdo faria a derivação tentar alocar terabytes
    /// antes de qualquer conferência. Valem na leitura e na gravação: um cofre nunca nasce com um
    /// cabeçalho que a leitura recusaria. Quem subir o padrão além deles sobe o teto na mesma mudança.
    /// O piso de memória é o do Argon2: 8 KiB por linha de paralelismo.
    /// </summary>
    private const int MaxMemoryKiB = 256 * 1024;
    private const int MaxIterations = 8;
    private const int MaxParallelism = 8;
    private const int MinMemoryKiBPerLane = 8;

    /// <summary>
    /// RN-COFRE-013: a espera antes de cada nova tentativa de uma gravação, quando outro programa (antivírus, cópia de segurança) segura o arquivo: até
    /// cinco tentativas, com 50, 100, 200 e 400 ms entre elas (750 ms no total, menos de um segundo, que é quanto uma gravação pode segurar o semáforo do cofre a mais).
    /// </summary>
    private static readonly TimeSpan[] WriteRetryDelays = [TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(200), TimeSpan.FromMilliseconds(400)];

    /// <summary>RN-COFRE-004: nomes em camelCase (`memoryKiB`, `wrappedKey`) e `byte[]` em base64, como o formato do arquivo define.</summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ILogger _logger = logger.ForContext<VaultFileClient>();
    private readonly string _directory = Path.Combine(options.Value.DataDirectory, "vaults");

    /// <summary>Costura de teste: a troca de arquivos (temporário, principal, `.bak`). Em produção é a do sistema de arquivos (<see cref="ReplaceFiles"/>).</summary>
    internal Action<string, string> FileSwap { get; init; } = ReplaceFiles;

    /// <summary>Costura de teste: a espera entre duas tentativas. Devolve verdadeiro se o cancelamento chegou durante a espera.</summary>
    internal Func<TimeSpan, CancellationToken, bool> RetryWait { get; init; } = WaitForRetry;

    public Result<Maybe<VaultFile>, EVaultFileError> Read(string userName)
    {
        var path = PathFor(userName);
        if (path is null)
            return Maybe<VaultFile>.None;

        // O temporário de uma gravação interrompida fica ao lado e não é lido: o cofre é sempre a última versão completa (RN-COFRE-005).
        var source = Send(nameof(Read), userName, () => ReadSource(path));
        if (source.IsFailure)
            return source.Error;

        if (source.Value is not { } found)
            return Maybe<VaultFile>.None;

        // RN-VERSAO-005: o número do formato é lido do cabeçalho antes de qualquer outra coisa, inclusive antes de promover o `.bak`, e este
        // método roda antes de toda derivação de chave. Cofre de formato mais novo não é aberto, promovido nem regravado: sem a resposta
        // própria, quem voltasse a uma versão antiga do Prism concluiria que errou a senha.
        var format = Send(nameof(Read), userName, () => ReadFormat(found.Bytes));
        if (format.IsFailure)
            return format.Error;

        if (format.Value > VaultCrypto.Version)
        {
            _logger.Warning("O cofre é de um formato mais novo ({Format}) que o conhecido ({KnownFormat}); usuário {User}.", format.Value, VaultCrypto.Version, Pseudonym(userName));

            return EVaultFileError.NewerFormat;
        }

        if (found.FromBackup)
        {
            var promoted = Send(nameof(Read), userName, () =>
            {
                PromoteBackup(path, userName);

                return true;
            });
            if (promoted.IsFailure)
                return promoted.Error;
        }

        var file = Send(nameof(Read), userName, () => JsonSerializer.Deserialize<VaultFile>(found.Bytes, JsonOptions));
        if (file.IsFailure)
            return file.Error;

        if (IsWellFormed(file.Value) && file.Value.Version == format.Value)
            return Maybe.From(file.Value);

        _logger.Warning("O arquivo do cofre não tem o formato esperado; usuário {User}.", Pseudonym(userName));

        return EVaultFileError.Corrupt;
    }

    public Result<Maybe<VaultFile>, EVaultFileError> ReadBackup(string userName)
    {
        var path = PathFor(userName);
        if (path is null)
            return Maybe<VaultFile>.None;

        var bytes = Send(nameof(ReadBackup), userName, () => File.Exists(path + ".bak") ? File.ReadAllBytes(path + ".bak") : null);
        if (bytes.IsFailure)
            return bytes.Error;

        if (bytes.Value is not { } found)
            return Maybe<VaultFile>.None;

        // RN-VERSAO-005: o formato do `.bak` é lido antes de tudo, como o do principal. O de formato mais novo não é aberto nem regravado.
        var format = Send(nameof(ReadBackup), userName, () => ReadFormat(found));
        if (format.IsFailure)
            return format.Error;

        if (format.Value > VaultCrypto.Version)
        {
            _logger.Warning("O .bak do cofre é de um formato mais novo ({Format}) que o conhecido ({KnownFormat}); usuário {User}.", format.Value, VaultCrypto.Version, Pseudonym(userName));

            return EVaultFileError.NewerFormat;
        }

        var file = Send(nameof(ReadBackup), userName, () => JsonSerializer.Deserialize<VaultFile>(found, JsonOptions));
        if (file.IsFailure)
            return file.Error;

        if (IsWellFormed(file.Value) && file.Value.Version == format.Value)
            return Maybe.From(file.Value);

        _logger.Warning("O .bak do cofre não tem o formato esperado; usuário {User}.", Pseudonym(userName));

        return EVaultFileError.Corrupt;
    }

    public UnitResult<EVaultFileError> Write(string userName, VaultFile file, CancellationToken cancellationToken = default)
    {
        var path = PathFor(userName);
        if (path is null)
        {
            _logger.Warning("O nome do usuário não serve de nome de arquivo e nada foi gravado; usuário {User}.", Pseudonym(userName));

            return EVaultFileError.Unavailable;
        }

        // O que a leitura recusaria não vai para o disco: o cofre nasceria ilegível, e a pessoa só descobriria na entrada seguinte. E só o formato
        // atual é gravado (RN-VERSAO-005): o anterior só se lê, para ser migrado ao abrir.
        if (!IsWellFormed(file) || file.Version != VaultCrypto.Version)
        {
            _logger.Warning("O cofre a gravar não tem o formato que a leitura aceita e nada foi gravado; usuário {User}.", Pseudonym(userName));

            return EVaultFileError.Corrupt;
        }

        return Send(nameof(Write), userName, () =>
        {
            var temporary = path + ".tmp";
            Directory.CreateDirectory(_directory);

            // RN-COFRE-005: o conteúdo novo vai inteiro para o disco num arquivo ao lado (`WriteThrough` e
            // `Flush(true)` não deixam nada no cache do sistema) antes de tomar o lugar do cofre. Uma queda
            // no meio deixa um `.tmp` pela metade, que a gravação seguinte trunca, e o cofre como estava;
            // uma queda dentro do `File.Replace`, entre as duas trocas de nome, deixa o cofre só no `.bak`,
            // e a leitura seguinte o devolve ao lugar (`PromoteBackup`).
            using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize: 4096, FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, file, JsonOptions);
                stream.Flush(flushToDisk: true);
            }

            FileSwap(temporary, path);

            return true;
        }, retryWhenInUse: true, cancellationToken);
    }

    /// <summary>A troca de arquivos de uma gravação (RN-COFRE-005): o temporário toma o lugar do principal, que vira o `.bak`; sem principal, o temporário só é movido.</summary>
    internal static void ReplaceFiles(string temporary, string path)
    {
        if (File.Exists(path))
            File.Replace(temporary, path, path + ".bak");
        else
            File.Move(temporary, path);
    }

    private static bool WaitForRetry(TimeSpan delay, CancellationToken cancellationToken)
        => cancellationToken.WaitHandle.WaitOne(delay);

    /// <summary>Não toca o disco, e passa pelo `Send` mesmo assim: o `AesGcm` só recusa a chave errada por exceção, e senha errada é resposta esperada.</summary>
    public Result<byte[], EVaultFileError> Open(byte[] key, VaultSealedBox box, byte[] associatedData)
        => Send(nameof(Open), null, () => VaultCrypto.Open(key, box, associatedData));

    /// <summary>
    /// De onde o cofre se lê: o arquivo principal, ou o `.bak` quando o principal não existe (RN-COFRE-005). Só lê; quem decide promover
    /// o `.bak` é o <see cref="Read"/>, depois de conferir o formato.
    /// </summary>
    private static VaultSource? ReadSource(string path)
    {
        if (File.Exists(path))
            return new VaultSource(File.ReadAllBytes(path), FromBackup: false);

        var backup = path + ".bak";

        return File.Exists(backup) ? new VaultSource(File.ReadAllBytes(backup), FromBackup: true) : null;
    }

    /// <summary>
    /// RN-VERSAO-005: o número do formato, lido só do campo `version` (sem diferenciar maiúsculas, como o resto do arquivo), para que um formato
    /// futuro de outra forma ainda seja reconhecido como mais novo. O que não é um número inteiro (ausente, texto, decimal, nulo) vale 0: não
    /// é mais novo, e segue para a leitura completa, que o recusa como arquivo corrompido: ela confere que o formato lido é este número (a leitura do
    /// `JsonSerializerDefaults.Web` aceita o número em texto, e `"2"` passaria por um cofre do formato 2). JSON quebrado lança, e o `Send` o devolve como `Corrupt`.
    /// </summary>
    private static long ReadFormat(byte[] bytes)
    {
        var header = JsonSerializer.Deserialize<VaultHeader>(bytes, JsonOptions);

        return header is { Version.ValueKind: JsonValueKind.Number } && header.Version.TryGetInt64(out var format) ? format : 0;
    }

    /// <summary>
    /// RN-COFRE-005: quando o arquivo principal não existe e o `.bak` existe, o `.bak` volta a ser o
    /// principal. O estado nasce de uma queda entre as duas trocas de nome do `File.Replace`, ou da
    /// falha em que o Windows devolve erro com o principal já renomeado. Sem isso o cofre pareceria não
    /// existir: a senha certa seria recusada, e criar de novo o mesmo usuário apagaria a única cópia.
    /// Roda dentro do `Send`, depois de o formato do `.bak` ser conferido (um `.bak` de formato mais novo
    /// fica onde está, RN-VERSAO-005) e antes de responder se o cofre existe.
    /// </summary>
    private void PromoteBackup(string path, string userName)
    {
        var backup = path + ".bak";
        if (File.Exists(path) || !File.Exists(backup))
            return;

        File.Move(backup, path);
        _logger.Warning("O cofre estava só no .bak e voltou a ser o arquivo principal; usuário {User}.", Pseudonym(userName));
    }

    /// <summary>
    /// RN-COFRE-001: `&lt;PRISM_DATA_DIR&gt;/vaults/&lt;usuario&gt;.vault.json`. O nome vira nome de arquivo, e
    /// esta é a última barreira antes do disco: um nome com separador, dois-pontos ou curinga não tem
    /// cofre, para que nenhuma chamada leia ou grave fora da pasta, e um nome de dispositivo do Windows
    /// (`con`, `nul`, `com1`...) também não tem. A checagem é a do <see cref="VaultFileName"/>; a regra
    /// completa do nome (RN-COFRE-010) é de quem recebe a requisição.
    /// </summary>
    private string? PathFor(string userName)
        => VaultFileName.IsAllowed(userName) ? Path.Combine(_directory, $"{userName}.vault.json") : null;

    /// <summary>
    /// O System.Text.Json não recusa campo faltando (entrega nulo) nem confere tamanho: é aqui que
    /// "campo faltando" e "parâmetro absurdo" viram arquivo corrompido, antes de qualquer derivação. O
    /// formato atual e os anteriores que ainda se leem (RN-VERSAO-005): o cabeçalho é o mesmo nos dois, e o
    /// anterior é migrado em `VaultService.Unlock`, ao abrir. A gravação só aceita o atual (`Write`).
    /// </summary>
    private static bool IsWellFormed([NotNullWhen(true)] VaultFile? file)
        => file is { Version: >= VaultCrypto.OldestVersion and <= VaultCrypto.Version } && IsWellFormed(file.Kdf) && IsSealedBox(file.WrappedKey) && file.WrappedKey.Ciphertext.Length == VaultCrypto.KeySize && IsSealedBox(file.Payload);

    private static bool IsWellFormed(VaultKdf? kdf)
        => kdf is { Algorithm: VaultCrypto.Algorithm, MemoryKiB: <= MaxMemoryKiB, Iterations: >= 1 and <= MaxIterations, Parallelism: >= 1 and <= MaxParallelism, Salt.Length: VaultCrypto.SaltSize } && kdf.MemoryKiB >= MinMemoryKiBPerLane * kdf.Parallelism;

    private static bool IsSealedBox(VaultSealedBox? box)
        => box is { Nonce.Length: VaultCrypto.NonceSize, Ciphertext: not null, Tag.Length: VaultCrypto.TagSize };

    /// <summary>De onde vieram os bytes do cofre: do arquivo principal ou, na falta dele, do `.bak`.</summary>
    private sealed record VaultSource(byte[] Bytes, bool FromBackup);

    /// <summary>Só o número do formato do cabeçalho (RN-VERSAO-005). `JsonElement` para o texto e o decimal não virarem exceção no meio da leitura.</summary>
    private sealed record VaultHeader(JsonElement Version);

    /// <summary>O log não leva o nome do usuário em claro: os 16 primeiros hexadecimais do SHA-256 bastam para juntar as linhas de uma mesma pessoa.</summary>
    private static string Pseudonym(string? userName)
        => userName is null ? "-" : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userName)))[..16];

    /// <summary>
    /// O único `try` da integração: exceção nenhuma sai daqui. A falha volta como `Result`, e o log
    /// recebe a classe do erro (RN-LOG-001), nunca a exceção inteira: a mensagem de uma `IOException`
    /// traz o caminho do arquivo, que tem o nome do usuário, e a de uma `JsonException`, um pedaço do
    /// conteúdo.
    ///
    /// `Corrupt` é o arquivo que não é JSON de cofre e a cifra que não autenticou (senha errada ou
    /// conteúdo adulterado); todo o resto é o disco, e sai como `Unavailable`.
    ///
    /// RN-COFRE-013: só a gravação (`retryWhenInUse`) repete a chamada, e só quando o arquivo está em uso por outro programa (<see cref="IsFileInUse"/>), até
    /// cinco tentativas com espera crescente. A chamada inteira se repete (o temporário é escrito de novo e a troca é refeita), então uma troca que parou
    /// entre as duas trocas de nome (o erro 1177) é completada pela tentativa seguinte, que não acha o principal e move o temporário para o lugar dele. Nada
    /// se repete depois de uma troca que valeu (ela não lança), disco cheio e o resto têm o desfecho de sempre, e o cancelamento pedido não deixa começar
    /// uma nova espera nem uma nova tentativa (a primeira tentativa sempre acontece).
    /// </summary>
    private Result<T, EVaultFileError> Send<T>(string operation, string? userName, Func<T> call, bool retryWhenInUse = false, CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return Result.Success<T, EVaultFileError>(call());
            }
            catch (Exception exception) when (exception is JsonException or CryptographicException)
            {
                _logger.Warning("O cofre não abriu em {Operation} ({ExceptionType}); usuário {User}.", operation, exception.GetType().Name, Pseudonym(userName));

                return EVaultFileError.Corrupt;
            }
            catch (Exception exception) when (retryWhenInUse && attempt <= WriteRetryDelays.Length && !cancellationToken.IsCancellationRequested && IsFileInUse(exception))
            {
                // A classe da exceção e nada mais: a mensagem traz o caminho do arquivo, que tem o nome do usuário.
                _logger.Information("O arquivo do cofre estava em uso em {Operation} ({ExceptionType}); nova tentativa {Attempt} de {MaxAttempts}; usuário {User}.", operation, exception.GetType().Name, attempt + 1, WriteRetryDelays.Length + 1, Pseudonym(userName));

                if (RetryWait(WriteRetryDelays[attempt - 1], cancellationToken))
                    return Failed<T>(operation, userName, exception);
            }
            catch (Exception exception)
            {
                return Failed<T>(operation, userName, exception);
            }
        }
    }

    private Result<T, EVaultFileError> Failed<T>(string operation, string? userName, Exception exception)
    {
        _logger.Error("O arquivo do cofre falhou em {Operation} ({ExceptionType}, HResult {HResult}); usuário {User}.{NewLine}{StackTrace}", operation, exception.GetType().Name, exception.HResult, Pseudonym(userName), Environment.NewLine, exception.StackTrace);

        return EVaultFileError.Unavailable;
    }

    /// <summary>
    /// RN-COFRE-013: o que vale uma nova tentativa na gravação é arquivo em uso por outro programa ou acesso negado passageiro: `UnauthorizedAccessException` e, no
    /// Windows, o `IOException` de HRESULT `0x8007xxxx` com o código 32 ou 33 (violação de compartilhamento ou de trava), 1175 (o arquivo a ser substituído não
    /// pôde ser removido: é o que o `.bak` aberto por outro programa dá) ou 1176 e 1177 (o substituto não pôde ser renomeado; o 1177 é o principal já renomeado
    /// para o `.bak`). Disco cheio, caminho que sumiu e o resto não são.
    /// </summary>
    private static bool IsFileInUse(Exception exception)
    {
        if (exception is UnauthorizedAccessException)
            return true;

        return exception is IOException && (exception.HResult & unchecked((int)0xFFFF0000)) == unchecked((int)0x80070000) && (exception.HResult & 0xFFFF) is 32 or 33 or 1175 or 1176 or 1177;
    }
}
