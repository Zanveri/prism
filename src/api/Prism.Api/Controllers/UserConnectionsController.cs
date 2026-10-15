using Microsoft.AspNetCore.Mvc;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Features.DeleteConnection;
using Prism.Application.Connections.Features.DuplicateConnection;
using Prism.Application.Connections.Features.GetConnection;
using Prism.Application.Connections.Features.GetConnections;
using Prism.Application.Connections.Features.RevealConnectionPassword;
using Prism.Application.Connections.Features.TestConnection;
using Prism.Application.Connections.Features.UpdateConnection;
using Prism.Application.Connections.Features.VerifyConnection;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As conexões do usuário com os bancos (`api/user/...`: só respondem com o cofre aberto). A barreira do
/// `VaultGateMiddleware` fecha o prefixo inteiro, então o controller não confere o cofre; os handlers também
/// recusam com `VAULT_LOCKED` se ele fechar no meio da operação. Sem `[Authorize]` de propósito: não há
/// autenticação do ASP.NET (decisão 1 da seção 8 da especificação). Nenhuma resposta leva a senha do banco, só a
/// revelação (RN-CONN-001 e RN-CONN-002).
/// </summary>
[ApiController]
[Route("api/user/connections")]
public sealed class UserConnectionsController(IMediator mediator) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetConnections(CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetConnectionsCommand(), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetConnection(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetConnectionCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost]
    public async Task<IActionResult> CreateConnection([FromBody] CreateConnectionCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/connections/{result.Value.ID}", result.Value);
    }

    /// <summary>
    /// O corpo leva `id` e todos os campos; `password` ausente ou nulo mantém a senha gravada, desde que o host e a porta não mudem (RN-CONN-004: 422
    /// `CONNECTION_INVALID`). `userPassword` é a senha do usuário que a mudança do somente leitura pede (RN-PROT-003: 422 `USER_PASSWORD_REQUIRED` ou
    /// `INVALID_PASSWORD`, e 401 `VAULT_LOCKED` no quinto erro seguido).
    /// </summary>
    [HttpPatch]
    public async Task<IActionResult> UpdateConnection([FromBody] UpdateConnectionCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// RN-CONN-016: "Duplicar conexão". Sem corpo: a cópia nasce na mesma pasta, com todos os campos e a senha gravada, copiada dentro do cofre, e
    /// o nome "&lt;nome&gt; (cópia)". 201 com a cópia, no formato do `GET api/user/connections/{id}`, e o `Location` dela; 404 `CONNECTION_NOT_FOUND`.
    /// </summary>
    [HttpPost("{id:guid}/duplicate")]
    public async Task<IActionResult> DuplicateConnection(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DuplicateConnectionCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/connections/{result.Value.ID}", result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteConnection(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new DeleteConnectionCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    /// <summary>
    /// RN-CONN-013: abre, confere e fecha, sem gravar nada. O corpo leva os campos da conexão e, opcional, a consulta de verificação do formulário
    /// (`verificationQuery`, RN-VERIF-001), que o teste executa no lugar da do banco; `id` e `password` são opcionais, e sem
    /// `password` e com `id` a API usa a senha guardada, se o host e a porta são os gravados (RN-CONN-013: 422 `CONNECTION_INVALID`, sem conectar). A rota `test` é literal e não colide com `{id:guid}`.
    /// </summary>
    [HttpPost("test")]
    public async Task<IActionResult> TestConnection([FromBody] TestConnectionCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    /// <summary>
    /// RN-VERIF-002: a verificação periódica da conexão conectada, sem corpo. Roda a consulta de verificação numa sessão já aberta e livre dela, e
    /// responde 200 `{ status, checkedAt, elapsedMs, message, sqlState }` (`ok`, `failed`, `busy` ou `notConnected`): a falha do banco é resposta,
    /// e não erro. 404 `CONNECTION_NOT_FOUND`.
    /// </summary>
    [HttpPost("{id:guid}/verification")]
    public async Task<IActionResult> VerifyConnection(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new VerifyConnectionCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// O corpo leva `password`, a senha do usuário do Prism. O `id` é o da rota. Senha errada é 422 `INVALID_PASSWORD` (e não
    /// 401, que a tela renovaria e repetiria), e o quinto erro seguido fecha o cofre e responde 401 `VAULT_LOCKED`.
    /// </summary>
    [HttpPost("{id:guid}/password/reveal")]
    public async Task<IActionResult> RevealConnectionPassword(Guid id, [FromBody] RevealConnectionPasswordCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { ID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }
}
