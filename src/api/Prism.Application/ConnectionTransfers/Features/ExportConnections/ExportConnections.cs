using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.ConnectionTransfers.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using System.Text;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ConnectionTransfers.Features.ExportConnections;

/// <summary>
/// RN-TRANSF-008: as pastas marcadas (as do caminho de cada item vêm sozinhas), as conexões marcadas com a escolha de cada uma (RN-TRANSF-003), a senha de
/// exportação (RN-TRANSF-004) e, quando pedida, a senha do Prism (RN-TRANSF-005). As duas senhas nunca voltam numa resposta nem vão a log.
/// </summary>
public sealed record ExportConnectionsCommand : IRequest<Result<ExportedConnectionsDto, ApiErrorDto>>
{
    public IReadOnlyList<Guid>? FolderIDs { get; init; }
    public IReadOnlyList<ExportConnectionChoice?>? Connections { get; init; }

    /// <summary>A senha de exportação. Não é a do Prism, e nunca é gravada (nem no cofre, nem nas preferências, nem no arquivo).</summary>
    public string Passphrase { get; init; } = string.Empty;

    /// <summary>A senha do usuário do Prism, só quando ao menos uma conexão vai com a senha de banco gravada (RN-TRANSF-005).</summary>
    public string? UserPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e duas delas são senhas.</summary>
    public override string ToString()
        => nameof(ExportConnectionsCommand);
}

/// <summary>RN-TRANSF-003: a conexão marcada e o que vai dela: `none` (o padrão, ausente ou nulo), `user` ou `userAndPassword`.</summary>
public sealed record ExportConnectionChoice
{
    public Guid ID { get; init; }
    public string? Credentials { get; init; }
}

internal sealed class ExportConnectionsHandler(IVaultService vaultService, IConnectionFileService fileService, ILogger logger) : IRequestHandler<ExportConnectionsCommand, Result<ExportedConnectionsDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<ExportConnectionsHandler>();

    public async Task<Result<ExportedConnectionsDto, ApiErrorDto>> Handle(ExportConnectionsCommand request, CancellationToken cancellationToken)
    {
        // RN-TRANSF-008: a geração é lida ANTES do documento e conferida depois da derivação e da cifra, fora da trava do cofre: se o cofre fechou, ou outro
        // usuário entrou, o arquivo é descartado (como no teste da conexão e na abertura de sessão).
        var generation = vaultService.Generation;

        // Uma leitura do cofre, o documento daquele instante: o que outra janela gravar depois não entra. Exportar não grava o cofre.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Refuse(VaultErrors.From(read.Error));

        var folderIDs = (request.FolderIDs ?? []).Distinct().ToList();
        var choices = (request.Connections ?? []).Select(choice => new ExportChoice(choice!.ID, TransferRules.CredentialsOf(choice.Credentials))).ToList();

        // As recusas que não dependem da senha do Prism vêm antes de ela ser conferida, e não gastam tentativa (RN-TRANSF-005).
        var planned = ExportPlanner.Plan(read.Value, folderIDs, choices);
        if (planned.IsFailure)
            return Refuse(planned.Error);

        var (document, plan) = (read.Value, planned.Value);

        if (plan.NeedsUserPassword)
        {
            // RN-TRANSF-005: exportar a senha de uma conexão é revelá-la. Sem a senha do Prism, nada é conferido nem contado.
            if (string.IsNullOrEmpty(request.UserPassword))
                return Refuse(TransferErrors.UserPasswordRequired());

            // A conferência e a contagem de erros são as de revelar a senha, trocar a senha e do somente leitura, na mesma conta (RN-CONN-003): o quinto erro
            // seguido fecha o cofre e responde 401. O arquivo sai do documento que a conferência devolve, e nunca da leitura de antes (RN-CONN-002).
            var verified = await vaultService.ReadIfPasswordMatchesAsync(request.UserPassword, cancellationToken);
            if (verified.IsFailure)
                return Refuse(VaultErrors.From(verified.Error));

            if (verified.Value is not { } verifiedDocument)
                return Refuse(ProtectionErrors.InvalidPassword());

            // RN-TRANSF-004: comparada só com a senha que veio e conferiu.
            if (PassphraseRules.EqualsUserPassword(request.Passphrase, request.UserPassword))
                return Refuse(TransferErrors.PassphraseEqualsUserPassword());

            // O que foi marcado e não existe mais, as contagens, os níveis e as escolhas, de novo no documento conferido: o cofre pode ter mudado no meio.
            var replanned = ExportPlanner.Plan(verifiedDocument, folderIDs, choices);
            if (replanned.IsFailure)
                return Refuse(replanned.Error);

            (document, plan) = (verifiedDocument, replanned.Value);
        }

        // RN-TRANSF-007: a derivação da chave do arquivo roda fora da trava do cofre, na fila das derivações; o texto em claro e a chave são zerados depois de cifrar.
        var build = ExportPlanner.Build(document, plan);
        var content = await fileService.SealAsync(build.Content, PassphraseRules.ForExport(request.Passphrase), cancellationToken);

        // RN-TRANSF-008: o cofre que fechou, ou mudou de dono, durante a derivação descarta o arquivo antes de qualquer outra resposta, também a do tamanho.
        if (vaultService.Generation != generation)
            return Refuse(VaultErrors.From(EVaultError.Locked));

        // RN-TRANSF-006: o tamanho se sabe com o arquivo montado. Todo arquivo que o Prism gera passa pelos limites da importação dele.
        if (Encoding.UTF8.GetByteCount(content) > TransferLimits.MaxFileBytes)
            return Refuse(TransferErrors.ExportLimitsExceeded());

        // RN-LOG-001 e RN-TRANSF-008: as contagens e os IDs, nunca nomes, hosts, usuários, senhas ou o arquivo.
        _logger.Information("Exportação de conexões: {Folders} pastas e {Connections} conexões, {WithUser} com o usuário e {WithPassword} com a senha; pastas {FolderIDs} e conexões {ConnectionIDs}.", build.Folders, build.Connections, build.WithUser, build.WithPassword, build.FolderIDs, build.ConnectionIDs);

        return Result.Success<ExportedConnectionsDto, ApiErrorDto>(new ExportedConnectionsDto { Content = content, Folders = build.Folders, Connections = build.Connections, WithUser = build.WithUser, WithPassword = build.WithPassword });
    }

    /// <summary>A recusa vai ao log só com o código (a classe da recusa, RN-LOG-001).</summary>
    private Result<ExportedConnectionsDto, ApiErrorDto> Refuse(ApiErrorDto error)
    {
        _logger.Information("Exportação de conexões recusada ({Refusal:l}).", error.Type);

        return Result.Failure<ExportedConnectionsDto, ApiErrorDto>(error);
    }
}
