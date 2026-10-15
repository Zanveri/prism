using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Features.TestConnection;

/// <summary>
/// RN-CONN-013: os campos do formulário, sem gravar nada. `ID` e `Password` são opcionais: sem `Password` e com `ID`, a API usa a senha
/// que o cofre guarda para essa conexão (a tela não tem como mandá-la sem a pessoa redigitá-la, RN-CONN-002), desde que o host e a porta
/// sejam os gravados (422 `CONNECTION_INVALID`, sem conectar); sem `Password` e sem `ID`, o validator recusa. Os campos que só servem para gravar (nome, pasta, ambiente) que o formulário mande são ignorados.
///
/// `VerificationQuery` é a consulta de verificação do formulário (RN-VERIF-001): quando vem, o teste a executa no lugar da do banco, com as regras da
/// verificação periódica (uma leitura só, até 1.000 caracteres; a recusa é do validator, antes de conectar).
/// </summary>
public sealed record TestConnectionCommand : IRequest<UnitResult<ApiErrorDto>>
{
    public Guid? ID { get; init; }
    public EDatabaseEngine Engine { get; init; }
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string UserName { get; init; } = string.Empty;
    public string? Password { get; init; }
    public string? VerificationQuery { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha do banco (e o host e o usuário vão junto).</summary>
    public override string ToString() => nameof(TestConnectionCommand);
}

internal sealed class TestConnectionHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService, IVaultService vaultService) : IRequestHandler<TestConnectionCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(TestConnectionCommand request, CancellationToken cancellationToken)
    {
        // Lida ANTES de a senha guardada ser lida: o teste conecta fora do semáforo do cofre (a mesma regra da abertura de sessão).
        var generation = vaultService.Generation;
        var password = request.Password;

        // Sem senha no pedido o validator garante que há `ID`, e a senha é a do cofre. Cofre fechado é 401; só um sucesso com `null` é "não existe" (404).
        if (password is null)
        {
            var id = request.ID.GetValueOrDefault();
            var read = await connectionQueries.GetRecordByID(id, cancellationToken);
            if (read.IsFailure)
                return UnitResult.Failure(VaultErrors.From(read.Error));

            if (read.Value is not { } record)
                return UnitResult.Failure(ConnectionErrors.NotFound(id));

            // RN-CONN-013 com a RN-CONN-004: a senha gravada só vai ao servidor para o qual foi gravada. A recusa vem antes de qualquer conexão.
            if (!ConnectionRules.SameServer(record.Host, record.Port, request.Host, request.Port))
                return UnitResult.Failure(ConnectionErrors.PasswordRequiredToTestOtherServer());

            password = record.Password;
        }

        // Aparados como o domínio os grava (`Connection.Create`): testar e gravar o mesmo formulário conecta da mesma forma.
        var settings = new ConnectionSettings(request.Engine, request.Host.Trim(), request.Port, request.Database.Trim(), request.UserName.Trim(), password);
        var tested = await databaseSessionService.TestAsync(settings, ConnectionRules.NormalizeVerificationQuery(request.VerificationQuery), cancellationToken);
        if (tested.IsFailure)
            return UnitResult.Failure(DatabaseSessionErrors.From(tested.Error));

        // O cofre mudou enquanto o teste rodava: o resultado é de credenciais que já não são de quem pediu.
        if (vaultService.Generation != generation)
            return UnitResult.Failure(VaultErrors.From(EVaultError.Locked));

        return UnitResult.Success<ApiErrorDto>();
    }
}
