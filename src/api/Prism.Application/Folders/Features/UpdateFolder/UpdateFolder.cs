using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Models.Dtos;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Application.Folders.Features.UpdateFolder;

/// <summary>
/// Renomear, mover e trocar o ambiente, a cor ou as proteções são a mesma rota, e o `PATCH` grava a pasta por inteiro: `ParentID` nulo
/// move a pasta para a raiz, o ambiente ausente a deixa sem ambiente (RN-PASTA-005, como no `PATCH` da conexão), a cor
/// ausente a deixa sem cor (RN-PASTA-007), a confirmação ausente volta a "Não" e o somente leitura ausente sai (RN-PROT-001 e 002),
/// e quem só renomeia ou só move manda o que ela já tem.
///
/// `UserPassword` é a senha do usuário do Prism, que só a mudança do somente leitura pede (RN-PROT-003: marcar ou desmarcar o da pasta, ou mover
/// para fora de uma pasta somente leitura uma pasta que tem conexões dentro); quem decide se ela é pedida é a gravação, contra o documento mais recente.
/// </summary>
public sealed record UpdateFolderCommand : IRequest<Result<FolderDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
    public string? Color { get; init; }

    /// <summary>RN-PROT-001: `none`, `irreversible` ou `all`; ausente, nulo ou vazio é `none`.</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: ausente é falso.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-PROT-003: a senha do usuário do Prism.</summary>
    public string? UserPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta pode ser a senha do usuário.</summary>
    public override string ToString() => nameof(UpdateFolderCommand);
}

internal sealed class UpdateFolderHandler(IFolderQueries folderQueries, IFolderRepository folderRepository, TimeProvider timeProvider) : IRequestHandler<UpdateFolderCommand, Result<FolderDto, ApiErrorDto>>
{
    public async Task<Result<FolderDto, ApiErrorDto>> Handle(UpdateFolderCommand request, CancellationToken cancellationToken)
    {
        var loaded = await folderRepository.GetByID(request.ID, cancellationToken);
        if (loaded.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(loaded.Error);

        var (folder, protections) = loaded.Value;
        var parentChanged = request.ParentID != folder.ParentID;

        // RN-PASTA-003. A pasta pai nova não é conferida por `ExistsByID`: "não existe" quem diz é a gravação, o único lugar em que um cofre
        // fechado não vira 404 (o `false` da consulta é o mesmo para "não existe" e "cofre fechado"). Uma pasta pai inexistente também não é
        // descendente de ninguém, e a conferência segue. Só uma consulta que respondeu "sim" recusa.
        if (parentChanged && request.ParentID is { } parentID && await folderQueries.IsSelfOrDescendant(parentID, folder.ID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.Cycle());

        var name = request.Name.NormalizeName();
        var environmentChanged = EnvironmentRules.NormalizeName(request.EnvironmentName) != folder.EnvironmentName || EnvironmentRules.NormalizeColor(request.EnvironmentColor) != folder.EnvironmentColor;
        var colorChanged = EnvironmentRules.NormalizeColor(request.Color) != folder.Color;
        var protectionsChanged = ProtectionRules.NormalizeConfirmation(request.ConfirmCommands) != folder.ConfirmCommands || request.ReadOnly != folder.ReadOnly;

        // Nada mudou depois da normalização (a tela salva sem editar): carimbar UpdatedAt e regravar o cofre fingiria uma alteração que não houve.
        // Nada mudou também não pede a senha do usuário: o somente leitura continua o mesmo.
        if (!parentChanged && name == folder.Name && !environmentChanged && !colorChanged && !protectionsChanged)
            return Result.Success<FolderDto, ApiErrorDto>(folder.ToDto(protections));

        // RN-PASTA-002, só quando a chave (nome sem diferenciar maiúsculas, pasta pai) mudou: com ela igual
        // a única pasta que a ocupa é esta mesma, e salvar sem mudar o nome não é duplicidade.
        var keyChanged = parentChanged || !string.Equals(name, folder.Name, StringComparison.OrdinalIgnoreCase);
        if (keyChanged && await folderQueries.Exists(name, request.ParentID, cancellationToken))
            return Result.Failure<FolderDto, ApiErrorDto>(FolderErrors.AlreadyExists(name));

        var now = timeProvider.GetUtcNow().UtcDateTime;
        folder.Rename(name, now);
        folder.MoveTo(request.ParentID, now);
        folder.ChangeEnvironment(request.EnvironmentName, request.EnvironmentColor, now);
        folder.ChangeColor(request.Color, now);
        folder.ChangeProtections(request.ConfirmCommands, request.ReadOnly, now);

        // A senha do usuário vai à gravação, que a confere só se a mudança do somente leitura a pede (RN-PROT-003). As proteções que valem
        // (RN-PROT-004) saem do documento gravado.
        var updated = await folderRepository.Update(folder, request.UserPassword, cancellationToken);
        if (updated.IsFailure)
            return Result.Failure<FolderDto, ApiErrorDto>(updated.Error);

        return Result.Success<FolderDto, ApiErrorDto>(folder.ToDto(updated.Value));
    }
}
