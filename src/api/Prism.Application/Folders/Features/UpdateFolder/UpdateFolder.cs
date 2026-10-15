using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Models.Dtos;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Application.Folders.Features.UpdateFolder;

/// <summary>
/// Renomear, mover e trocar o ambiente são a mesma rota, e o `PATCH` grava a pasta por inteiro: `ParentID` nulo move a
/// pasta para a raiz, o ambiente ausente a deixa sem ambiente (RN-PASTA-005, como no `PATCH` da conexão), e quem só
/// renomeia ou só move manda o que ela já tem.
/// </summary>
public sealed record UpdateFolderCommand : IRequest<Result<FolderDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
}

internal sealed class UpdateFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, TimeProvider timeProvider) : IRequestHandler<UpdateFolderCommand, Result<FolderDto, ApiErrorDto>>
{
    public async Task<Result<FolderDto, ApiErrorDto>> Handle(UpdateFolderCommand request, CancellationToken cancellationToken)
    {
        var loaded = await folderRepository.GetByID(request.ID, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(loaded.Error);

        var folder = loaded.Value;
        var parentChanged = request.ParentID != folder.ParentID;

        // RN-PASTA-003. A pasta pai nova não é conferida por `ExistsByID`: "não existe" quem diz é a gravação, o único lugar em que um cofre
        // fechado não vira 404 (o `false` da consulta é o mesmo para "não existe" e "cofre fechado"). Uma pasta pai inexistente também não é
        // descendente de ninguém, e a conferência segue. Só uma consulta que respondeu "sim" recusa.
        if (parentChanged && request.ParentID is { } parentID && await folderQueries.IsSelfOrDescendant(parentID, folder.ID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.Cycle());

        var name = request.Name.NormalizeName();
        var environmentChanged = EnvironmentRules.NormalizeName(request.EnvironmentName) != folder.EnvironmentName || EnvironmentRules.NormalizeColor(request.EnvironmentColor) != folder.EnvironmentColor;

        // Nada mudou depois da normalização (a tela salva sem editar): carimbar UpdatedAt e regravar o cofre fingiria uma alteração que não houve.
        if (!parentChanged && name == folder.Name && !environmentChanged)
            return Result.Success<FolderDto, ApiErrorDto>(FolderMappings.ToDto(folder));

        // RN-PASTA-002, só quando a chave (nome sem diferenciar maiúsculas, pasta pai) mudou: com ela igual
        // a única pasta que a ocupa é esta mesma, e salvar sem mudar o nome não é duplicidade.
        var keyChanged = parentChanged || !string.Equals(name, folder.Name, StringComparison.OrdinalIgnoreCase);
        if (keyChanged && await folderQueries.Exists(name, request.ParentID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.AlreadyExists(name));

        var now = timeProvider.GetUtcNow().UtcDateTime;
        folder.Rename(name, now);
        folder.MoveTo(request.ParentID, now);
        folder.ChangeEnvironment(request.EnvironmentName, request.EnvironmentColor, now);

        var updated = await folderRepository.Update(folder, cancellationToken);
        if (updated.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(updated.Error);

        return Result.Success<FolderDto, ApiErrorDto>(FolderMappings.ToDto(folder));
    }
}
