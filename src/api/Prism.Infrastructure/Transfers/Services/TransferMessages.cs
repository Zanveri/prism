using Prism.Core.Extensions;
using System.Globalization;
using System.Resources;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// Os textos das exportações, importações e cópias que chegam à tela, no idioma do pedido: <c>TransferMessages.resx</c> (português) e as traduções ao lado.
/// O conteúdo dos arquivos exportados não passa por aqui: fica em português (as fixtures de <c>src/test-fixtures/export</c> o comparam).
/// </summary>
internal static class TransferMessages
{
    internal static readonly ResourceManager Texts = new(typeof(TransferMessages));

    /// <summary>O texto da chave na <see cref="CultureInfo.CurrentUICulture"/>, com os argumentos formatados na <see cref="CultureInfo.CurrentCulture"/>.</summary>
    internal static string Say(string key, params object?[] args)
        => Texts.Get(key, args);

    /// <summary>
    /// O texto no idioma guardado de um pedido, para o que nasce fora dele (o temporizador do registro): um trabalho em segundo plano que o pedido iniciou
    /// herda a <see cref="CultureInfo.CurrentUICulture"/> dele, mas o temporizador não.
    /// </summary>
    internal static string SayIn(CultureInfo culture, string key)
        => Texts.GetString(key, culture) ?? key;
}
