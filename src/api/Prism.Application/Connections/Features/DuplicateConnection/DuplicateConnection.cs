using CSharpFunctionalExtensions;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using ILogger = Serilog.ILogger;

namespace Prism.Application.Connections.Features.DuplicateConnection;

/// <summary>RN-CONN-016: "Duplicar conexão". Só o ID, que vem da rota: a senha é copiada dentro do cofre e não passa pela tela.</summary>
public sealed record DuplicateConnectionCommand(Guid ID) : IRequest<Result<ConnectionDto, ApiErrorDto>>;

internal sealed class DuplicateConnectionHandler(IConnectionRepository connectionRepository, TimeProvider timeProvider, ILogger logger) : IRequestHandler<DuplicateConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<DuplicateConnectionHandler>();

    public async Task<Result<ConnectionDto, ApiErrorDto>> Handle(DuplicateConnectionCommand request, CancellationToken cancellationToken)
    {
        // Uma gravação só, sem leitura antes: que a conexão exista, o nome livre da cópia na pasta (RN-CONN-011) e a senha copiada quem resolve é
        // a função do `SaveAsync`, com o documento mais recente. Uma leitura feita antes devolveria "não existe" também com o cofre fechado.
        var duplicated = await connectionRepository.Duplicate(request.ID, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
        if (duplicated.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(duplicated.Error);

        // RN-LOG-001: os IDs, e nada da conexão (nome, host, usuário e senha ficam fora do log).
        _logger.Information("Conexão {ConnectionID} duplicada; a cópia é a conexão {CopyID}.", request.ID, duplicated.Value.ID);

        // RN-CONN-001: a resposta é a do detalhe, sem a senha.
        return Result.Success<ConnectionDto, ApiErrorDto>(duplicated.Value.ToDto());
    }
}
