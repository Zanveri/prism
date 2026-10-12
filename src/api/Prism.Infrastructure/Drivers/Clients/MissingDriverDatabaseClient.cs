using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Services;

namespace Prism.Infrastructure.Drivers.Clients;

/// <summary>
/// O client de um banco cujo driver esta execução da API não tem (RN-DRIVER-006): fica no lugar do client de verdade e responde a
/// recusa do gerenciador de drivers, sem conectar e sem tocar em nenhum tipo do fabricante. É por ele existir que abrir sessão ou
/// testar conexão sem o driver é uma resposta, e não a falha de carga de um assembly que não está lá.
/// </summary>
internal sealed class MissingDriverDatabaseClient(EDatabaseEngine engine, IDriverService driverService) : IDatabaseClient
{
    public EDatabaseEngine Engine => engine;

    /// <summary>A recusa é perguntada a cada chamada: a mensagem muda quando o driver é instalado e passa a esperar o reinício.</summary>
    public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => Task.FromResult(Result.Failure<IDatabaseConnection, DatabaseFailure>(driverService.RefusalFor(engine) ?? new DatabaseFailure(EDatabaseFailure.DriverNotInstalled, "O driver deste banco não está em uso nesta execução do Prism. Reinicie o Prism.")));
}
