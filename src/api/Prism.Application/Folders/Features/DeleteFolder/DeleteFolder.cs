using CSharpFunctionalExtensions;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Folders.Features.DeleteFolder;

public sealed record DeleteFolderCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository) : IRequestHandler<DeleteFolderCommand, UnitResult<ApiErrorDto>>
{
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteFolderCommand request, CancellationToken cancellationToken)
    {
        // RN-PASTA-004. A conferência que vale contra uma subpasta criada ao mesmo tempo é a do repository, dentro da gravação.
        // Que a pasta exista também é dito só por ela: o `false` de `ExistsByID` é o mesmo para "não existe" e "cofre fechado", e uma pasta
        // que não existe não tem filhos, então esta conferência segue. Só uma consulta que respondeu "sim" recusa.
        if (await folderQueries.HasChildren(request.ID, cancellationToken))
            return UnitResult.Failure(FolderErrors.NotEmpty());

        return await folderRepository.Delete(request.ID, cancellationToken);
    }
}
