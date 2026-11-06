using Microsoft.AspNetCore.Mvc;
using Prism.Application.BuildModels.Features.CreateBuildModel;
using Prism.Application.BuildModels.Features.DeleteBuildModel;
using Prism.Application.BuildModels.Features.GetBuildModel;
using Prism.Application.BuildModels.Features.GetBuildModels;
using Prism.Application.BuildModels.Features.UpdateBuildModel;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// Os modelos do modo Construir salvos no cofre do usuário (seção 7 da especificação de Construir, <c>api/user/build-models</c>).
/// Todas as respostas de leitura, criação e alteração devolvem o corpo JSON do modelo, pois a lista mostra destino e contagens.
/// </summary>
[ApiController]
[Route("api/user/build-models")]
public sealed class UserBuildModelsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetBuildModels(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetBuildModelsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetBuildModel(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetBuildModelCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> CreateBuildModel([FromBody] CreateBuildModelCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/build-models/{result.Value.ID}", result.Value);
    }

    [HttpPatch("{id:guid}")]
    public async Task<IActionResult> UpdateBuildModel(Guid id, [FromBody] UpdateBuildModelCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { ID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteBuildModel(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteBuildModelCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }
}
