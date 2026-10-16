using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.ConnectionTransfers.Repositories;

/// <summary>Internal, como a `IConnectionRepository`: a assinatura trafega o que a importação conferiu, que é internal.</summary>
internal interface IConnectionImportRepository
{
    /// <summary>
    /// RN-TRANSF-014: a importação é UMA gravação do cofre (RN-COFRE-005), tudo ou nada, e o `.bak` fica com o cofre de antes dela. Dentro da gravação, contra
    /// o documento mais recente: a geração do cofre lida antes de abrir o arquivo (`generation`, mudou: 401 `VAULT_LOCKED`, e a importação não vai para o
    /// cofre de outra pessoa), o lugar escolhido (excluído: 404 `FOLDER_NOT_FOUND`), e o lugar, os nomes e as proteções de cada item (`ImportPlacement`). Sem
    /// nada criado, nada é gravado. Falha também com o cofre fechado (401) e o disco (503).
    /// </summary>
    Task<Result<ImportPlacementResult, ApiErrorDto>> Import(ImportAnalysis analysis, Guid? targetFolderID, IReadOnlySet<string> selected, EImportConflict onConflict, bool keepVerificationQueries, long generation, DateTime now, CancellationToken cancellationToken);
}
