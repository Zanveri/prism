using CSharpFunctionalExtensions;
using Prism.Application.Workspaces.Models.Dtos;
using Prism.Application.Workspaces.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using ILogger = Serilog.ILogger;

namespace Prism.Application.Workspaces.Features.SaveWorkspace;

/// <summary>
/// RN-ABAS-006: as abas abertas de todas as janelas, na ordem, e o índice da ativa. A tela manda a lista inteira alguns segundos depois de cada mudança, ao
/// fechar uma aba e antes de o cofre fechar; a gravada troca a anterior.
/// </summary>
public sealed record SaveWorkspaceCommand : IRequest<UnitResult<ApiErrorDto>>
{
    public IReadOnlyList<WorkspaceTabDto> Tabs { get; init; } = [];
    public int? ActiveIndex { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria as abas, com o texto do SQL.</summary>
    public override string ToString() => nameof(SaveWorkspaceCommand);
}

internal sealed class SaveWorkspaceHandler(IWorkspaceRepository workspaceRepository, ILogger logger) : IRequestHandler<SaveWorkspaceCommand, UnitResult<ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<SaveWorkspaceHandler>();

    public async Task<UnitResult<ApiErrorDto>> Handle(SaveWorkspaceCommand request, CancellationToken cancellationToken)
    {
        var workspace = request.Tabs.ToDomain(request.ActiveIndex);

        var saved = await workspaceRepository.Replace(workspace, cancellationToken);
        if (saved.IsFailure)
            return saved;

        // Seção 24: o log destas rotas registra só a contagem de abas, nunca o SQL nem os nomes (RN-LOG-001).
        _logger.Information("Área de trabalho gravada com {TabCount} abas.", workspace.Tabs.Count);

        return saved;
    }
}
