using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Workspaces.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.Workspaces.Features.GetWorkspace;

/// <summary>RN-ABAS-006: as abas gravadas, que a janela principal reabre na entrada, desconectadas. Nada gravado é a lista vazia e o índice nulo.</summary>
public sealed record GetWorkspaceCommand : IRequest<Result<WorkspaceDto, ApiErrorDto>>;

internal sealed class GetWorkspaceHandler(IVaultService vaultService, ILogger logger) : IRequestHandler<GetWorkspaceCommand, Result<WorkspaceDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<GetWorkspaceHandler>();

    public Task<Result<WorkspaceDto, ApiErrorDto>> Handle(GetWorkspaceCommand request, CancellationToken cancellationToken)
    {
        // Uma lista vazia seria a resposta errada para um cofre fechado: a tela acharia que não havia abas, e a gravação seguinte apagaria as que havia.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<WorkspaceDto, ApiErrorDto>(VaultErrors.From(read.Error)));

        var workspace = read.Value.Workspace.ToDto();

        // Seção 24: só a contagem de abas, nunca o SQL nem os nomes (RN-LOG-001).
        _logger.Information("Área de trabalho lida com {TabCount} abas.", workspace.Tabs.Count);

        return Task.FromResult(Result.Success<WorkspaceDto, ApiErrorDto>(workspace));
    }
}
