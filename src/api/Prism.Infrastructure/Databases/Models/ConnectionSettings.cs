namespace Prism.Infrastructure.Databases.Models;

/// <summary>O que um driver precisa para abrir a conexão com um banco. Carrega a senha do banco: nunca vai a log.</summary>
public sealed record ConnectionSettings(EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string IsolationLevel = IsolationLevels.Default)
{
    /// <summary>O `ToString()` gerado de um record imprime todas as propriedades, e esta tem a senha (RN-LOG-001).</summary>
    public override string ToString()
        => nameof(ConnectionSettings);
}
