using System.Runtime.InteropServices;

namespace Prism.Infrastructure.Drivers.Models;

/// <summary>
/// Onde os drivers ficam, de onde vêm e para qual plataforma. Não é configuração: em produção os três valores saem de
/// <see cref="For"/>, e nenhum deles é lido de variável de ambiente nem de arquivo (RN-DRIVER-008). O registro existe para o host de
/// teste trocá-lo por um que aponta para um servidor de mentira, e não há outro jeito de mudar o endereço.
/// </summary>
/// <param name="Directory">RN-DRIVER-003 e 009: `&lt;PRISM_DATA_DIR&gt;/drivers`, da máquina e não do cofre.</param>
/// <param name="PackageSource">O contêiner plano do nuget.org; o resto do endereço sai do catálogo.</param>
/// <param name="Platform">O identificador de runtime que escolhe o pacote no catálogo (`win-x64`, `linux-x64`, `osx-arm64`).</param>
internal sealed record DriverSettings(string Directory, Uri PackageSource, string Platform)
{
    /// <summary>RN-DRIVER-008: o único destino de saída da API.</summary>
    public static readonly Uri NuGetOrg = new("https://api.nuget.org/v3-flatcontainer/");

    public static DriverSettings For(string dataDirectory)
        => new(Path.Combine(dataDirectory, "drivers"), NuGetOrg, RuntimeInformation.RuntimeIdentifier);
}
