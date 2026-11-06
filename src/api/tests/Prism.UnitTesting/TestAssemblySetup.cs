using System.Globalization;
using System.Runtime.CompilerServices;

namespace Prism.UnitTesting;

internal static class TestAssemblySetup
{
    /// <summary>
    /// Os testes comparam as mensagens em português, e o texto de um <c>.resx</c> sai na UICulture: pt-BR em qualquer máquina, como num pedido sem
    /// <c>Accept-Language</c>. Só a UICulture; a CurrentCulture continua a da máquina, como antes.
    /// </summary>
    [ModuleInitializer]
    internal static void UsePortugueseTexts()
        => CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo("pt-BR");
}
