using CSharpFunctionalExtensions;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Scripts.Features.DeleteScript;

public sealed record DeleteScriptCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteScriptHandler(IScriptRepository scriptRepository) : IRequestHandler<DeleteScriptCommand, UnitResult<ApiErrorDto>>
{
    /// <summary>Que o script exista é dito só pela gravação: uma leitura antes devolveria "não existe" também com o cofre fechado, e seria um 404 onde o certo é o 401.</summary>
    public Task<UnitResult<ApiErrorDto>> Handle(DeleteScriptCommand request, CancellationToken cancellationToken)
        => scriptRepository.Delete(request.ID, cancellationToken);
}
