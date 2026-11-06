using CSharpFunctionalExtensions;
using Prism.Application.BuildModels.Models;
using Prism.Application.BuildModels.Models.Dtos;
using Prism.Application.Common.Vault;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.BuildModels.Repositories;

/// <summary>
/// Lê e grava os modelos do Construir pelo serviço do cofre (seção 7 da especificação). Unicidade do nome, existência do registro e concorrência por
/// <c>expectedUpdatedAt</c> são decididas dentro da função entregue ao <c>SaveOrRefuse</c>, com o semáforo do cofre tomado.
/// </summary>
internal sealed class BuildModelRepository(IVaultService vaultService) : IBuildModelRepository
{
    public Task<UnitResult<ApiErrorDto>> Insert(BuildModelDto model, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            var models = document.BuildModels ?? [];
            if (NameIsTaken(models, model.ID, model.Name))
                return BuildModelErrors.AlreadyExists(model.Name);

            var record = new VaultBuildModelRecord(model.ID, model.Name, model.Body, model.CreatedAt, model.UpdatedAt);

            return document with { BuildModels = [.. models, record] };
        }, cancellationToken);

    public async Task<Result<BuildModelDto, ApiErrorDto>> Update(Guid id, string? name, string? body, DateTime expectedUpdatedAt, DateTime now, CancellationToken cancellationToken)
    {
        BuildModelDto? changed = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var models = document.BuildModels ?? [];
            var existing = models.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return BuildModelErrors.NotFound(id);

            // RN-CONSTRUIR-081: se outra janela salvou depois da leitura desta janela, a gravação é recusada com 409 BUILD_MODEL_CHANGED.
            if (existing.UpdatedAt != expectedUpdatedAt)
                return BuildModelErrors.Changed(id);

            var nextName = name is not null ? name.NormalizeName() : existing.Name;
            if (NameIsTaken(models, id, nextName))
                return BuildModelErrors.AlreadyExists(nextName);

            var nextBody = body ?? existing.Body;
            var updated = existing with { Name = nextName, Body = nextBody, UpdatedAt = now };
            changed = updated.ToDto();

            return document with { BuildModels = [.. models.Select(record => record.ID == id ? updated : record)] };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return changed!;
    }

    public Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            var models = document.BuildModels ?? [];
            if (!models.Any(record => record.ID == id))
                return BuildModelErrors.NotFound(id);

            return document with { BuildModels = [.. models.Where(record => record.ID != id)] };
        }, cancellationToken);

    private static bool NameIsTaken(IReadOnlyList<VaultBuildModelRecord> models, Guid id, string name)
        => models.Any(record => record.ID != id && string.Equals(record.Name, name, StringComparison.OrdinalIgnoreCase));
}
