using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Services;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Journal.Features.GetAuditFacets;

public sealed record GetAuditFacetsCommand : IRequest<Result<AuditFacetsDto, ApiErrorDto>>;

internal sealed class GetAuditFacetsHandler(IJournalService journalService, IVaultService vaultService) : IRequestHandler<GetAuditFacetsCommand, Result<AuditFacetsDto, ApiErrorDto>>
{
    public async Task<Result<AuditFacetsDto, ApiErrorDto>> Handle(GetAuditFacetsCommand request, CancellationToken cancellationToken)
    {
        var vaultResult = vaultService.Read();
        if (vaultResult.IsFailure)
            return Result.Failure<AuditFacetsDto, ApiErrorDto>(VaultErrors.From(vaultResult.Error));

        var facetsResult = await journalService.FacetsAsync(cancellationToken);
        if (facetsResult.IsFailure)
            return Result.Failure<AuditFacetsDto, ApiErrorDto>(JournalErrors.From(facetsResult.Error));

        var activeById = vaultResult.Value.Connections.ToDictionary(c => c.ID);
        var connections = new List<AuditConnectionFacetDto>();
        var seenIds = new HashSet<Guid>();

        foreach (var facet in facetsResult.Value.Connections)
        {
            seenIds.Add(facet.ConnectionId);
            var isActive = activeById.TryGetValue(facet.ConnectionId, out var active);
            connections.Add(new AuditConnectionFacetDto
            {
                Id = facet.ConnectionId,
                Name = isActive && active is not null ? active.Name : facet.Name,
                Deleted = !isActive,
                Engine = facet.Engine,
                EnvironmentName = facet.EnvironmentName,
                EnvironmentColor = facet.EnvironmentColor
            });
        }

        foreach (var active in vaultResult.Value.Connections)
        {
            if (seenIds.Add(active.ID))
            {
                var (snapshot, _) = JournalSnapshots.FromDocument(vaultResult.Value, active);
                connections.Add(new AuditConnectionFacetDto
                {
                    Id = active.ID,
                    Name = active.Name,
                    Deleted = false,
                    Engine = snapshot.Engine,
                    EnvironmentName = snapshot.EnvironmentName,
                    EnvironmentColor = snapshot.EnvironmentColor
                });
            }
        }

        var environments = facetsResult.Value.Environments
            .Select(env => new AuditEnvironmentFacetDto
            {
                Name = env.Name ?? string.Empty,
                Color = env.Color
            })
            .ToList();

        return Result.Success<AuditFacetsDto, ApiErrorDto>(new AuditFacetsDto
        {
            Connections = connections,
            Environments = environments,
            Count = facetsResult.Value.TotalEntries,
            Oldest = facetsResult.Value.OldestEntryAt,
            SizeBytes = facetsResult.Value.FileSizeBytes,
            RetentionDays = facetsResult.Value.RetentionDays ?? 0
        });
    }
}
