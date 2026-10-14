using CSharpFunctionalExtensions;
using Prism.Application.Workspaces.Domain;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Workspaces.Repositories;

/// <summary>Internal, porque a assinatura trafega o domínio, que é internal. A área de trabalho é uma só por usuário, e a gravada troca a anterior inteira.</summary>
internal interface IWorkspaceRepository
{
    /// <summary>Grava a área de trabalho no lugar da anterior; a mesma de novo não regrava o cofre. Falha com 401 `VAULT_LOCKED` ou 503 `VAULT_UNAVAILABLE`.</summary>
    Task<UnitResult<ApiErrorDto>> Replace(Workspace workspace, CancellationToken cancellationToken);
}
