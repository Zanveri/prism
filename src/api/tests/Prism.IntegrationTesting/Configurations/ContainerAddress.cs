using DotNet.Testcontainers.Containers;

namespace Prism.IntegrationTesting.Configurations;

/// <summary>
/// O endereço em que um contêiner de teste atende, que quem sabe é o Testcontainers. Na máquina de quem desenvolve é `localhost`; na
/// pipeline os testes rodam dentro de um contêiner e falam com um serviço de Docker à parte, e o contêiner do banco atende no
/// endereço desse serviço: um `127.0.0.1` fixo não chega nele.
///
/// `localhost` vira `127.0.0.1` porque o contêiner só publica a porta em IPv4: com o nome, o driver tenta o `::1` antes, e a espera
/// por uma porta que ainda não abriu dobra.
/// </summary>
internal static class ContainerAddress
{
    public static string Of(IContainer container)
        => container.Hostname == "localhost" ? "127.0.0.1" : container.Hostname;
}
