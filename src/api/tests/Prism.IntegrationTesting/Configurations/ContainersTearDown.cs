using Prism.IntegrationTesting.Configurations;

namespace Prism.IntegrationTesting;

/// <summary>
/// Derruba os contêineres depois do último fixture, qualquer que seja o filtro da execução. Fica no namespace raiz porque um
/// `[SetUpFixture]` vale para o namespace dele e os de dentro; um fixture "ordenado por último" só valeria dentro do próprio namespace.
/// </summary>
[SetUpFixture]
public sealed class ContainersTearDown
{
    [OneTimeTearDown]
    public Task DisposeContainers()
        => Task.WhenAll(PostgresSingleton.DisposeAsync(), Db2Singleton.DisposeAsync(), InformixSingleton.DisposeAsync());
}
