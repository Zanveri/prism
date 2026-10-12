using System.Globalization;

namespace Prism.Api.Hosting;

/// <summary>
/// O que o processo principal do Electron entrega à API ao iniciá-la, por variáveis de ambiente.
/// RN-API-003: não há valor padrão, porque um token ou uma pasta "de desenvolvimento" embutidos
/// valeriam também no app instalado; sem as três obrigatórias a API não sobe e diz qual faltou.
/// </summary>
/// <param name="ApiToken">O token de lançamento: 32 bytes aleatórios que só o processo principal e a tela conhecem.</param>
/// <param name="DataDirectory">Onde ficam os cofres e os logs.</param>
/// <param name="AllowedOrigin">A única origem que o CORS aceita: o Vite em desenvolvimento, `app://prism` empacotado.</param>
/// <param name="ParentProcessID">O processo que a API acompanha; ela encerra quando ele deixa de existir (RN-API-004).</param>
public sealed record PrismHostOptions(string ApiToken, string DataDirectory, string AllowedOrigin, int? ParentProcessID)
{
    private const string ApiTokenVariable = "PRISM_API_TOKEN";
    private const string DataDirectoryVariable = "PRISM_DATA_DIR";
    private const string AllowedOriginVariable = "PRISM_ALLOWED_ORIGIN";
    private const string ParentProcessVariable = "PRISM_PARENT_PID";

    public static PrismHostOptions FromEnvironment(Func<string, string?> read)
        => new(Required(read, ApiTokenVariable), Required(read, DataDirectoryVariable), Required(read, AllowedOriginVariable), ParentProcessIDOf(read(ParentProcessVariable)));

    /// <summary>O ToString gerado pelo record imprimiria o token; o log nunca recebe credencial.</summary>
    public override string ToString() => nameof(PrismHostOptions);

    private static string Required(Func<string, string?> read, string variable)
        => read(variable) is { } value && !string.IsNullOrWhiteSpace(value) ? value : throw new InvalidOperationException($"Defina a variável de ambiente {variable}.");

    private static int? ParentProcessIDOf(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var processID) || processID <= 0)
            throw new InvalidOperationException($"A variável de ambiente {ParentProcessVariable} deve ser o número de um processo.");

        return processID;
    }
}
