using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Prism.Application.DatabaseSessions.Features.ApplyEdits;
using Prism.Application.DatabaseSessions.Features.CancelQuery;
using Prism.Application.DatabaseSessions.Features.CloseDatabaseSession;
using Prism.Application.DatabaseSessions.Features.CountQuery;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Features.FetchNextPage;
using Prism.Application.DatabaseSessions.Features.GetDatabases;
using Prism.Application.DatabaseSessions.Features.GetEditTarget;
using Prism.Application.DatabaseSessions.Features.GetResultCells;
using Prism.Application.DatabaseSessions.Features.GetDatabaseProperties;
using Prism.Application.DatabaseSessions.Features.GetSchemaDiagram;
using Prism.Application.DatabaseSessions.Features.GetSchemaObjects;
using Prism.Application.DatabaseSessions.Features.GetSchemas;
using Prism.Application.DatabaseSessions.Features.GetTableChecks;
using Prism.Application.DatabaseSessions.Features.GetTableColumns;
using Prism.Application.DatabaseSessions.Features.GetTableForeignKeys;
using Prism.Application.DatabaseSessions.Features.GetTableIndexes;
using Prism.Application.DatabaseSessions.Features.GetTableReferencedBy;
using Prism.Application.DatabaseSessions.Features.GetViewDefinition;
using Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;
using Prism.Application.DatabaseSessions.Features.PreviewEdits;
using Prism.Core.Extensions;
using Prism.Core.Mediator;

namespace Prism.Api.Controllers;

/// <summary>
/// As sessões do usuário com os bancos, o catálogo e os comandos (`api/user/...`: só respondem com o cofre aberto). A barreira do
/// `VaultGateMiddleware` fecha o prefixo inteiro, então o controller não confere o cofre; os handlers também recusam com
/// `VAULT_LOCKED` se ele fechar no meio da operação. Sem `[Authorize]` de propósito: não há autenticação do ASP.NET (decisão 1 da
/// seção 8 da especificação). O `id` da sessão vem sempre da rota, nunca do corpo.
/// </summary>
[ApiController]
[Route("api/user/database-sessions")]
public sealed class UserDatabaseSessionsController(IMediator mediator) : ControllerBase, IActionFilter
{
    /// <summary>O corpo leva `connectionID` e, para outro banco do mesmo servidor, `database` (RN-ARVORE-006). O `Location` aponta para a sessão, que se fecha por essa rota.</summary>
    [HttpPost]
    public async Task<IActionResult> OpenDatabaseSession([FromBody] OpenDatabaseSessionCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Created($"/api/user/database-sessions/{result.Value.ID}", result.Value);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> CloseDatabaseSession(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new CloseDatabaseSessionCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    /// <summary>RN-ARVORE-006: os bancos do servidor da sessão, com o dela primeiro.</summary>
    [HttpGet("{id:guid}/databases")]
    public async Task<IActionResult> GetDatabases(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetDatabasesCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}/schemas")]
    public async Task<IActionResult> GetSchemas(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetSchemasCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>`kind` ausente vira vazio, que o validator recusa com `OBJECT_KIND_INVALID`: um parâmetro de rota obrigatório do ASP.NET responderia 400 em outro formato.</summary>
    [HttpGet("{id:guid}/schemas/{schema}/objects")]
    public async Task<IActionResult> GetSchemaObjects(Guid id, [FromQuery] string? kind, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetSchemaObjectsCommand(id, PathName(2), kind ?? string.Empty), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}/schemas/{schema}/tables/{table}/columns")]
    public async Task<IActionResult> GetTableColumns(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTableColumnsCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}/schemas/{schema}/tables/{table}/indexes")]
    public async Task<IActionResult> GetTableIndexes(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTableIndexesCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpGet("{id:guid}/schemas/{schema}/tables/{table}/foreign-keys")]
    public async Task<IActionResult> GetTableForeignKeys(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTableForeignKeysCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-CAT-004: as chaves estrangeiras que apontam para a tabela.</summary>
    [HttpGet("{id:guid}/schemas/{schema}/tables/{table}/referenced-by")]
    public async Task<IActionResult> GetTableReferencedBy(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTableReferencedByCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-CAT-005: as restrições de conferência da tabela.</summary>
    [HttpGet("{id:guid}/schemas/{schema}/tables/{table}/checks")]
    public async Task<IActionResult> GetTableChecks(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetTableChecksCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-CAT-006: `{ definition }`, nulo quando o banco não devolve nada.</summary>
    [HttpGet("{id:guid}/schemas/{schema}/views/{view}/definition")]
    public async Task<IActionResult> GetViewDefinition(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetViewDefinitionCommand(id, PathName(4), PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-CAT-008: `{ tables, foreignKeys }` do esquema inteiro.</summary>
    [HttpGet("{id:guid}/schemas/{schema}/diagram")]
    public async Task<IActionResult> GetSchemaDiagram(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetSchemaDiagramCommand(id, PathName(2)), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-CAT-010: a lista de `{ name, value }` do banco conectado.</summary>
    [HttpGet("{id:guid}/properties")]
    public async Task<IActionResult> GetDatabaseProperties(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new GetDatabasePropertiesCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>O corpo leva `sql` e, se quiser, `pageSize` (RN-SQL-016). Devolve a primeira página, ou as linhas afetadas quando o comando não devolve linhas.</summary>
    [HttpPost("{id:guid}/queries")]
    public async Task<IActionResult> ExecuteQuery(Guid id, [FromBody] ExecuteQueryCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { SessionID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost("{id:guid}/queries/next")]
    public async Task<IActionResult> FetchNextPage(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new FetchNextPageCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost("{id:guid}/queries/count")]
    public async Task<IActionResult> CountQuery(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new CountQueryCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-EDIT-002, 003 e 010: o corpo leva `resultID` e, se a tela tiver, `catalogSessionID` (a sessão da árvore da mesma conexão).</summary>
    [HttpPost("{id:guid}/queries/edit-target")]
    public async Task<IActionResult> GetEditTarget(Guid id, [FromBody] GetEditTargetCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { SessionID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-EDIT-005 e 012: o "Salvar". O corpo leva `resultID` e `changes`; a resposta é `{ applied }`.</summary>
    [HttpPost("{id:guid}/queries/edits")]
    public async Task<IActionResult> ApplyEdits(Guid id, [FromBody] ApplyEditsCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { SessionID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>RN-EDIT-008: o "Ver SQL" das mesmas alterações, sem executar nada.</summary>
    [HttpPost("{id:guid}/queries/edits/preview")]
    public async Task<IActionResult> PreviewEdits(Guid id, [FromBody] PreviewEditsCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { SessionID = id }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    /// <summary>
    /// RN-SQL-017: o valor completo das células que chegaram cortadas, para copiar e exportar. O corpo leva `cells` (até 10.000), cada uma
    /// pela linha no resultado inteiro e pela coluna; a resposta, `{ values }` na ordem pedida.
    /// </summary>
    [HttpPost("{id:guid}/results/{resultID:guid}/cells")]
    public async Task<IActionResult> GetResultCells(Guid id, Guid resultID, [FromBody] GetResultCellsCommand command, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(command with { SessionID = id, ResultID = resultID }, cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return Ok(result.Value);
    }

    [HttpPost("{id:guid}/queries/cancel")]
    public async Task<IActionResult> CancelQuery(Guid id, CancellationToken cancellationToken)
    {
        var result = await mediator.Send(new CancelQueryCommand(id), cancellationToken);
        if (result.IsFailure)
            return result.ToIActionResult();

        return NoContent();
    }

    /// <summary>
    /// O Kestrel tira os segmentos `.` e `..` (crus ou `%2E`) do caminho ANTES de rotear, e o alvo cru fica como chegou: ler os nomes dele
    /// leria posições diferentes das que o roteador casou (`.../tables/segredo/../pedido/columns` casa `loja`/`pedido`, e o alvo cru diz
    /// `segredo`/`pedido`). Um caminho com esse segmento responde como a rota que não casa, 404 sem corpo: não há código de erro da API
    /// para isto na seção 6, e o roteador também não dá um. Consequência: um esquema ou uma tabela chamados `.` ou `..` não são
    /// alcançáveis por estas rotas, porque o `encodeURIComponent` não codifica o ponto e o Kestrel os tiraria do caminho de qualquer jeito.
    /// </summary>
    [NonAction]
    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (RawPathSegments().Any(segment => segment is "." or ".."))
        {
            context.HttpContext.Response.StatusCode = StatusCodes.Status404NotFound;
            context.Result = new EmptyResult();
        }
    }

    [NonAction]
    public void OnActionExecuted(ActionExecutedContext context)
    {
    }

    /// <summary>
    /// Um nome de esquema ou de tabela da rota, lido do alvo da requisição como chegou e decodificado aqui, uma vez. A tela codifica cada
    /// nome com `encodeURIComponent`, e o valor de rota que o ASP.NET Core entrega já foi decodificado pelo Kestrel, menos o `%2F`: a barra
    /// do nome (`a%2Fb`) e o texto literal `%2F` dele (`a%252Fb`) chegam iguais (`a%2Fb`), e decodificar o valor de novo desfaria um nome
    /// com `%41` no meio. O alvo cru ainda distingue os dois. Conta-se a partir do fim do caminho, que é fixo (`.../schemas/{schema}/objects`
    /// e `.../schemas/{schema}/tables/{table}/{rota}`, `.../schemas/{schema}/views/{view}/definition` e `.../schemas/{schema}/diagram`),
    /// para não depender do que vem antes dele.
    /// </summary>
    private string PathName(int segmentsFromEnd)
        => RawPathSegments().ToArray()[^segmentsFromEnd];

    /// <summary>Os segmentos do caminho do alvo cru, sem a query string e sem a barra final, cada um decodificado uma vez.</summary>
    private IEnumerable<string> RawPathSegments()
    {
        var target = HttpContext.Features.Get<IHttpRequestFeature>()!.RawTarget;
        var path = target.Split('?', 2)[0].TrimEnd('/');

        return path.Split('/').Select(Uri.UnescapeDataString);
    }
}
