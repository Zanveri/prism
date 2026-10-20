using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.DbeaverSources.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.DbeaverImports.Features.ScanDbeaver;

/// <summary>
/// RN-DBEAVER-007: a contagem (`POST api/user/connections/dbeaver/scan`), o que o "Comece por aqui", o convite e o seletor do projeto mostram: de cada projeto da cópia,
/// quantas conexões tem e quantas o Prism importa. Não confere os limites de conexões, pastas e níveis, e não apaga a cópia.
/// </summary>
public sealed record ScanDbeaverCommand : IRequest<Result<DbeaverScanDto, ApiErrorDto>>
{
    public string? SourceId { get; init; }

    public override string ToString()
        => nameof(ScanDbeaverCommand);
}

internal sealed class ScanDbeaverHandler(IDbeaverSourceService source, ILogger logger) : IRequestHandler<ScanDbeaverCommand, Result<DbeaverScanDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ScanDbeaverHandler>();

    public Task<Result<DbeaverScanDto, ApiErrorDto>> Handle(ScanDbeaverCommand request, CancellationToken cancellationToken)
    {
        var sourceId = DbeaverRequests.SourceIdOf(request.SourceId!);
        var read = DbeaverSources.Read(source, sourceId, onlyProject: null);
        if (read.IsFailure)
            return Task.FromResult(Refuse(read.Error));

        // Nenhum projeto lido: `DBEAVER_SOURCE_INVALID`. Com algum, os outros são dados da contagem, e não uma recusa.
        if (DbeaverSources.Choose(read.Value, null) is { IsFailure: true } none)
            return Task.FromResult(Refuse(none.Error));

        var projects = read.Value.Projects.Select(Count).ToList();

        // RN-LOG-001: as contagens e o `sourceId`, nunca nomes de projeto, conexões, hosts, usuários ou senhas.
        _logger.Information("Contagem do DBeaver {SourceId}: {Projects} projetos, {Connections} conexões e {Importable} importáveis.", sourceId, projects.Count, projects.Sum(project => project.Connections), projects.Sum(project => project.Importable));

        return Task.FromResult(Result.Success<DbeaverScanDto, ApiErrorDto>(new DbeaverScanDto { Where = read.Value.Where, Projects = projects }));
    }

    /// <summary>
    /// As contagens de um projeto, pela mesma análise da prévia (o que o Prism importa é o que passa nas regras da criação), sem os limites. O projeto que não entra
    /// (protegido, de nome que não serve, ou ilegível) tem zero conexões.
    /// </summary>
    private static DbeaverScanProjectDto Count(DbeaverProjectModel project)
    {
        var importable = 0;
        var withPassword = 0;

        if (project.Included
            && DbeaverAssembly.Build([project], withPasswords: true, [], manyProjectsInSource: false, checkLimits: false) is { IsSuccess: true } assembled
            && ImportAnalysis.Analyze(assembled.Value.File, checkDepth: false) is { IsSuccess: true } analyzed)
        {
            var candidates = analyzed.Value.Connections.Where(connection => connection.Candidate is not null).ToList();
            importable = candidates.Count;
            withPassword = candidates.Count(connection => connection.Candidate!.Password.Length > 0);
        }

        return new DbeaverScanProjectDto
        {
            Name = project.DisplayName,
            Connections = project.Connections.Count,
            Importable = importable,
            WithPassword = withPassword,
            Protected = project.Protected,
            NameInvalid = project.NameInvalid,
            CredentialsUnreadable = project.CredentialsUnreadable,
            CredentialsProtected = project.CredentialsProtected
        };
    }

    private Result<DbeaverScanDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Contagem do DBeaver recusada ({Refusal:l}).", error.Type);

        return Result.Failure<DbeaverScanDto, ApiErrorDto>(error);
    }
}
