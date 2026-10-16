using CSharpFunctionalExtensions;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.Vault.Clients;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.ConnectionFiles.Clients;

internal sealed class ConnectionFileClient(ILogger logger) : IConnectionFileClient
{
    /// <summary>
    /// RN-TRANSF-007: os nomes em camelCase (`memoryKiB`, `payload`) e os `byte[]` em base64, como o cabeçalho do cofre. Número só como número: a leitura do
    /// `JsonSerializerDefaults.Web` aceitaria `"65536"` em texto, e o formato diz inteiro.
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.Strict };

    private readonly ILogger _logger = logger.ForContext<ConnectionFileClient>();

    public Result<ConnectionFile, EConnectionFileError> Read(string content)
    {
        var read = Send(nameof(Read), () => ReadHeader(content));
        if (read.IsFailure)
            return read.Error;

        if (read.Value.IsFailure)
            _logger.Information("O arquivo de conexões foi recusado na leitura do cabeçalho ({Refusal:l}).", read.Value.Error.ToString());

        return read.Value;
    }

    public Result<T, EConnectionFileError> Open<T>(byte[] key, ConnectionFile file, Func<JsonElement, T> readContent)
    {
        // RN-TRANSF-007: o cabeçalho é o dado autenticado; mudar um valor dele, ou um byte do conteúdo, da tag ou do nonce, faz a abertura falhar.
        var plaintext = Send(nameof(Open), () => VaultCrypto.Open(key, file.Payload, ConnectionFileFormat.AssociatedData(file.Version, file.Kdf)));
        if (plaintext.IsFailure)
            return plaintext.Error;

        // RN-TRANSF-010: o `JsonDocument` lê o buffer sem copiá-lo (o que a leitura extrai vira texto do .NET, como o documento do cofre), e o buffer é zerado
        // assim que a leitura acaba, também quando ela falha: a saída do `using` o zera mesmo com uma exceção que o `Send` não trata (um defeito, que sobe).
        return Send("Content", () =>
        {
            using var wipe = new Wipe(plaintext.Value);
            using var document = JsonDocument.Parse(plaintext.Value.AsMemory());

            return readContent(document.RootElement);
        });
    }

    public string Write(ConnectionFile file)
    {
        // O que a leitura recusaria não sai: um arquivo exportado pelo Prism sempre abre no mesmo Prism. Os parâmetros vêm das opções, e passar dos limites é
        // defeito de configuração, e não resposta.
        if (!IsWellFormed(file))
            throw new InvalidOperationException("O arquivo de conexões a gravar não tem o cabeçalho que a leitura aceita.");

        return JsonSerializer.Serialize(file, JsonOptions);
    }

    /// <summary>
    /// RN-TRANSF-010, etapas 3 a 5, nesta ordem e sem derivar nada. O `kind` e o `version` são lidos antes do resto do cabeçalho (`ConnectionFileHeader`),
    /// para um formato futuro de outra forma ainda ser reconhecido como mais novo; depois a leitura completa, que confere a forma (o base64 que não decodifica
    /// lança, e o `Send` o devolve como `Invalid`) e os limites, os mesmos do cofre. JSON quebrado e o texto vazio também lançam.
    /// </summary>
    private static Result<ConnectionFile, EConnectionFileError> ReadHeader(string content)
    {
        var header = JsonSerializer.Deserialize<ConnectionFileHeader>(content, JsonOptions);
        if (header is not { Kind.ValueKind: JsonValueKind.String } || header.Kind.GetString() != ConnectionFileFormat.Kind)
            return EConnectionFileError.Invalid;

        var format = FormatOf(header.Version);
        if (format > ConnectionFileFormat.Version)
            return EConnectionFileError.Newer;

        if (format != ConnectionFileFormat.Version)
            return EConnectionFileError.Invalid;

        var file = JsonSerializer.Deserialize<ConnectionFile>(content, JsonOptions);

        return IsWellFormed(file) ? file : EConnectionFileError.Invalid;
    }

    /// <summary>
    /// RN-TRANSF-010, etapa 4: o número do formato, só de um inteiro escrito como tal (dígitos, sem sinal, casas nem expoente). O que não é um inteiro vale 0
    /// (`Invalid`); o inteiro grande demais para um `int` é maior que qualquer formato conhecido (`Newer`), e não um arquivo danificado.
    /// </summary>
    private static long FormatOf(JsonElement version)
    {
        if (version.ValueKind != JsonValueKind.Number)
            return 0;

        var text = version.GetRawText();
        if (!text.All(char.IsAsciiDigit))
            return 0;

        return text.Length > 9 ? long.MaxValue : long.Parse(text, System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>A forma do cabeçalho e os limites do cofre (`VaultHeaderLimits`): o algoritmo, a memória, as passadas, o paralelismo, o sal, o nonce e a tag.</summary>
    private static bool IsWellFormed([NotNullWhen(true)] ConnectionFile? file)
        => file is { Kind: ConnectionFileFormat.Kind, Version: ConnectionFileFormat.Version } && VaultHeaderLimits.IsWellFormed(file.Kdf) && VaultHeaderLimits.IsSealedBox(file.Payload);

    /// <summary>
    /// O único `try` da integração. A falha volta como `Result`, e o log recebe a classe da exceção, nunca a exceção inteira (RN-LOG-001 e RN-TRANSF-010): a
    /// mensagem de uma `JsonException` traz um pedaço do texto, que no conteúdo aberto é o conteúdo em claro.
    ///
    /// `WrongPassphrase` é a cifra que não autenticou (a senha errada ou o arquivo alterado: o AES-GCM não distingue). `Invalid` é o JSON que não lê: o
    /// `JsonException`, e o `InvalidOperationException` que o leitor de JSON lança ao ler um texto com um caractere UTF-16 inválido (um `\ud800` sozinho). O
    /// resto é defeito, e sobe como veio.
    /// </summary>
    private Result<T, EConnectionFileError> Send<T>(string operation, Func<T> call)
    {
        try
        {
            return Result.Success<T, EConnectionFileError>(call());
        }
        catch (CryptographicException exception)
        {
            _logger.Information("O arquivo de conexões não abriu em {Operation} ({ExceptionType}): a senha de exportação não confere, ou o arquivo foi alterado.", operation, exception.GetType().Name);

            return EConnectionFileError.WrongPassphrase;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            _logger.Warning("O arquivo de conexões não é um JSON que o Prism lê, em {Operation} ({ExceptionType}).", operation, exception.GetType().Name);

            return EConnectionFileError.Invalid;
        }
    }

    /// <summary>Só o `kind` e o número do formato (RN-TRANSF-010, etapas 3 e 4). `JsonElement` para o texto e o decimal não virarem exceção no meio da leitura.</summary>
    private sealed record ConnectionFileHeader(JsonElement Kind, JsonElement Version);

    /// <summary>Zera o buffer na saída do `using`, como a fila devolve a vez no serviço: sem `try`/`finally` fora do `Send`.</summary>
    private readonly struct Wipe(byte[] buffer) : IDisposable
    {
        public void Dispose()
            => CryptographicOperations.ZeroMemory(buffer);
    }
}
