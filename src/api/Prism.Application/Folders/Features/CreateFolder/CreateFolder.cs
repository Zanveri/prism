using CSharpFunctionalExtensions;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Models.Dtos;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Application.Folders.Features.CreateFolder;

/// <summary>`ParentID` nulo cria na raiz (RN-PASTA-001). O ambiente é opcional (RN-PASTA-005): sem nome, a pasta não tem ambiente.</summary>
public sealed record CreateFolderCommand : IRequest<Result<FolderDto, ApiErrorDto>>
{
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
}

internal sealed class CreateFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, TimeProvider timeProvider) : IRequestHandler<CreateFolderCommand, Result<FolderDto, ApiErrorDto>>
{
    public async Task<Result<FolderDto, ApiErrorDto>> Handle(CreateFolderCommand request, CancellationToken cancellationToken)
    {
        var name = request.Name.NormalizeName();

        // RN-PASTA-002. Esta conferência dá a resposta rápida; a que vale contra uma criação simultânea é a do repository, dentro da gravação.
        // A pasta pai não é conferida aqui: "não existe" quem diz é a gravação, o único lugar em que um cofre fechado não vira 404 (a consulta
        // devolve `bool`, e o `false` de `ExistsByID` é o mesmo para "não existe" e "cofre fechado"). Só uma consulta que respondeu "sim" recusa.
        if (await folderQueries.Exists(name, request.ParentID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.AlreadyExists(name));

        var folder = Folder.Create(name, request.ParentID, request.EnvironmentName, request.EnvironmentColor, timeProvider.GetUtcNow().UtcDateTime);

        var inserted = await folderRepository.Insert(folder, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(inserted.Error);

        return Result.Success<FolderDto, ApiErrorDto>(FolderMappings.ToDto(folder));
    }
}
